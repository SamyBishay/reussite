// The sync store over Dexie: what `syncOnce` reads and writes (src/sync/run.ts). Incoming
// documents arrive already stamped with their clocks, so they are merged into what's stored and
// put as they are, without ticking the local clock. In the app the write goes through
// `putMerged` in store.ts (read-only mode); tests give their own.
import type { ReussiteDb } from './db';
import { getLocal, setLocal } from './db';
import { merge } from './doc';
import type { Clock } from './hlc';
import { COLLECTIONS, type Collection } from './schema';
import { upgradeEntries } from './migrations';
import { INITIAL_STATE, type SyncState, type SyncStore } from '../sync/run';
import type { DocSet } from '../sync/engine';
import type { StoredDoc } from '../sync/protocol';

export const STATE_KEY = 'sync.state';
export type Write = { c: Collection; d: StoredDoc };

/**
 * Put merged documents. Each is merged again with what is stored right now, inside the
 * transaction, so an edit made while a sync round was folding is never overwritten.
 */
export async function writeMerged(db: ReussiteDb, writes: Write[]): Promise<void> {
  const colls = [...new Set(writes.map(w => w.c))];
  if (!colls.length) return;
  await db.transaction('rw', colls.map(c => db.table_(c)), async () => {
    for (const c of colls) {
      const docs = writes.filter(w => w.c === c).map(w => w.d);
      const cur = await db.table_(c).bulkGet(docs.map(d => d.id));
      await db.table_(c).bulkPut(docs.map((d, i) => (cur[i] ? merge(cur[i]!, d) : d)) as never[]);
    }
  });
}

export function dexieSyncStore(db: ReussiteDb, clock: () => Clock, put: (w: Write[]) => Promise<void> = w => writeMerged(db, w)): SyncStore {
  return {
    get clock() { return clock(); },
    loadState: async (): Promise<SyncState> => ({ ...INITIAL_STATE, ...((await getLocal<SyncState>(db, STATE_KEY)) ?? {}) }),
    saveState: s => setLocal(db, STATE_KEY, s),
    all: async (): Promise<DocSet> => {
      const out: DocSet = {};
      for (const c of COLLECTIONS) out[c] = (await db.table_(c).toArray()) as StoredDoc[];
      return out;
    },
    getMany: async (c, ids) => (await db.table_(c).bulkGet(ids)).filter((d): d is StoredDoc => !!d),
    putMany: put,
    upgrade: upgradeEntries,
  };
}
