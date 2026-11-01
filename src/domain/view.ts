// What the lists are looking at (the place menu's View): the whole of a region, one of its areas, or everywhere.
// The choice is kept on the device and tied to the region the person was in when they made it (`region`), so when
// they move to another region, by a stay or by ticking "I'm here", the view goes back to that region by itself.
// Pure: the store keeps the saved value and reads it through `resolveView`.
import { isArea, rootOf, type PlaceMap } from './places';

/** The id the view has when it shows every place. */
export const ALL_VIEW = 'all';

/** What is kept on the device: a place or area id (or 'all') and the region of "here" when it was chosen. */
export interface SavedView { id: string; region: string }

/** What the lists read: the page's place (the top of the chain), the area inside it, or no place at all. */
export interface PageView {
  /** The view as chosen: a place or area id, or 'all'. */
  id: string;
  /** The place whose page it is: the region itself, or the region of an area; for 'all', the region of "here". */
  page: string;
  /** The area the lists are narrowed to, if the view is an area. */
  area: string | null;
  /** Every place at once: the lists ignore where a step is. */
  all: boolean;
}

/** The region the person is in: the top of the place they said they are in. */
export const regionOf = (places: PlaceMap, here: string): string => rootOf(places, here);

/** The view when nothing was chosen (or the choice no longer holds): the whole region of "here". */
export function defaultView(places: PlaceMap, here: string): PageView {
  const region = regionOf(places, here);
  return { id: region, page: region, area: null, all: false };
}

/**
 * The view to show. The saved one holds while the person is still in the region it was made in and the place or area
 * still exists; otherwise (moved to another region, place deleted, nothing saved) it is the region of "here".
 */
export function resolveView(places: PlaceMap, here: string, saved: SavedView | null | undefined): PageView {
  const def = defaultView(places, here);
  if (!saved || saved.region !== def.page) return def;
  if (saved.id === ALL_VIEW) return { id: ALL_VIEW, page: def.page, area: null, all: true };
  if (!places.has(saved.id)) return def;
  return { id: saved.id, page: rootOf(places, saved.id), area: isArea(places, saved.id) ? saved.id : null, all: false };
}

/** The value to keep for a choice: nothing for the default (so the saved view never outlives its region by accident). */
export function savedViewFor(places: PlaceMap, here: string, id: string | null): SavedView | null {
  const region = regionOf(places, here);
  return id === null || id === region ? null : { id, region };
}

/** Whether the lists are showing something other than where the person is: all places, or a place or area that is not "here". */
export function viewsElsewhere(places: PlaceMap, here: string, v: PageView): boolean {
  return v.all || (v.id !== here && v.id !== regionOf(places, here));
}

/** Reads what was kept; anything that is not a view reads as none. */
export function parseSavedView(raw: string | null | undefined): SavedView | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SavedView> | null;
    return v && typeof v.id === 'string' && v.id && typeof v.region === 'string' && v.region ? { id: v.id, region: v.region } : null;
  } catch { return null; }
}
