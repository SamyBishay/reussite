// Shared by the sheets: names of places and areas, the rank of a pile, the banner for the biggest moments, and the registry the guided flows fill (it keeps imports one-way).
import { signal } from '@preact/signals';
import { places } from './store';
import { t } from '../i18n';
import { placePath, placeRows } from '../domain/areas';

const rankOf = (n: number) => (n <= 0 ? '' : n <= 13 ? ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][n]! : 'K+');
export { rankOf };

/** A place's name; an area's as "Cairo › Heliopolis". */
export const placeName = (id: string) => (id === 'any' ? t('anywhere') : placePath(places.value, id));
/** An area's own name, for a heading or a tag next to its place. */
export const areaName = (id: string) => places.value.get(id)?.name ?? id;
/** Every place and area, a place followed by its areas (the order of a select). */
export const placeIds = () => placeRows(places.value).map(r => r.id);
export const hm = (d: Date) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

/** A short-lived banner for the biggest moments (a finished project, a decision made). */
export const moment = signal<{ kind: 'project' | 'decision'; name: string } | null>(null);
let momentTimer = 0;
export function showMoment(kind: 'project' | 'decision', name: string) {
  moment.value = { kind, name };
  clearTimeout(momentTimer);
  momentTimer = window.setTimeout(() => (moment.value = null), 2600);
}

/** Flows open from sheets; they register here to keep imports one-way. */
export const flows = {
  breakDown: (_id: string) => {},
  decide: (_decisionId: string | null, _link?: { taskId?: string; projectId?: string }) => {},
  stuck: (_id?: string) => {},
  /** The after-visit screen (Addresses and people). */
  visit: (_addressId: string, _o: { stepId: string; day: string }) => {},
};
