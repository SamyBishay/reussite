// The calendar feed (docs/dev/feed.md). The device PUTs finished calendar text with a Bearer
// write secret (SHA-256 kept, trust on first use, as for push); anyone with the address may GET
// it. The address is 192 random bits, so guessing is hopeless, and misses are counted per IP
// anyway so the space cannot be scanned cheaply. The relay never builds or reads the calendar.
import { b64uEncode, timingSafeEqual } from '../../src/sync/bytes';
import { hashAuthSecret } from '../../src/sync/keys';
import { FEED_ID, MAX_FEED_BYTES } from '../../src/feed/protocol';
import type { Env } from './env';
import { fail, json } from './http';
import { clientIp, countIp, countKey, feedMissLimit, feedNewIpLimit, feedPutLimit } from './limits';
import { limited, ipGate } from './sync';

const BEARER = /^Bearer ([A-Za-z0-9_-]{20,64})$/;
const looksLikeCalendar = (s: string) => /^BEGIN:VCALENDAR\r?\n/.test(s) && /\nEND:VCALENDAR\r?\n?$/.test(s);

/** `/v1/feed/:fid`: PUT writes (the first write sets the secret), DELETE removes. */
export async function handleFeed(req: Request, env: Env, fid: string): Promise<Response> {
  if (!FEED_ID.test(fid)) return fail('bad_request', 400);
  if (req.method === 'PUT') return put(req, env, fid);
  if (req.method === 'DELETE') return remove(req, env, fid);
  return fail('not_found', 404);
}

async function put(req: Request, env: Env, fid: string): Promise<Response> {
  const m = BEARER.exec(req.headers.get('Authorization') ?? '');
  if (!m) return fail('unauthorized', 401);
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_FEED_BYTES) return fail('too_large', 413);
  const ics = await req.text();
  if (new TextEncoder().encode(ics).length > MAX_FEED_BYTES) return fail('too_large', 413);
  if (!looksLikeCalendar(ics)) return fail('bad_request', 400);

  const gate = await ipGate(req, env);
  if (gate) return gate;
  const hash = await hashAuthSecret(m[1]!);
  const now = Date.now();
  const known = await env.DB.prepare('SELECT auth_hash FROM feeds WHERE fid = ?1').bind(fid).first<{ auth_hash: string }>();
  let stored = known;
  if (!known) {
    if (!(await countKey(env, 'feed-new:' + clientIp(req), now, feedNewIpLimit(env)))) return limited();
    // The first write sets the secret. If two race, the loser reads the winner's hash and is refused below.
    const r = await env.DB.batch<{ auth_hash: string }>([
      env.DB.prepare('INSERT OR IGNORE INTO feeds (fid, auth_hash, ics, updated) VALUES (?1, ?2, ?3, ?4)').bind(fid, hash, ics, now),
      env.DB.prepare('SELECT auth_hash FROM feeds WHERE fid = ?1').bind(fid),
    ]);
    stored = r[1]!.results[0] ?? null;
  }
  if (!stored || !timingSafeEqual(hash, stored.auth_hash)) {
    await countIp(env, clientIp(req), now); // guessing costs the guesser
    return fail('forbidden', 403);
  }
  if (known) {
    if (!(await countKey(env, 'feed-put:' + fid, now, feedPutLimit(env)))) return limited();
    await env.DB.prepare('UPDATE feeds SET ics = ?2, updated = ?3 WHERE fid = ?1').bind(fid, ics, now).run();
  }
  return json({ ok: true }, known ? 200 : 201);
}

async function remove(req: Request, env: Env, fid: string): Promise<Response> {
  const m = BEARER.exec(req.headers.get('Authorization') ?? '');
  if (!m) return fail('unauthorized', 401);
  const gate = await ipGate(req, env);
  if (gate) return gate;
  const known = await env.DB.prepare('SELECT auth_hash FROM feeds WHERE fid = ?1').bind(fid).first<{ auth_hash: string }>();
  if (!known) return json({ ok: true, deleted: 0 }); // already gone is fine
  if (!timingSafeEqual(await hashAuthSecret(m[1]!), known.auth_hash)) {
    await countIp(env, clientIp(req), Date.now());
    return fail('forbidden', 403);
  }
  await env.DB.prepare('DELETE FROM feeds WHERE fid = ?1').bind(fid).run();
  return json({ ok: true, deleted: 1 });
}

const text = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

/** `GET /cal/:fid.ics`: no sign-in, no CORS. Only misses are counted against the IP. */
export async function serveFeed(req: Request, env: Env, fid: string): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(405);
  const row = FEED_ID.test(fid) ? await env.DB.prepare('SELECT ics FROM feeds WHERE fid = ?1').bind(fid).first<{ ics: string }>() : null;
  if (!row) {
    if (!(await countKey(env, 'feed-miss:' + clientIp(req), Date.now(), feedMissLimit(env)))) return limited();
    return text(404);
  }
  const etag = '"' + b64uEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(row.ics))).slice(0, 16)) + '"';
  const headers = { ETag: etag, 'Cache-Control': 'max-age=900', 'Content-Type': 'text/calendar; charset=utf-8' };
  const sent = req.headers.get('If-None-Match');
  if (sent && sent.split(',').some(v => v.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'max-age=900' } });
  return new Response(req.method === 'HEAD' ? null : row.ics, { headers });
}
