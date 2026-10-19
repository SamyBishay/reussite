// A small cache, per Worker isolate, of the decrypted and merged list (docs/dev/connector.md,
// "CPU on the free plan"). A call that finds its space here reads only the batches after what the
// entry holds, instead of decrypting and parsing the snapshot again. It is a bonus: a new isolate
// starts empty, and the connector must fit the free plan's CPU without it.
//
// What it holds is plaintext, in memory only, and only while the connector is on: the relay already
// holds the key then, so this does not change who can read the list. An entry is dropped when the
// connector is switched off or the space is deleted (in the isolate that handles that), when the
// connector is switched on again with a new wrapped key (every call compares it), after five idle
// minutes, and to keep to a few spaces and a byte budget. Every call still passes the database
// check that the connector is on, so an entry in another isolate can never answer once it is off.
import type { Sealer } from '../../../src/sync/crypto';
import type { Loaded, Maps, SplitInfo } from './space';

export interface Entry {
  space: string;
  /** The wrapped key the entry was made under; a different one (switched off and on) is a different entry. */
  wrapped: string;
  keys: Sealer;
  maps: Maps;
  /** Everything up to and including this seq is in `maps`. */
  head: number;
  /** A clock string past every timestamp in `maps`. */
  top: string;
  split: SplitInfo | null;
  /** A rough size, to keep the cache to a byte budget. */
  bytes: number;
  used: number;
}

export const CACHE_SPACES = 3;
export const CACHE_BYTES = 24_000_000;
export const CACHE_IDLE_MS = 5 * 60_000;

const entries = new Map<string, Entry>();
let on = true;

/** Tests and the benchmark switch it off to measure a cold isolate. */
export function setCacheEnabled(enabled: boolean): void {
  on = enabled;
  if (!enabled) entries.clear();
}

export function cacheGet(space: string, wrapped: string, now = Date.now()): Entry | undefined {
  const e = on ? entries.get(space) : undefined;
  if (!e) return undefined;
  if (e.wrapped !== wrapped || now - e.used > CACHE_IDLE_MS) { entries.delete(space); return undefined; }
  e.used = now;
  entries.delete(space); // most recently used last
  entries.set(space, e);
  return e;
}

/** Forget a space: the connector was switched off or the space deleted. */
export function cacheDrop(space: string): void {
  entries.delete(space);
}

export const cacheSize = (): number => entries.size;

/** Keep what a request now holds, for the next one. */
export function remember(s: Loaded, wrapped = s.wrapped, now = Date.now()): void {
  if (!on || s.newer || !wrapped) return;
  if (s.split && !s.split.loaded && s.split.pending) return; // not usable until the cold part has been read
  const rough = (m: Map<string, unknown>) => m.size * 2000;
  const bytes = Object.values(s.maps).reduce((a, m) => a + rough(m), 0);
  if (bytes > CACHE_BYTES) return;
  entries.delete(s.space);
  entries.set(s.space, {
    space: s.space, wrapped, keys: s.keys, maps: s.maps, head: s.readHead, split: s.split && { ...s.split },
    top: `${String(s.clock.wall).padStart(13, '0')}:${String(s.clock.counter).padStart(4, '0')}:${s.clock.node}`, bytes, used: now,
  });
  let total = 0, n = 0;
  for (const e of [...entries.values()].reverse()) {
    total += e.bytes;
    if (++n > CACHE_SPACES || total > CACHE_BYTES) entries.delete(e.space);
  }
}
