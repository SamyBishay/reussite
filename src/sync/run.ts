// One sync round: pull everything new, fold it in, push what changed here, and now and then
// upload a snapshot. Storage and the clock are injected (`SyncStore`), so this runs against a
// fake in tests and against Dexie in the app. Safe to run again after any failure.
import type { Clock } from '../data/hlc';
import { SCHEMA_VERSION, type Collection } from '../data/schema';
import { RelayError, type Pulled, type RelayClient } from './client';
import { NewerFormatError } from './crypto';
import { applyIncoming, collectOutgoing, snapshotDocs, type DocSet, type LocalDocs } from './engine';
import type { ChangeDoc, Cut, StoredDoc } from './protocol';
import { buildParts, lateExchanges, touchesCold } from './parts';

/** What a device remembers between rounds. Keep it in the `local` table, never in synced data. */
export interface SyncState {
  /** The last relay seq fully applied here. */
  seq: number;
  /** Own clocks above this are not yet pushed ('' = never pushed). */
  watermark: string;
  /** The `upto` of the latest snapshot this device knows of. */
  snapshotSeq: number;
  /** Where the relay's hot and cold parts were cut, as this device last saw or wrote it; unset for a whole snapshot or none. */
  cut?: Cut;
  /** Exchange writes made long before they were pushed went up: the next snapshot rewrites both parts (src/sync/parts.ts, `lateExchanges`). */
  owesFull?: true;
}
export const INITIAL_STATE: SyncState = { seq: 0, watermark: '', snapshotSeq: 0 };

export interface SyncStore {
  clock: Clock;
  loadState(): Promise<SyncState>;
  saveState(s: SyncState): Promise<void>;
  /** Every document of the synced collections, deletions included. */
  all(): Promise<DocSet>;
  /** The stored documents with these ids (missing ones are left out). */
  getMany(c: Collection, ids: string[]): Promise<StoredDoc[]>;
  /** Put merged documents. In the app this goes through store.ts (read-only mode, live signals). It must throw rather than drop a write. */
  putMany(writes: { c: Collection; d: StoredDoc }[]): Promise<void>;
  /** Bring received entries written under an older schema up to the current one (see migrations). */
  upgrade?(entries: ChangeDoc[]): ChangeDoc[];
}

export interface SyncResult {
  /** A document from a newer schema was seen: the app goes read-only and asks to reload. */
  newer: boolean;
  pulled: number;
  pushed: number;
  snapshot: boolean;
  /** The relay has no space for this key yet: normal for the first device, a sign of a wrong key on a joining one. */
  emptySpace: boolean;
  /** `stopIfGone` was set and the space this device had synced with is no longer on the relay: nothing was pushed. */
  gone: boolean;
  state: SyncState;
}

export interface SyncOptions {
  /** Upload a snapshot once this many batches have piled up since the last (default `SNAPSHOT_EVERY`). */
  snapshotEvery?: number;
  /** The time, for the cut between hot and cold (tests move it). */
  now?: () => number;
  /** Documents per pushed batch (default 300; halved if the relay says too large). */
  batchDocs?: number;
  /** Push every field, whoever wrote it (after restoring a backup or importing). */
  full?: boolean;
  /** If the relay has no space but this device had already pulled from it, the space was deleted elsewhere: stop instead of recreating it. */
  stopIfGone?: boolean;
}

/**
 * A short tail: every reader (the connector most of all) decrypts and folds the batches after the
 * snapshot, which costs about 0.25 ms of CPU each, so the app snapshots after this few.
 */
export const SNAPSHOT_EVERY = 8;

const EMPTY_PAGE: Pulled = { head: 0, more: false, snapshot: null, cold: null, batches: [] };

async function fold(store: SyncStore, received: ChangeDoc[]): Promise<{ newer: boolean }> {
  const entries = store.upgrade ? store.upgrade(received) : received;
  const byColl = new Map<Collection, Set<string>>();
  for (const e of entries) if (e?.d && typeof e.d.id === 'string') (byColl.get(e.c) ?? byColl.set(e.c, new Set()).get(e.c)!).add(e.d.id);
  const local: LocalDocs = {};
  for (const [c, ids] of byColl) local[c] = new Map((await store.getMany(c, [...ids])).map(d => [d.id, d]));
  const r = applyIncoming(local, entries, store.clock);
  if (r.newer) return { newer: true };
  if (r.writes.length) await store.putMany(r.writes);
  return { newer: false };
}

