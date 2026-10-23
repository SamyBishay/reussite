// IndexedDB through Dexie. One table per collection, plus two that never sync:
// `local` (this device's clock node id and other device-only values) and `backups`
// (copies taken before a migration or an import).
import Dexie, { type Table } from 'dexie';
import type { Stored } from './doc';
import type { Collection } from './schema';

export interface Backup {
  id?: number;
  at: string;
  reason: string;
  schema: number;
  data: Record<string, unknown[]>;
}

export class ReussiteDb extends Dexie {
  tasks!: Table<Stored<Record<string, unknown>>, string>;
  sessions!: Table<Stored<Record<string, unknown>>, string>;
  projects!: Table<Stored<Record<string, unknown>>, string>;
  days!: Table<Stored<Record<string, unknown>>, string>;
  decisions!: Table<Stored<Record<string, unknown>>, string>;
  places!: Table<Stored<Record<string, unknown>>, string>;
  stays!: Table<Stored<Record<string, unknown>>, string>;
  memory!: Table<Stored<Record<string, unknown>>, string>;
  exchanges!: Table<Stored<Record<string, unknown>>, string>;
  addresses!: Table<Stored<Record<string, unknown>>, string>;
  people!: Table<Stored<Record<string, unknown>>, string>;
  meta!: Table<Stored<Record<string, unknown>>, string>;
  local!: Table<{ key: string; value: unknown }, string>;
  backups!: Table<Backup, number>;

  constructor(name = 'reussite') {
    super(name);
    this.version(1).stores({
      tasks: 'id, status, project, doneDay, due',
      sessions: 'id, taskId, d',
      projects: 'id',
      days: 'id',
      decisions: 'id',
      places: 'id',
      stays: 'id, from',
      meta: 'id',
      local: 'key',
      backups: '++id, at',
    });
    // Phase 2b: memory notes and exchanges. Added tables only; Dexie opens a version-1 database and creates them.
    this.version(2).stores({
      memory: 'id, kind',
      exchanges: 'id, at',
    });
    // Phase 4: addresses and people. Added tables only, as in version 2.
    this.version(3).stores({
      addresses: 'id, placeId, state',
      people: 'id, placeId',
    });
  }

  table_(c: Collection): Table<Stored<Record<string, unknown>>, string> {
    return this[c];
  }
}

/** Everything in the synced collections, deletions included, as plain arrays. */
export async function dumpAll(db: ReussiteDb, collections: readonly Collection[]): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const c of collections) out[c] = await db.table_(c).toArray();
  return out;
}

export async function getLocal<T>(db: ReussiteDb, key: string): Promise<T | undefined> {
  return (await db.local.get(key))?.value as T | undefined;
}
export async function setLocal(db: ReussiteDb, key: string, value: unknown): Promise<void> {
  await db.local.put({ key, value });
}
