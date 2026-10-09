// Read-side helpers, ported from v1. They read the signals, so views that call them re-render.
import { computed } from '@preact/signals';
import { tasks, sessions, projects, days, settings, today, type WithId } from './store';
import type { Task, Day } from '../data/schema';
import { quadrant, isUrgent, type Quadrant } from '../domain/tasks';
import { minutesByTask, ratio as ratioOf } from '../domain/ratio';
import { addDays } from '../domain/dates';

export type T = WithId<Task>;

export const T = (id: string): T | undefined => tasks.value.get(id);
export const whereOf = (t: T): string => t.where || projects.value.get(t.project)?.where || 'any';
export const inPlace = (t: T, place = settings.value.here) => { const w = whereOf(t); return w === 'any' || w === place; };
export const isOpen = (t: T | undefined): t is T => !!t && t.status === 'open' && !t.template;
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

export function candidates(k = today.value): T[] {
  const plan = new Set(rawPlan(k));
  return [...tasks.value.values()].filter(t => isOpen(t) && inPlace(t) && !blocked(t) && !plan.has(t.id)).sort(byPriority);
}

export const yesterdayOpen = (k = today.value) => {
  const plan = rawPlan(k);
  return rawPlan(addDays(k, -1)).filter(id => isOpen(T(id)) && !plan.includes(id));
};
