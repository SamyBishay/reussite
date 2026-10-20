// Import a v1 export (brief §4). Accepts {collection: [docs]} or {collection: {id: doc}},
// with or without each doc wrapped as {data, version}. Pure: returns the v2 documents and a
// summary to show before anything is written.
import { create, merge, type Stored } from './doc';
import { ZERO } from './hlc';
import { SCHEMA_VERSION, type Collection } from './schema';
import { migrateData, type Data } from './migrations';
import type { ReussiteDb } from './db';
import { COLLECTIONS } from './schema';
import { dumpAll } from './db';

type Doc = Record<string, unknown>;
export type V2Data = Partial<Record<Collection, Stored<Doc>[]>>;

export interface ImportSummary {
  /** Documents found in the file, per v1 collection. */
  found: Record<string, number>;
  /** Documents produced, per v2 collection. */
  produced: Record<string, number>;
  skipped: { collection: string; id: string; reason: string }[];
  /** Tasks whose v1 `spent` didn't match their sessions; the v1 figure is kept as `spentV1`. */
  spentMismatch: number;
  places: string[];
}

const V1_COLLECTIONS = ['tasks', 'projects', 'days', 'decisions', 'meta'] as const;

/** Time zones for place ids v1 may have used. Anything else gets this device's zone. */
const KNOWN_ZONES: Record<string, string> = {
  france: 'Europe/Paris', paris: 'Europe/Paris', cairo: 'Africa/Cairo', egypt: 'Africa/Cairo',
  london: 'Europe/London', uk: 'Europe/London', berlin: 'Europe/Berlin', germany: 'Europe/Berlin',
  madrid: 'Europe/Madrid', spain: 'Europe/Madrid', rome: 'Europe/Rome', italy: 'Europe/Rome',
  brussels: 'Europe/Brussels', belgium: 'Europe/Brussels', geneva: 'Europe/Zurich', switzerland: 'Europe/Zurich',
  montreal: 'America/Toronto', quebec: 'America/Toronto', newyork: 'America/New_York',
};

const isObj = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);
const BY: Record<string, 'me' | 'ai'> = { samy: 'me', me: 'me', claude: 'ai', ai: 'ai' };

/** Unwrap {data, version} and list a collection's docs with their ids. */
function entries(raw: unknown, coll: string, skipped: ImportSummary['skipped']): [string, Doc][] {
  const out: [string, Doc][] = [];
  const add = (id: unknown, v: unknown, pos: string) => {
    let doc = v;
    if (isObj(doc) && isObj(doc.data) && 'version' in doc) doc = doc.data;
    if (!isObj(doc)) return skipped.push({ collection: coll, id: String(id ?? pos), reason: 'not an object' });
    const realId = typeof id === 'string' && id ? id : typeof doc.id === 'string' && doc.id ? doc.id : null;
    if (!realId) return skipped.push({ collection: coll, id: pos, reason: 'no id' });
    out.push([realId, doc]);
  };
  if (Array.isArray(raw)) raw.forEach((v, i) => add(isObj(v) ? (isObj(v.data) && 'version' in v ? v.id ?? v.data.id : v.id) : undefined, v, '#' + i));
  else if (isObj(raw)) for (const [id, v] of Object.entries(raw)) add(id, v, id);
  return out;
}

const titleCase = (s: string) => s.replace(/(^|[\s-])\p{L}/gu, m => m.toUpperCase());

