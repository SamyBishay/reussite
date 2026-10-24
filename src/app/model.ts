// Read-side helpers, ported from v1. They read the signals, so views that call them re-render.
import { computed } from '@preact/signals';
import { tasks, sessions, projects, days, settings, today, pagePlace, here, decisions, places, stays, clockNow, addresses, people, type WithId } from './store';
import type { Task, Day, Session, Address, Person } from '../data/schema';
import { fit, predict, type Point, type Prediction } from '../domain/estimates';
import { isUrgent, type Quadrant } from '../domain/tasks';
import * as L from '../domain/lists';
import * as C from '../domain/chains';
import { minutesByTask, ratio as ratioOf } from '../domain/ratio';
import { addDays } from '../domain/dates';
import { agenda } from '../domain/agenda';
import { greeting } from '../domain/greeting';
import { offerAddresses, offerPeople, lastVisit } from '../domain/offers';
import { onPage } from '../domain/places';
import { en } from '../i18n/en';
import { t as tr, type Key } from '../i18n';

export type T = WithId<Task>;

export const T = (id: string): T | undefined => tasks.value.get(id);
// The rules themselves live in src/domain/lists.ts (the connector uses them too); these read the signals.
export const whereOf = (t: T): string => L.whereOf(t, projects.value);
/** On the page being viewed (or `place`): its own steps plus everything marked Anywhere. */
export const inPlace = (t: T, place = pagePlace.value) => L.inPlace(t, place, projects.value, places.value);
/** An open work step: not a standing obligation, not a fixed commitment. */
export const isOpen = (t: T | undefined): t is T => L.isOpen(t);
/** Obligations (standing, or a copy of one) never sit in the matrix or the planner's pool; their urgent and important flags are ignored. */
export const isObligation = (t: T): boolean => L.isObligation(t, tasks.value);
/** The chains of the open steps (src/domain/chains.ts), rebuilt once whenever the steps change. */
export const chains = computed(() => C.chainIndex(tasks.value));
/** A chain's head carries the earliest due date of its chain, so a far deadline turns the chain urgent in time. */
const withChainDue = (t: T): T => { const d = C.effectiveDue(chains.value, t.id, t.due); return d === (t.due ?? null) ? t : { ...t, due: d }; };
export const quad = (t: T): Quadrant => L.quadOf(withChainDue(t), today.value, settings.value.urgencyDays);
export const urgent = (t: T) => isUrgent(withChainDue(t), today.value, settings.value.urgencyDays);
/** The chain a step heads (with "+n after"), if it has one. */
export const chainOfHead = (id: string) => chains.value.chains.get(id);
/** A step that waits for another in a chain: shown inside its head's card, not on its own. */
export const isWaiting = (id: string) => C.isWaiting(chains.value, id);

export const listOf = L.listOf;
export const waitingOn = (t: T): T[] => L.waitingOn(t, tasks.value);
export const blocked = (t: T) => isWaiting(t.id);

export const dayDoc = (k: string): WithId<Day> | undefined => days.value.get(k);
export const rawPlan = (k: string): string[] => L.rawPlan(days.value, k);
export const planOf = (k: string) => L.planOf({ days: days.value, tasks: tasks.value }, k);
/** A day's cards: its list and its fixed-time items (src/domain/lists.ts). */
export const dayCards = (k: string) => L.dayCards({ days: days.value, tasks: tasks.value }, k);

export const spent = computed(() => minutesByTask(sessions.value.values()));
export const spentOf = (id: string) => spent.value.get(id) ?? 0;

export function cardsOn(k: string): T[] {
  const out = [...tasks.value.values()].filter(t => t.status === 'done' && !t.template && t.doneDay === k);
  return out.sort((a, b) => String(a.doneAt ?? '').localeCompare(String(b.doneAt ?? '')));
}
export function minutesOn(k: string): number {
  let m = 0;
  for (const s of sessions.value.values()) if (s.d === k) m += Number(s.m) || 0;
  return m;
}
export function minutesOnFor(k: string, taskId: string): number {
  let m = 0;
  for (const s of sessions.value.values()) if (s.d === k && s.taskId === taskId) m += Number(s.m) || 0;
  return m;
}
export const allCards = () => [...tasks.value.values()].filter(t => t.status === 'done' && !t.template).length;
export const ratio = computed(() => ratioOf(tasks.value.values(), spent.value));
export const running = (): T | undefined => [...tasks.value.values()].find(t => t.started && t.status === 'open');
export const elapsedSec = (t: T, now = Date.now()) => (t.started ? Math.max(0, (now - Date.parse(t.started)) / 1000) : 0);

const byOrder = L.byOrder;
export { byOrder };
export const byPriority = (a: T, b: T): number => L.byPriority(withChainDue(a), withChainDue(b), { today: today.value, urgencyDays: settings.value.urgencyDays, projects: projects.value });

export function candidates(k = today.value, place = pagePlace.value): T[] {
  const plan = new Set(rawPlan(k));
  return [...tasks.value.values()].filter(t => isOpen(t) && !isObligation(t) && inPlace(t, place) && !blocked(t) && !plan.has(t.id)).sort(byPriority);
}
export const sessionsOf = (id: string): WithId<Session>[] =>
  [...sessions.value.values()].filter(s => s.taskId === id).sort((a, b) => String(a.d + a.at).localeCompare(String(b.d + b.at)));

