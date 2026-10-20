// The connector reads and writes a space like any other device (docs/dev/sync.md): it decrypts
// the latest snapshot and the batches after it, folds them in with the engine the app uses, and
// writes encrypted change batches under its own node id ("connector") and a clock kept per space.
// A snapshot in two parts (hot and cold, src/sync/parts.ts) is read hot first: that answers the
// common questions, and the cold part is fetched only when something asks for it (`loadCold`).
// Nothing here knows about tools; tools.ts and the writer sit on top.
import { b64uDecode } from '../../../src/sync/bytes';
import { decryptJson, sealToText, type Sealer } from '../../../src/sync/crypto';
import { decodeBatch, decodeSnapshot, encodeBatch, encodeSnapshot } from '../../../src/sync/wire';
import { applyIncoming, collectOutgoing, SYNCED_COLLECTIONS, type DocSet } from '../../../src/sync/engine';
import { create, merge, patch, remove } from '../../../src/data/doc';
import { createClock, format, receive, tick, type Clock } from '../../../src/data/hlc';
import { COLLECTIONS, SCHEMA_VERSION, type Collection, type UndoDoc } from '../../../src/data/schema';
import { b64uLength, MAX_BATCH_BYTES, MAX_SNAPSHOT_BYTES, type ChangeBatch, type ChangeDoc, type ColdDigest, type Cut, type Snapshot, type StoredDoc } from '../../../src/sync/protocol';
import { buildParts, hotFrom, inCold } from '../../../src/sync/parts';
import type { Env } from '../env';
import { appendBatch, spaceSlot, storeSnapshot, type SnapshotWrite } from '../sync';
import { CONNECTOR_DEVICE } from './admin';
import { cacheGet, remember, type Entry } from './cache';
import { UndoLog } from '../../../src/ai/undo';

export type { UndoDoc };
export type Maps = Record<Collection, Map<string, StoredDoc>>;
export const emptyMaps = (): Maps => Object.fromEntries(COLLECTIONS.map(c => [c, new Map()])) as unknown as Maps;

/** After its own write, the connector rewrites the hot snapshot once this many batches have piled up on it. */
export const COMPACT_TAIL = 10;
/**
 * Rewriting the hot part costs CPU in proportion to its size (gzip is most of it: about 17 ms for 1,100
 * documents, 2.6 ms for 250), and the write that triggers it has to answer within the same 10 ms. Above
 * this many documents the connector leaves it to the apps.
 */
export const COMPACT_MAX_DOCS = 600;

/** What a two-part snapshot adds to a loaded space (see `Loaded.split`). */
export interface SplitInfo {
  /** The hot part's `upto`. */
  upto: number;
  cut: Cut;
  /** Everything dated on or after this day is held in full. */
  from: string;
  /** The ids held by the cold part, per collection. */
  index: Record<string, string>;
  /** What the cold documents add to answers about the hot ones. Not used once the cold part is loaded. */
  x: ColdDigest;
  /** The cold part has been merged into `maps`. */
  loaded: boolean;
  /** A document of the tail, or one a day or decision points to, is held by the cold part too: it has to be read before any answer. */
  pending: boolean;
}

export interface Loaded {
  space: string;
  keys: Sealer;
  /**
   * Every document read so far, tombstones included. Shared with the cache until this request
   * writes: `writable(c)` copies a collection before changing it.
   */
  maps: Maps;
  /** The highest seq folded in. */
  head: number;
  /** The highest seq read from the database (not counting this request's own batch). */
  readHead: number;
  /** The connector's clock for this space, past every timestamp seen. */
  clock: Clock;
  /** Something in the space was written by a newer app than this relay understands: read and write nothing. */
  newer: boolean;
  /** Set when the snapshot is in two parts (hot and cold); null for a whole one or none. */
  split: SplitInfo | null;
  /** The collections of `maps` this request owns (may change). */
  own: Set<Collection>;
  /** Served from the isolate's cache. */
  cached: boolean;
  /** This request read the cold part from the database (a cached copy that has it doesn't count). */
  coldRead: boolean;
  /** The wrapped key this was read under: what the cache is keyed on besides the space. */
  wrapped?: string;
}

