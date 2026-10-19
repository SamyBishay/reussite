// The connector reads and writes a space like any other device (docs/dev/sync.md): it decrypts
// the latest snapshot and the batches after it, folds them in with the engine the app uses, and
// writes encrypted change batches under its own node id ("connector") and a clock kept per space.
// Nothing here knows about tools; tools.ts and the writer sit on top.
import { b64uDecode } from '../../../src/sync/bytes';
import { decryptJson, sealToText, type Sealer } from '../../../src/sync/crypto';
import { applyIncoming, collectOutgoing, SYNCED_COLLECTIONS, type DocSet } from '../../../src/sync/engine';
import { create, patch, remove } from '../../../src/data/doc';
import { createClock, format, receive, tick, type Clock } from '../../../src/data/hlc';
import { COLLECTIONS, SCHEMA_VERSION, type Collection } from '../../../src/data/schema';
import { b64uLength, MAX_BATCH_BYTES, type ChangeBatch, type ChangeDoc, type Snapshot, type StoredDoc } from '../../../src/sync/protocol';
import type { Env } from '../env';
import { appendBatch } from '../sync';
import { CONNECTOR_DEVICE } from './admin';

export type Maps = Record<Collection, Map<string, StoredDoc>>;
export const emptyMaps = (): Maps => Object.fromEntries(COLLECTIONS.map(c => [c, new Map()])) as unknown as Maps;

export interface Loaded {
  space: string;
  keys: Sealer;
  /** Every document, tombstones included. */
  maps: Maps;
  /** The highest seq folded in. */
  head: number;
  /** The connector's clock for this space, past every timestamp seen. */
  clock: Clock;
  /** Something in the space was written by a newer app than this relay understands: read and write nothing. */
  newer: boolean;
}

/**
 * The space as it stands: the latest snapshot, then the batches after it. Decrypting and parsing
 * the snapshot is the expensive part (relay/bench measures it); the cost grows with the list.
 */
export async function loadSpace(env: Env, space: string, keys: Sealer, persisted: { wall: number; counter: number }): Promise<Loaded> {
  const [snaps, batches] = await env.DB.batch<{ blob: string; upto: number; seq: number }>([
    env.DB.prepare('SELECT blob, upto FROM snapshots WHERE space = ?1 ORDER BY part').bind(space),
    env.DB.prepare('SELECT seq, blob FROM batches WHERE space = ?1 AND seq > COALESCE((SELECT upto FROM snapshots WHERE space = ?1 AND part = 0), 0) ORDER BY seq').bind(space),
  ]);
  const clock = createClock(CONNECTOR_DEVICE);
  clock.wall = persisted.wall;
  clock.counter = persisted.counter;
  const out: Loaded = { space, keys, maps: emptyMaps(), head: 0, clock, newer: false };

  if (snaps!.results.length) {
    const snap = await decryptJson<Snapshot>(keys, b64uDecode(snaps!.results.map(r => r.blob).join('')));
    out.head = snap.upto;
    if (snap.v > SCHEMA_VERSION) out.newer = true;
    // Straight into the maps: a snapshot has each document once, so there is nothing to merge.
    let top = '';
    for (const c of SYNCED_COLLECTIONS) {
      const into = out.maps[c];
      for (const d of snap.docs[c] ?? []) {
        if (!d || typeof d.id !== 'string' || !d._hlc || typeof d._v !== 'number') continue;
        if (d._v > SCHEMA_VERSION) out.newer = true;
        into.set(d.id, d);
        for (const h of Object.values(d._hlc)) if (h > top) top = h;
        if (d._del && d._del > top) top = d._del;
      }
    }
    if (top) receive(clock, top);
  }

  const entries: ChangeDoc[] = [];
  for (const row of await Promise.all(batches!.results.map(async r => ({ seq: r.seq, batch: await decryptJson<ChangeBatch>(keys, b64uDecode(r.blob)) })))) {
    out.head = Math.max(out.head, row.seq);
    if (row.batch.v > SCHEMA_VERSION) out.newer = true;
    entries.push(...row.batch.docs);
  }
  if (entries.length && !out.newer) {
    const r = applyIncoming(out.maps, entries, clock);
    if (r.newer) out.newer = true;
    for (const w of r.writes) out.maps[w.c].set(w.d.id, w.d);
  }
  return out;
}

