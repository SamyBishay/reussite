// The sync endpoints (docs/dev/sync.md). The relay never decrypts anything: blobs are
// base64url text, stored and returned as is, so each handler costs very little CPU.
//
// Order of work for a write: check the body, count the IP, check the secret, count the space,
// write. A wrong secret writes nothing. Reads for an unknown space answer 404 `unknown_space`.
import { hashAuthSecret } from '../../src/sync/keys';
import { timingSafeEqual, isB64u } from '../../src/sync/bytes';
import {
  b64uLength, DEVICE_ID, MAX_BATCH_BYTES, MAX_SNAPSHOT_BYTES, PAGE_BATCHES, PAGE_BYTES, SPACE_ID,
  type ChangesResponse, type DevicesResponse, type PushResponse, type SnapshotResponse,
} from '../../src/sync/protocol';
import type { Env } from './env';
import { fail, json, readJson } from './http';
import { clientIp, countIp, spaceLimit } from './limits';
import { revokeConnector } from './connector/oauth';

const MINUTE = 60_000;
const PART_CHARS = 1_000_000; // a D1 row holds at most 2 MB
const MAX_LABEL_CHARS = 2048;

/** Tables that hold a space's rows: "delete everywhere" and switching the connector off clear them. */
const SPACE_TABLES: { table: string; col: string }[] = [
  { table: 'batches', col: 'space' }, { table: 'snapshots', col: 'space' }, { table: 'devices', col: 'space' },
  { table: 'connector', col: 'space' }, { table: 'connector_codes', col: 'space' }, { table: 'connector_pending', col: 'space' }, { table: 'connector_undo', col: 'space' },
  { table: 'spaces', col: 'id' },
];
export const deleteSpaceData = (db: D1Database, space: string) =>
  db.batch(SPACE_TABLES.map(t => db.prepare(`DELETE FROM ${t.table} WHERE ${t.col} = ?1`).bind(space)));

const sizeOf = (blob: string) => Math.floor((blob.length * 3) / 4);

export type Auth = { ok: true; head: number } | { ok: false; res: Response };

export async function authorize(req: Request, env: Env, space: string, opts: { create?: boolean } = {}): Promise<Auth> {
  const m = /^Bearer ([A-Za-z0-9_-]{20,64})$/.exec(req.headers.get('Authorization') ?? '');
  if (!m) return { ok: false, res: fail('unauthorized', 401) };
  const hash = await hashAuthSecret(m[1]!);
  const now = Date.now();
  const select = env.DB.prepare('SELECT auth_hash, head FROM spaces WHERE id = ?1').bind(space);
  let row: { auth_hash: string; head: number } | null;
  if (opts.create) {
    const r = await env.DB.batch<{ auth_hash: string; head: number }>([
      env.DB.prepare('INSERT OR IGNORE INTO spaces (id, auth_hash, created, last_write) VALUES (?1, ?2, ?3, ?3)').bind(space, hash, now), select,
    ]);
    row = r[1]!.results[0] ?? null;
  } else {
    row = await select.first();
  }
  if (!row) return { ok: false, res: fail('unknown_space', 404) };
  if (!timingSafeEqual(hash, row.auth_hash)) {
    await countIp(env, clientIp(req), now); // guessing costs the guesser
    return { ok: false, res: fail('forbidden', 403) };
  }
  return { ok: true, head: row.head };
}

/** Count a write against the space's minute; returns the new head (bumped by `bump`) or null if over the limit. */
export async function spaceSlot(env: Env, space: string, now: number, bump: number): Promise<number | null> {
  const win = Math.floor(now / MINUTE);
  const row = await env.DB.prepare(
    'UPDATE spaces SET win = ?1, n = CASE WHEN win = ?1 THEN n + 1 ELSE 1 END, last_write = ?2, head = head + ?3 WHERE id = ?4 AND (win <> ?1 OR n < ?5) RETURNING head',
  ).bind(win, now, bump, space, spaceLimit(env)).first<{ head: number }>();
  return row ? row.head : null;
}

export const limited = () => fail('rate_limited', 429, { 'Retry-After': '60' });