/** Not an error: the answer needs documents the cold part holds. Load it (`loadCold`) and ask again. */
export class NeedCold extends Error {
  constructor() { super('needs the cold part'); }
}

export const needsCold = (s: Loaded): boolean => !!s.split && !s.split.loaded;

/** A collection's map that this request may change. */
export function writable(s: Loaded, c: Collection): Map<string, StoredDoc> {
  if (!s.own.has(c)) { s.maps = { ...s.maps, [c]: new Map(s.maps[c]) }; s.own.add(c); }
  return s.maps[c];
}

const hotKinds = "kind IN ('full', 'hot')";

/**
 * The space as it stands: the latest snapshot (its hot part), then the batches after it. Decrypting
 * and parsing the snapshot is the expensive part (relay/bench measures it); with a cached copy only
 * the batches after what the cache holds are read.
 */
export async function loadSpace(env: Env, space: string, keys: Sealer, persisted: { wall: number; counter: number }, cached?: Entry | null): Promise<Loaded> {
  if (cached) {
    const [info, tail] = await env.DB.batch<{ upto: number | null; head: number | null; seq: number; blob: string }>([
      env.DB.prepare(`SELECT (SELECT upto FROM snapshots WHERE space = ?1 AND ${hotKinds} AND part = 0) AS upto, (SELECT head FROM spaces WHERE id = ?1) AS head`).bind(space),
      env.DB.prepare('SELECT seq, blob FROM batches WHERE space = ?1 AND seq > ?2 ORDER BY seq').bind(space, cached.head),
    ]);
    const i = info!.results[0];
    // Valid while nothing newer than what we hold was folded into a snapshot (those batches are gone), and the space wasn't recreated.
    if (i && (i.upto ?? 0) <= cached.head && (i.head ?? -1) >= cached.head) {
      const s = fromEntry(space, keys, persisted, cached);
      await foldTail(s, tail!.results);
      return s;
    }
  }
  const [snaps, batches] = await env.DB.batch<{ blob: string; upto: number; seq: number }>([
    env.DB.prepare(`SELECT blob, upto FROM snapshots WHERE space = ?1 AND ${hotKinds} ORDER BY part`).bind(space),
    env.DB.prepare(`SELECT seq, blob FROM batches WHERE space = ?1 AND seq > COALESCE((SELECT upto FROM snapshots WHERE space = ?1 AND ${hotKinds} AND part = 0), 0) ORDER BY seq`).bind(space),
  ]);
  return buildSpace(space, keys, snaps!.results.length ? snaps!.results.map(r => r.blob).join('') : null, batches!.results, persisted);
}

function newClock(persisted: { wall: number; counter: number }): Clock {
  const clock = createClock(CONNECTOR_DEVICE);
  clock.wall = persisted.wall;
  clock.counter = persisted.counter;
  return clock;
}

function fromEntry(space: string, keys: Sealer, persisted: { wall: number; counter: number }, e: Entry): Loaded {
  const clock = newClock(persisted);
  if (e.top) receive(clock, e.top);
  return { space, keys, maps: { ...e.maps }, head: e.head, readHead: e.head, clock, newer: false, split: e.split && { ...e.split }, own: new Set(), cached: true, coldRead: false };
}

