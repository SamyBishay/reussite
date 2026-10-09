// Read-side helpers, ported from v1. They read the signals, so views that call them re-render.
import { computed } from '@preact/signals';
import { tasks, sessions, projects, days, settings, today, pagePlace, here, decisions, type WithId } from './store';
import type { Task, Day, Session } from '../data/schema';
import { fit, predict, SOURCE_WEIGHT, type Point, type Prediction } from '../domain/estimates';
import { quadrant, isUrgent, type Quadrant } from '../domain/tasks';
import { minutesByTask, ratio as ratioOf } from '../domain/ratio';
import { addDays } from '../domain/dates';

export type T = WithId<Task>;

export const T = (id: string): T | undefined => tasks.value.get(id);
export const whereOf = (t: T): string => t.where || projects.value.get(t.project)?.where || 'any';
/** On the page being viewed (or `place`): its own steps plus everything marked Anywhere. */
export const inPlace = (t: T, place = pagePlace.value) => { const w = whereOf(t); return w === 'any' || w === place; };
/** An open work step: not a standing obligation, not a fixed commitment. */
export const isOpen = (t: T | undefined): t is T => !!t && t.status === 'open' && !t.template && !t.fixed;
export const quad = (t: T): Quadrant => quadrant(t, today.value, settings.value.urgencyDays);
export const urgent = (t: T) => isUrgent(t, today.value, settings.value.urgencyDays);

export const listOf = (a: unknown): string[] => (a == null || a === '' ? [] : Array.isArray(a) ? a.map(String) : [String(a)]);
export const waitingOn = (t: T): T[] =>
  listOf(t.after).map(id => tasks.value.get(id)).filter((x): x is T => !!x && x.status !== 'done' && x.status !== 'dropped');
export const blocked = (t: T) => waitingOn(t).length > 0;

export const dayDoc = (k: string): WithId<Day> | undefined => days.value.get(k);
export const rawPlan = (k: string): string[] => (Array.isArray(dayDoc(k)?.plan) ? [...dayDoc(k)!.plan] : []);
export const planOf = (k: string) => rawPlan(k).filter(id => tasks.value.has(id) && T(id)!.status !== 'dropped');

export const spent = computed(() => minutesByTask(sessions.value.values()));
export const spentOf = (id: string) => spent.value.get(id) ?? 0;

export function cardsOn(k: string): T[] {
  const out = [...tasks.value.values()].filter(t => t.status === 'done' && !t.template && t.doneDay === k);
  return out.sort((a, b) => String(a.doneAt ?? '').localeCompare(String(b.doneAt ?? '')));
}
export function minutesOn(k: string): number {
  let m = 0;
  for (const s of sessions.value.values()) if (s.d === k) m += Number(s.m) || 0;
  return m;
}
export function minutesOnFor(k: string, taskId: string): number {
  let m = 0;
  for (const s of sessions.value.values()) if (s.d === k && s.taskId === taskId) m += Number(s.m) || 0;
  return m;
}
export const allCards = () => [...tasks.value.values()].filter(t => t.status === 'done' && !t.template).length;
export const ratio = computed(() => ratioOf(tasks.value.values(), spent.value));
export const running = (): T | undefined => [...tasks.value.values()].find(t => t.started && t.status === 'open');
export const elapsedSec = (t: T, now = Date.now()) => (t.started ? Math.max(0, (now - Date.parse(t.started)) / 1000) : 0);

const byOrder = (a: { order?: number }, b: { order?: number }) => (a.order || 0) - (b.order || 0);
export { byOrder };
export function byPriority(a: T, b: T): number {
  const qa = quad(a), qb = quad(b);
  if (qa !== qb) return qa - qb;
  const da = a.due || '9999', db = b.due || '9999';
  if (da !== db) return da < db ? -1 : 1;
  const pa = projects.value.get(a.project)?.order || 0, pb = projects.value.get(b.project)?.order || 0;
  if (pa !== pb) return pa - pb;
  return byOrder(a, b);
}

export function candidates(k = today.value, place = pagePlace.value): T[] {
  const plan = new Set(rawPlan(k));
  return [...tasks.value.values()].filter(t => isOpen(t) && inPlace(t, place) && !blocked(t) && !plan.has(t.id)).sort(byPriority);
}
export const sessionsOf = (id: string): WithId<Session>[] =>
  [...sessions.value.values()].filter(s => s.taskId === id).sort((a, b) => String(a.d + a.at).localeCompare(String(b.d + b.at)));

// ---------- personal estimates (brief §5) ----------
/** Data points: done steps with a frozen estimate and recorded time. "Didn't time it" has no sessions, so it's left out. */
export const estPoints = computed((): (Point & { id: string; title: string })[] => {
  const by = new Map<string, { m: number; wm: number }>();
  for (const s of sessions.value.values()) {
    const m = Number(s.m) || 0;
    if (m <= 0) continue;
    const cur = by.get(s.taskId) ?? { m: 0, wm: 0 };
    cur.m += m;
    cur.wm += m * (SOURCE_WEIGHT[s.source as keyof typeof SOURCE_WEIGHT] ?? 0.5);
    by.set(s.taskId, cur);
  }
  const out: (Point & { id: string; title: string })[] = [];
  for (const t of tasks.value.values()) {
    const x = by.get(t.id);
    const est0 = t.est0 ?? null;
    if (t.status !== 'done' || !x || !est0 || !t.doneDay) continue;
    out.push({ id: t.id, title: t.title, est0, real: x.m, w0: x.wm / x.m, doneDay: t.doneDay, app: t.app ?? null, project: t.project, suit: t.suit, by: t.estBy ?? 'me' });
  }
  return out;
});
export const estModel = computed(() => fit(estPoints.value, today.value));
export const personal = (t: Pick<T, 'est' | 'app' | 'project' | 'suit' | 'estBy'>): Prediction | null =>
  predict(estModel.value, { est: t.est, app: t.app, project: t.project, suit: t.suit, estBy: t.estBy });
/** The estimate the planner uses: personal when there is one, else the person's own. */
export const planEst = (t: T) => personal(t)?.value ?? t.est ?? null;

/** The day a standing obligation was last played (its copies carry `from`). */
export function lastDoneOf(templateId: string): string | null {
  let last: string | null = null;
  for (const t of tasks.value.values()) if (t.from === templateId && t.status === 'done' && t.doneDay && (!last || t.doneDay > last)) last = t.doneDay;
  return last;
}
/** Fixed-time items on a day: commitments and timed steps due that day. */
export const fixedOn = (k: string): T[] =>
  [...tasks.value.values()].filter(t => t.at && t.due === k && t.status !== 'dropped' && !t.template).sort((a, b) => String(a.at).localeCompare(String(b.at)));
/** Decisions whose check date has come. */
export const decisionsToCheck = (k = today.value) => [...decisions.value.values()].filter(d => d.status === 'decided' && d.reviewOn && d.reviewOn <= k);
export const hereNow = () => here.value;

export const yesterdayOpen = (k = today.value) => {
  const plan = rawPlan(k);
  return rawPlan(addDays(k, -1)).filter(id => isOpen(T(id)) && !plan.includes(id));
};
