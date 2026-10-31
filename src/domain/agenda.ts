// The agenda: everything that happens at a clock time on a dated day, as instants (brief §8).
// Launch points, fixed-time items (one-off and standing), the check-in, the close of the day, the
// weekly review and decision checks. Push notifications (notify.ts), the planner's fixed lines and
// the calendar exports all read it, so they agree on what is when. Pure: no store, no clock.
import type { Day, Decision, Place, Stay, Task } from '../data/schema';
import { addDays, type DayKey } from './dates';
import { isoDow } from './repeat';
import { atOnDay, placeOfDay } from './zone';
import { zoneOfPlace } from './places';

type WithId<T> = T & { id: string };

/** The documents the agenda reads: maps of live documents by id (tombstones removed). */
export interface AgendaData {
  tasks: ReadonlyMap<string, WithId<Task>>;
  days: ReadonlyMap<string, WithId<Day>>;
  decisions: ReadonlyMap<string, WithId<Decision>>;
  places: ReadonlyMap<string, WithId<Place>>;
  stays: ReadonlyMap<string, WithId<Stay>>;
}

/** The settings it reads (the app's `Settings` has all of them). */
export interface AgendaSettings {
  dayStart: string;
  /** The place chosen by hand: where a day outside every stay belongs. */
  here: string;
  morningAt: string;
  eveningAt: string;
  reviewDay: number;
  reviewTime: string;
  /** Default minutes of notice before a fixed-time item. */
  notifyLead: number;
}

export type AgendaKind = 'launch' | 'fixed' | 'checkin' | 'close' | 'review' | 'decision';

export interface AgendaEvent {
  /** Stable for the same thing on the same day: `launch:<day>:<n>`, `fixed:<rootId>:<day>`, `checkin:<day>`, … */
  id: string;
  kind: AgendaKind;
  /** The day it belongs to (by the day-start rule), which may differ from the calendar date of `at`. */
  day: DayKey;
  /** The start, epoch milliseconds. */
  at: number;
  /** The clock reading at the place (HH:MM). */
  time: string;
  /** The place the day belongs to, and its zone (undefined = this device's). */
  place: string;
  zone: string | undefined;
  // fixed
  /** The step shown: the check-in's copy or the one-off; the standing item itself when nothing was placed. */
  taskId?: string;
  /** The standing item a copy came from, else the step itself: the same thing has the same root. */
  rootId?: string;
  /** Not yet placed on the day: `taskId` is the standing item. */
  template?: boolean;
  title?: string;
  /** Minutes before `at` to leave. */
  lead?: number;
  dur?: number | null;
  // launch
  launch?: { k: 'start' | 'restart'; n: number; note?: string };
  // decision
  decisionId?: string;
}

const TIME = /^(\d{1,2}):(\d{2})$/;
/** HH:MM, zero-padded, or null for anything else. */
export function clockOf(s: unknown): string | null {
  const m = typeof s === 'string' ? TIME.exec(s.trim()) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return m[1]!.padStart(2, '0') + ':' + m[2];
}
const leadOf = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 24 * 60) : null);
const weekdaysOf = (w: unknown): number[] => (Array.isArray(w) ? w.map(Number).filter(d => Number.isInteger(d) && d >= 1 && d <= 7) : []);

/**
 * Every timed event on days `from`..`to` (inclusive), soonest first.
 *
 * Fixed-time items: a step with `at` that is due that day (or, with no due date, on that day's
 * list); a standing item (`template`) with `weekdays` and `at` on each matching day, unless a copy
 * of it was already placed that day (the copy is the event, or, done or dropped, there is none).
 * Done and dropped items have no event. The check-in, the close and the review are left out of
 * days where they were already done.
 */