/** The work after the database reads, on its own so the benchmark can time it. */
export async function buildSpace(
  space: string, keys: Sealer, snapshotBlob: string | null, batchRows: { seq: number; blob: string }[], persisted: { wall: number; counter: number },
): Promise<Loaded> {
  const clock = newClock(persisted);
  const out: Loaded = { space, keys, maps: emptyMaps(), head: 0, readHead: 0, clock, newer: false, split: null, own: new Set(COLLECTIONS), cached: false, coldRead: false };

  if (snapshotBlob) {
    const snap = decodeSnapshot(await decryptJson(keys, b64uDecode(snapshotBlob)));
    out.head = out.readHead = snap.upto;
    if (snap.v > SCHEMA_VERSION) out.newer = true;
    if (snap.part === 'hot' && snap.cut && snap.cold && snap.x) {
      out.split = { upto: snap.upto, cut: snap.cut, from: hotFrom(snap.cut), index: snap.cold, x: snap.x, loaded: false, pending: false };
    }
    // Straight into the maps: a snapshot has each document once, so there is nothing to merge.
    let top = snap.top ?? '';
    for (const c of SYNCED_COLLECTIONS) {
      const into = out.maps[c];
      for (const d of snap.docs[c] ?? []) {
        if (!d || typeof d.id !== 'string' || !d._hlc || typeof d._v !== 'number') continue;
        if (d._v > SCHEMA_VERSION) out.newer = true;
        into.set(d.id, d);
        if (snap.top === undefined) {
          for (const k in d._hlc) if (d._hlc[k]! > top) top = d._hlc[k]!;
          if (d._del && d._del > top) top = d._del;
        }
      }
    }
    if (top) receive(clock, top);
  }
  await foldTail(out, batchRows);
  return out;
}

/** Fold the batches after the snapshot (or the cache) into the maps. */
async function foldTail(s: Loaded, batchRows: { seq: number; blob: string }[]): Promise<void> {
  const entries: ChangeDoc[] = [];
  for (const row of await Promise.all(batchRows.map(async r => ({ seq: r.seq, batch: decodeBatch(await decryptJson(s.keys, b64uDecode(r.blob))) })))) {
    s.head = s.readHead = Math.max(s.head, row.seq);
    if (row.batch.v > SCHEMA_VERSION) s.newer = true;
    entries.push(...row.batch.docs);
  }
  if (entries.length && !s.newer) {
    const sp = s.split && !s.split.loaded ? s.split : null;
    if (sp) for (const e of entries) if (e?.d && !s.maps[e.c]?.has(e.d.id) && inCold(sp.index, e.c, e.d.id)) sp.pending = true; // a document the cold part holds too
    const r = applyIncoming(s.maps, entries, s.clock);
    if (r.newer) s.newer = true;
    for (const w of r.writes) writable(s, w.c).set(w.d.id, w.d);
  }
  if (s.split && !s.split.loaded && !s.newer) checkReferences(s);
}

const refIds = (a: unknown): string[] => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);

/**
 * The hot part keeps every step a hot day's list or a decision points to. A batch since may point
 * at an older one (a day planned with a step finished months ago): if that step is in the cold
 * part, it has to be read before the list can be shown.
 */
function checkReferences(s: Loaded): void {
  const sp = s.split!;
  if (sp.pending) return;
  const missing = (id: string) => !s.maps.tasks.has(id) && inCold(sp.index, 'tasks', id);
  for (const d of s.maps.days.values()) {
    if (d._del) continue;
    const first = d.first as { id?: unknown } | null | undefined;
    if (refIds(d.plan).some(missing) || refIds(d.optional).some(missing) || (typeof first?.id === 'string' && missing(first.id))) { sp.pending = true; return; }
  }
  for (const d of s.maps.decisions.values()) if (!d._del && refIds(d.taskIds).some(missing)) { sp.pending = true; return; }
}

/** Merge the cold part into the maps (this request's own copies). Afterwards `maps` is the whole list. */
export async function loadCold(env: Env, s: Loaded): Promise<void> {
  const sp = s.split;
  if (!sp || sp.loaded) return;
  const rows = await env.DB.prepare("SELECT blob FROM snapshots WHERE space = ?1 AND kind = 'cold' ORDER BY part").bind(s.space).all<{ blob: string }>();
  if (rows.results.length) {
    const snap = decodeSnapshot(await decryptJson(s.keys, b64uDecode(rows.results.map(r => r.blob).join(''))));
    if (snap.v > SCHEMA_VERSION) s.newer = true;
    let top = snap.top ?? '';
    for (const c of SYNCED_COLLECTIONS) {
      const list = snap.docs[c] ?? [];
      if (!list.length) continue;
      const into = writable(s, c);
      for (const d of list) {
        if (!d || typeof d.id !== 'string' || !d._hlc || typeof d._v !== 'number') continue;
        if (d._v > SCHEMA_VERSION) s.newer = true;
        const cur = into.get(d.id);
        into.set(d.id, cur ? merge(d, cur) : d);
        if (snap.top === undefined) for (const k in d._hlc) if (d._hlc[k]! > top) top = d._hlc[k]!;
      }
    }
    if (top) receive(s.clock, top);
  }
  sp.loaded = true;
  sp.pending = false;
  s.coldRead = true;
  remember(s);
}

