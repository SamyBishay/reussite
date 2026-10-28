// Areas on the page being viewed (phase 4b): which areas the page's place has, and the one area a view is narrowed to.
// The narrowing is for the session only, per view; the rules are in src/domain/areas.ts.
import { computed, signal } from '@preact/signals';
import { places, pagePlace } from './store';
import { activeArea, areaOf, areasOnPage, inArea } from '../domain/areas';
import { whereOf, type T } from './model';

export type AreaView = 'today' | 'matrix' | 'calendar';

/** The areas of the page's place, by order; the chips show only when there are some. */
export const pageAreas = computed(() => areasOnPage(places.value, pagePlace.value));

const chosen = signal<Partial<Record<AreaView, string>>>({});

/** The area a view is narrowed to now: what was tapped, if the page still has it. */
export const areaFilter = (view: AreaView): string | null => activeArea(places.value, pagePlace.value, chosen.value[view]);

/** Tap an area to narrow the view to it; tap it again to clear. */
export function toggleArea(view: AreaView, id: string): void {
  const next = { ...chosen.value };
  if (next[view] === id) delete next[view]; else next[view] = id;
  chosen.value = next;
}

/** Whether a step shows in the view under its area filter (the area's own and Anywhere; the Matrix: the area's own only); with no filter, always. */
export const showsInArea = (view: AreaView, tk: T): boolean => inArea(whereOf(tk), areaFilter(view), view === 'matrix');

/** The area a step is set to (its own place, else its project's), if it is set to one. */
export const areaOfStep = (tk: T): string | null => areaOf(places.value, whereOf(tk));
