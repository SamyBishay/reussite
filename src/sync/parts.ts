// A snapshot in two parts (docs/dev/sync.md, "Hot and cold"). Reading the whole list costs CPU in
// proportion to its size, and most of a year's list is finished history nobody asks about. So a
// snapshot is written as two blobs:
//
//   hot   open steps, steps done or due in the last ~30 days, their sessions, the days from the last
//         30 days on, every project, decision, place, stay and setting, and anything whose clocks
//         changed in the last 30 days. Plus an index of the cold ids and a digest of the cold
//         documents (`ColdDigest`), so the common questions never open the cold part.
//   cold  everything else.
//
// A document may be in both (merging is idempotent and commutative, so a reader just merges them).
// The cut they were made at (`Cut`: a day, a time, the cold part's `upto`) is kept in the hot part,
// and a later hot-only snapshot is made with the same cut: it holds exactly what is hot by that cut
// plus everything touched since, so the stored cold part stays valid. Nothing here touches the stored
// document shape.
import { addDays } from '../domain/dates';
import { estPointsOf, type TaskW } from '../domain/lists';
import { format } from '../data/hlc';
import { SCHEMA_VERSION } from '../data/schema';
import type { DocSet } from './engine';
import type { ColdDigest, Cut, Snapshot, StoredDoc } from './protocol';

export const HOT_DAYS = 30;
const DAY = 86_400_000;
/** The cold part is rewritten (a new cut) when the cut is older than this. */
export const FULL_EVERY_MS = 7 * DAY;
/** The digest carries estimate points for steps done within this many days of the cut; older ones weigh under 1% already. */
export const DIGEST_DAYS = 400;

export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** Everything dated on or after this day is in the hot part. */
export const hotFrom = (cut: Pick<Cut, 'day'>): string => addDays(cut.day, -HOT_DAYS);

type Docs = Record<string, StoredDoc[]>;
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const ids = (a: unknown): string[] => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);

/** Was any clock of the document written at or after this one? (A clock string compares by time first.) */
function touchedSince(d: StoredDoc, min: string): boolean {
  if (d._del !== undefined && d._del >= min) return true;
  for (const k in d._hlc) if (d._hlc[k]! >= min) return true;
  return false;
}

/** The cold ids of one collection as the index stores them: "\nid\nid\n". */
export const coldIndexOf = (list: StoredDoc[]): string => (list.length ? '\n' + list.map(d => d.id).join('\n') + '\n' : '');
/** Is this id held by the cold part (according to a hot part's index)? */
export const inCold = (index: Record<string, string> | undefined, c: string, id: string): boolean => !!index?.[c]?.includes('\n' + id + '\n');

export interface Split { hot: Docs; cold: Docs }

/** Which documents are hot, by this cut. */
export function split(all: DocSet, cut: Cut, o: { closure?: boolean } = {}): Split {
  const from = hotFrom(cut);
  const min = format(cut.wall - HOT_DAYS * DAY, 0, '');
  const hot: Docs = {}, cold: Docs = {};
  const list = (c: string): StoredDoc[] => [...((all as Record<string, Iterable<StoredDoc> | undefined>)[c] ?? [])];
  const put = (c: string, d: StoredDoc, isHot: boolean) => ((isHot ? hot : cold)[c] ??= []).push(d);

  // Days first: the steps on a hot day's list, and the steps a decision lists, must be hot too,
  // or a reader would find a list that points at nothing.
  const days = list('days'), decisions = list('decisions'), tasks = list('tasks');
  const hotDay = (d: StoredDoc) => touchedSince(d, min) || str(d.date || d.id) >= from;
  const wanted = new Set<string>();
  if (o.closure !== false) for (const d of days) if (!d._del && hotDay(d)) {
    for (const id of ids(d.plan)) wanted.add(id);
    for (const id of ids(d.optional)) wanted.add(id);
    const first = d.first as { id?: unknown } | null | undefined;
    if (typeof first?.id === 'string') wanted.add(first.id);
  }
  if (o.closure !== false) for (const d of decisions) if (!d._del) {
    for (const id of ids(d.taskIds)) wanted.add(id);
    if (typeof d.taskId === 'string') wanted.add(d.taskId);
  }
  const hotTasks = new Set<string>();
  for (const d of tasks) {
    const open = d.status !== 'done' && d.status !== 'dropped';
    const isHot = touchedSince(d, min) || (!d._del && (open || str(d.doneDay) >= from || (!!d.at && str(d.due) >= from) || wanted.has(d.id)));
    put('tasks', d, isHot);
    if (isHot) hotTasks.add(d.id);
  }
  for (const d of days) put('days', d, hotDay(d));
  for (const d of list('sessions')) put('sessions', d, touchedSince(d, min) || str(d.d) >= from || hotTasks.has(str(d.taskId)));
  for (const c of ['projects', 'decisions', 'places', 'stays', 'meta']) for (const d of c === 'decisions' ? decisions : list(c)) put(c, d, touchedSince(d, min) || !d._del);
  return { hot, cold };
}

