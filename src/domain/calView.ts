// What the Calendar tab shows on each day (brief §16), as plain events for a calendar library to draw. Fixed-time
// items sit on the hour grid at their time and length; everything else that belongs to a day with no time (the
// day's planned cards, the steps due, cards played, decision checks, project due dates, the review, a stay) is an
// all-day event and never gets a slot on the grid. Pure: data in, events out; the app maps them onto its library.
import type { Address, Day, Decision, Place, Project, Stay, SuitId, Task } from '../data/schema';
import { addDays, type DayKey } from './dates';
import { DEFAULT_FIXED_MINUTES } from './ics';
import { shortLabel } from './label';
import { chainIndex, isWaiting } from './chains';
import { fixedOn, isOpen, rawPlan } from './lists';
import { locationOf } from './calItems';
import { isoDow, occurrences } from './repeat';

type WithId<T> = T & { id: string };

export interface CalViewData {
  tasks: ReadonlyMap<string, WithId<Task>>;
  days: ReadonlyMap<string, WithId<Day>>;
  decisions: ReadonlyMap<string, WithId<Decision>>;
  projects: ReadonlyMap<string, WithId<Project>>;
  places: ReadonlyMap<string, WithId<Place>>;
  stays: ReadonlyMap<string, WithId<Stay>>;
  addresses: ReadonlyMap<string, WithId<Address>>;
}

export interface CalViewOptions {
  today: DayKey;
  dayStart: string;
  reviewDay: number;
  /** Whether a step is on the page being viewed (its place, or Anywhere); due steps and repeat markers follow it. */
  onPage: (t: WithId<Task>) => boolean;
}

export type CalViewKind = 'fixed' | 'plan' | 'due' | 'done' | 'check' | 'project' | 'review' | 'repeat' | 'stay';

export interface CalViewEvent {
  /** Unique in a view: `<kind>:<id>:<day>`. */
  id: string;
  kind: CalViewKind;
  /** The app's day. */
  day: DayKey;
  /** The calendar date it is drawn on: a time before the day starts is on the next date. */
  date: DayKey;
  /** A stay: its last date (inclusive). */
  endDate?: DayKey;
  /** Fixed-time items: HH:MM on `date`, and the end on the same date (never past 23:59). */
  time?: string;
  endTime?: string;
  taskId?: string;
  decisionId?: string;
  projectId?: string;
  stayId?: string;
  /** A step's short name; for the others, the name of the decision, project or place. */
  title: string;
  /** The address or the place, short. */
  where?: string;
  suit?: SuitId;
  done?: boolean;
  /** Can be dragged: planned and due steps, cards played, and fixed-time steps not yet done. */
  movable: boolean;
}

const MIN = 60;
const toMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return (h ?? 0) * MIN + (m ?? 0); };
const toClock = (n: number): string => String(Math.floor(n / MIN)).padStart(2, '0') + ':' + String(n % MIN).padStart(2, '0');
const HHMM = /^\d{1,2}:\d{2}$/;

/** Where a fixed time is drawn: on its day, or on the next date when it is before the day starts (01:00 of a day starting at 05:00). */
export function gridSlot(day: DayKey, at: string, dayStart: string): { date: DayKey; time: string } {
  const [h, m] = at.split(':');
  const time = String(h).padStart(2, '0') + ':' + m;
  return { date: time < dayStart ? addDays(day, 1) : day, time };
}

/** The inverse of `gridSlot`: the app's day and the time for a date and a time dropped on the grid. */
export function appSlot(date: DayKey, time: string, dayStart: string): { day: DayKey; at: string } {
  return { day: time < dayStart ? addDays(date, -1) : date, at: time };
}

/** The end of a fixed-time item on its drawn date: its length, at least 5 minutes, and the grid stops at 23:59. */
export function endClock(time: string, minutes: number | null | undefined): string {
  const len = minutes && minutes > 0 ? Math.max(5, Math.round(minutes)) : DEFAULT_FIXED_MINUTES;
  return toClock(Math.min(toMin(time) + len, 24 * MIN - 1));
}

