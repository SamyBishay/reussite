// What the Calendar tab shows on each day (brief §16): only what is at a fixed time, as plain events for a calendar
// library to draw. Items with a time (`at`, one-off and standing items on their weekdays) sit on the hour grid at their
// time and length; a stay is a band over its days and a half day spent in an area is a label (both cheap, neither a
// task). Planned cards, due steps, decision checks, project dates and the review are not here: the calendar is not the
// task list. Pure: data in, events out; the app maps them onto its library.
import type { Address, Day, Place, Project, Stay, SuitId, Task } from '../data/schema';
import { addDays, type DayKey } from './dates';
import { DEFAULT_FIXED_MINUTES } from './ics';
import { shortLabel } from './label';
import { chainIndex, isWaiting } from './chains';
import { fixedOn, rawPlan, whereOf } from './lists';
import { inArea, type Half } from './areas';
import { locationOf } from './calItems';
import { isoDow } from './repeat';

type WithId<T> = T & { id: string };

export interface CalViewData {
  tasks: ReadonlyMap<string, WithId<Task>>;
  days: ReadonlyMap<string, WithId<Day>>;
  projects: ReadonlyMap<string, WithId<Project>>;
  places: ReadonlyMap<string, WithId<Place>>;
  stays: ReadonlyMap<string, WithId<Stay>>;
  addresses: ReadonlyMap<string, WithId<Address>>;
}

export interface CalViewOptions {
  dayStart: string;
  /** Narrowed to one area: its steps and Anywhere's, and the half days spent there. Every step on the calendar follows it. */
  area?: string | null;
}

export type CalViewKind = 'fixed' | 'stay' | 'half';

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
  stayId?: string;
  /** A step's short name; for a stay or a half day, the name of the place or area. */
  title: string;
  /** The address or the place, short. */
  where?: string;
  suit?: SuitId;
  /** A half day spent in an area: `title` is the area's name. */
  half?: Half;
  done?: boolean;
  /** Can be dragged: fixed-time steps not yet done (a standing item that has no copy on the day cannot). */
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
  const task = (t: WithId<Task>, day: DayKey, extra: Partial<CalViewEvent> = {}): CalViewEvent =>
    ({ id: `fixed:${t.id}:${day}`, kind: 'fixed', day, date: day, taskId: t.id, title: shortLabel(t), suit: t.suit, ...(where(t) ? { where: where(t) } : {}), movable: false, ...extra });

  // Stays: one band from the first to the last date, whatever part of it is in the window.
  for (const s of data.stays.values()) {
    if (s.to < from || s.from > to) continue;
    out.push({ id: `stay:${s.id}:${s.from}`, kind: 'stay', day: s.from, date: s.from, endDate: s.to, stayId: s.id, title: data.places.get(s.placeId)?.name ?? '', movable: false });
  }

  // A step that waits for another is inside its head's card, so it has no event of its own (a commitment never waits).
  const ix = chainIndex(data.tasks);
  const waiting = (t: WithId<Task>) => !t.fixed && isWaiting(ix, t.id);

  const lists = { days: data.days, tasks: data.tasks };
  const standing = [...data.tasks.values()].filter(t => t.template && t.status === 'open' && HHMM.test(t.at ?? '') && Array.isArray(t.weekdays) && t.weekdays.length);
  const copies = new Map<string, WithId<Task>[]>();
  for (const c of data.tasks.values()) if (c.from) copies.set(c.from, [...(copies.get(c.from) ?? []), c]);
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const timed = fixedOn(lists, k).filter(t => !waiting(t) && HHMM.test(t.at ?? ''));
    for (const t of timed) {
      const slot = gridSlot(k, t.at!, o.dayStart);
      const done = t.status === 'done';
      out.push(task(t, k, { date: slot.date, time: slot.time, endTime: endClock(slot.time, t.dur ?? t.est), done, movable: !done }));
    }
    // A standing item on its weekdays, until a copy of it is placed on the day (the copy is the event then).
    const plan = new Set(rawPlan(data.days, k));
    for (const tpl of standing) {
      if (!tpl.weekdays!.includes(isoDow(k)) || (copies.get(tpl.id) ?? []).some(c => c.due === k || (!c.due && plan.has(c.id)))) continue;
      const slot = gridSlot(k, tpl.at!, o.dayStart);
      out.push(task(tpl, k, { date: slot.date, time: slot.time, endTime: endClock(slot.time, tpl.dur ?? tpl.est) }));
    }
    for (const a of data.days.get(k)?.areas ?? []) {
      const name = data.places.get(a.placeId)?.name;
      if (name && (!o.area || o.area === a.placeId)) out.push({ id: `half:${a.half}:${k}`, kind: 'half', day: k, date: k, half: a.half, title: name, movable: false });
    }
  }
  // Narrowed to an area: a step shows if it is set to the area or to Anywhere.
  return o.area ? out.filter(e => !e.taskId || inArea(whereOf(data.tasks.get(e.taskId)!, data.projects), o.area!)) : out;
}