/** Count the IP for a write; a response if it is over the limit. */
export async function ipGate(req: Request, env: Env): Promise<Response | null> {
  return (await countIp(env, clientIp(req), Date.now())) ? null : limited();
}

export async function handleSync(req: Request, env: Env, space: string, route: string, device?: string): Promise<Response> {
  if (!SPACE_ID.test(space)) return fail('bad_request', 400);
  const m = req.method;

  if (route === 'batches' && m === 'POST') return pushBatch(req, env, space);
  if (route === 'changes' && m === 'GET') return changes(req, env, space);
  if (route === 'snapshot' && m === 'PUT') return putSnapshot(req, env, space);
  if (route === 'devices' && device === undefined && m === 'GET') return listDevices(req, env, space);
  if (route === 'devices' && device !== undefined && m === 'POST') return touchDevice(req, env, space, device);
  if (route === '' && m === 'DELETE') return deleteSpace(req, env, space);
  return fail('not_found', 404);
}

async function pushBatch(req: Request, env: Env, space: string): Promise<Response> {
  const max = b64uLength(MAX_BATCH_BYTES);
  const body = await readJson(req, max + 200);
  if (body === 'too_large') return fail('too_large', 413);
  const { device, blob } = body ?? {};
  if (typeof device !== 'string' || !DEVICE_ID.test(device) || typeof blob !== 'string' || blob.length < 40 || !isB64u(blob)) return fail('bad_request', 400);
  if (blob.length > max) return fail('too_large', 413);

  const gate = await ipGate(req, env);
  if (gate) return gate;
  const auth = await authorize(req, env, space, { create: true });
  if (!auth.ok) return auth.res;
  const seq = await appendBatch(env, space, device, blob);
  if (seq === null) return limited();
  return json({ seq } satisfies PushResponse, 201);
}

