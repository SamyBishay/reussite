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
import { cacheDrop } from './connector/cache';
import { revokeConnector } from './connector/oauth';

const MINUTE = 60_000;
const PART_CHARS = 1_000_000; // a D1 row holds at most 2 MB
const MAX_LABEL_CHARS = 2048;

/** Tables that hold a space's rows: "delete everywhere" and switching the connector off clear them. */
const SPACE_TABLES: { table: string; col: string }[] = [
  { table: 'batches', col: 'space' }, { table: 'snapshots', col: 'space' }, { table: 'devices', col: 'space' },
  { table: 'inbox', col: 'space' }, { table: 'connector', col: 'space' }, { table: 'connector_codes', col: 'space' }, { table: 'connector_pending', col: 'space' }, { table: 'connector_undo', col: 'space' },
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

  // A snapshot is whole (kind 'full') or two parts (kind 'hot', 'cold'); what a reader gets of it depends on `after`.
  const heads = await env.DB.prepare('SELECT kind, upto, at, size FROM snapshots WHERE space = ?1 AND part = 0').bind(space).all<{ kind: Kind; upto: number; at: number; size: number }>();
  const main = heads.results.find(r => r.kind !== 'cold');
  const coldRow = heads.results.find(r => r.kind === 'cold');
  const wantMain = !!main && after < main.upto;
  const wantCold = !!coldRow && after < coldRow.upto;
  let snapshot: ChangesResponse['snapshot'] = null;
  let cold: ChangesResponse['cold'] = null;
  let from = after;
  let spent = 0;
  if (wantMain || wantCold) {
    const kinds = [...(wantMain ? [main!.kind] : []), ...(wantCold ? ['cold'] : [])];
    const parts = await env.DB.prepare(`SELECT kind, blob FROM snapshots WHERE space = ?1 AND kind IN (${kinds.map(k => `'${k}'`).join(',')}) ORDER BY kind, part`).bind(space).all<{ kind: Kind; blob: string }>();
    const blobOf = (k: Kind) => parts.results.filter(p => p.kind === k).map(p => p.blob).join('');
    if (wantMain) { snapshot = { upto: main!.upto, at: main!.at, blob: blobOf(main!.kind) }; from = main!.upto; spent += main!.size; }
    if (wantCold) { cold = { upto: coldRow!.upto, at: coldRow!.at, blob: blobOf('cold') }; spent += coldRow!.size; }
  }
  // Batches after `from`, stopping once the page holds PAGE_BATCHES or about PAGE_BYTES (always at least one).
  const rows = await env.DB.prepare(
    `WITH p AS (SELECT seq, SUM(size) OVER (ORDER BY seq) - size AS before FROM batches WHERE space = ?1 AND seq > ?2)
     SELECT b.seq, b.device, b.blob, b.at FROM batches b JOIN p ON p.seq = b.seq
     WHERE b.space = ?1 AND p.before < ?3 ORDER BY b.seq LIMIT ?4`,
  ).bind(space, from, Math.max(PAGE_BYTES - spent, 1), PAGE_BATCHES).all<ChangesResponse['batches'][number]>();
  const last = rows.results.at(-1)?.seq ?? from;
  const more = !!(await env.DB.prepare('SELECT 1 AS x FROM batches WHERE space = ?1 AND seq > ?2 LIMIT 1').bind(space, last).first());
  return json({ head: auth.head, more, snapshot, ...(cold ? { cold } : {}), batches: rows.results } satisfies ChangesResponse);
}

async function putSnapshot(req: Request, env: Env, space: string): Promise<Response> {
  const max = b64uLength(MAX_SNAPSHOT_BYTES);
  const body = await readJson(req, 2 * max + 400);
  if (body === 'too_large') return fail('too_large', 413);
  const { upto, blob, part, cold, coldUpto } = (body ?? {}) as Record<string, any>;
  const okBlob = (b: unknown): b is string => typeof b === 'string' && b.length >= 40 && isB64u(b);
  const okUpto = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;
  if (!okUpto(upto) || !okBlob(blob)) return fail('bad_request', 400);
  if (part !== undefined && part !== 'hot') return fail('bad_request', 400);
  if (cold !== undefined && (part !== 'hot' || !cold || !okUpto(cold.upto) || cold.upto > upto || !okBlob(cold.blob))) return fail('bad_request', 400);
  if (part === 'hot' && cold === undefined && !okUpto(coldUpto)) return fail('bad_request', 400);
  if (part === undefined && (cold !== undefined || coldUpto !== undefined)) return fail('bad_request', 400);
  if (blob.length > max || (cold && cold.blob.length > max)) return fail('too_large', 413);

  const gate = await ipGate(req, env);
  if (gate) return gate;
  const auth = await authorize(req, env, space);
  if (!auth.ok) return auth.res;
  if (upto > auth.head) return fail('bad_upto', 409);
  if ((await spaceSlot(env, space, Date.now(), 0)) === null) return limited();

  const r = await storeSnapshot(env, space, { upto, blob, part, cold, coldUpto });
  return r === 'bad_parts' ? fail('bad_parts', 409) : json(r satisfies SnapshotResponse);
}

