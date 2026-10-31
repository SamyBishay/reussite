// Read-side helpers, ported from v1. They read the signals, so views that call them re-render.
import { computed } from '@preact/signals';
import { tasks, sessions, projects, days, settings, today, pagePlace, here, hereZone, decisions, places, stays, clockNow, addresses, people, type WithId } from './store';
import type { Task, Day, Session, Address, Person } from '../data/schema';
import { fit, predict, type Point, type Prediction } from '../domain/estimates';
import { isUrgent, type Quadrant } from '../domain/tasks';
import * as L from '../domain/lists';
import * as C from '../domain/chains';
import { minutesByTask, ratio as ratioOf } from '../domain/ratio';
import { nudgesDue, waitingList } from '../domain/events';
import { addDays } from '../domain/dates';
import { fixedOnDay } from '../domain/agenda';
import { greeting, nearGoal, type LineInput } from '../domain/greeting';
import { dayOrder, type DayOrder, type FixedItem } from '../domain/dayOrder';
import { atOnDay, placeOfDay, wallOf } from '../domain/zone';
import { offerAddresses, offerPeople, lastVisit } from '../domain/offers';
import { onPage, zoneOfPlace } from '../domain/places';
import { showsInArea } from './areas';
import { en } from '../i18n/en';
import { t as tr, type Key } from '../i18n';

export type T = WithId<Task>;

export const T = (id: string): T | undefined => tasks.value.get(id);
// The rules themselves live in src/domain/lists.ts (the connector uses them too); these read the signals.
export const whereOf = (t: T): string => L.whereOf(t, projects.value);
/** On the page being viewed (or `place`): its own steps plus everything marked Anywhere. */
export const inPlace = (t: T, place = pagePlace.value) => L.inPlace(t, place, projects.value, places.value);
/** An open work step: not a standing obligation, not a fixed commitment, not an event the person waits for. */
export const isOpen = (t: T | undefined): t is T => L.isOpen(t);
/** Something the person waits for (schema 6, src/domain/events.ts): dormant, and out of every list of work. */
export const isEvent = (t: Pick<T, 'kind'> | undefined): boolean => L.isEvent(t);
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
  const out = [...tasks.value.values()].filter(t => t.status === 'done' && !t.template && !isEvent(t) && t.doneDay === k);
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
export const allCards = () => [...tasks.value.values()].filter(t => t.status === 'done' && !t.template && !isEvent(t)).length;
export const ratio = computed(() => ratioOf(tasks.value.values(), spent.value));
export const running = (): T | undefined => [...tasks.value.values()].find(t => t.started && t.status === 'open' && !isEvent(t));
export const elapsedSec = (t: T, now = Date.now()) => (t.started ? Math.max(0, (now - Date.parse(t.started)) / 1000) : 0);

const byOrder = L.byOrder;
export { byOrder };
export const byPriority = (a: T, b: T): number => L.byPriority(withChainDue(a), withChainDue(b), { today: today.value, urgencyDays: settings.value.urgencyDays, projects: projects.value });

export function candidates(k = today.value, place = pagePlace.value): T[] {
  const plan = new Set(rawPlan(k));
  return [...tasks.value.values()].filter(t => isOpen(t) && !isObligation(t) && inPlace(t, place) && !blocked(t) && !plan.has(t.id)).sort(byPriority);
}
/** Events to ask about today (their nudge day has come), and every open event with what it holds back (src/domain/events.ts). */
export const nudges = computed(() => nudgesDue(tasks.value.values(), today.value));
export const waiting = computed(() => waitingList(tasks.value.values(), today.value));
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

/**
 * The one order of a day (src/domain/dayOrder.ts), for Home's Start here, Today's card and list and the next-step bar: the day's open
 * cards, without the steps that wait for another, within Today's area filter, with its fixed-time items (standing ones not yet placed
 * too) laid out against the clock. Follows the clock for today; another day is laid out from its start. Its first item is Start here.
 */
