// Days follow the day-start rule (a day starts at `dayStart`, 05:00 by default) in a time zone.
export type DayKey = string;

const pad = (n: number) => String(n).padStart(2, '0');

// Building a formatter is the slow part; schedules ask for hundreds of readings in a few zones.
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone?: string): Intl.DateTimeFormat {
  const make = () => new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (!timeZone) return make(); // the device's zone can change while the app is open
  let f = formatters.get(timeZone);
  if (!f) formatters.set(timeZone, (f = make()));
  return f;
}

/** Wall-clock parts of `at` in `timeZone`. */
export function partsIn(at: Date, timeZone?: string): { y: number; m: number; d: number; hh: number; mm: number } {
  const f = formatterFor(timeZone);
  const p = Object.fromEntries(f.formatToParts(at).map(x => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour), mm: Number(p.minute) };
}

/** The day `at` belongs to: before `dayStart` it still counts as the previous day. */
export function dayKey(at: Date = new Date(), dayStart = '05:00', timeZone?: string): DayKey {
  const p = partsIn(at, timeZone);
  const key = p.y + '-' + pad(p.m) + '-' + pad(p.d);
  return pad(p.hh) + ':' + pad(p.mm) < dayStart ? addDays(key, -1) : key;
}

export function addDays(k: DayKey, n: number): DayKey {
  const [y, m, d] = k.split('-').map(Number);
  const x = new Date(Date.UTC(y!, m! - 1, d! + n));
  return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
}

/** Whole days from `today` to `k`; Infinity when there's no date. */
export function daysBetween(today: DayKey, k: DayKey | null | undefined): number {
  if (!k) return Infinity;
  const t = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y!, m! - 1, d!); };
  return Math.round((t(k) - t(today)) / 86400000);
}

export const isDayKey = (s: unknown): s is DayKey => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
