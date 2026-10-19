// Switching the connector on and off, from the app (docs/dev/connector.md). Bearer auth with the
// space's auth secret, as for sync. Switching on hands the relay the space's raw encryption key;
// the relay keeps it wrapped (wrap.ts) and lists itself as the device "Connector".
import { authenticates, sealToText } from '../../../src/sync/crypto';
import { b64uDecode } from '../../../src/sync/bytes';
import { importEncKey } from '../../../src/sync/keys';
import { type ConnectorCodeResponse, type ConnectorOffResponse, type ConnectorOnResponse, type ConnectorStatus } from '../../../src/sync/protocol';
import type { Env } from '../env';
import { fail, json, readJson } from '../http';
import { authorize, ipGate, limited, spaceSlot } from '../sync';
import { MCP_PATH, revokeConnector } from './oauth';
import { formatCode, issueCode } from './pairing';
import { wrap, wrapKeyReady } from './wrap';

/** The connector's device id: also its clock's node. */
export const CONNECTOR_DEVICE = 'connector';
const CONNECTOR_NAME = 'Connector';
const mcpUrl = (env: Env) => env.RELAY_URL.replace(/\/+$/, '') + MCP_PATH;

export async function handleConnector(req: Request, env: Env, space: string, sub: string): Promise<Response> {
  const m = req.method;
  if (sub === '' && m === 'POST') return switchOn(req, env, space);
  if (sub === 'code' && m === 'POST') return freshCode(req, env, space);
  if (sub === '' && m === 'GET') return status(req, env, space);
  if (sub === '' && m === 'DELETE') return switchOff(req, env, space);
  return fail('not_found', 404);
}

/** Does the key open what the space already holds? A space with nothing in it accepts any key. */
async function keyFits(env: Env, space: string, raw: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const keys = { spaceId: space, encKey: await importEncKey(raw) };
  const batch = await env.DB.prepare('SELECT blob FROM batches WHERE space = ?1 ORDER BY seq DESC LIMIT 1').bind(space).first<{ blob: string }>();
  if (batch) return authenticates(keys, b64uDecode(batch.blob));
  const parts = await env.DB.prepare('SELECT blob FROM snapshots WHERE space = ?1 ORDER BY part').bind(space).all<{ blob: string }>();
  if (parts.results.length) return authenticates(keys, b64uDecode(parts.results.map(p => p.blob).join('')));
  return true;
}

async function switchOn(req: Request, env: Env, space: string): Promise<Response> {
  const body = await readJson(req, 400);
  if (body === 'too_large') return fail('too_large', 413);
  const key = body?.key;
  let raw: Uint8Array<ArrayBuffer>;
  try {
    if (typeof key !== 'string') throw new Error();
    raw = b64uDecode(key);
    if (raw.length !== 32) throw new Error();
  } catch {
    return fail('bad_request', 400);
  }
  const gate = await ipGate(req, env);
  if (gate) return gate;
  const bearer = /^Bearer ([A-Za-z0-9_-]{20,64})$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  const auth = await authorize(req, env, space, { create: true });
  if (!auth.ok) return auth.res;
  if (!wrapKeyReady(env)) return fail('connector_unavailable', 503); // the secret isn't set: store nothing
  if ((await spaceSlot(env, space, Date.now(), 0)) === null) return limited();
  if (!(await keyFits(env, space, raw))) return fail('wrong_key', 409);

  const now = Date.now();
  const wrapped = await wrap(env, space, { k: key, a: bearer! });
  const label = await sealToText({ spaceId: space, encKey: await importEncKey(raw) }, { name: CONNECTOR_NAME });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO connector (space, wrapped, created) VALUES (?1, ?2, ?3) ON CONFLICT (space) DO UPDATE SET wrapped = ?2').bind(space, wrapped, now),
    env.DB.prepare(
      'INSERT INTO devices (space, device, label_blob, last_seen) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (space, device) DO UPDATE SET label_blob = ?3, last_seen = ?4',
    ).bind(space, CONNECTOR_DEVICE, label, now),
  ]);
  const { code, expires } = await issueCode(env, space, now);
  return json({ on: true, code: formatCode(code), expires, url: mcpUrl(env) } satisfies ConnectorOnResponse, 201);
}

async function freshCode(req: Request, env: Env, space: string): Promise<Response> {
  const gate = await ipGate(req, env);
  if (gate) return gate;
  const auth = await authorize(req, env, space);
  if (!auth.ok) return auth.res;
  if (!(await env.DB.prepare('SELECT 1 AS x FROM connector WHERE space = ?1').bind(space).first())) return fail('connector_off', 409);
  if ((await spaceSlot(env, space, Date.now(), 0)) === null) return limited();
  const { code, expires } = await issueCode(env, space);
  return json({ code: formatCode(code), expires } satisfies ConnectorCodeResponse);
}

async function status(req: Request, env: Env, space: string): Promise<Response> {
  const auth = await authorize(req, env, space);
  if (!auth.ok) return auth.res;
  const row = await env.DB.prepare('SELECT last_used FROM connector WHERE space = ?1').bind(space).first<{ last_used: number | null }>();
  return json({ on: !!row, lastUsed: row?.last_used ?? null, url: mcpUrl(env) } satisfies ConnectorStatus);
}

/** Delete the stored key and everything the connector kept, and revoke every token and grant of the space at once. */
async function switchOff(req: Request, env: Env, space: string): Promise<Response> {
  const gate = await ipGate(req, env);
  if (gate) return gate;
  const auth = await authorize(req, env, space);
  if (!auth.ok) return auth.res;
  // The key first: from this moment every call fails, even if revoking the grants is interrupted.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM connector WHERE space = ?1').bind(space),
    env.DB.prepare('DELETE FROM connector_codes WHERE space = ?1').bind(space),
    env.DB.prepare('DELETE FROM connector_pending WHERE space = ?1').bind(space),
    env.DB.prepare('DELETE FROM connector_undo WHERE space = ?1').bind(space),
    env.DB.prepare('DELETE FROM devices WHERE space = ?1 AND device = ?2').bind(space, CONNECTOR_DEVICE),
  ]);
  const revoked = await revokeConnector(env, space);
  return json({ ok: true, revoked } satisfies ConnectorOffResponse);
}
