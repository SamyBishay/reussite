// The cron: every minute, send what is due. Sized for the free plan (10 ms of CPU, 50
// subrequests, 6 simultaneous connections): one select, at most TICK_LIMIT sends, one batch of
// writes, so about 40 subrequests; the sends run 6 at a time; each push service gets one
// VAPID signature per tick. Whatever does not fit carries to the next minute. At minute 0 the
// same run also prunes (docs/dev/push.md).
import type { PushUrgency } from '../../src/push/protocol';
import type { Env } from './env';
import { checkEndpoint, loadSigner, sendWebPush, VapidHeaders } from './webpush';

export const TICK_LIMIT = 36;
export const SEND_CONCURRENCY = 6;
/** A message due within this long is sent now, so one due at 18:30:00 is not left to 18:31. */
export const EARLY_MS = 5_000;
/** A message the push service keeps refusing (429, 5xx, unreachable) is given up on after this many sends. */
export const MAX_TRIES = 3;
/** A device with no schedule write for this long is forgotten (the app rewrites it whenever it is opened). */
export const DEVICE_KEEP_MS = 45 * 86_400_000;
/** A calendar feed not written for this long is forgotten (the app rewrites it at least weekly while it is on; docs/dev/feed.md). */
export const FEED_KEEP_MS = 60 * 86_400_000;

interface Due { pid: string; id: string; at: number; ttl: number; urgency: PushUrgency; blob: string; tries: number; endpoint: string }

export interface TickResult { due: number; sent: number; retried: number; dropped: number; gone: number; signed: number }

type Outcome = 'sent' | 'retry' | 'drop' | 'gone';
const classify = (status: number): Outcome =>
  status >= 200 && status < 300 ? 'sent' : status === 404 || status === 410 ? 'gone' : status === 429 || status >= 500 || status === 0 ? 'retry' : 'drop';

/** Run `f` over `list`, at most `n` at a time. */
async function pool<T>(list: T[], n: number, f: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (next < list.length) await f(list[next++]!);
  }));
}

export async function runTick(env: Env, now: number, deps: { fetch: typeof fetch } = { fetch }): Promise<TickResult> {
  const result: TickResult = { due: 0, sent: 0, retried: 0, dropped: 0, gone: 0, signed: 0 };
  try {
    await send(env, now, deps, result);
  } finally {
    if (new Date(now).getUTCMinutes() === 0) await prune(env, now); // runs even if sending failed
  }
  return result;
}

async function send(env: Env, now: number, deps: { fetch: typeof fetch }, result: TickResult): Promise<void> {
  const signer = await loadSigner(env);
  if (!signer) return; // no VAPID keys: leave everything where it is
  const { results: due } = await env.DB.prepare(
    `SELECT i.pid, i.id, i.at, i.ttl, i.urgency, i.blob, i.tries, d.endpoint
     FROM push_items i JOIN push_devices d ON d.pid = i.pid
     WHERE i.at <= ?1 AND i.at + i.ttl * 1000 >= ?2
     ORDER BY i.at, i.pid, i.id LIMIT ?3`,
  ).bind(now + EARLY_MS, now, TICK_LIMIT).all<Due>();
  result.due = due.length;
  if (!due.length) return;

  const headers = new VapidHeaders(signer, now);
  const finished: [string, string][] = []; // delivered or given up
  const retry: [string, string][] = [];
  const gone = new Set<string>();
  const status = new Map<string, { pid: string; ok: number; status: number }>();

  await pool(due, SEND_CONCURRENCY, async row => {
    const endpoint = checkEndpoint(row.endpoint, env); // the allow-list may have changed since it was stored
    let code = 400;
    if (endpoint) code = await sendWebPush(deps.fetch, { endpoint, blob: row.blob, ttl: (row.at + row.ttl * 1000 - now) / 1000, urgency: row.urgency, authorization: await headers.for(endpoint) });
    let outcome = classify(code);
    if (outcome === 'retry' && row.tries + 1 >= MAX_TRIES) outcome = 'drop';
    const key: [string, string] = [row.pid, row.id];
    if (outcome === 'sent') { finished.push(key); result.sent++; }
    else if (outcome === 'retry') { retry.push(key); result.retried++; }
    else if (outcome === 'gone') { gone.add(row.pid); result.gone++; }
    else { finished.push(key); result.dropped++; }
    const prev = status.get(row.pid);
    if (!prev?.ok) status.set(row.pid, { pid: row.pid, ok: outcome === 'sent' ? 1 : 0, status: code });
  });
  result.signed = headers.signed;

  const db = env.DB;
  const rows = [...status.values()].filter(s => !gone.has(s.pid));
  const writes = [
    finished.length && db.prepare('DELETE FROM push_items WHERE (pid, id) IN (SELECT json_extract(value, \'$[0]\'), json_extract(value, \'$[1]\') FROM json_each(?1))').bind(JSON.stringify(finished)),
    retry.length && db.prepare('UPDATE push_items SET tries = tries + 1 WHERE (pid, id) IN (SELECT json_extract(value, \'$[0]\'), json_extract(value, \'$[1]\') FROM json_each(?1))').bind(JSON.stringify(retry)),
    gone.size && db.prepare('DELETE FROM push_items WHERE pid IN (SELECT value FROM json_each(?1))').bind(JSON.stringify([...gone])),
    gone.size && db.prepare('DELETE FROM push_devices WHERE pid IN (SELECT value FROM json_each(?1))').bind(JSON.stringify([...gone])),
    rows.length && db.prepare(
      `UPDATE push_devices SET fails = CASE WHEN u.ok THEN 0 ELSE fails + 1 END, last_status = u.status, last_sent = CASE WHEN u.ok THEN ?2 ELSE last_sent END
       FROM (SELECT json_extract(value, '$.pid') AS pid, json_extract(value, '$.ok') AS ok, json_extract(value, '$.status') AS status FROM json_each(?1)) u
       WHERE push_devices.pid = u.pid`,
    ).bind(JSON.stringify(rows), now),
  ].filter((s): s is D1PreparedStatement => !!s);
  if (writes.length) await db.batch(writes);
}

/** Hourly: forget devices with no schedule write for 45 days, items past their TTL, items of no device, and calendar feeds not written for 60 days. */
export async function prune(env: Env, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM push_items WHERE pid IN (SELECT pid FROM push_devices WHERE updated < ?1)').bind(now - DEVICE_KEEP_MS),
    env.DB.prepare('DELETE FROM push_devices WHERE updated < ?1').bind(now - DEVICE_KEEP_MS),
    env.DB.prepare('DELETE FROM push_items WHERE at < ?1 AND at + ttl * 1000 < ?1').bind(now),
    env.DB.prepare('DELETE FROM push_items WHERE pid NOT IN (SELECT pid FROM push_devices)'),
    env.DB.prepare('DELETE FROM feeds WHERE updated < ?1').bind(now - FEED_KEEP_MS),
  ]);
}
