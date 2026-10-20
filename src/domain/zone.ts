// Wall time at a place → an instant (brief §8). A time on a day means that clock time in the
// IANA zone of the place the day belongs to, so it stays right across daylight-saving changes,
// and a time before the day-start rule belongs to the next calendar date.
import { addDays, partsIn, type DayKey } from './dates';
import { currentPlace, type StayLike } from './places';

const MIN = 60_000;
const DAY = 86_400_000;

/** The zone's offset from UTC at an instant, in milliseconds (whole minutes). `undefined` = this device's zone. */
export function offsetAt(instant: number, timeZone?: string): number {
  const p = partsIn(new Date(instant), timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - Math.floor(instant / MIN) * MIN;
}

/**
 * The instant at which the clock in `timeZone` reads `hhmm` on calendar date `date`.
 * A time that happens twice (clocks going back) is the first one; a time that doesn't exist
 * (clocks going forward) is read with the offset from before the change, so it lands an hour later.
 */
export function wallToInstant(date: DayKey, hhmm: string, timeZone?: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y!, m! - 1, d!, hh ?? 0, mm ?? 0);
  const before = offsetAt(wall - DAY, timeZone), after = offsetAt(wall + DAY, timeZone);
  const valid = [...new Set([before, after])].map(o => wall - o).filter(i => offsetAt(i, timeZone) === wall - i).sort((a, b) => a - b);
  return valid[0] ?? wall - before;
}

/** The instant of `hhmm` on day `k`: before `dayStart` it is the small hours of the next calendar date. */
export function atOnDay(k: DayKey, hhmm: string, dayStart: string, timeZone?: string): number {
  return wallToInstant(hhmm < dayStart ? addDays(k, 1) : k, hhmm, timeZone);
}

/** The clock reading (HH:MM) at an instant in a zone. */
export function wallOf(instant: number, timeZone?: string): string {
  const p = partsIn(new Date(instant), timeZone);
  return String(p.hh).padStart(2, '0') + ':' + String(p.mm).padStart(2, '0');
}

const known = new Map<string, boolean>();
/** The zone name if the platform knows it; a place typed with a bad zone falls back to the device's. */
export function validZone(timeZone: string | undefined | null): string | undefined {
  if (!timeZone) return undefined;
  let ok = known.get(timeZone);
  if (ok === undefined) {
    try { new Intl.DateTimeFormat('en-GB', { timeZone }); ok = true; } catch { ok = false; }
    known.set(timeZone, ok);
  }
  return ok ? timeZone : undefined;
}

/** The place a day belongs to (the stay covering it, else the place chosen by hand) and its zone. */
export function placeOfDay(
  k: DayKey, stays: Iterable<StayLike>, chosen: string, zoneOf: (placeId: string) => string | undefined,
): { placeId: string; timeZone: string | undefined } {
  const placeId = currentPlace(stays, k, chosen);
  return { placeId, timeZone: validZone(zoneOf(placeId)) };
}
