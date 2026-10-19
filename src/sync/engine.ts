// The sync logic, with no I/O: which changes to send, and how to fold received ones in.
// Storage is the caller's business (see run.ts for the loop and the store interface).
//
// No outbox table: an HLC is monotonic per device, and its last part is the device's node id.
// So "everything this device wrote after the watermark" is exactly the unpushed changes.
import { type Clock, type Hlc, parse, receive } from '../data/hlc';
import { merge } from '../data/doc';
import { COLLECTIONS, type Collection, SCHEMA_VERSION } from '../data/schema';
import type { ChangeDoc, Snapshot, StoredDoc } from './protocol';

/**
 * The collections that sync: every one in the schema, settings (`meta`) included. The `local`
 * and `backups` tables are not collections, so sync key, AI key and push subscription can't enter a batch.
 */
export const SYNCED_COLLECTIONS: readonly Collection[] = COLLECTIONS;
const SYNCED = new Set<string>(SYNCED_COLLECTIONS);
export const isSynced = (c: string): c is Collection => SYNCED.has(c);

export type DocSet = Partial<Record<Collection, Iterable<StoredDoc>>>;

/** Imported and migrated fields carry the oldest clock (node '0'). */
const IMPORTED_NODE = '0';

export interface Outgoing {
  docs: ChangeDoc[];
  /** Pass this next time. Unchanged when there is nothing to send. */
  watermark: Hlc;
}

/**
 * Every field (and deletion) whose clock was written by `ownNode` after `watermark`, as partial
 * documents. Fields written by other nodes are never emitted. With `imported`, fields with the
 * oldest clock (v1 import) go too: they can't be told apart from "already sent" by clock alone,
 * so the first sync, and the sync after an import, ask for them.
 */
export function collectOutgoing(all: DocSet, ownNode: string, watermark: Hlc, opts: { imported?: boolean } = {}): Outgoing {
  const docs: ChangeDoc[] = [];
  let top = watermark;
  const wanted = (h: Hlc | undefined): h is Hlc => {
    if (h === undefined) return false;
    const node = parse(h).node;
    if (node === ownNode) return h > watermark;
    return !!opts.imported && node === IMPORTED_NODE;
  };
  for (const c of SYNCED_COLLECTIONS) {
    for (const doc of all[c] ?? []) {
      const hlc: Record<string, Hlc> = {};
      const part: Record<string, unknown> = {};
      for (const [k, h] of Object.entries(doc._hlc)) {
        if (!wanted(h)) continue;
        hlc[k] = h;
        part[k] = doc[k];
        if (h > top) top = h;
      }
      const del = wanted(doc._del) ? doc._del : undefined;
      if (del !== undefined && del > top) top = del;
      if (!Object.keys(hlc).length && del === undefined) continue;
      const d: Record<string, unknown> = { ...part, id: doc.id, _v: doc._v, _hlc: hlc };
      if (del !== undefined) d._del = del;
      docs.push({ c, d: d as StoredDoc });
    }
  }
  return { docs, watermark: top };
}

export type LocalDocs = Partial<Record<Collection, ReadonlyMap<string, StoredDoc>>>;

export interface Incoming {
  /** Merged documents to put, only those that differ from what's stored. */
  writes: { c: Collection; d: StoredDoc }[];
  /** A document from a newer schema: apply nothing, go read-only, ask to reload. */
  newer: boolean;
  /** Malformed entries or unknown collections, left out. */
  skipped: number;
}

const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

const wellFormed = (d: unknown): d is StoredDoc =>
  !!d && typeof d === 'object' && typeof (d as StoredDoc).id === 'string' && typeof (d as StoredDoc)._v === 'number' &&
  !!(d as StoredDoc)._hlc && typeof (d as StoredDoc)._hlc === 'object';

/**
 * Merge received documents into the local ones (per field, last writer wins) and advance the
 * clock past every received timestamp. Pure: nothing is written, `writes` says what to put.
 * If any document is from a newer schema, nothing is applied (`newer`): the data stays on the
 * relay, and the reloaded app pulls it again.
 */
export function applyIncoming(local: LocalDocs, remote: readonly ChangeDoc[], clock: Clock, now = Date.now()): Incoming {
  let skipped = 0;
  const good: ChangeDoc[] = [];
  for (const r of remote) {
    if (!r || !isSynced(r.c) || !wellFormed(r.d)) { skipped++; continue; }
    good.push(r);
  }
  if (good.some(r => r.d._v > SCHEMA_VERSION)) return { writes: [], newer: true, skipped };

  const work = new Map<string, { c: Collection; cur: StoredDoc | undefined }>();
  for (const { c, d } of good) {
    const key = c + '/' + d.id;
    const cur = work.has(key) ? work.get(key)!.cur : local[c]?.get(d.id);
    work.set(key, { c, cur: cur ? merge(cur, d) : { ...d, _hlc: { ...d._hlc } } });
    for (const h of Object.values(d._hlc)) receive(clock, h, now);
    if (d._del) receive(clock, d._del, now);
  }
  const writes: Incoming['writes'] = [];
  for (const [key, { c, cur }] of work) {
    const before = local[c]?.get(key.slice(c.length + 1));
    if (cur && (!before || canon(before) !== canon(cur))) writes.push({ c, d: cur });
  }
  return { writes, newer: false, skipped };
}

/** The whole space, tombstones included. `upto` must be a seq this device has fully applied. */
export function buildSnapshot(all: DocSet, upto: number): Snapshot {
  const docs: Record<string, StoredDoc[]> = {};
  for (const c of SYNCED_COLLECTIONS) docs[c] = [...(all[c] ?? [])];
  return { v: SCHEMA_VERSION, upto, docs };
}

/** A snapshot as change entries, for applyIncoming. */
export function snapshotDocs(s: Snapshot): ChangeDoc[] {
  const out: ChangeDoc[] = [];
  for (const [c, docs] of Object.entries(s.docs)) for (const d of docs) out.push({ c: c as Collection, d });
  return out;
}
