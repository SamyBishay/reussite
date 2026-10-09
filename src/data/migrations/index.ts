// Ordered migrations (brief §11). Each one takes the data written at version n-1 and
// returns it at version n. They run on load, before any write, after a local backup.
// A migration never drops a field it doesn't recognise.
import { COLLECTIONS, SCHEMA_VERSION } from '../schema';
import { type ReussiteDb, dumpAll, getLocal, setLocal } from '../db';

export type Data = Record<string, Record<string, unknown>[]>;
export type Migration = (data: Data) => Data;

/** migrations[i] upgrades from version i+1 to version i+2. Version 1 is the first v2 schema. */
export const MIGRATIONS: Migration[] = [];

export function migrateData(data: Data, from: number, to = SCHEMA_VERSION, list = MIGRATIONS): Data {
  let out = data;
  for (let v = from; v < to; v++) {
    const m = list[v - 1];
    if (!m) throw new Error('Missing migration from schema ' + v + ' to ' + (v + 1));
    out = m(out);
  }
  return out;
}

export type MigrateResult = { status: 'current' } | { status: 'migrated'; from: number } | { status: 'newer'; found: number };

/**
 * Bring the local database up to SCHEMA_VERSION. If the data was written by a newer
 * version, return 'newer': the app must stay read-only and ask to reload.
 */
export async function runMigrations(db: ReussiteDb, list = MIGRATIONS, target = SCHEMA_VERSION): Promise<MigrateResult> {
  const found = (await getLocal<number>(db, 'schema')) ?? target;
  if (found > target) return { status: 'newer', found };
  if (found === target) {
    await setLocal(db, 'schema', target);
    return { status: 'current' };
  }
  const before = await dumpAll(db, COLLECTIONS);
  await db.backups.add({ at: new Date().toISOString(), reason: 'before migration ' + found + '→' + target, schema: found, data: before });
  const after = migrateData(before as Data, found, target, list);
  await db.transaction('rw', COLLECTIONS.map(c => db.table_(c)), async () => {
    for (const c of COLLECTIONS) {
      await db.table_(c).clear();
      await db.table_(c).bulkPut((after[c] ?? []) as never[]);
    }
  });
  await setLocal(db, 'schema', target);
  return { status: 'migrated', from: found };
}