// ---------- personal estimates (brief §5) ----------
/** Data points: done steps with a frozen estimate and recorded time. "Didn't time it" has no sessions, so it's left out. */
export const estPoints = computed((): (Point & { id: string; title: string })[] => L.estPointsOf(tasks.value.values(), sessions.value.values()));
export const estModel = computed(() => fit(estPoints.value, today.value));
export const personal = (t: Pick<T, 'est' | 'app' | 'project' | 'suit' | 'estBy'>): Prediction | null =>
  predict(estModel.value, { est: t.est, app: t.app, project: t.project, suit: t.suit, estBy: t.estBy });
/** The estimate the planner uses: personal when there is one, else the person's own. */
export const planEst = (t: T) => personal(t)?.value ?? t.est ?? null;

/** The day a standing obligation was last played (its copies carry `from`). */
export function lastDoneOf(templateId: string): string | null {
  let last: string | null = null;
  for (const t of tasks.value.values()) if (t.from === templateId && t.status === 'done' && t.doneDay && (!last || t.doneDay > last)) last = t.doneDay;
  return last;
}
/** Fixed-time items on a day: commitments and timed steps due that day, and timed steps on its list with no due date. */
export const fixedOn = (k: string): T[] => L.fixedOn({ days: days.value, tasks: tasks.value }, k);
/** Decisions whose check date has come. */
export const decisionsToCheck = (k = today.value) => L.decisionsToCheck(decisions.value.values(), k);
export const hereNow = () => here.value;

export const yesterdayOpen = (k = today.value) => L.yesterdayOpen({ days: days.value, tasks: tasks.value }, k, addDays(k, -1));

/** Tomorrow's first step: the one chosen when the day was closed, else the first open step on its list. */
export function tomorrowFirst(k = today.value): { id: string; title: string } | null {
  const tk = addDays(k, 1);
  const chosen = T(dayDoc(tk)?.first?.id ?? '');
  const tt = isOpen(chosen) ? chosen : planOf(tk).map(id => T(id)).find(isOpen);
  return tt ? { id: tt.id, title: tt.title } : null;
}

/** What Home's greeting says now (src/domain/greeting.ts); follows the clock, so a fixed-time item takes over on time. */
export const greetingNow = computed(() => {
  const now = clockNow.value, k = today.value;
  const data = { tasks: tasks.value, days: days.value, decisions: decisions.value, places: places.value, stays: stays.value };
  const plan = planOf(k);
  return greeting({
    now, fixed: agenda(data, settings.value, addDays(k, -1), addDays(k, 1)).filter(e => e.kind === 'fixed'),
    running: running()?.id ?? null, closed: !!dayDoc(k)?.closed, planned: plan.length, next: plan.find(id => isOpen(T(id))) ?? null, tomorrow: tomorrowFirst(k),
  });
});

// ---------- addresses and people (phase 4) ----------
/** The module is on (Settings → Addresses & People). Off hides the screens and the offers; what is stored stays. */
export const addressesOn = () => settings.value.addressesPeople !== false;

/** A category's name: what the person typed, else the app's word for it in the current language, else its id. */
export function categoryName(id: string): string {
  const c = settings.value.addressCategories.find(x => x.id === id);
  if (c?.name.trim()) return c.name;
  const key = 'addressCat_' + id;
  return key in en ? tr(key as Key) : c?.id ?? id;
}
/** The categories in the person's order, with their names. A category an address still has but the list lost shows by its id. */
export const categories = (): { id: string; name: string }[] => settings.value.addressCategories.map(c => ({ id: c.id, name: categoryName(c.id) }));

export type A = WithId<Address>;
export type P = WithId<Person>;
export const addressById = (id: string | null | undefined): A | undefined => (id ? addresses.value.get(id) : undefined);
export const personById = (id: string | null | undefined): P | undefined => (id ? people.value.get(id) : undefined);
export const lastVisitOf = lastVisit;

/** Addresses on a place's page (its own plus Anywhere), by name. */
export const addressesIn = (place = pagePlace.value): A[] =>
  [...addresses.value.values()].filter(a => onPage(places.value, a.placeId, place)).sort((a, b) => a.name.localeCompare(b.name));
export const peopleIn = (place = pagePlace.value): P[] =>
  [...people.value.values()].filter(p => onPage(places.value, p.placeId, place)).sort((a, b) => a.name.localeCompare(b.name));

/** What the planner offers for a leisure obligation: up to three addresses in the current place (`place`), `category` narrowing them. */
export const offerAddressesNow = (category: string | null = null, place = here.value): A[] => (addressesOn() ? offerAddresses(addresses.value.values(), { place, category, places: places.value }) : []);
/** What the planner offers for a people obligation: up to three people in the current place, seen least recently first. */
export const offerPeopleNow = (place = here.value): P[] => (addressesOn() ? offerPeople(people.value.values(), { place, places: places.value }) : []);