/**
 * A set of edits to a loaded space. It uses the same document functions as the app (create,
 * patch, remove), keeps what each edit replaced (for undo), and ends in one encrypted batch.
 */
export class Edits {
  private touched = new Map<string, Collection>();
  private watermark: string;
  /** What changed, field by field (src/ai/undo.ts, shared with the app). */
  private log = new UndoLog();

  constructor(readonly s: Loaded, private now: () => number = Date.now) {
    this.watermark = format(s.clock.wall, s.clock.counter, s.clock.node);
  }

  /** A live document, or undefined. Throws `NeedCold` when the document is only in the cold part, which isn't loaded. */
  get(c: Collection, id: string): StoredDoc | undefined {
    const d = this.s.maps[c].get(id);
    if (!d) this.guard(c, id);
    return d && !d._del ? d : undefined;
  }
  private guard(c: Collection, id: string) {
    const sp = this.s.split;
    if (sp && !sp.loaded && inCold(sp.index, c, id)) throw new NeedCold();
  }
  /** Live documents of a collection (no tombstones). */
  *live(c: Collection): Generator<StoredDoc> {
    for (const d of this.s.maps[c].values()) if (!d._del) yield d;
  }

  createDoc(c: Collection, id: string, fields: object): string {
    if (!this.s.maps[c].has(id)) this.guard(c, id); // a day that exists in the cold part would be made again from nothing
    const doc = create(id, fields, SCHEMA_VERSION, tick(this.s.clock, this.now())) as StoredDoc;
    writable(this.s, c).set(id, doc);
    this.touch(c, id);
    this.log.created(c, id, doc);
    return id;
  }

  update(c: Collection, id: string, changes: Record<string, unknown>): void {
    const cur = this.get(c, id);
    if (!cur) throw new Error('missing ' + c + '/' + id);
    const next = patch(cur, changes, this.s.clock, SCHEMA_VERSION) as StoredDoc;
    this.touch(c, id);
    this.log.updated(c, id, cur, next, Object.keys(changes));
    writable(this.s, c).set(id, next);
  }

  /** A tombstone, never a hard delete. */
  remove(c: Collection, id: string): void {
    const cur = this.get(c, id);
    if (!cur) return;
    writable(this.s, c).set(id, remove(cur, this.s.clock) as StoredDoc);
    this.touch(c, id);
    this.log.removed(c, id);
  }

  private touch(c: Collection, id: string) { this.touched.set(c + '/' + id, c); }

  /** The undo records so far. */
  get undo(): UndoDoc[] { return this.log.docs; }

  get empty() { return this.touched.size === 0; }

  /** The changes as one batch: every field this clock wrote after the watermark. */
  outgoing(): ChangeDoc[] {
    const set: Partial<Record<Collection, StoredDoc[]>> = {};
    for (const [key, c] of this.touched) (set[c] ??= []).push(this.s.maps[c].get(key.slice(c.length + 1))!);
    return collectOutgoing(set as DocSet, this.s.clock.node, this.watermark).docs;
  }

