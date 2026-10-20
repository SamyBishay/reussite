// Helpers for the connector tests: an app device that syncs through the relay, switching the
// connector on, signing in as an AI app (dynamic registration, pairing code, PKCE) and calling /mcp.
import { env, exports } from 'cloudflare:workers';
import { b64uEncode } from '../../src/sync/bytes';
import { RelayClient } from '../../src/sync/client';
import { deriveKeys, generateKey, type SpaceKeys } from '../../src/sync/keys';
import { syncOnce } from '../../src/sync/run';
import { FakeDevice } from '../../src/sync/testing';
import type { ConnectorOnResponse } from '../../src/sync/protocol';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { BASE, call, url } from './helpers';

export const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
export const viaWorker: typeof fetch = (input, init) => exports.default.fetch(new Request(input as RequestInfo, init));

export interface App { keys: SpaceKeys; key: Uint8Array; client: RelayClient; device: FakeDevice; sync(): ReturnType<typeof syncOnce> }

/** An app device with a fresh space; `sync()` is what the app does on open. */
export async function newApp(node = 'app00001'): Promise<App> {
  const key = generateKey();
  const keys = await deriveKeys(key);
  const client = new RelayClient(BASE, keys, viaWorker);
  const device = new FakeDevice(node);
  return { keys, key, client, device, sync: () => syncOnce(device, client) };
}

export const switchOn = (app: App, env?: Record<string, string>) =>
  call('POST', url(app.keys, '/connector'), app.keys, { body: { key: b64uEncode(app.keys.encKeyRaw) }, env: env as never });

export const pairingCode = (r: { body: ConnectorOnResponse }) => r.body.code;

/** Through the Worker's default export, or (with `env`) straight into its router with other settings, e.g. tight rate limits. */
const send = (path: string, init: RequestInit = {}, withEnv?: Partial<Env>) => {
  const req = new Request(BASE + path, { ...init, headers: { 'CF-Connecting-IP': 'ip-' + Math.random(), ...(init.headers as Record<string, string>) } });
  return withEnv ? handle(req, { ...(env as unknown as Env), ...withEnv }) : exports.default.fetch(req);
};

async function pkce() {
  const verifier = b64uEncode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64uEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

export interface Registered { clientId: string }
export async function register(name = 'Claude', redirect = REDIRECT): Promise<Registered> {
  const res = await send('/oauth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  if (res.status >= 300) throw new Error('register ' + res.status + ' ' + (await res.text()));
  return { clientId: ((await res.json()) as { client_id: string }).client_id };
}

export interface Begun { query: string; html: string; status: number; cookie: string; handle: string; verifier: string; clientId: string }
/** GET /authorize as the AI app's browser would. */
export async function beginAuthorize(clientId: string, o: { redirect?: string; acceptLanguage?: string } = {}): Promise<Begun> {
  const { verifier, challenge } = await pkce();
  const query = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: o.redirect ?? REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', resource: BASE + '/mcp',
  }).toString();
  const res = await send('/authorize?' + query, { headers: o.acceptLanguage ? { 'Accept-Language': o.acceptLanguage } : {} });
  const html = await res.text();
  const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  return { query, html, status: res.status, cookie, handle: /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? '', verifier, clientId };
}

/** POST the form. Returns the response (a 302 to the AI app on success, the page again on a wrong code). */
export const submitAuthorize = (b: Begun, code: string, o: { ip?: string; decision?: string; env?: Partial<Env> } = {}) =>
  send('/authorize?' + b.query, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: b.cookie, ...(o.ip ? { 'CF-Connecting-IP': o.ip } : {}) },
    body: new URLSearchParams({ handle: b.handle, code, decision: o.decision ?? 'approve' }).toString(),
  }, o.env);

export async function exchange(b: Begun, location: string): Promise<{ access: string; refresh: string }> {
  const code = new URL(location).searchParams.get('code')!;
  const res = await send('/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: b.clientId, code_verifier: b.verifier, resource: BASE + '/mcp' }).toString(),
  });
  const j = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!j.access_token) throw new Error('token ' + res.status + ' ' + JSON.stringify(j));
  return { access: j.access_token, refresh: j.refresh_token! };
}

/** The whole sign-in: register, authorize with a pairing code, trade the code for a token. */
export async function signIn(code: string): Promise<{ access: string; refresh: string; clientId: string }> {
  const { clientId } = await register();
  const b = await beginAuthorize(clientId);
  const res = await submitAuthorize(b, code);
  if (res.status !== 302) throw new Error('authorize ' + res.status + ' ' + (await res.text()).slice(0, 300));
  return { ...(await exchange(b, res.headers.get('Location')!)), clientId };
}

let rpcId = 1;
/** One MCP request over Streamable HTTP, as Claude sends it. */
export async function rpc(token: string | null, method: string, params: unknown = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await send('/mcp', {
    method: 'POST',
    headers: { Host: 'relay.test', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { const data = /^data: (.*)$/m.exec(text)?.[1]; body = data ? JSON.parse(data) : text; }
  return { status: res.status, body, headers: res.headers };
}

export const initialize = (token: string) => rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });

/** Call a tool; returns its text and whether it was an error. */
export async function tool(token: string, name: string, args: unknown = {}): Promise<{ text: string; isError: boolean; status: number; raw: any }> {
  const r = await rpc(token, 'tools/call', { name, arguments: args });
  const result = r.body?.result;
  return { text: result?.content?.map((c: { text: string }) => c.text).join('\n') ?? JSON.stringify(r.body), isError: !!result?.isError || !!r.body?.error, status: r.status, raw: r.body };
}
