// One sync round: pull everything new, fold it in, push what changed here, and now and then
// upload a snapshot. Storage and the clock are injected (`SyncStore`), so this runs against a
// fake in tests and against Dexie in the app. Safe to run again after any failure.
import type { Clock } from '../data/hlc';
import { SCHEMA_VERSION, type Collection } from '../data/schema';
import { RelayError, type Pulled, type RelayClient } from './client';
import { applyIncoming, buildSnapshot, collectOutgoing, snapshotDocs, type DocSet, type LocalDocs } from './engine';
import type { ChangeDoc, StoredDoc } from './protocol';

/** What a device remembers between rounds. Keep it in the `local` table, never in synced data. */
export interface SyncState {
  /** The last relay seq fully applied here. */
  seq: number;
  /** Own clocks above this are not yet pushed ('' = never pushed). */
  watermark: string;
  /** The `upto` of the latest snapshot this device knows of. */
  snapshotSeq: number;
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
  /** Put merged documents. In the app this goes through store.ts (read-only mode, live signals). */
  putMany(writes: { c: Collection; d: StoredDoc }[]): Promise<void>;
}

export interface SyncResult {
  /** A document from a newer schema was seen: the app goes read-only and asks to reload. */
  newer: boolean;
  pulled: number;
  pushed: number;
  snapshot: boolean;
  /** The relay has no space for this key yet: normal for the first device, a sign of a wrong key on a joining one. */
  emptySpace: boolean;
  state: SyncState;
}

export interface SyncOptions {
  /** Upload a snapshot once this many batches have piled up since the last (default 50). */
  snapshotEvery?: number;
  /** Documents per pushed batch (default 300; halved if the relay says too large). */
  batchDocs?: number;
}

const EMPTY_PAGE: Pulled = { head: 0, more: false, snapshot: null, batches: [] };

async function fold(store: SyncStore, entries: ChangeDoc[]): Promise<{ newer: boolean }> {
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
  const result: SyncResult = { newer: false, pulled: 0, pushed: 0, snapshot: false, emptySpace: false, state };

  // Pull until caught up.
  for (;;) {
    const page = await client.pull(state.seq).catch(e => {
      if (e instanceof RelayError && e.code === 'unknown_space') { result.emptySpace = true; return EMPTY_PAGE; }
      throw e;
    });
    const entries: ChangeDoc[] = [];
    if (page.snapshot) {
      if (page.snapshot.v > SCHEMA_VERSION) return { ...result, newer: true };
      entries.push(...snapshotDocs(page.snapshot));
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
    await store.saveState(state);
    if (!page.more || (!page.snapshot && !page.batches.length)) break; // nothing new: never spin on a gap at the head
  }

  // Push what changed here.
  const out = collectOutgoing(await store.all(), node, state.watermark, { imported: state.watermark === '' });
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
    state = { ...state, watermark: out.watermark };
    await store.saveState(state);
  }

  // Now and then, a snapshot so new devices start fast and the relay can drop old batches.
  if (state.seq - state.snapshotSeq >= (opts.snapshotEvery ?? 50)) {
    try {
      await client.putSnapshot(buildSnapshot(await store.all(), state.seq));
      state = { ...state, snapshotSeq: state.seq };
      await store.saveState(state);
      result.snapshot = true;
    } catch (e) {
      if (!(e instanceof RelayError && e.code === 'too_large')) throw e; // too big for the relay: keep using batches
    }
  }
  return { ...result, state };
}
