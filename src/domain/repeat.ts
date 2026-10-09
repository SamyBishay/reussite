// Repeating steps (brief §5). Only the next occurrence ever exists; this computes its date.
import { addDays, daysBetween, type DayKey } from './dates';

export interface Repeat {
  every: number;
  unit: 'day' | 'week' | 'month';
  /** ISO weekdays, 1 = Monday … 7 = Sunday. Weekly only. */
  weekdays?: number[];
  /** Day of the month, 1–31. Monthly only; clamped to the month's length. */
  monthDay?: number;
  /** Repeat from the due date ("pay rent on the 5th") or from completion ("water every 10 days"). */
  from: 'due' | 'done';
  until?: DayKey | null;
}

const parts = (k: DayKey) => k.split('-').map(Number) as [number, number, number];
const pad = (n: number) => String(n).padStart(2, '0');
/** ISO weekday: 1 Monday … 7 Sunday. */
export function isoDow(k: DayKey): number {
  const [y, m, d] = parts(k);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}
export const mondayOf = (k: DayKey) => addDays(k, 1 - isoDow(k));
const monthLength = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function addMonths(k: DayKey, n: number, day?: number): DayKey {
  const [y, m, d] = parts(k);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  return ny + '-' + pad(nm) + '-' + pad(Math.min(day ?? d, monthLength(ny, nm)));
}

/**
 * The next occurrence's due date, or null when the series has ended.
 * `due` is this occurrence's due date (if any); `done` is the day it was done or skipped.
 */
export function nextDue(r: Repeat, due: DayKey | null, done: DayKey): DayKey | null {
  const every = Math.max(1, Math.round(r.every || 1));
  const base = r.from === 'due' && due ? due : done;
  let next: DayKey;
  if (r.unit === 'day') next = addDays(base, every);
  else if (r.unit === 'week') {
    const days = (r.weekdays ?? []).filter(d => d >= 1 && d <= 7);
    if (!days.length) next = addDays(base, 7 * every);
    else {
      const w0 = mondayOf(base);
      next = addDays(base, 7 * every); // fallback, never reached with a valid weekday
      for (let i = 1; i <= 7 * every + 7; i++) {
        const k = addDays(base, i);
        const week = daysBetween(w0, mondayOf(k)) / 7;
        if (week % every === 0 && days.includes(isoDow(k))) { next = k; break; }
      }
    }
  } else next = addMonths(base, every, r.monthDay);
  // A step done late, repeating from its due date, shouldn't come back already overdue
  // by more than one period: skip ahead to the first date after it was done.
  if (r.from === 'due' && due) {
    let guard = 0;
    while (next <= done && guard++ < 400) {
      const again = nextDue({ ...r, until: null }, next, next);
      if (!again) break;
      next = again;
    }
  }
  if (r.until && next > r.until) return null;
  return next;
}

/** Later dates of the series after `from`, up to `to`, for faint markers on the calendar. */
export function occurrences(r: Repeat, from: DayKey, to: DayKey, max = 60): DayKey[] {
  const out: DayKey[] = [];
  let k: DayKey | null = from;
  while (out.length < max) {
    k = nextDue({ ...r, from: 'due' }, k, k);
    if (!k || k > to) break;
    out.push(k);
  }
  return out;
}
