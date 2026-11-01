// The area the lists are narrowed to (phase 4b): chosen in the place menu's View (src/app/store.ts `viewArea`), kept on the
// device. The rules are in src/domain/areas.ts and src/domain/view.ts.
import { places, viewArea } from './store';
import { areaOf, inArea } from '../domain/areas';
import { whereOf, type T } from './model';

/** The views the area narrows. The Matrix shows an area's own steps; the others add Anywhere's. */
export type AreaView = 'today' | 'matrix' | 'calendar';

/** The area the lists are narrowed to now, if the view is an area. */
export const areaFilter = (): string | null => viewArea.value;

/** Whether a step shows in the view under the area (the area's own and Anywhere; the Matrix: the area's own only); with no area, always. */
export const showsInArea = (view: AreaView, tk: T): boolean => inArea(whereOf(tk), viewArea.value, view === 'matrix');

/** The area a step is set to (its own place, else its project's), if it is set to one. */
export const areaOfStep = (tk: T): string | null => areaOf(places.value, whereOf(tk));
