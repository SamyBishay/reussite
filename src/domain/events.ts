// Event steps (schema 6): something outside the person's hands that they wait for ("the bellman calls back with a tailor").
// An event is a step of a chain that nobody does: it is dormant (not in the Matrix, a day's list, the planner, Start here, the
// calendar, the feed, the close of the day, the estimates or any notification) until it happens. "It happened" is the same
// as a step done, on the day it happened (`status: 'done'` and `doneDay`), so the steps that wait for it are freed by the
// chain rules unchanged; a dropped one frees them the same way. Pure: nothing here reads a store.
import type { Task } from '../data/schema';
import { nextHeads } from './chains';
import { addDays, daysBetween, type DayKey } from './dates';
import { isEvent, listOf, type TaskW } from './lists';

/**
 * What a step stops being when it becomes an event: no estimate, starter, time, due date or quadrant, no standing
 * or repeating. Known fields set to nothing, never dropped; turning it back into a step, the person enters them again.
 */
export function toEventFields(): Partial<Task> {
  return {
    kind: 'event', est: null, est0: null, estBy: null, starter: null, due: null, dueRule: null, at: null, dur: null, lead: null,
    weekdays: null, repeat: null, offer: null, urgent: false, important: false, template: false, started: null,
  };
}

/** The steps that become heads when `id` stops being open, leaving out the events among them (they stay dormant). */
export function liveNextHeads(tasks: ReadonlyMap<string, TaskW>, id: string): string[] {
  return nextHeads(tasks, id).filter(h => !isEvent(tasks.get(h)));
}

/** Events to ask about today: open, with a nudge day that has come. Shown from that day until answered, so a nudge missed on a closed phone is still there. */
export function nudgesDue(tasks: Iterable<TaskW>, today: DayKey): TaskW[] {
  return [...tasks].filter(t => isEvent(t) && t.status === 'open' && !t.template && !!t.nudge && t.nudge <= today)
    .sort((a, b) => String(a.nudge).localeCompare(String(b.nudge)) || (a.order || 0) - (b.order || 0));
}

export interface Waiting {
  id: string;
  title: string;
  /** Whole days since it was created (0 the same day). */
  days: number;
  nudge: DayKey | null;
  /** The open steps that wait for it. */
  unlocks: { id: string; title: string }[];
}

/** The open events, oldest wait first, with the steps each one holds back. */
export function waitingList(tasks: Iterable<TaskW>, today: DayKey): Waiting[] {
  const all = [...tasks];
  return all.filter(t => isEvent(t) && t.status === 'open' && !t.template)
    .sort((a, b) => String(a.created).localeCompare(String(b.created)) || (a.order || 0) - (b.order || 0))
    .map(e => ({
      id: e.id, title: e.title, nudge: e.nudge ?? null,
      days: Math.max(0, daysBetween(String(e.created).slice(0, 10), today)),
      unlocks: all.filter(x => x.status === 'open' && !x.template && x.id !== e.id && listOf(x.after).includes(e.id)).sort((a, b) => (a.order || 0) - (b.order || 0)).map(x => ({ id: x.id, title: x.title })),
    }));
}

export type Snooze = '3d' | '1w';
/** "Still waiting": ask again in three days or a week from today. */
export const snoozeNudge = (today: DayKey, how: Snooze): DayKey => addDays(today, how === '3d' ? 3 : 7);
/** A custom day for the next question: never today or earlier (that would ask again at once). */
export const nudgeAfter = (today: DayKey, day: DayKey): DayKey => (day > today ? day : addDays(today, 1));
