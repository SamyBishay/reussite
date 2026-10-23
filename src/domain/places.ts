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

// Areas (schema 5): a place can hold areas (Cairo → Heliopolis). An area has no time zone of its own and no page
// of its own: what is set to an area is on its parent place's page. One level only; written data is checked
// (`parentProblem`), and read data is read forgivingly (a chain is followed to its top, a loop or a parent that
// is gone stops it), so two devices that each made a valid change can never leave a place unreadable.

export interface PlaceNode { timeZone?: string; parentId?: string | null; order?: number }
export type PlaceMap = ReadonlyMap<string, PlaceNode>;

/** The place an area belongs to, if `id` is an area whose parent still exists. */
export function parentOf(places: PlaceMap, id: string): string | undefined {
  const p = places.get(id)?.parentId;
  return p && p !== id && places.has(p) ? p : undefined;
}

/** The place whose page `id` belongs to: `id` itself for a place, 'any' and an unknown id, else the top of its chain. */
export function rootOf(places: PlaceMap, id: string): string {
  let cur = id;
  const seen = new Set([cur]);
  for (;;) {
    const up = parentOf(places, cur);
    if (!up || seen.has(up)) return cur;
    seen.add(up);
    cur = up;
  }
}

export const isArea = (places: PlaceMap, id: string): boolean => parentOf(places, id) !== undefined;

/** A place's time zone; an area has none of its own and takes its parent's. `undefined` = this device's. */
export function zoneOfPlace(places: PlaceMap, id: string): string | undefined {
  return places.get(rootOf(places, id))?.timeZone;
}

/** Everything that belongs to a place's page: the place (the top of `id`'s chain) first, then its areas by order. */
export function placeAndAreas(places: PlaceMap, id: string): string[] {
  const root = rootOf(places, id);
  const areas = [...places].filter(([k]) => k !== root && rootOf(places, k) === root).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0) || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
  return [root, ...areas];
}

/** On a place's page: the page of the same place (areas count as their parent), or Anywhere. */
export const onPage = (places: PlaceMap, where: string, page: string): boolean =>
  where === 'any' || where === page || rootOf(places, where) === rootOf(places, page);

export type ParentProblem = 'self' | 'missing' | 'area' | 'hasAreas';

/**
 * Why `parentId` cannot be the parent of the place `id` (null for a place being made), or null when it can:
 * itself, a place that does not exist, an area (areas hold no areas), or `id` already holds areas (it would nest two levels).
 */
export function parentProblem(places: PlaceMap, id: string | null, parentId: string): ParentProblem | null {
  if (id !== null && parentId === id) return 'self';
  if (!places.has(parentId)) return 'missing';
  if (isArea(places, parentId)) return 'area';
  if (id !== null && [...places].some(([k, p]) => k !== id && p.parentId === id && parentOf(places, k) === id)) return 'hasAreas';
  return null;
}
