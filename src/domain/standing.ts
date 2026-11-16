// A standing item's days (a `template` with `weekdays` and `at`): the days it comes, when it has ended, and what already stands in for
// one of its occurrences. The agenda, the calendar, the connector and the app's placing of tonight's copy all read these, so they agree.
import type { Task } from '../data/schema';
import type { DayKey } from './dates';
import { isoDow } from './repeat';
import { addDays } from './dates';
import { norm } from './names';

const days = (w: unknown): number[] => (Array.isArray(w) ? w.map(Number).filter(d => Number.isInteger(d) && d >= 1 && d <= 7) : []);

/** Does the series come on day `k`: it is that weekday and `k` is not after its `until` (the last day, inclusive)? */
export function standingDay(t: Pick<Task, 'weekdays' | 'until'>, k: DayKey): boolean {
  if (typeof t.until === 'string' && t.until && k > t.until) return false;
  return days(t.weekdays).includes(isoDow(k));
}

/**
 * The id of the copy that is placed on a day for a series, the same on every device: two devices that place it at once make one
 * document, and a copy the person moved or shelved is still the day's copy (it is not made again).
 */
export const copyId = (templateId: string, k: DayKey): string => templateId + '-' + k;

/** A one-off's words and time, for "the same thing as the series": a one-off that has them stands in for the series' occurrence that day. */
export const thingKey = (title: string, clock: string): string => norm(title) + '|' + clock;

/** Has the series ended before day `k` (its `until` is earlier)? An ended series is offered, placed and shown on no day. */
export const ended = (t: Pick<Task, 'until'>, k: DayKey): boolean => typeof t.until === 'string' && !!t.until && t.until < k;

/**
 * One occurrence of a series called off ("no choir this Monday"): the day's copy, made dropped. It has the id the placed copy would have
 * (`copyId`), so nothing places it again, and the agenda, the calendar, the feed, the push and the connector, which all look for that
 * copy, show nothing for the day. The series goes on. Undone by removing it (a change-set's Undo) or by reopening the card.
 */
export function skippedCopy(tpl: Pick<Task, 'at' | 'dur' | 'est'>, templateId: string, k: DayKey): Partial<Task> {
  return { from: templateId, at: tpl.at ?? null, dur: tpl.dur ?? tpl.est ?? null, due: k, status: 'dropped', important: true };
}

/** The open copies of a series on day `k`, whatever made them (the app's placing, the check-in, a move to that day). */
export function openCopiesOn<T extends Pick<Task, 'from' | 'due' | 'status'> & { id: string }>(tasks: Iterable<T>, templateId: string, k: DayKey): T[] {
  return [...tasks].filter(t => t.from === templateId && t.due === k && t.status === 'open');
}

/**
 * The next day, from `from` on, that the series still comes on: its weekday, before its end, and not already called off or played
 * (a day whose copy is no longer open). Looks eight weeks ahead; null when there is none.
 */
export function nextComing(tasks: ReadonlyMap<string, Pick<Task, 'from' | 'due' | 'status'>>, tpl: Pick<Task, 'weekdays' | 'until'> & { id: string }, from: DayKey): DayKey | null {
  const closed = new Set<string>();
  for (const t of tasks.values()) if (t.from === tpl.id && t.due && t.status !== 'open') closed.add(t.due);
  for (const t of tasks.values()) if (t.from === tpl.id && t.due && t.status === 'open') closed.delete(t.due);
  for (let n = 0, k = from; n < 56; n++, k = addDays(k, 1)) if (standingDay(tpl, k) && !closed.has(k)) return k;
  return null;
}
