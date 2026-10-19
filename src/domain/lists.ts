// Read-side rules on plain data, shared by the app (src/app/model.ts wraps them over its signals)
// and by the connector in the relay Worker, which has no signals. Pure: nothing here reads a store.
import type { Day, Decision, Place, Project, Session, Stay, Task } from '../data/schema';
import type { Point } from './estimates';
import { SOURCE_WEIGHT } from './estimates';
import type { DayKey } from './dates';
import { quadrant, type Quadrant } from './tasks';

type WithId<T> = T & { id: string };
export type TaskW = WithId<Task>;

/** Everything the rules below look at. A Map of live documents (no tombstones) per collection. */
export interface Data {
  today: DayKey;
  urgencyDays: number;
  tasks: ReadonlyMap<string, TaskW>;
  sessions: ReadonlyMap<string, WithId<Session>>;
  projects: ReadonlyMap<string, WithId<Project>>;
  days: ReadonlyMap<string, WithId<Day>>;
  decisions: ReadonlyMap<string, WithId<Decision>>;
  places: ReadonlyMap<string, WithId<Place>>;
  stays: ReadonlyMap<string, WithId<Stay>>;
}

export const listOf = (a: unknown): string[] => (a == null || a === '' ? [] : Array.isArray(a) ? a.map(String) : [String(a)]);

export const whereOf = (t: Pick<Task, 'where' | 'project'>, projects: ReadonlyMap<string, Pick<Project, 'where'>>): string => t.where || projects.get(t.project)?.where || 'any';
/** On a place's page: its own steps plus everything marked Anywhere. */
export const inPlace = (t: Pick<Task, 'where' | 'project'>, place: string, projects: ReadonlyMap<string, Pick<Project, 'where'>>) => {
  const w = whereOf(t, projects);
  return w === 'any' || w === place;
};
/** An open work step: not a standing obligation, not a fixed commitment. */
export const isOpen = <T extends Pick<Task, 'status' | 'template' | 'fixed'>>(t: T | undefined): t is T => !!t && t.status === 'open' && !t.template && !t.fixed;
export const quadOf = (t: Pick<Task, 'urgent' | 'important' | 'due'>, today: DayKey, urgencyDays: number): Quadrant => quadrant(t, today, urgencyDays);

export const waitingOn = (t: Pick<Task, 'after'>, tasks: ReadonlyMap<string, TaskW>): TaskW[] =>
  listOf(t.after).map(id => tasks.get(id)).filter((x): x is TaskW => !!x && x.status !== 'done' && x.status !== 'dropped');
export const blocked = (t: Pick<Task, 'after'>, tasks: ReadonlyMap<string, TaskW>) => waitingOn(t, tasks).length > 0;

export const byOrder = (a: { order?: number }, b: { order?: number }) => (a.order || 0) - (b.order || 0);
export function byPriority(a: TaskW, b: TaskW, d: Pick<Data, 'today' | 'urgencyDays' | 'projects'>): number {
  const qa = quadOf(a, d.today, d.urgencyDays), qb = quadOf(b, d.today, d.urgencyDays);
  if (qa !== qb) return qa - qb;
  const da = a.due || '9999', db = b.due || '9999';
  if (da !== db) return da < db ? -1 : 1;
  const pa = d.projects.get(a.project)?.order || 0, pb = d.projects.get(b.project)?.order || 0;
  if (pa !== pb) return pa - pb;
  return byOrder(a, b);
}

export const rawPlan = (days: ReadonlyMap<string, Pick<Day, 'plan'>>, k: DayKey): string[] => (Array.isArray(days.get(k)?.plan) ? [...days.get(k)!.plan] : []);
/** A day's list without steps that no longer exist or were dropped. */
export const planOf = (d: Pick<Data, 'days' | 'tasks'>, k: DayKey) => rawPlan(d.days, k).filter(id => d.tasks.has(id) && d.tasks.get(id)!.status !== 'dropped');

/** Fixed-time items on a day: commitments and timed steps due that day, and timed steps on its
 *  list with no due date (copies of timed standing items saved before they were given one). */
