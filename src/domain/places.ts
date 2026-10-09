// Places and stays (brief §5). A stay is a place with a first and a last day. On a stay's
// first day the current place switches by itself; outside any stay it's the last one chosen.
import { addDays, type DayKey } from './dates';

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
