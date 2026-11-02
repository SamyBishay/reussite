// The connector's maintenance, in its own cron invocation (docs/dev/connector.md, "Maintenance"). A write call has
// 10 ms of CPU on the free plan and the work after it (cutting the hot part again, writing the calendar feed again)
// does not fit, so a write only leaves a note in D1 (`feed_dirty`, `compact_due`) and this does the work later.
//
// One run picks at most ONE space and does ONE job for it, so it stays inside a cron invocation's 10 ms as far as
// that can be: the hot part's compaction if it is due, else the feed. It is best effort: a run that is killed loses
// nothing (the notes stay; the next pick comes round to it), and `last_maintained` is set before the work, so a space
// that always dies does not hold the others back: the oldest-maintained space goes first.
import { b64uDecode } from '../../../src/sync/bytes';
import { importEncKey } from '../../../src/sync/keys';
import type { Env } from '../env';
import { refreshFeed } from './feed';
import { compact, COMPACT_TAIL, loadCold, loadSpace, needsCold } from './space';
import { unwrap } from './wrap';

/** The cron expression in wrangler.jsonc that runs this; any other one is the push tick (src/index.ts). */
export const MAINTAIN_CRON = '*/5 * * * *';
/** A space whose compaction was tried is not tried again for this long (it may be one that cannot be compacted, or one that always dies). */
export const COMPACT_COOLOFF_MS = 15 * 60_000;

interface Pick { space: string; wrapped: string; wall: number; counter: number; dirty: number; due: number; tail: number; last: number }

export interface MaintainResult { space: string | null; job: 'compact' | 'feed' | null; done: boolean }

/**
 * The space that needs work and was looked at longest ago. A feed that is behind goes first in line by age like
 * the rest: there is no priority but the order of `last_maintained`. A compaction is wanted when a call had to read the
 * cold part (`compact_due`) or the batches since the hot snapshot reach COMPACT_TAIL, and only if the snapshot is in two parts.
 */
const PICK = `
  SELECT c.space, c.wrapped, c.hlc_wall AS wall, c.hlc_counter AS counter, c.feed_dirty AS dirty, c.compact_due AS due, c.last_maintained AS last,
         COALESCE((SELECT head FROM spaces s WHERE s.id = c.space), 0) - COALESCE((SELECT upto FROM snapshots n WHERE n.space = c.space AND n.kind = 'hot' AND n.part = 0), 0) AS tail
  FROM connector c
  WHERE c.feed_dirty > 0
     OR (c.last_maintained <= ?2 AND EXISTS (SELECT 1 FROM snapshots n WHERE n.space = c.space AND n.kind = 'hot' AND n.part = 0)
         AND (c.compact_due = 1 OR tail >= ?1))
  ORDER BY c.last_maintained, c.space
  LIMIT 1`;

export async function runMaintenance(env: Env, now = Date.now()): Promise<MaintainResult> {
  const p = await env.DB.prepare(PICK).bind(COMPACT_TAIL, now - COMPACT_COOLOFF_MS).first<Pick>();
  if (!p) return { space: null, job: null, done: false };
  // Before the work: a run that dies from here on still sends this space to the back of the line.
  await env.DB.prepare('UPDATE connector SET last_maintained = ?1 WHERE space = ?2').bind(now, p.space).run();

  const keys = { spaceId: p.space, encKey: await importEncKey(b64uDecode((await unwrap(env, p.space, p.wrapped)).k)) };
  // No cache in either direction: this runs in an isolate of its own, and a copy it left would be one more thing to keep right.
  const s = await loadSpace(env, p.space, keys, { wall: p.wall, counter: p.counter }, null);
  if (s.newer) return { space: p.space, job: null, done: false }; // a newer app than this relay understands: touch nothing

  // The cool-off applies here too: a space picked for its feed whose compaction was tried a moment ago gets only the feed,
  // so a compaction that always dies cannot also keep the calendar from ever being written.
  const coolOff = p.last <= now - COMPACT_COOLOFF_MS;
  if (coolOff && !!s.split && (p.due === 1 || p.tail >= COMPACT_TAIL)) {
    // A call that read the cold part (or a stub that points into it) wants the hot part cut again with the cold part in hand.
    if (p.due === 1 && needsCold(s)) await loadCold(env, s);
    const done = await compact(env, s).catch(() => false);
    // Cleared whether or not it could cut (a list over COMPACT_MAX_DOCS can't, and would ask again for ever); a write that reads the cold part sets it again.
    await env.DB.prepare('UPDATE connector SET compact_due = 0 WHERE space = ?1').bind(p.space).run();
    return { space: p.space, job: 'compact', done };
  }
  if (!p.dirty) return { space: p.space, job: null, done: false };
  // The feed. `feed_dirty` is the ms of the last write; clear it only if no write has come since we read it.
  const done = await refreshFeed(env, s, now).catch(() => false);
  await env.DB.prepare('UPDATE connector SET feed_dirty = 0 WHERE space = ?1 AND feed_dirty = ?2').bind(p.space, p.dirty).run();
  return { space: p.space, job: 'feed', done };
}
