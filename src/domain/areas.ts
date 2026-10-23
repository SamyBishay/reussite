// Areas in use (schema 5): a place can hold areas (Cairo → Heliopolis), and the person can spend a morning or an
// afternoon in one. What an area is (`parentId`, one level) is in places.ts; this is what the views do with it: the
// order of the places in a select, the chips that filter a page to one area, the headings a list is grouped under,
// and the half days. Pure: ids in, ids out.
import { isArea, parentOf, placeAndAreas, type PlaceMap } from './places';

/** A half day is the morning (the launch points before this time) or the afternoon (from it on). */
export const HALF_DAY_AT = '13:00';
export type Half = 'am' | 'pm';
export interface HalfDay { half: Half; placeId: string }

type Named = { name: string; order?: number; parentId?: string | null };
export type NamedPlaces = ReadonlyMap<string, Named>;

export interface PlaceRow { id: string; name: string; area: boolean }

const byOrder = (a: [string, Named], b: [string, Named]) => (a[1].order ?? 0) - (b[1].order ?? 0) || (a[0] < b[0] ? -1 : 1);

/** The places by order, each followed by its areas by order: the order of a select. An area whose parent is gone is read as a place. */
export function placeRows(places: NamedPlaces): PlaceRow[] {
  const all = [...places].sort(byOrder);
  const out: PlaceRow[] = [];
  for (const [id, p] of all) {
    if (isArea(places, id)) continue;
    out.push({ id, name: p.name, area: false });
    for (const [aid, a] of all) if (aid !== id && parentOf(places, aid) === id) out.push({ id: aid, name: a.name, area: true });
  }
  return out;
}

/** "Cairo › Heliopolis" for an area, the name for a place. */
export function placePath(places: NamedPlaces, id: string): string {
  const p = places.get(id), up = parentOf(places, id);
  return p ? (up ? `${places.get(up)!.name} › ${p.name}` : p.name) : id;
}

/** The areas on the page of the place `page` (an area counts as its parent), by order; empty when it holds none. */
export const areasOnPage = (places: PlaceMap, page: string): string[] => placeAndAreas(places, page).slice(1);

/** The area a step, address or person is set to, if it is set to one. */
export const areaOf = (places: PlaceMap, where: string): string | null => (isArea(places, where) ? where : null);

/** Whether something set to `where` shows when the page is narrowed to `area`: that area's own, and Anywhere (the base layer). */
export const inArea = (where: string, area: string | null): boolean => !area || where === 'any' || where === area;

/** The filter to use on a page: the chosen area if the page still has it, else none. */
export const activeArea = (places: PlaceMap, page: string, chosen: string | null | undefined): string | null =>
  chosen && areasOnPage(places, page).includes(chosen) ? chosen : null;

export interface AreaGroup<T> { area: string | null; items: T[] }

/**
 * Items under the heading of their area: those set to no area first (the place's own and Anywhere), then each area of the
 * page in order that has items. The order inside a group is the order given. With no area in use there is one group.
 */
export function groupByArea<T>(items: readonly T[], whereOf: (x: T) => string, places: PlaceMap, page: string): AreaGroup<T>[] {
  const areas = areasOnPage(places, page);
  const out: AreaGroup<T>[] = [{ area: null, items: [] }, ...areas.map(area => ({ area, items: [] as T[] }))];
  for (const x of items) {
    const a = areaOf(places, whereOf(x));
    (out.find(g => g.area === a) ?? out[0]!).items.push(x);
  }
  return out.filter(g => g.items.length > 0);
}

/** The area set for a half of a day, if any. */
export const areaFor = (halves: readonly HalfDay[] | null | undefined, half: Half): string | null => (Array.isArray(halves) ? halves.find(h => h.half === half)?.placeId : undefined) ?? null;

export interface PlanGroup { area: string | null; half: Half | null; ids: string[] }

/**
 * A day's list under headings: steps set to an area go under that area's heading ("Afternoon · Heliopolis" when the day spends
 * a half there), the rest under none. Groups come in the order of their first step, the steps in the order of the list; with
 * no step in an area there is one group and no heading.
 */
export function groupPlan(ids: readonly string[], areaOfId: (id: string) => string | null, halves: readonly HalfDay[] | null | undefined): PlanGroup[] {
  const out: PlanGroup[] = [];
  for (const id of ids) {
    const area = areaOfId(id);
    let g = out.find(x => x.area === area);
    if (!g) {
      const half = area ? (['am', 'pm'] as Half[]).find(h => areaFor(halves, h) === area) ?? null : null;
      g = { area, half, ids: [] };
      out.push(g);
    }
    g.ids.push(id);
  }
  return out;
}
