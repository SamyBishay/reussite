// Calendar grids (brief §5, Calendar view). Weeks start on Monday.
import { addDays, dayKey, type DayKey } from './dates';
import { mondayOf } from './repeat';
import { atOnDay } from './zone';

/** The weeks that cover a month, Monday first, as rows of seven day keys. */
export function monthGrid(year: number, month: number): DayKey[][] {
  const first = year + '-' + String(month).padStart(2, '0') + '-01';
  const last = addDays(month === 12 ? (year + 1) + '-01-01' : year + '-' + String(month + 1).padStart(2, '0') + '-01', -1);
  const rows: DayKey[][] = [];
  for (let k = mondayOf(first); k <= last; k = addDays(k, 7)) rows.push(Array.from({ length: 7 }, (_, i) => addDays(k, i)));
  return rows;
}

export const weekOf = (k: DayKey): DayKey[] => Array.from({ length: 7 }, (_, i) => addDays(mondayOf(k), i));

/** Minutes between two HH:MM times on the same day, wrapping past midnight. */
export function minutesBetween(from: string, to: string): number {
  const m = (t: string) => { const [h, mm] = t.split(':').map(Number); return (h ?? 0) * 60 + (mm ?? 0); };
  const d = m(to) - m(from);
  return d < 0 ? d + 24 * 60 : d;
}

/** "Still on …?": twice the personal estimate, at least 45 minutes (brief §5, timer). */
export const stillOnAfter = (personalEst: number | null | undefined) => Math.max(45, 2 * (personalEst ?? 0));

/**
 * The moment a running timer becomes "long" (epoch ms), for the in-app banner and the push alike:
 * `stillOnAfter` the later of the start and the last "still going", or, if the person has never
 * said "still going", the start of the next day (`dayStart` in `zone`) when that is over four hours
 * after the start, whichever comes first.
 */
export function stillOnDue(started: number, stillAt: number | null | undefined, personalEst: number | null | undefined, dayStart: string, zone?: string): number {
  const last = Math.max(started, stillAt ?? 0);
  const at = last + stillOnAfter(personalEst) * 60_000;
  if (stillAt) return at;
  const nextStart = atOnDay(addDays(dayKey(new Date(started), dayStart, zone), 1), dayStart, dayStart, zone);
  return Math.min(at, Math.max(nextStart, started + 4 * 3_600_000));
}

/** An HH:MM moved by some minutes, staying within the day (wraps past midnight). */
export function shiftTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = (((h ?? 0) * 60 + (m ?? 0) + Math.round(minutes)) % 1440 + 1440) % 1440;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}

/**
 * A fixed-time item as a line: the time goes after the first part of the title
 * ("Choir, Hill House 602" at 19:00 → "Choir 19:00, Hill House 602"), or at its end.
 * A title that already carries the time is left alone.
 */
export function withTime(title: string, at: string): string {
  const s = title.trim();
  if (!at || s.includes(at)) return s;
  const i = s.indexOf(',');
  return i < 0 ? s + ' ' + at : s.slice(0, i) + ' ' + at + s.slice(i);
}
