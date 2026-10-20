// Test data for the agenda and the notification schedule: a small world with two places.
import type { Day, Decision, Place, Session, Stay, Task } from '../data/schema';
import { DEFAULT_SETTINGS } from '../data/settings';
import { newTaskFields } from './effects';
import { en } from '../i18n/en';
import type { NotifySettings, NotifyState, Translate } from './notify';

type WithId<T> = T & { id: string };

export const task = (id: string, o: Partial<Task> = {}): WithId<Task> => ({ ...newTaskFields(id, 'S', 'inbox', {}, new Map(), '2026-10-01T00:00:00.000Z', 1), id, ...o });
export const place = (id: string, timeZone: string): WithId<Place> => ({ id, name: id, timeZone, order: 0 });
export const stay = (id: string, placeId: string, from: string, to: string): WithId<Stay> => ({ id, placeId, from, to, note: '' });
export const day = (date: string, o: Partial<Day> = {}): WithId<Day> => ({ id: date, date, plan: [], launches: [], first: null, checkin: null, closed: null, summary: null, ...o });
export const decision = (id: string, o: Partial<Decision> = {}): WithId<Decision> => ({
  id, title: 'Decision ' + id, projectId: null, taskId: null, problem: { what: '', should: '', gap: '', constraints: '', deadline: '', control: '' },
  options: [], status: 'decided', listClosedAt: null, chosen: null, chosenId: null, why: '', mustBeTrue: '', falsifier: '', date: null, reviewOn: null,
  taskIds: [], newFacts: [], reviews: [], history: [], ...o,
});

/** The choir: Mondays at 19:00, leave 30 minutes before. */
export const choir = (o: Partial<Task> = {}) => task('choir', { title: 'Choir, Hill House 602', template: true, weekdays: [1], at: '19:00', lead: 30, dur: 90, ...o });

const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map(x => [x.id, x]));
export interface World {
  tasks?: WithId<Task>[]; days?: WithId<Day>[]; decisions?: WithId<Decision>[]; places?: WithId<Place>[]; stays?: WithId<Stay>[]; sessions?: WithId<Session>[];
}
export const state = (w: World = {}): NotifyState => ({
  tasks: byId(w.tasks ?? []), days: byId(w.days ?? []), decisions: byId(w.decisions ?? []),
  places: byId(w.places ?? [place('paris', 'Europe/Paris'), place('cairo', 'Africa/Cairo')]), stays: byId(w.stays ?? []), sessions: byId(w.sessions ?? []),
});
export const settings = (o: Partial<NotifySettings> = {}): NotifySettings => ({ ...DEFAULT_SETTINGS, here: 'paris', ...o });

/** The app's English words, filled in like `t` does. */
export const tr: Translate = (key, vars = {}) => (en[key] as string).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
export const iso = (ms: number) => new Date(ms).toISOString();