type Kind = 'full' | 'hot' | 'cold';
export interface SnapshotWrite { upto: number; blob: string; part?: 'hot'; cold?: { upto: number; blob: string }; coldUpto?: number }

/**
 * Store a snapshot (docs/dev/sync.md, "Snapshots and pruning"). Whole (no `part`): replaces
 * everything. 'hot' with `cold`: replaces both. 'hot' alone: replaces the hot part only, and only if
 * the stored cold part is at least as new as `coldUpto` (else 'bad_parts'). An `upto` that is not
 * newer than the stored one changes nothing (the answer carries the stored `upto`). Batches up to
 * `upto` are pruned. The connector's compaction calls this too, without the HTTP layer.
 *
 * Every statement carries the same guard, so two writers racing past the first check can't leave an
 * older snapshot over a newer one (the batch is atomic and the guard is evaluated inside it). Parts
 * go in cold first and part 0 last, so the guard, which looks at a stored part 0, holds until the end.
 */
export async function storeSnapshot(env: Env, space: string, w: SnapshotWrite): Promise<SnapshotResponse | 'bad_parts'> {
  const now = Date.now();
  const rows = await env.DB.prepare('SELECT kind, upto FROM snapshots WHERE space = ?1 AND part = 0').bind(space).all<{ kind: Kind; upto: number }>();
  const current = rows.results.find(r => r.kind !== 'cold');
  const storedCold = rows.results.find(r => r.kind === 'cold');
  if (w.part === 'hot' && !w.cold && !(storedCold && storedCold.upto >= (w.coldUpto ?? Infinity))) return 'bad_parts';
  if (current && current.upto >= w.upto) return { upto: current.upto, pruned: 0 };

  const hotOnly = w.part === 'hot' && !w.cold;
  const guard = `NOT EXISTS (SELECT 1 FROM snapshots WHERE space = ?1 AND kind IN ('full', 'hot') AND part = 0 AND upto >= ?2)`;
  const needCold = `EXISTS (SELECT 1 FROM snapshots WHERE space = ?1 AND kind = 'cold' AND part = 0 AND upto >= ?9)`;
  const where = hotOnly ? `${guard} AND ${needCold}` : guard;
  const insert = (kind: Kind, partNo: number, rowUpto: number, chunk: string, size: number) =>
    env.DB.prepare(`INSERT INTO snapshots (space, kind, part, upto, blob, size, at) SELECT ?1, ?3, ?4, ?5, ?6, ?7, ?8 WHERE ${where}`)
      .bind(space, w.upto, kind, partNo, rowUpto, chunk, size, now, ...(hotOnly ? [w.coldUpto] : []));
  const chunks = (kind: Kind, rowUpto: number, text: string): D1PreparedStatement[] => {
    const out: D1PreparedStatement[] = [];
    const size = sizeOf(text);
    for (let i = Math.ceil(text.length / PART_CHARS) - 1; i >= 0; i--) out.push(insert(kind, i, rowUpto, text.slice(i * PART_CHARS, (i + 1) * PART_CHARS), size));
    return out;
  };
  const stmts = [
    hotOnly
      ? env.DB.prepare(`DELETE FROM snapshots WHERE space = ?1 AND kind = 'hot' AND ${where}`).bind(space, w.upto, ...Array(6).fill(null), w.coldUpto)
      : env.DB.prepare(`DELETE FROM snapshots WHERE space = ?1 AND ${where}`).bind(space, w.upto),
    ...(w.cold ? chunks('cold', w.cold.upto, w.cold.blob) : []),
    ...chunks(w.part ?? 'full', w.upto, w.blob),
    env.DB.prepare(`DELETE FROM batches WHERE space = ?1 AND seq <= ?2 AND EXISTS (SELECT 1 FROM snapshots WHERE space = ?1 AND kind IN ('full', 'hot') AND part = 0 AND upto >= ?2)`).bind(space, w.upto),
    env.DB.prepare(`SELECT upto FROM snapshots WHERE space = ?1 AND kind IN ('full', 'hot') AND part = 0`).bind(space),
  ];
  const res = await env.DB.batch(stmts);
  const stored = (res.at(-1)!.results as { upto: number }[])[0]?.upto ?? w.upto;
  return { upto: stored, pruned: res.at(-2)!.meta.changes };
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
  cacheDrop(space); // the connector's plaintext copy, if this isolate holds one
  await revokeConnector(env, space); // sign-ins live in KV, outside the tables below
  await deleteSpaceData(env.DB, space);
  return json({ ok: true });
}
