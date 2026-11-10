// Deadlines, events and slots apart (plan 10 Nov). Three things a step can carry, each in its own field:
//   due (+ dueAt)   must be done by then; never in a calendar, never off a list;
//   at (+ dur)      happens then, an event (src/domain/lists.ts `fixedOn`, agenda.ts, calView.ts);
//   slot            time set aside to work on the step: a day, a start and a length. Movable, never an event.
// Pure: the clock is a day and an HH:MM reading, the instants come from dayOrder.
import type { DayKey } from './dates';
import { wallOf } from './zone';
import type { DayOrder } from './dayOrder';
import type { By, Slot, SlotLogEntry } from '../data/schema';

export const MAX_SLOT_LOG = 20;
const HHMM = /^\d{1,2}:\d{2}$/;
/** The shortest slot, in minutes. */
export const MIN_SLOT = 5;

const mins = (hhmm: string): number => Number(hhmm.slice(0, hhmm.indexOf(':'))) * 60 + Number(hhmm.slice(hhmm.indexOf(':') + 1));
/** Minutes since the day started (`dayStart`, HH:MM) for a clock reading: 01:00 of a day starting at 05:00 is late in that day. */
const intoDay = (hhmm: string, dayStart: string): number => (((mins(hhmm) - mins(dayStart)) % 1440) + 1440) % 1440;

export type DueState = 'ahead' | 'today' | 'passed' | 'carried';
/**
 * Where a deadline stands: `ahead` (a later day), `today` (today, its time not yet here or none), `passed` (today, its time has gone:
 * shown as passed, never red, the card stays) or `carried` (an earlier day: carried over, not "late").
 */
export function dueState(due: DayKey, dueAt: string | null | undefined, today: DayKey, now: string, dayStart = '00:00'): DueState {
  if (due > today) return 'ahead';
  if (due < today) return 'carried';
  return dueAt && HHMM.test(dueAt) && intoDay(dueAt, dayStart) <= intoDay(now, dayStart) ? 'passed' : 'today';
}

/** A fixed-time item's length when it has none, in minutes (the same 30 as the day's order). */
const EVENT_MINUTES = 30;
/**
 * An event (a step with `at`) is missed when its end has gone and it is not done: an earlier day, or today past `at + dur`. It stays on
 * Today, marked missed, with Move and Remove; it never leaves by itself. `day` is the event's day (its due date, else its list's).
 */
export function eventMissed(day: DayKey | null | undefined, at: string, dur: number | null | undefined, today: DayKey, now: string, dayStart = '00:00'): boolean {
  if (!day || !HHMM.test(at)) return false;
  if (day < today) return true;
  if (day > today) return false;
  return intoDay(now, dayStart) >= intoDay(at, dayStart) + (dur && dur > 0 ? dur : EVENT_MINUTES);
}

export type SlotState = 'ahead' | 'now' | 'passed';
/** Where a slot stands against the clock: `passed` once its end has gone (the step, if open, shows "slot passed" and offers Re-slot). */
export function slotState(s: Slot, today: DayKey, now: string, dayStart = '00:00'): SlotState {
  if (s.day > today) return 'ahead';
  if (s.day < today) return 'passed';
  const from = intoDay(s.at, dayStart), n = intoDay(now, dayStart);
  return n >= from + s.dur ? 'passed' : n >= from ? 'now' : 'ahead';
}

/** A well-formed slot, or null: a day, a start as HH:MM, a length of at least five minutes (rounded to whole minutes). */
export function readSlot(v: unknown): Slot | null {
  if (!v || typeof v !== 'object') return null;
  const { day, at, dur } = v as Record<string, unknown>;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof at !== 'string' || !HHMM.test(at) || typeof dur !== 'number' || !Number.isFinite(dur)) return null;
  return { day, at: at.padStart(5, '0'), dur: Math.max(MIN_SLOT, Math.round(dur)) };
}

export const sameSlot = (a: Slot | null | undefined, b: Slot | null | undefined): boolean =>
  !a && !b ? true : !!a && !!b && a.day === b.day && a.at === b.at && a.dur === b.dur;

/** The last end of a slot, as HH:MM (the grid stops at 23:59). */
export function slotEnd(s: Slot): string {
  const n = Math.min(mins(s.at) + s.dur, 24 * 60 - 1);
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
}

/**
 * The patch that writes a step's one slot and keeps where it has been: `slot` and `slotLog` (the last 20 writes, newest last). Writing
 * the slot it already has changes nothing (an empty patch). `why`: planned (Plan my day), set (the sheet), moved (a drag), reslotted
 * (the person confirmed a new slot after the old one passed), cleared.
 */
export function writeSlot(cur: { slot?: Slot | null; slotLog?: SlotLogEntry[] | null }, to: Slot | null, by: By, why: SlotLogEntry['why'], nowIso: string): { slot: Slot | null; slotLog: SlotLogEntry[] } | Record<string, never> {
  const from = readSlot(cur.slot);
  const next = to ? readSlot(to) : null;
  if (sameSlot(from, next)) return {};
  const log = [...(Array.isArray(cur.slotLog) ? cur.slotLog : []), { from, to: next, at: nowIso, by, why: next ? why : 'cleared' }];
  return { slot: next, slotLog: log.slice(-MAX_SLOT_LOG) };
}

/**
 * Plan my day's slots: the accepted order of the day as one slot per planned step, at the time `dayOrder` projects it and as long as
 * the order gives it. Fixed items are not slots, and a step that starts after the day's end (it did not fit) gets none.
 */
export function slotsFor(o: DayOrder, day: DayKey, end: number, zone?: string): Map<string, Slot> {
  const out = new Map<string, Slot>();
  for (const x of o.order) {
    if (x.kind !== 'step' || x.start >= end) continue;
    out.set(x.id, { day, at: wallOf(x.start, zone), dur: Math.max(MIN_SLOT, Math.round((Math.min(x.end, end) - x.start) / 60_000)) });
  }
  return out;
}