/** Append an encrypted batch to a space (counts against the space's minute); its seq, or null when over the limit. The connector writes through here too. */
export async function appendBatch(env: Env, space: string, device: string, blob: string): Promise<number | null> {
  const now = Date.now();
  const seq = await spaceSlot(env, space, now, 1);
  if (seq === null) return null;
  await env.DB.prepare('INSERT INTO batches (space, seq, device, blob, size, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(space, seq, device, blob, sizeOf(blob), now).run();
  return seq;
}

async function changes(req: Request, env: Env, space: string): Promise<Response> {
  const afterText = new URL(req.url).searchParams.get('after') ?? '0';
  const after = Number(afterText);
  if (!/^\d+$/.test(afterText) || !Number.isSafeInteger(after)) return fail('bad_request', 400);
  const auth = await authorize(req, env, space);
  if (!auth.ok) return auth.res;

  const snap = await env.DB.prepare('SELECT upto, at, size FROM snapshots WHERE space = ?1 AND part = 0').bind(space).first<{ upto: number; at: number; size: number }>();
  let snapshot: ChangesResponse['snapshot'] = null;
  let from = after;
  let spent = 0;
  if (snap && after < snap.upto) {
    const parts = await env.DB.prepare('SELECT blob FROM snapshots WHERE space = ?1 ORDER BY part').bind(space).all<{ blob: string }>();
    snapshot = { upto: snap.upto, at: snap.at, blob: parts.results.map(p => p.blob).join('') };
    from = snap.upto;
    spent = snap.size;
  }
  // Batches after `from`, stopping once the page holds PAGE_BATCHES or about PAGE_BYTES (always at least one).
  const rows = await env.DB.prepare(
    `WITH p AS (SELECT seq, SUM(size) OVER (ORDER BY seq) - size AS before FROM batches WHERE space = ?1 AND seq > ?2)
     SELECT b.seq, b.device, b.blob, b.at FROM batches b JOIN p ON p.seq = b.seq
     WHERE b.space = ?1 AND p.before < ?3 ORDER BY b.seq LIMIT ?4`,
  ).bind(space, from, Math.max(PAGE_BYTES - spent, 1), PAGE_BATCHES).all<ChangesResponse['batches'][number]>();
  const last = rows.results.at(-1)?.seq ?? from;
  const more = !!(await env.DB.prepare('SELECT 1 AS x FROM batches WHERE space = ?1 AND seq > ?2 LIMIT 1').bind(space, last).first());
  return json({ head: auth.head, more, snapshot, batches: rows.results } satisfies ChangesResponse);
}

async function putSnapshot(req: Request, env: Env, space: string): Promise<Response> {
  const max = b64uLength(MAX_SNAPSHOT_BYTES);
  const body = await readJson(req, max + 200);
  if (body === 'too_large') return fail('too_large', 413);
  const { upto, blob } = body ?? {};
  if (typeof upto !== 'number' || !Number.isSafeInteger(upto) || upto < 1 || typeof blob !== 'string' || blob.length < 40 || !isB64u(blob)) return fail('bad_request', 400);
  if (blob.length > max) return fail('too_large', 413);

  const gate = await ipGate(req, env);
  if (gate) return gate;
  const auth = await authorize(req, env, space);
  if (!auth.ok) return auth.res;
  if (upto > auth.head) return fail('bad_upto', 409);
  const now = Date.now();
  if ((await spaceSlot(env, space, now, 0)) === null) return limited();

  const current = await env.DB.prepare('SELECT upto FROM snapshots WHERE space = ?1 AND part = 0').bind(space).first<{ upto: number }>();
  if (current && current.upto >= upto) return json({ upto: current.upto, pruned: 0 } satisfies SnapshotResponse); // already have a newer one
  const size = sizeOf(blob);
  const stmts = [env.DB.prepare('DELETE FROM snapshots WHERE space = ?1').bind(space)];
  for (let i = 0, part = 0; i < blob.length; i += PART_CHARS, part++) {
    stmts.push(env.DB.prepare('INSERT INTO snapshots (space, part, upto, blob, size, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(space, part, upto, blob.slice(i, i + PART_CHARS), size, now));
  }
  stmts.push(env.DB.prepare('DELETE FROM batches WHERE space = ?1 AND seq <= ?2').bind(space, upto));
  const res = await env.DB.batch(stmts);
  return json({ upto, pruned: res.at(-1)!.meta.changes } satisfies SnapshotResponse);
}

async function touchDevice(req: Request, env: Env, space: string, device: string): Promise<Response> {
  if (!DEVICE_ID.test(device)) return fail('bad_request', 400);
  const body = await readJson(req, MAX_LABEL_CHARS + 100);
  if (body === 'too_large') return fail('too_large', 413);
  const label = body?.label;
  if (label !== undefined && (typeof label !== 'string' || label.length > MAX_LABEL_CHARS || !isB64u(label))) return fail('bad_request', 400);
  const gate = await ipGate(req, env);
  if (gate) return gate;
  const auth = await authorize(req, env, space);
  if (!auth.ok) return auth.res;
  const now = Date.now();
  if ((await spaceSlot(env, space, now, 0)) === null) return limited();
  await env.DB.prepare(
    'INSERT INTO devices (space, device, label_blob, last_seen) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (space, device) DO UPDATE SET last_seen = ?4, label_blob = COALESCE(?3, label_blob)',
  ).bind(space, device, label ?? null, now).run();
  return json({ ok: true });
}

async function listDevices(req: Request, env: Env, space: string): Promise<Response> {
  const auth = await authorize(req, env, space);
  if (!auth.ok) return auth.res;
  const rows = await env.DB.prepare('SELECT device, label_blob, last_seen FROM devices WHERE space = ?1 ORDER BY last_seen DESC').bind(space).all<{ device: string; label_blob: string | null; last_seen: number }>();
  return json({ devices: rows.results.map(r => ({ device: r.device, label: r.label_blob, lastSeen: r.last_seen })) } satisfies DevicesResponse);
}

async function deleteSpace(req: Request, env: Env, space: string): Promise<Response> {
  const gate = await ipGate(req, env);
  if (gate) return gate;
  const auth = await authorize(req, env, space);
  if (!auth.ok) return auth.res;
  await revokeConnector(env, space); // sign-ins live in KV, outside the tables below
  await deleteSpaceData(env.DB, space);
  return json({ ok: true });
}
