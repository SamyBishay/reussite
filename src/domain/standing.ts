// A standing item's days (a `template` with `weekdays` and `at`): the days it comes, when it has ended, and what already stands in for
// one of its occurrences. The agenda, the calendar, the connector and the app's placing of tonight's copy all read these, so they agree.
import type { Task } from '../data/schema';
import type { DayKey } from './dates';
import { isoDow } from './repeat';
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