export function importV1(file: unknown, deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone): { data: V2Data; summary: ImportSummary } {
  if (!isObj(file)) throw new Error('This file isn’t a Réussite export.');
  const skipped: ImportSummary['skipped'] = [];
  const found: Record<string, number> = {};
  const src: Record<string, [string, Doc][]> = {};
  for (const c of V1_COLLECTIONS) {
    src[c] = entries(file[c], c, skipped);
    found[c] = src[c].length + skipped.filter(s => s.collection === c).length;
  }
  for (const [k, v] of Object.entries(file)) {
    const known = (V1_COLLECTIONS as readonly string[]).includes(k);
    if (!known && (isObj(v) || Array.isArray(v))) skipped.push({ collection: k, id: '*', reason: 'unknown collection' });
  }
  if (!src.tasks!.length && !src.projects!.length) throw new Error('This file has no tasks or projects. Is it a Réussite export?');

  // Built in the first v2 schema, then brought up to date by the same migrations as stored data.
  const mk = (id: string, fields: Doc) => create(id, fields, 1, ZERO);
  const out: Required<V2Data> = { tasks: [], sessions: [], projects: [], days: [], decisions: [], places: [], stays: [], memory: [], exchanges: [], addresses: [], people: [], meta: [] };
  const where = new Set<string>();
  let spentMismatch = 0;

  for (const [id, t0] of src.tasks!) {
    const { id: _drop, sessions, spent, ...t } = t0;
    const task: Doc = { ...t };
    if (typeof task.estBy === 'string') task.estBy = BY[task.estBy] ?? task.estBy;
    task.est0 = typeof task.est === 'number' ? task.est : null;
    if (typeof task.where === 'string' && task.where !== 'any') where.add(task.where);
    let sum = 0;
    if (Array.isArray(sessions)) sessions.forEach((s, i) => {
      if (!isObj(s)) return skipped.push({ collection: 'tasks.sessions', id: id + '#' + i, reason: 'not an object' });
      const { manual, ...rest } = s;
      sum += Number(s.m) || 0;
      out.sessions.push(mk(id + '~s' + i, { ...rest, taskId: id, source: manual ? 'typed' : 'timer' }));
    });
    if (typeof spent === 'number' && Math.round(spent) !== Math.round(sum)) {
      task.spentV1 = spent;
      spentMismatch++;
    }
    out.tasks.push(mk(id, task));
  }
  for (const [id, p0] of src.projects!) {
    const { id: _drop, ...p } = p0;
    if (typeof p.goalBy === 'string') p.goalBy = BY[p.goalBy] ?? p.goalBy;
    if (typeof p.where === 'string' && p.where !== 'any') where.add(p.where);
    out.projects.push(mk(id, p));
  }
  for (const [id, d0] of src.days!) {
    const { id: _drop, ...d } = d0;
    out.days.push(mk(id, d));
  }
  for (const [id, d0] of src.decisions!) {
    const { id: _drop, ...d } = d0;
    out.decisions.push(mk(id, d));
  }
  const v1settings = src.meta!.find(([id]) => id === 'settings')?.[1] ?? {};
  for (const [id] of src.meta!) if (id !== 'settings') skipped.push({ collection: 'meta', id, reason: 'not used by v2' });
  if (typeof v1settings.here === 'string' && v1settings.here !== 'any') where.add(v1settings.here);

  const places = [...where].sort();
  places.forEach((p, i) => out.places.push(mk(p, { name: titleCase(p), timeZone: KNOWN_ZONES[p.toLowerCase().replace(/\s+/g, '')] ?? deviceZone, order: i })));
  const { id: _drop, ...settings } = v1settings;
  out.meta.push(mk('settings', settings));

  const data = migrateData(out as unknown as Data, 1) as unknown as Required<V2Data>;
  const produced: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) produced[k] = v.length;
  return { data, summary: { found, produced, skipped, spentMismatch, places } };
}

/**
 * Write imported data. Backs up what's there first, then merges document by document:
 * imported fields carry the oldest possible clock, so anything edited in v2 wins.
 */
export async function writeImport(db: ReussiteDb, data: V2Data): Promise<void> {
  await db.backups.add({ at: new Date().toISOString(), reason: 'before v1 import', schema: SCHEMA_VERSION, data: await dumpAll(db, COLLECTIONS) });
  await db.transaction('rw', COLLECTIONS.map(c => db.table_(c)), async () => {
    for (const c of COLLECTIONS) {
      const docs = data[c] ?? [];
      if (!docs.length) continue;
      const table = db.table_(c);
      const existing = await table.bulkGet(docs.map(d => d.id));
      await table.bulkPut(docs.map((d, i) => (existing[i] ? merge(existing[i]!, d) : d)));
    }
  });
}