  /** Encrypt and append the batch; remember the clock. Returns the seq, or null when over the rate limit. */
  async flush(env: Env): Promise<number | null> {
    const docs = this.outgoing();
    if (!docs.length) return this.s.head;
    const blob = await sealToText(this.s.keys, encodeBatch({ v: SCHEMA_VERSION, device: CONNECTOR_DEVICE, docs }), { lean: true });
    if (blob.length > b64uLength(MAX_BATCH_BYTES)) throw new Error('This change is too big for one batch. Split it into smaller change-sets.');
    const seq = await appendBatch(env, this.s.space, CONNECTOR_DEVICE, blob);
    if (seq === null) return null;
    // Our batch follows what we read with nothing in between only if the numbers are consecutive.
    const contiguous = seq === this.s.readHead + 1;
    this.s.head = seq;
    // Only ever forwards, so two overlapping calls can't wind the clock back.
    await env.DB.prepare(
      'UPDATE connector SET hlc_wall = MAX(hlc_wall, ?1), hlc_counter = CASE WHEN ?1 > hlc_wall THEN ?2 WHEN ?1 = hlc_wall THEN MAX(hlc_counter, ?2) ELSE hlc_counter END WHERE space = ?3',
    ).bind(this.s.clock.wall, this.s.clock.counter, this.s.space).run();
    // The state we hold includes our batch; it is complete up to what we read, and up to our batch only if it followed that directly.
    this.s.readHead = contiguous ? seq : this.s.readHead;
    await compact(env, this.s).catch(() => undefined); // best effort: the apps snapshot too
    remember(this.s);
    return seq;
  }
}

/**
 * The tail since the snapshot is what every later call folds. After a write, once it is longer
 * than COMPACT_TAIL, the connector writes the hot part again (docs/dev/sync.md). With only the hot
 * part loaded, what it holds is the old hot part plus the tail, which is exactly a new hot part, and
 * the cold part stays as it is. That doesn't work if a document the cold part also holds was touched
 * (the connector holds a stub of it), so then it waits for the apps. If this request had to read the
 * cold part, it holds the whole list and cuts the hot part again, at once, so the calls that follow
 * needn't read the cold part too.
 */
export async function compact(env: Env, s: Loaded): Promise<boolean> {
  const sp = s.split;
  if (!sp || s.newer || (!sp.loaded && sp.pending)) return false;
  const upto = s.readHead;
  if (upto - sp.upto < (s.coldRead ? 1 : COMPACT_TAIL)) return false;
  if (SYNCED_COLLECTIONS.reduce((n, c) => n + s.maps[c].size, 0) > COMPACT_MAX_DOCS) return false;
  if ((await spaceSlot(env, s.space, Date.now(), 0)) === null) return false;
  let write: SnapshotWrite;
  if (sp.loaded) {
    const all: Record<string, StoredDoc[]> = {};
    for (const c of SYNCED_COLLECTIONS) all[c] = [...s.maps[c].values()];
    const parts = buildParts(all as never, upto, { now: Date.now(), prev: sp.cut });
    const seal = (x: Snapshot) => sealToText(s.keys, encodeSnapshot(x), { lean: true, plain: COMPACT_PLAIN });
    const [blob, cold] = [await seal(parts.hot), parts.cold ? await seal(parts.cold) : undefined];
    write = { upto, blob, part: 'hot', ...(cold ? { cold: { upto, blob: cold } } : { coldUpto: parts.cut.coldUpto }) };
    if (blob.length > b64uLength(MAX_SNAPSHOT_BYTES) || (cold && cold.length > b64uLength(MAX_SNAPSHOT_BYTES))) return false;
  } else {
    const blob = await sealHot(s, upto);
    if (blob.length > b64uLength(MAX_SNAPSHOT_BYTES)) return false;
    write = { upto, blob, part: 'hot', coldUpto: sp.cut.coldUpto };
  }
  const r = await storeSnapshot(env, s.space, write);
  if (r === 'bad_parts') return false;
  sp.upto = Math.max(sp.upto, r.upto);
  return r.upto === upto;
}

/** The hot part as it now stands (the old hot part plus the tail), sealed for the relay. */
export async function sealHot(s: Loaded, upto: number): Promise<string> {
  const sp = s.split!;
  const docs: Record<string, StoredDoc[]> = {};
  for (const c of SYNCED_COLLECTIONS) docs[c] = [...s.maps[c].values()];
  const top = format(s.clock.wall, s.clock.counter, s.clock.node);
  return sealToText(s.keys, encodeSnapshot({ v: SCHEMA_VERSION, upto, part: 'hot', cut: sp.cut, cold: sp.index, x: sp.x, top, docs }), { lean: true, plain: COMPACT_PLAIN });
}

/** Compaction writes the hot part uncompressed: gzip of the whole hot part costs more CPU than the call has left (relay/bench). */
const COMPACT_PLAIN = false;