/**
 * A set of edits to a loaded space. It uses the same document functions as the app (create,
 * patch, remove), keeps what each edit replaced (for undo), and ends in one encrypted batch.
 */
export class Edits {
  private touched = new Map<string, Collection>();
  private watermark: string;
  /** What changed, field by field: `was` is null for a field the document didn't have. */
  readonly undo: UndoDoc[] = [];
  private undoBy = new Map<string, UndoDoc>();

  constructor(readonly s: Loaded, private now: () => number = Date.now) {
    this.watermark = format(s.clock.wall, s.clock.counter, s.clock.node);
  }

  get(c: Collection, id: string): StoredDoc | undefined {
    const d = this.s.maps[c].get(id);
    return d && !d._del ? d : undefined;
  }
  /** Live documents of a collection (no tombstones). */
  *live(c: Collection): Generator<StoredDoc> {
    for (const d of this.s.maps[c].values()) if (!d._del) yield d;
  }

  createDoc(c: Collection, id: string, fields: object): string {
    const doc = create(id, fields, SCHEMA_VERSION, tick(this.s.clock, this.now())) as StoredDoc;
    this.s.maps[c].set(id, doc);
    this.mark(c, id, { c, id, created: true });
    return id;
  }

  update(c: Collection, id: string, changes: Record<string, unknown>): void {
    const cur = this.get(c, id);
    if (!cur) throw new Error('missing ' + c + '/' + id);
    const next = patch(cur, changes, this.s.clock, SCHEMA_VERSION) as StoredDoc;
    const u = this.mark(c, id, { c, id, fields: {} });
    for (const k of Object.keys(changes)) {
      if (next._hlc[k] === cur._hlc[k]) continue; // unchanged: no new clock
      u.fields ??= {};
      u.fields[k] ??= { was: k in cur ? cur[k] ?? null : null, now: null };
      u.fields[k]!.now = next[k] ?? null;
    }
    this.s.maps[c].set(id, next);
  }

  /** A tombstone, never a hard delete. */
  remove(c: Collection, id: string): void {
    const cur = this.get(c, id);
    if (!cur) return;
    this.s.maps[c].set(id, remove(cur, this.s.clock) as StoredDoc);
    this.mark(c, id, { c, id, removed: true });
  }

  private mark(c: Collection, id: string, u: UndoDoc): UndoDoc {
    const key = c + '/' + id;
    this.touched.set(key, c);
    const have = this.undoBy.get(key);
    if (have) {
      if (u.removed) have.removed = true;
      return have;
    }
    this.undoBy.set(key, u);
    this.undo.push(u);
    return u;
  }

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
    const blob = await sealToText(this.s.keys, { v: SCHEMA_VERSION, device: CONNECTOR_DEVICE, docs } satisfies ChangeBatch);
    if (blob.length > b64uLength(MAX_BATCH_BYTES)) throw new Error('This change is too big for one batch. Split it into smaller change-sets.');
    const seq = await appendBatch(env, this.s.space, CONNECTOR_DEVICE, blob);
    if (seq === null) return null;
    this.s.head = seq;
    // Only ever forwards, so two overlapping calls can't wind the clock back.
    await env.DB.prepare(
      'UPDATE connector SET hlc_wall = MAX(hlc_wall, ?1), hlc_counter = CASE WHEN ?1 > hlc_wall THEN ?2 WHEN ?1 = hlc_wall THEN MAX(hlc_counter, ?2) ELSE hlc_counter END WHERE space = ?3',
    ).bind(this.s.clock.wall, this.s.clock.counter, this.s.space).run();
    return seq;
  }
}

/** What one edit replaced, kept so `undo` can put it back. */
export interface UndoDoc {
  c: Collection;
  id: string;
  /** Made by this change-set: undone with a tombstone. */
  created?: true;
  /** Removed by this change-set (tombstoned). */
  removed?: true;
  fields?: Record<string, { was: unknown; now: unknown }>;
}
