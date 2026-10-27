// The calendar feed (docs/dev/feed.md). A device PUTs finished calendar text with a Bearer write
// secret (SHA-256 kept, trust on first use, as for push); anyone with the address may GET it. The
// address is 192 random bits, so guessing is hopeless, and misses are counted per IP anyway so the
// space cannot be scanned cheaply. The list has one feed, whose id and secret are synced with the list;
// a feed a device made for itself before that is an alias of it (`POST /v1/feed/:fid/alias`), so old
// subscriptions keep working. The relay does not read the calendar: it serves it, and only adds one
// event to a feed nobody wrote for FEED_STALE_MS, to say so where the person looks. The connector,
// which holds the list's key while it is on, writes the feed after its own changes (`writeFeed`).
import { b64uEncode, timingSafeEqual } from '../../src/sync/bytes';
import { hashAuthSecret } from '../../src/sync/keys';
import { escapeText, fold, UID_DOMAIN } from '../../src/domain/ics';
import { FEED_ID, FEED_STALE_MS, MAX_FEED_BYTES } from '../../src/feed/protocol';
import type { Env } from './env';
import { fail, json } from './http';
import { clientIp, countIp, countKey, feedMissLimit, feedNewIpLimit, feedPutLimit } from './limits';
import { limited, ipGate } from './sync';

const BEARER = /^Bearer ([A-Za-z0-9_-]{20,64})$/;
const looksLikeCalendar = (s: string) => /^BEGIN:VCALENDAR\r?\n/.test(s) && /\nEND:VCALENDAR\r?\n?$/.test(s);
const fits = (ics: string) => new TextEncoder().encode(ics).length <= MAX_FEED_BYTES;

interface Row { auth_hash: string; alias: string | null }

/** `/v1/feed/:fid`: PUT writes (the first write sets the secret), DELETE removes; `/v1/feed/:fid/alias`: POST points it at another feed. */
export async function handleFeed(req: Request, env: Env, fid: string, sub?: string): Promise<Response> {
  if (!FEED_ID.test(fid)) return fail('bad_request', 400);
  if (sub === 'alias') return req.method === 'POST' ? alias(req, env, fid) : fail('not_found', 404);
  if (req.method === 'PUT') return put(req, env, fid);
  if (req.method === 'DELETE') return remove(req, env, fid);
  return fail('not_found', 404);
}

async function put(req: Request, env: Env, fid: string): Promise<Response> {
  const m = BEARER.exec(req.headers.get('Authorization') ?? '');
  if (!m) return fail('unauthorized', 401);
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_FEED_BYTES) return fail('too_large', 413);
  const ics = await req.text();
  if (!fits(ics)) return fail('too_large', 413);
  if (!looksLikeCalendar(ics)) return fail('bad_request', 400);

  const gate = await ipGate(req, env);
  if (gate) return gate;
  const hash = await hashAuthSecret(m[1]!);
  const now = Date.now();
  const known = await env.DB.prepare('SELECT auth_hash, alias FROM feeds WHERE fid = ?1').bind(fid).first<Row>();
  let stored: Pick<Row, 'auth_hash'> | null = known;
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
  // An app from before shared feeds still writes its own: its address shows the list's feed now, so the write is let go.
  if (known?.alias) return json({ ok: true, alias: true });
  if (known) {
    if (!(await countKey(env, 'feed-put:' + fid, now, feedPutLimit(env)))) return limited();
    await env.DB.prepare('UPDATE feeds SET ics = ?2, updated = ?3 WHERE fid = ?1').bind(fid, ics, now).run();
  }
  return json({ ok: true }, known ? 200 : 201);
}

/** Point this feed at `to` (the list's feed): its own text is dropped, and its address serves `to`'s. Feeds that pointed at it follow. */
async function alias(req: Request, env: Env, fid: string): Promise<Response> {
  const m = BEARER.exec(req.headers.get('Authorization') ?? '');
  if (!m) return fail('unauthorized', 401);
  let to: unknown;
  try { to = ((await req.json()) as { to?: unknown }).to; } catch { return fail('bad_request', 400); }
  if (typeof to !== 'string' || !FEED_ID.test(to) || to === fid) return fail('bad_request', 400);
  const gate = await ipGate(req, env);
  if (gate) return gate;
  const now = Date.now();
  const known = await env.DB.prepare('SELECT auth_hash, alias FROM feeds WHERE fid = ?1').bind(fid).first<Row>();
  if (!known) return fail('not_found', 404); // deleted (regenerated or switched off): it must not come back
  if (!timingSafeEqual(await hashAuthSecret(m[1]!), known.auth_hash)) {
    await countIp(env, clientIp(req), now);
    return fail('forbidden', 403);
  }
  if (!(await countKey(env, 'feed-put:' + fid, now, feedPutLimit(env)))) return limited();
  const target = await env.DB.prepare('SELECT alias FROM feeds WHERE fid = ?1').bind(to).first<{ alias: string | null }>();
  if (!target || target.alias) return fail('not_found', 404);
  await env.DB.batch([
    env.DB.prepare("UPDATE feeds SET alias = ?2, ics = '', updated = ?3 WHERE fid = ?1").bind(fid, to, now),
    env.DB.prepare('UPDATE feeds SET alias = ?2 WHERE alias = ?1').bind(fid, to),
  ]);
  return json({ ok: true });
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
  // The addresses that pointed at it go too: the person switched the calendar off, or asked for a new address.
  const r = await env.DB.prepare('DELETE FROM feeds WHERE fid = ?1 OR alias = ?1').bind(fid).run();
  return json({ ok: true, deleted: r.meta.changes ?? 1 });
}

