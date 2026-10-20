// The push endpoints (docs/dev/push.md). A device has a push id of its own and a Bearer secret
// whose SHA-256 the relay keeps (trust on first use, like a space), so it cannot be linked to a
// space. The relay stores the push service's endpoint and encrypted payloads it never opens.
//
// Order of work for a write, as in sync: check the body, count what can be counted without a
// secret, check the secret, count the device, write.
import { timingSafeEqual, isB64u } from '../../src/sync/bytes';
import { hashAuthSecret } from '../../src/sync/keys';
import {
  MAX_PUSH_BLOB_CHARS, MAX_PUSH_ITEMS, MAX_PUSH_TTL, MAX_SCHEDULE_CHARS, MIN_PUSH_TTL, PUSH_AT_SPAN_MS, PUSH_ID, PUSH_ITEM_ID, PUSH_URGENCIES,
  type PushDeleteResponse, type PushItem, type PushOk, type PushScheduleResponse, type PushSendResponse,
} from '../../src/push/protocol';
import type { Env } from './env';
import { fail, json, readJson } from './http';
import { clientIp, countIp, countKey, pushNewIpLimit, pushScheduleLimit, pushSendLimit, pushUpdateLimit } from './limits';
import { limited, ipGate } from './sync';
import { checkEndpoint, loadSigner, sendWebPush, VapidHeaders } from './webpush';

export interface Deps { fetch: typeof fetch }

const BEARER = /^Bearer ([A-Za-z0-9_-]{20,64})$/;

type Device = { auth_hash: string; endpoint: string };
type Auth = { ok: true; device: Device } | { ok: false; res: Response };

/** The device's row if the Bearer secret matches. A wrong secret counts against the IP. */
async function authorize(req: Request, env: Env, pid: string): Promise<Auth> {
  const m = BEARER.exec(req.headers.get('Authorization') ?? '');
  if (!m) return { ok: false, res: fail('unauthorized', 401) };
  const hash = await hashAuthSecret(m[1]!);
  const row = await env.DB.prepare('SELECT auth_hash, endpoint FROM push_devices WHERE pid = ?1').bind(pid).first<Device>();
  if (!row) return { ok: false, res: fail('unknown_device', 404) };
  if (!timingSafeEqual(hash, row.auth_hash)) {
    await countIp(env, clientIp(req), Date.now()); // guessing costs the guesser
    return { ok: false, res: fail('forbidden', 403) };
  }
  return { ok: true, device: row };
}

export async function handlePush(req: Request, env: Env, pid: string, route: string, deps: Deps = { fetch }): Promise<Response> {
  if (!PUSH_ID.test(pid)) return fail('bad_request', 400);
  const m = req.method;
  if (route === '' && m === 'PUT') return register(req, env, pid);
  if (route === '' && m === 'DELETE') return remove(req, env, pid);
  if (route === 'schedule' && m === 'PUT') return schedule(req, env, pid);
  if (route === 'send' && m === 'POST') return send(req, env, pid, deps);
  return fail('not_found', 404);
}

async function register(req: Request, env: Env, pid: string): Promise<Response> {
  const body = await readJson(req, 2048);
  if (body === 'too_large') return fail('too_large', 413);
  if (!body) return fail('bad_request', 400);
  const endpoint = checkEndpoint(body.endpoint, env);
  if (!endpoint) return fail('bad_endpoint', 400);
  const m = BEARER.exec(req.headers.get('Authorization') ?? '');
  if (!m) return fail('unauthorized', 401);
  const hash = await hashAuthSecret(m[1]!);

  const now = Date.now();
  const known = await env.DB.prepare('SELECT auth_hash FROM push_devices WHERE pid = ?1').bind(pid).first<{ auth_hash: string }>();
  let stored = known;
  if (!known) {
    if (!(await countKey(env, 'push-new:' + clientIp(req), now, pushNewIpLimit(env)))) return limited();
    // The first write sets the secret. If two race, the loser reads the winner's hash and is refused below.
    const r = await env.DB.batch<{ auth_hash: string }>([
      env.DB.prepare('INSERT OR IGNORE INTO push_devices (pid, auth_hash, endpoint, created, updated) VALUES (?1, ?2, ?3, ?4, ?4)').bind(pid, hash, endpoint.href, now),
      env.DB.prepare('SELECT auth_hash FROM push_devices WHERE pid = ?1').bind(pid),
    ]);
    stored = r[1]!.results[0] ?? null;
  }
  if (!stored || !timingSafeEqual(hash, stored.auth_hash)) {
    await countIp(env, clientIp(req), now);
    return fail('forbidden', 403);
  }
  if (known) {
    if (!(await countKey(env, 'push-upd:' + pid, now, pushUpdateLimit(env)))) return limited();
    await env.DB.prepare('UPDATE push_devices SET endpoint = ?2, updated = ?3, fails = 0 WHERE pid = ?1').bind(pid, endpoint.href, now).run();
  }
  return json({ ok: true } satisfies PushOk, known ? 200 : 201);
}

/** An item as the request carries it, or null if any field is out of bounds. */
function validItem(v: unknown, now: number): PushItem | null {
  if (!v || typeof v !== 'object') return null;
  const { id, at, ttl, urgency, blob } = v as Record<string, unknown>;
  if (typeof id !== 'string' || !PUSH_ITEM_ID.test(id)) return null;
  if (typeof at !== 'number' || !Number.isSafeInteger(at) || Math.abs(at - now) > PUSH_AT_SPAN_MS) return null;
  if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < MIN_PUSH_TTL || ttl > MAX_PUSH_TTL) return null;
  if (urgency !== undefined && !PUSH_URGENCIES.includes(urgency as never)) return null;
  if (typeof blob !== 'string' || blob.length < 40 || blob.length > MAX_PUSH_BLOB_CHARS || !isB64u(blob)) return null;
  return { id, at, ttl, urgency: (urgency as PushItem['urgency']) ?? 'high', blob };
}

