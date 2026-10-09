// Calendar grids (brief §5, Calendar view). Weeks start on Monday.
import { addDays, type DayKey } from './dates';
import { mondayOf } from './repeat';

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