/** The clock past which nothing in these documents lies. */
export function topClock(docs: Docs): string {
  let top = '';
  for (const list of Object.values(docs)) for (const d of list) {
    for (const k in d._hlc) if (d._hlc[k]! > top) top = d._hlc[k]!;
    if (d._del !== undefined && d._del > top) top = d._del;
  }
  return top;
}

/** What the cold documents add to answers about the hot ones. */
export function digestOf(cold: Docs, all: DocSet, cut: Cut): ColdDigest {
  const since = addDays(cut.day, -DIGEST_DAYS);
  const live = (cold.tasks ?? []).filter(d => !d._del);
  const done: Record<string, number> = {};
  for (const t of live) if (!t.template && t.status !== 'open' && t.status !== 'dropped') { const p = str(t.project); done[p] = (done[p] ?? 0) + 1; }
  const sessions = ([...((all as Record<string, Iterable<StoredDoc> | undefined>).sessions ?? [])] as StoredDoc[]).filter(s => !s._del);
  const est = estPointsOf(live.filter(t => t.status === 'done' && str(t.doneDay) >= since) as unknown as TaskW[], sessions as never)
    .map(p => [p.id, p.est0, p.real, p.w0, p.doneDay, p.app ?? null, p.project ?? null, p.suit, p.by ?? null]);
  return { est, done };
}

/** The fields whose value decides whether a document is hot by itself (not by being touched lately). */
const STATE_FIELDS: Record<string, string[]> = { tasks: ['status', 'doneDay', 'due', 'at'], sessions: ['d', 'taskId'], days: ['date'] };

/**
 * Might these just-pushed documents also be held by the cold part? If so a reader that has only the
 * hot part would see them as stubs, so the app snapshots again at once (docs/dev/sync.md). A document
 * is flagged when the push changed a field that decides hotness, or when it is cold by itself (an
 * edit to an old finished step, say). A document made in this push can't be in the cold part, and a
 * day or decision that now lists a step which is cold by itself counts too.
 */
export function touchesCold(pushed: { c: string; d: StoredDoc }[], all: DocSet, cut: Cut): boolean {
  const byState = split(all, { ...cut, wall: 9e12 }, { closure: false }); // hot by state alone: not by being touched lately, not by being listed
  const docs = new Map<string, Map<string, StoredDoc>>();
  const lookup = (c: string) => {
    let m = docs.get(c);
    if (!m) docs.set(c, (m = new Map(([...((all as Record<string, Iterable<StoredDoc> | undefined>)[c] ?? [])] as StoredDoc[]).map(d => [d.id, d]))));
    return m;
  };
  const hots = new Map<string, Set<string>>();
  const isHot = (c: string, id: string) => {
    let h = hots.get(c);
    if (!h) hots.set(c, (h = new Set((byState.hot[c] ?? []).map(d => d.id))));
    return h.has(id);
  };
  for (const { c, d } of pushed) {
    const full = lookup(c).get(d.id);
    if (!full) continue;
    const made = Object.keys(full._hlc).every(k => k in d._hlc) && new Set(Object.values(d._hlc)).size === 1;
    if (!made && (!isHot(c, d.id) || d._del !== undefined || STATE_FIELDS[c]?.some(k => k in d._hlc))) return true;
    const first = (d.first as { id?: unknown } | null | undefined)?.id;
    const refs = c === 'days' ? [...ids(d.plan), ...ids(d.optional), ...(typeof first === 'string' ? [first] : [])] : c === 'decisions' ? ids(d.taskIds) : [];
    if (refs.some(id => lookup('tasks').has(id) && !isHot('tasks', id))) return true;
  }
  return false;
}

export interface Parts {
  hot: Snapshot;
  /** Present when the cold part is being rewritten (a new cut). */
  cold?: Snapshot;
  cut: Cut;
}

/**
 * The snapshot to upload, as parts. `prev` is the cut of the cold part on the relay as this device
 * knows it. With one that is recent, only the hot part is written, cut the same way; otherwise
 * (none known, or a week old) both are, with a new cut at `now`. `upto` must be a seq this device
 * has fully applied.
 */
export function buildParts(all: DocSet, upto: number, o: { now: number; prev?: Cut | null; full?: boolean }): Parts {
  const rewrite = o.full || !o.prev || o.now - o.prev.wall > FULL_EVERY_MS || o.now < o.prev.wall;
  const cut: Cut = rewrite ? { day: dayOf(o.now), wall: o.now, coldUpto: upto } : o.prev!;
  const { hot, cold } = split(all, cut);
  const index: Record<string, string> = {};
  for (const [c, list] of Object.entries(cold)) { const s = coldIndexOf(list); if (s) index[c] = s; }
  return {
    cut,
    hot: { v: SCHEMA_VERSION, upto, part: 'hot', cut, cold: index, x: digestOf(cold, all, cut), docs: hot, top: topClock(hot) },
    ...(rewrite ? { cold: { v: SCHEMA_VERSION, upto, part: 'cold' as const, docs: cold, top: topClock(cold) } } : {}),
  };
}