async function schedule(req: Request, env: Env, pid: string): Promise<Response> {
  const body = await readJson(req, MAX_SCHEDULE_CHARS);
  if (body === 'too_large') return fail('too_large', 413);
  const now = Date.now();
  const { items: rawItems, keep: rawKeep } = body ?? {};
  if (!Array.isArray(rawItems) || !Array.isArray(rawKeep)) return fail('bad_request', 400);
  if (rawItems.length > MAX_PUSH_ITEMS || rawKeep.length > MAX_PUSH_ITEMS) return fail('too_large', 413);
  const items: PushItem[] = [];
  for (const raw of rawItems) {
    const item = validItem(raw, now);
    if (!item) return fail('bad_request', 400);
    items.push(item);
  }
  const keep = rawKeep as unknown[];
  if (!keep.every((k): k is string => typeof k === 'string' && PUSH_ITEM_ID.test(k))) return fail('bad_request', 400);
  if (new Set(items.map(i => i.id)).size !== items.length) return fail('bad_request', 400);
  const ids = new Set([...items.map(i => i.id), ...keep]);
  if (ids.size > MAX_PUSH_ITEMS) return fail('too_large', 413);

  const gate = await ipGate(req, env);
  if (gate) return gate;
  const auth = await authorize(req, env, pid);
  if (!auth.ok) return auth.res;
  if (!(await countKey(env, 'push-sched:' + pid, now, pushScheduleLimit(env)))) return limited();

  // One batch is one transaction: the device never holds a half-replaced schedule.
  const r = await env.DB.batch<{ n: number }>([
    env.DB.prepare(
      `INSERT INTO push_items (pid, id, at, ttl, urgency, blob, tries)
       SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.at'), json_extract(value, '$.ttl'), json_extract(value, '$.urgency'), json_extract(value, '$.blob'), 0
       FROM json_each(?2) WHERE true
       ON CONFLICT (pid, id) DO UPDATE SET at = excluded.at, ttl = excluded.ttl, urgency = excluded.urgency, blob = excluded.blob, tries = 0`,
    ).bind(pid, JSON.stringify(items)),
    env.DB.prepare('DELETE FROM push_items WHERE pid = ?1 AND id NOT IN (SELECT value FROM json_each(?2))').bind(pid, JSON.stringify([...ids])),
    env.DB.prepare('UPDATE push_devices SET updated = ?2 WHERE pid = ?1').bind(pid, now),
    env.DB.prepare('SELECT COUNT(*) AS n FROM push_items WHERE pid = ?1').bind(pid),
  ]);
  return json({ stored: items.length, held: r[3]!.results[0]?.n ?? 0 } satisfies PushScheduleResponse);
}

async function send(req: Request, env: Env, pid: string, deps: Deps): Promise<Response> {
  const body = await readJson(req, MAX_PUSH_BLOB_CHARS + 200);
  if (body === 'too_large') return fail('too_large', 413);
  const blob = body?.blob;
  if (typeof blob !== 'string' || blob.length < 40 || !isB64u(blob)) return fail('bad_request', 400);
  if (blob.length > MAX_PUSH_BLOB_CHARS) return fail('too_large', 413);

  const auth = await authorize(req, env, pid);
  if (!auth.ok) return auth.res;
  const now = Date.now();
  if (!(await countKey(env, 'push-send:' + pid, now, pushSendLimit(env)))) return limited();
  const endpoint = checkEndpoint(auth.device.endpoint, env);
  if (!endpoint) return fail('bad_endpoint', 400);
  const signer = await loadSigner(env);
  if (!signer) return fail('push_unavailable', 503);

  const status = await sendWebPush(deps.fetch, { endpoint, blob, ttl: 60, urgency: 'high', authorization: await new VapidHeaders(signer, now).for(endpoint) });
  const ok = status >= 200 && status < 300;
  if (status === 404 || status === 410) {
    await removeDevice(env, pid);
    return fail('gone', 410);
  }
  await env.DB.prepare('UPDATE push_devices SET last_status = ?2, fails = CASE WHEN ?3 THEN 0 ELSE fails + 1 END, last_sent = CASE WHEN ?3 THEN ?4 ELSE last_sent END WHERE pid = ?1')
    .bind(pid, status, ok ? 1 : 0, now).run();
  if (!ok) return json({ error: 'push_failed', status }, 502);
  return json({ ok: true, status } satisfies PushSendResponse, 201);
}

async function remove(req: Request, env: Env, pid: string): Promise<Response> {
  const auth = await authorize(req, env, pid);
  if (!auth.ok) return auth.res.status === 404 ? json({ ok: true, deleted: 0 } satisfies PushDeleteResponse) : auth.res; // already gone is as good as deleted
  await removeDevice(env, pid);
  return json({ ok: true, deleted: 1 } satisfies PushDeleteResponse);
}

/** A device and everything waiting for it. */
export const removeDevice = (env: Env, pid: string) =>
  env.DB.batch([env.DB.prepare('DELETE FROM push_items WHERE pid = ?1').bind(pid), env.DB.prepare('DELETE FROM push_devices WHERE pid = ?1').bind(pid)]);