/**
 * Write the list's feed from the connector (it holds the list's key while it is on, and so its feed's id and
 * secret). Trust on first use as for a device; an alias or a wrong secret writes nothing. False when nothing was written.
 */
export async function writeFeed(env: Env, fid: string, secret: string, ics: string, now = Date.now()): Promise<boolean> {
  if (!FEED_ID.test(fid) || !fits(ics) || !looksLikeCalendar(ics)) return false;
  const hash = await hashAuthSecret(secret);
  const r = await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO feeds (fid, auth_hash, ics, updated) VALUES (?1, ?2, ?3, ?4)').bind(fid, hash, ics, now),
    env.DB.prepare('UPDATE feeds SET ics = ?3, updated = ?4 WHERE fid = ?1 AND auth_hash = ?2 AND alias IS NULL').bind(fid, hash, ics, now),
  ]);
  return (r[0]!.meta.changes ?? 0) + (r[1]!.meta.changes ?? 0) > 0;
}

const DAY = 86_400_000;
const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * The text served for a feed last written at `updated`: as stored, or, once nobody has written it for
 * FEED_STALE_MS, with one all-day event today that says so and what to do (in English and French: the relay
 * does not know the person's language).
 */
export function served(ics: string, updated: number, now: number): string {
  if (now - updated < FEED_STALE_MS) return ics;
  const since = dateOf(updated), today = dateOf(now).replace(/-/g, ''), tomorrow = dateOf(now + DAY).replace(/-/g, '');
  const event = [
    'BEGIN:VEVENT',
    `UID:stale-${today}@${UID_DOMAIN}`,
    'DTSTAMP:' + utc(now),
    'DTSTART;VALUE=DATE:' + today,
    'DTEND;VALUE=DATE:' + tomorrow,
    'SUMMARY:' + escapeText('Réussite: this calendar is out of date'),
    'DESCRIPTION:' + escapeText(`Not updated since ${since}. Open Réussite on a device you use: it updates this calendar. If this event is still here after that, subscribe again from Settings → Calendar.\n\nPas mis à jour depuis le ${since}. Ouvrez Réussite sur un appareil que vous utilisez : il met ce calendrier à jour. Si cet évènement est toujours là ensuite, abonnez-vous de nouveau depuis Réglages → Calendrier.`),
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ].flatMap(fold).join('\r\n') + '\r\n';
  return ics.replace(/END:VCALENDAR\r?\n?$/, event + 'END:VCALENDAR\r\n');
}

/** Revalidate on every fetch: an unchanged feed costs a 304, a changed one shows at the calendar's next refresh. */
export const FEED_CACHE = 'no-cache';
const text = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

/** `GET /cal/:fid.ics`: no sign-in, no CORS. An alias serves the feed it points at. Only misses are counted against the IP. */
export async function serveFeed(req: Request, env: Env, fid: string): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(405);
  type Served = { ics: string; updated: number; alias: string | null };
  let row = FEED_ID.test(fid) ? await env.DB.prepare('SELECT ics, updated, alias FROM feeds WHERE fid = ?1').bind(fid).first<Served>() : null;
  if (row?.alias) row = await env.DB.prepare('SELECT ics, updated, alias FROM feeds WHERE fid = ?1 AND alias IS NULL').bind(row.alias).first<Served>();
  if (!row) {
    if (!(await countKey(env, 'feed-miss:' + clientIp(req), Date.now(), feedMissLimit(env)))) return limited();
    return text(404);
  }
  const body = served(row.ics, row.updated, Date.now());
  const etag = '"' + b64uEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))).slice(0, 16)) + '"';
  const headers = { ETag: etag, 'Cache-Control': FEED_CACHE, 'Content-Type': 'text/calendar; charset=utf-8' };
  const sent = req.headers.get('If-None-Match');
  if (sent && sent.split(',').some(v => v.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': FEED_CACHE } });
  return new Response(req.method === 'HEAD' ? null : body, { headers });
}
