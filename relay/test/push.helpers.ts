// Test helpers for the push endpoints and the cron: a device, calls to the Worker, and a stub push service.
import { env } from 'cloudflare:workers';
import { b64uEncode } from '../../src/sync/bytes';
import { encryptPushBlob } from '../../src/push/encrypt';
import { newReceiver } from '../../src/push/testing';
import type { ReceiverKeys } from '../../src/push/encrypt';
import type { PushItem } from '../../src/push/protocol';
import { pushPath } from '../../src/push/protocol';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { BASE } from './helpers';

export interface Device { pid: string; secret: string; endpoint: string; receiver: ReceiverKeys }

const random = (n: number) => b64uEncode(crypto.getRandomValues(new Uint8Array(n)));
export const newDevice = async (endpoint = 'https://push.test/wpush/' + random(12)): Promise<Device> => ({ pid: random(16), secret: random(32), endpoint, receiver: await newReceiver() });

export interface Call { auth?: string | false; body?: unknown; origin?: string; ip?: string; env?: Partial<Env>; fetch?: typeof fetch }

export async function pcall(method: string, path: string, d: Pick<Device, 'secret'>, o: Call = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (o.auth !== false) headers.Authorization = 'Bearer ' + (o.auth ?? d.secret);
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.origin) headers.Origin = o.origin;
  headers['CF-Connecting-IP'] = o.ip ?? 'ip-' + Math.random().toString(36).slice(2);
  const req = new Request(BASE + path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const res = await handle(req, { ...(env as unknown as Env), ...o.env }, o.fetch ? { fetch: o.fetch } : undefined);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

export const register = (d: Device, o: Call = {}) => pcall('PUT', pushPath(d.pid), d, { body: { endpoint: d.endpoint }, ...o });
export const putSchedule = (d: Device, items: PushItem[], keep: string[] = [], o: Call = {}) => pcall('PUT', pushPath(d.pid, 'schedule'), d, { body: { items, keep }, ...o });

/** An item due at `at` with a real encrypted payload for the device. */
export async function item(d: Device, id: string, at: number, extra: Partial<PushItem> & { text?: unknown } = {}): Promise<PushItem> {
  const { text, ...rest } = extra;
  return { id, at, ttl: 600, blob: await encryptPushBlob(d.receiver, text ?? { title: id }), ...rest };
}

export interface Held { id: string; at: number; ttl: number; urgency: string; tries: number }
export const held = async (pid: string) =>
  (await env.DB.prepare('SELECT id, at, ttl, urgency, tries FROM push_items WHERE pid = ? ORDER BY at, id').bind(pid).all<Held>()).results;
export const deviceRow = (pid: string) =>
  env.DB.prepare('SELECT * FROM push_devices WHERE pid = ?').bind(pid).first<{ auth_hash: string; endpoint: string; created: number; updated: number; fails: number; last_status: number | null; last_sent: number | null }>();
export const countAll = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

/** Put a device and items straight into the tables (the endpoint tests cover the HTTP route). */
export async function seed(d: Device, items: PushItem[], o: { updated?: number } = {}): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO push_devices (pid, auth_hash, endpoint, created, updated) VALUES (?1, ?2, ?3, ?4, ?4)').bind(d.pid, 'hash-' + d.pid, d.endpoint, o.updated ?? Date.now()),
    ...items.map(i => env.DB.prepare('INSERT OR REPLACE INTO push_items (pid, id, at, ttl, urgency, blob, tries) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)').bind(d.pid, i.id, i.at, i.ttl, i.urgency ?? 'high', i.blob)),
  ]);
}

export interface Seen { url: string; headers: Headers; body: Uint8Array }
/** A stub push service: records every POST and answers with `status(url, n)`. `delay` holds each call so concurrency can be seen. */
export function pushStub(status: (url: string, n: number) => number = () => 201, delay = 0) {
  const seen: Seen[] = [];
  let inflight = 0, peak = 0;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    inflight++; peak = Math.max(peak, inflight);
    const body = new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer());
    seen.push({ url: String(input), headers: new Headers(init?.headers), body });
    if (delay) await new Promise(r => setTimeout(r, delay));
    inflight--;
    const code = status(String(input), seen.length);
    return new Response(null, { status: code });
  }) as typeof fetch;
  return { fetch: f, seen, peak: () => peak };
}
