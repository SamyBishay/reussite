// Ordered migrations (brief §11). Each one takes the data written at version n-1 and
// returns it at version n. They run on load, before any write, after a local backup.
// A migration never drops a field it doesn't recognise.
import { COLLECTIONS, SCHEMA_VERSION } from '../schema';
import { type ReussiteDb, dumpAll, getLocal, setLocal } from '../db';
import { ZERO } from '../hlc';
import { normDecision } from '../normalize';

export type Data = Record<string, Record<string, unknown>[]>;
export type Migration = (data: Data) => Data;

type Doc = Record<string, unknown> & { _hlc?: Record<string, string> };
const META = new Set(['id', '_v', '_hlc', '_del']);

/**
 * Replace a stored document's fields with `next`, keeping its bookkeeping. A changed field
 * keeps its clock; a new field gets the oldest clock, so it never wins over a real edit.
 */
function rewrite(doc: Doc, next: Record<string, unknown>, v: number): Doc {
  const out: Doc = { ...doc, _v: v, _hlc: { ...(doc._hlc ?? {}) } };
  for (const [k, val] of Object.entries(next)) {
    if (META.has(k)) continue;
    if (JSON.stringify(doc[k]) === JSON.stringify(val)) continue;
    if (!(k in doc)) out._hlc![k] = ZERO;
    out[k] = val;
  }
  return out;
}

/** 1 → 2 (phase 1): decisions get the structured shape: problem fields, option ids, items as objects, a status. */
const v2: Migration = data => ({
  ...data,
  decisions: (data.decisions ?? []).map(d => {
    const { id: _id, _v, _hlc, _del, ...fields } = d as Doc;
    return rewrite(d as Doc, normDecision(fields) as unknown as Record<string, unknown>, 2);
  }),
});

/** migrations[i] upgrades from version i+1 to version i+2. Version 1 is the first v2 schema. */
export const MIGRATIONS: Migration[] = [v2];

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