export const fixedOn = (d: Pick<Data, 'days' | 'tasks'>, k: DayKey): TaskW[] => {
  const plan = new Set(rawPlan(d.days, k));
  return [...d.tasks.values()].filter(t => t.at && (t.due === k || (!t.due && plan.has(t.id))) && t.status !== 'dropped' && !t.template)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
};

/** Steps on yesterday's list still open and not on `k`'s list. */
export const yesterdayOpen = (d: Pick<Data, 'days' | 'tasks'>, k: DayKey, prev: DayKey) => {
  const plan = rawPlan(d.days, k);
  return rawPlan(d.days, prev).filter(id => isOpen(d.tasks.get(id)) && !plan.includes(id));
};

/** Decisions whose check date has come. */
export const decisionsToCheck = (decisions: Iterable<WithId<Decision>>, k: DayKey) => [...decisions].filter(d => d.status === 'decided' && d.reviewOn && d.reviewOn <= k);

/** Data points for personal estimates: done steps with a frozen estimate and recorded time. */
export function estPointsOf(tasks: Iterable<TaskW>, sessions: Iterable<Pick<Session, 'taskId' | 'm' | 'source'>>): (Point & { id: string; title: string })[] {
  const by = new Map<string, { m: number; wm: number }>();
  for (const s of sessions) {
    const m = Number(s.m) || 0;
    if (m <= 0) continue;
    const cur = by.get(s.taskId) ?? { m: 0, wm: 0 };
    cur.m += m;
    cur.wm += m * (SOURCE_WEIGHT[s.source as keyof typeof SOURCE_WEIGHT] ?? 0.5);
    by.set(s.taskId, cur);
  }
  const out: (Point & { id: string; title: string })[] = [];
  for (const t of tasks) {
    const x = by.get(t.id);
    const est0 = t.est0 ?? null;
    if (t.status !== 'done' || !x || !est0 || !t.doneDay) continue;
    out.push({ id: t.id, title: t.title, est0, real: x.m, w0: x.wm / x.m, doneDay: t.doneDay, app: t.app ?? null, project: t.project, suit: t.suit, by: t.estBy ?? 'me' });
  }
  return out;
}

// ---------- compact lines (what an AI is given) ----------
const one = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
export const oneLine = one;

export const projName = (projects: ReadonlyMap<string, Pick<Project, 'name'>>, id: string) => (id === 'inbox' ? 'Inbox' : projects.get(id)?.name ?? id);

/** `id | title | Q1 | due | est | project`, as v1 sent them. */
export function stepLine(t: Pick<TaskW, 'id' | 'title' | 'project' | 'due' | 'est' | 'status' | 'urgent' | 'important'>, d: Pick<Data, 'today' | 'urgencyDays' | 'projects'>): string {
  const done = t.status === 'done' ? ' (done)' : t.status === 'dropped' ? ' (dropped)' : '';
  return [t.id, one(t.title) + done, 'Q' + quadOf(t, d.today, d.urgencyDays), t.due ?? '-', t.est ? t.est + 'm' : '-', one(projName(d.projects, t.project))].join(' | ');
}
export const STEP_HEADER = 'Steps (id | title | quadrant: Q1 now, Q2 plan, Q3 quick, Q4 later | due | estimate | project):';

/** A decision as compact lines: problem, options with their columns, and the choice. */
export function decisionLines(d: WithId<Decision>): string {
  const L = [`Decision ${d.id}: ${one(d.title)} (${d.status})`];
  for (const [k, v] of Object.entries(d.problem)) if (v) L.push(`problem.${k}: ${one(v)}`);
  for (const o of d.options) {
    L.push(`option "${one(o.name)}"${o.screened ? ' (screened out: ' + one(o.screened) + ')' : ''}`);
    for (const c of ['pros', 'cons', 'prosNot', 'consNot'] as const) if (o[c].length) L.push(`  ${c}: ${o[c].map(i => one(i.text)).join('; ')}`);
  }
  if (d.chosen) L.push(`chosen: ${one(d.chosen)}; why: ${one(d.why)}; falsifier: ${one(d.falsifier)}; check on ${d.reviewOn ?? '-'}`);
  return L.join('\n');
}