export async function syncOnce(store: SyncStore, client: RelayClient, opts: SyncOptions = {}): Promise<SyncResult> {
  const node = store.clock.node;
  let state = { ...(await store.loadState()) };
  const result: SyncResult = { newer: false, pulled: 0, pushed: 0, snapshot: false, emptySpace: false, gone: false, state };

  // Pull until caught up.
  const pull = async (): Promise<SyncResult | null> => {
    for (;;) {
      const page = await client.pull(state.seq).catch(e => {
        if (e instanceof RelayError && e.code === 'unknown_space') { result.emptySpace = true; return EMPTY_PAGE; }
        if (e instanceof NewerFormatError) return null; // written by a newer app: same as a newer schema
        throw e;
      });
      if (!page) return { ...result, newer: true };
      if (result.emptySpace && opts.stopIfGone && state.seq > 0) return { ...result, gone: true };
      const entries: ChangeDoc[] = [];
      if (page.snapshot) {
        if (page.snapshot.v > SCHEMA_VERSION || (page.cold && page.cold.v > SCHEMA_VERSION)) return { ...result, newer: true };
        entries.push(...snapshotDocs(page.snapshot));
        if (page.cold) entries.push(...snapshotDocs(page.cold));
      }
      let top = page.snapshot ? Math.max(state.seq, page.snapshot.upto) : state.seq;
      for (const b of page.batches) {
        if (b.batch.v > SCHEMA_VERSION) return { ...result, newer: true };
        if (b.batch.device !== node) entries.push(...b.batch.docs); // our own are already here
        top = Math.max(top, b.seq);
      }
      if ((await fold(store, entries)).newer) return { ...result, newer: true };
      result.pulled += entries.length;
      state = { ...state, seq: top, snapshotSeq: Math.max(state.snapshotSeq, page.snapshot?.upto ?? 0) };
      if (page.snapshot) state = page.snapshot.cut ? { ...state, cut: page.snapshot.cut } : omitCut(state); // a whole snapshot has no cold part to build on
      await store.saveState(state);
      if (!page.more || (!page.snapshot && !page.batches.length)) return null; // nothing new: never spin on a gap at the head
    }
  };
  const stopped = await pull();
  if (stopped) return stopped;

  // Push what changed here.
  const everything = await store.all();
  const out = collectOutgoing(everything, node, state.watermark, { imported: state.watermark === '', all: opts.full });
  // An edit to a document the cold part holds too leaves a reader with only the hot part looking at a stub:
  // snapshot as soon as our own batch has come back, rather than after 8 more.
  const late = out.docs.length > 0 && lateExchanges(out.docs, (opts.now ?? Date.now)());
  const urgent = late || (!!state.cut && out.docs.length > 0 && touchesCold(out.docs, everything, state.cut));
  // A new space comes into being with its first write, so a first device with nothing yet still makes one.
  if (result.emptySpace && !out.docs.length) {
    await client.push({ v: SCHEMA_VERSION, device: node, docs: [] });
    state = { ...state, watermark: out.watermark };
    await store.saveState(state);
  }
  if (out.docs.length) {
    let size = opts.batchDocs ?? 300;
    for (let i = 0; i < out.docs.length;) {
      const docs = out.docs.slice(i, i + size);
      try {
        await client.push({ v: SCHEMA_VERSION, device: node, docs });
        i += docs.length;
        result.pushed += docs.length;
      } catch (e) {
        if (e instanceof RelayError && e.code === 'too_large' && docs.length > 1) size = Math.ceil(docs.length / 2);
        else throw e;
      }
    }
    state = { ...state, watermark: out.watermark, ...(late ? { owesFull: true as const } : {}) };
    await store.saveState(state);
  }

  if (urgent) {
    const again = await pull(); // our batch's seq, and anything others wrote meanwhile, so the snapshot may cover it
    if (again) return again;
  }

  // Now and then, a snapshot so new devices start fast and the relay can drop old batches. Two parts
  // (src/sync/parts.ts): the hot one every time, the cold one when the cut is old or unknown.
  if (state.seq - state.snapshotSeq >= (opts.snapshotEvery ?? SNAPSHOT_EVERY) || (urgent && state.seq > state.snapshotSeq) || (state.owesFull && state.seq > 0)) {
    try {
      const all = await store.all();
      const now = (opts.now ?? Date.now)();
      let parts = buildParts(all, state.seq, { now, prev: state.cut, full: !!state.owesFull });
      try {
        await client.putSnapshotParts(parts);
      } catch (e) {
        if (!(e instanceof RelayError && e.code === 'bad_parts' && !parts.cold)) throw e;
        parts = buildParts(all, state.seq, { now, full: true }); // the relay holds no cold part to build on
        await client.putSnapshotParts(parts);
      }
      const { owesFull: _, ...rest } = state;
      state = { ...rest, snapshotSeq: state.seq, cut: parts.cut };
      await store.saveState(state);
      result.snapshot = true;
    } catch (e) {
      if (!(e instanceof RelayError && e.code === 'too_large')) throw e; // too big for the relay: keep using batches
    }
  }
  return { ...result, state };
}

const omitCut = ({ cut: _cut, ...rest }: SyncState): SyncState => rest;