export function agenda(data: AgendaData, s: AgendaSettings, from: DayKey, to: DayKey): AgendaEvent[] {
  const out = new Map<string, AgendaEvent>();
  const stays = [...data.stays.values()];
  const zoneOf = (id: string) => zoneOfPlace(data.places, id);
  const where = new Map<DayKey, ReturnType<typeof placeOfDay>>();
  const at = (k: DayKey) => { let w = where.get(k); if (!w) where.set(k, (w = placeOfDay(k, stays, s.here, zoneOf))); return w; };
  const inRange = (k: DayKey) => k >= from && k <= to;
  const put = (e: Omit<AgendaEvent, 'place' | 'zone' | 'at' | 'time'> & { clock: string }) => {
    if (out.has(e.id)) return;
    const w = at(e.day);
    const { clock, ...rest } = e;
    out.set(e.id, { ...rest, time: clock, at: atOnDay(e.day, clock, s.dayStart, w.timeZone), place: w.placeId, zone: w.timeZone });
  };

  // Which days' lists a step is on, for steps without a due date.
  const planDays = new Map<string, DayKey[]>();
  for (const d of data.days.values()) {
    if (!inRange(d.date) || !Array.isArray(d.plan)) continue;
    for (const id of d.plan) { const l = planDays.get(id); if (l) l.push(d.date); else planDays.set(id, [d.date]); }
  }

  // Fixed-time steps, and the days a copy of a standing item already covers.
  const placed = new Set<string>();
  const fixed = (t: WithId<Task>, k: DayKey, clock: string, tpl: WithId<Task> | undefined) => put({
    id: 'fixed:' + (t.from ?? t.id) + ':' + k, kind: 'fixed', day: k, clock, taskId: t.id, rootId: t.from ?? t.id, title: t.title,
    lead: leadOf(t.lead) ?? leadOf(tpl?.lead) ?? leadOf(s.notifyLead) ?? 30, dur: t.dur ?? tpl?.dur ?? t.est ?? null,
  });
  for (const t of data.tasks.values()) {
    if (t.template || t.kind === 'event' || (!t.at && !t.from)) continue;
    const root = t.from ?? t.id;
    const tpl = t.from ? data.tasks.get(t.from) : undefined;
    for (const k of t.due ? [t.due] : planDays.get(t.id) ?? []) {
      if (!inRange(k)) continue;
      placed.add(root + ':' + k);
      const clock = clockOf(t.at);
      if (clock && t.status === 'open') fixed(t, k, clock, tpl);
    }
  }
  for (const tpl of data.tasks.values()) {
    const clock = clockOf(tpl.at), days = weekdaysOf(tpl.weekdays);
    if (!tpl.template || tpl.status !== 'open' || !clock || !days.length) continue;
    for (let k = from; k <= to; k = addDays(k, 1)) {
      if (!days.includes(isoDow(k)) || placed.has(tpl.id + ':' + k)) continue;
      put({
        id: 'fixed:' + tpl.id + ':' + k, kind: 'fixed', day: k, clock, taskId: tpl.id, rootId: tpl.id, template: true, title: tpl.title,
        lead: leadOf(tpl.lead) ?? leadOf(s.notifyLead) ?? 30, dur: tpl.dur ?? tpl.est ?? null,
      });
    }
  }

  // The day's own times.
  const morning = clockOf(s.morningAt), evening = clockOf(s.eveningAt), review = clockOf(s.reviewTime);
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const d = data.days.get(k);
    const ls = Array.isArray(d?.launches) ? d!.launches : [];
    ls.forEach((l, n) => {
      const clock = clockOf(l.t);
      if (clock) put({ id: `launch:${k}:${n}`, kind: 'launch', day: k, clock, launch: { k: l.k === 'restart' ? 'restart' : 'start', n, ...(l.n ? { note: l.n } : {}) } });
    });
    if (morning && !d?.checkin) put({ id: 'checkin:' + k, kind: 'checkin', day: k, clock: morning });
    if (evening && !d?.closed) put({ id: 'close:' + k, kind: 'close', day: k, clock: evening });
    if (review && isoDow(k) === s.reviewDay && !d?.review) put({ id: 'review:' + k, kind: 'review', day: k, clock: review });
  }
  // A decision is checked on its review date, in the morning.
  if (morning) {
    for (const dec of data.decisions.values()) {
      if (dec.status !== 'decided' || !dec.reviewOn || !inRange(dec.reviewOn)) continue;
      put({ id: `decision:${dec.id}:${dec.reviewOn}`, kind: 'decision', day: dec.reviewOn, clock: morning, decisionId: dec.id, title: dec.title });
    }
  }

  return [...out.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}

/** The fixed-time items of one day that are still to come or going on (not done, not dropped). */
export const fixedOnDay = (data: AgendaData, s: AgendaSettings, k: DayKey): AgendaEvent[] => agenda(data, s, k, k).filter(e => e.kind === 'fixed');