/** The events of days `from`..`to`, in the order a day lists them. */
export function calViewEvents(data: CalViewData, o: CalViewOptions, from: DayKey, to: DayKey): CalViewEvent[] {
  const out: CalViewEvent[] = [];
  const ctx = { addresses: data.addresses, places: data.places, projects: data.projects };
  const where = (t: WithId<Task>) => locationOf(t, ctx, true) || undefined;
  const task = (kind: CalViewKind, t: WithId<Task>, day: DayKey, extra: Partial<CalViewEvent> = {}): CalViewEvent =>
    ({ id: `${kind}:${t.id}:${day}`, kind, day, date: day, taskId: t.id, title: shortLabel(t), suit: t.suit, ...(where(t) ? { where: where(t) } : {}), movable: false, ...extra });

  // Stays: one band from the first to the last date, whatever part of it is in the window.
  for (const s of data.stays.values()) {
    if (s.to < from || s.from > to) continue;
    out.push({ id: `stay:${s.id}:${s.from}`, kind: 'stay', day: s.from, date: s.from, endDate: s.to, stayId: s.id, title: data.places.get(s.placeId)?.name ?? '', movable: false });
  }

  // A step that waits for another is inside its head's card, so it has no event of its own (a commitment never waits).
  const ix = chainIndex(data.tasks);
  const waiting = (t: WithId<Task>) => !t.fixed && isWaiting(ix, t.id);

  const repeats = new Map<DayKey, WithId<Task>[]>();
  for (const x of data.tasks.values()) {
    if (!isOpen(x) || !x.repeat || !x.due || !o.onPage(x)) continue;
    for (const k of occurrences(x.repeat, x.due, to)) if (k >= from) repeats.set(k, [...(repeats.get(k) ?? []), x]);
  }

  const lists = { days: data.days, tasks: data.tasks };
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const timed = fixedOn(lists, k).filter(t => !waiting(t));
    for (const t of timed) {
      if (!HHMM.test(t.at ?? '')) continue;
      const slot = gridSlot(k, t.at!, o.dayStart);
      const done = t.status === 'done';
      out.push(task('fixed', t, k, { date: slot.date, time: slot.time, endTime: endClock(slot.time, t.dur ?? t.est), done, movable: !done }));
    }
    const timedIds = new Set(timed.filter(t => HHMM.test(t.at ?? '')).map(t => t.id));

    const planned = new Set<string>();
    for (const id of rawPlan(data.days, k)) {
      const t = data.tasks.get(id);
      if (!t || t.status === 'dropped' || t.template || t.at || planned.has(id) || waiting(t)) continue;
      planned.add(id);
      if (t.status === 'done') out.push(task('done', t, k, { id: `done:${t.id}:${k}`, done: true, movable: true }));
      else out.push(task('plan', t, k, { movable: true }));
    }
    for (const t of data.tasks.values()) {
      if (!isOpen(t) || t.due !== k || planned.has(t.id) || t.at || !o.onPage(t) || waiting(t)) continue;
      out.push(task('due', t, k, { movable: true }));
    }
    if (k <= o.today) {
      for (const t of data.tasks.values()) {
        if (t.status !== 'done' || t.template || t.doneDay !== k || planned.has(t.id) || timedIds.has(t.id)) continue;
        out.push(task('done', t, k, { done: true, movable: true }));
      }
    }
    for (const d of data.decisions.values()) if (d.status === 'decided' && d.reviewOn === k) out.push({ id: `check:${d.id}:${k}`, kind: 'check', day: k, date: k, decisionId: d.id, title: d.title, movable: false });
    for (const p of data.projects.values()) if (p.due === k && p.status === 'active') out.push({ id: `project:${p.id}:${k}`, kind: 'project', day: k, date: k, projectId: p.id, title: p.name, movable: false });
    if (isoDow(k) === o.reviewDay) out.push({ id: `review:${k}`, kind: 'review', day: k, date: k, title: '', movable: false });
    for (const t of repeats.get(k) ?? []) out.push(task('repeat', t, k));
  }
  return out;
}
