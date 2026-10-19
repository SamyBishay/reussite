// Places and stays (brief §5). A stay is a place with a first and a last day. On a stay's
// first day the current place switches by itself; outside any stay it's the last one chosen.
import { addDays, dayKey, type DayKey } from './dates';

export interface StayLike { id: string; placeId: string; from: DayKey; to: DayKey }

/** The stay a day belongs to. A day shared by two stays belongs to the one that starts on it. */
export function stayOn<S extends StayLike>(stays: Iterable<S>, k: DayKey): S | undefined {
  let best: S | undefined;
  for (const s of stays) {
    if (!(s.from <= k && k <= s.to)) continue;
    if (!best || s.from > best.from) best = s;
  }
  return best;
}

export function currentPlace(stays: Iterable<StayLike>, k: DayKey, chosen: string): string {
  return stayOn(stays, k)?.placeId ?? chosen;
}

/** "Before I leave": the stay's last day minus `daysBefore`. */
export function dueBeforeEnd(stay: Pick<StayLike, 'to'>, daysBefore = 1): DayKey {
  return addDays(stay.to, -Math.max(0, Math.round(daysBefore)));
}

/**
 * Today (in the current place's time zone, by the day-start rule) and the place the person is in:
 * the stay that day belongs to, else the place chosen by hand. The app's store computes the same
 * from its signals; the connector calls this on plain data.
 */
export function whereNow<S extends StayLike>(
  at: Date, chosen: { here: string; dayStart: string }, zoneOf: (placeId: string) => string | undefined, stays: Iterable<S>,
): { today: DayKey; here: string; stay: S | null } {
  const list = [...stays];
  let k = dayKey(at, chosen.dayStart, zoneOf(chosen.here));
  let stay = stayOn(list, k);
  if (stay) {
    k = dayKey(at, chosen.dayStart, zoneOf(stay.placeId));
    stay = stayOn(list, k) ?? stay;
  }
  return { today: k, here: stay?.placeId ?? chosen.here, stay: stay ?? null };
}