export function dayOrderOf(k: string = today.value): DayOrder {
  const s = settings.value;
  const zone = dayZone(k);
  const data = { tasks: tasks.value, days: days.value, decisions: decisions.value, places: places.value, stays: stays.value };
  const events = fixedOnDay(data, s, k).filter(e => e.taskId && T(e.taskId));
  const timed = new Set(events.map(e => e.taskId!));
  const fixed: FixedItem[] = events.filter(e => showsInArea('today', T(e.taskId!)!))
    .map(e => ({ id: e.taskId!, at: e.at, dur: e.dur, lead: e.lead, standing: !!e.template }));
  const cards = dayCards(k).filter(id => !timed.has(id) && !isWaiting(id) && isOpen(T(id)) && showsInArea('today', T(id)!));
  const rid = [...fixed.map(f => f.id), ...cards].find(id => T(id)?.started);
  // The morning's shape: nothing is placed before the start it chose, and the day ends when it said (else at the setting's `dayEnd`).
  const shape = dayDoc(k)?.shape, floor = atOnDay(k, s.dayStart, s.dayStart, zone);
  const start = shape?.start ? Math.max(floor, atOnDay(k, shape.start, s.dayStart, zone)) : floor;
  return dayOrder({
    now: k === today.value ? Math.max(clockNow.value, floor) : floor, floor: start, end: atOnDay(k, shape?.end || s.dayEnd, s.dayStart, zone),
    cards, est: id => planEst(T(id)!), fixed, running: rid ? { id: rid, started: T(rid)!.started! } : null, optional: new Set(dayDoc(k)?.optional ?? []),
  });
}

/** The zone a day's clock is read in (its stay's place, else the one chosen by hand). */
export const dayZone = (k: string): string | undefined => placeOfDay(k, stays.value.values(), settings.value.here, id => zoneOfPlace(places.value, id)).timeZone;

/** The instant of a clock time (HH:MM) on a day, by the day-start rule and the day's zone. */
export const timeOnDay = (k: string, hhmm: string): number => atOnDay(k, hhmm, settings.value.dayStart, dayZone(k));

/** What Home's greeting card says now (src/domain/greeting.ts): the first item of the day's order, so a fixed-time item takes over on time. */
export const greetingNow = computed(() => {
  const k = today.value, o = dayOrderOf(k), first = o.order[0];
  // A fixed-time item whose time has passed is not a card played, nor one still to play: a day with only those has no list yet.
  const planned = dayCards(k).filter(id => !o.missed.includes(id) && !isWaiting(id) && showsInArea('today', T(id)!)).length;
  return greeting({
    closed: !!dayDoc(k)?.closed, planned, tomorrow: tomorrowFirst(k),
    first: first ? { id: first.id, kind: first.kind, running: !!T(first.id)?.started } : null,
  });
});

/** The first item of today's order when it is a fixed-time item: its time, when to leave, and its step. */
export function fixedFirst(): { id: string; time: string; leave: string } | null {
  const f = dayOrderOf(today.value).order[0];
  if (!f || f.kind !== 'fixed' || !T(f.id)) return null;
  const zone = hereZone.value;
  return { id: f.id, time: wallOf(f.at!, zone), leave: wallOf(f.start, zone) };
}

/** A step's title in a sentence: cut at a word within 40 characters. */
const nameOf = (x: Pick<T, 'title'>): string => {
  const s = x.title.trim();
  if (s.length <= 40) return s;
  const cut = s.slice(0, 39), i = cut.lastIndexOf(' ');
  return (i > 20 ? cut.slice(0, i) : cut).trimEnd() + '…';
};

/** What the greeting's line can say now (src/domain/greeting.ts): the real data its templates are filled with. */
export function lineInputNow(): LineInput {
  const k = today.value, zone = hereZone.value;
  const order = dayOrderOf(k).order;
  const next = order.find(x => x.kind === 'fixed' && !T(x.id)?.started && x.at! > clockNow.value);
  const counts = new Map<string, { open: number; done: number }>();
  for (const x of tasks.value.values()) {
    if (x.template || isEvent(x) || !projects.value.get(x.project)) continue;
    const c = counts.get(x.project) ?? { open: 0, done: 0 };
    if (x.status === 'done') c.done++; else if (x.status === 'open') c.open++;
    counts.set(x.project, c);
  }
  const near = [...projects.value.values()].filter(p => p.status === 'active').map(p => ({ name: p.name, order: p.order, ...(counts.get(p.id) ?? { open: 0, done: 0 }) }));
  return {
    clock: wallOf(clockNow.value, zone), dayStart: settings.value.dayStart,
    fixed: next ? { time: wallOf(next.at!, zone), title: nameOf(T(next.id)!) } : null,
    project: nearGoal(near), doneToday: cardsOn(k).length,
    planned: order.filter(x => x.kind === 'step').length, running: !!running(),
  };
}

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
