// Read-side helpers, ported from v1. They read the signals, so views that call them re-render.
import { computed } from '@preact/signals';
import { tasks, sessions, projects, days, settings, today, pagePlace, viewAll, here, hereZone, decisions, places, stays, clockNow, addresses, people, type WithId } from './store';
import type { Task, Day, Session, Address, Person, Slot } from '../data/schema';
import { dueState, slotState, slotsFor, eventMissed as eventMissedAt, type DueState, type SlotState } from '../domain/slots';
import { fit, predict, type Point, type Prediction } from '../domain/estimates';
import type { Quadrant } from '../domain/tasks';
import * as L from '../domain/lists';
import * as C from '../domain/chains';
import { minutesByTask, ratio as ratioOf } from '../domain/ratio';
import { nudgesDue, waitingList } from '../domain/events';
import { addDays } from '../domain/dates';
import { fixedOnDay } from '../domain/agenda';
import { greeting, type LineInput } from '../domain/greeting';
import { dayOrder, type DayOrder, type FixedItem } from '../domain/dayOrder';
import { proposeDay, loadOf, type Proposal, type PropStep } from '../domain/propose';
import { atOnDay, placeOfDay, wallOf } from '../domain/zone';
import { offerAddresses, offerPeople, lastVisit } from '../domain/offers';
import { onPage, zoneOfPlace } from '../domain/places';
import { showsInArea } from './areas';
import { en } from '../i18n/en';
import { t as tr, type Key } from '../i18n';
import { outcomeOf, progressOf } from '../domain/goal';

export type T = WithId<Task>;

export const T = (id: string): T | undefined => tasks.value.get(id);
// The rules themselves live in src/domain/lists.ts (the connector uses them too); these read the signals.
export const whereOf = (t: T): string => L.whereOf(t, projects.value);
/** On the page being viewed (or `place`): its own steps plus everything marked Anywhere. With the view on Everywhere and no `place`, every step is. */
export const inPlace = (t: T, place?: string) => (place === undefined ? viewAll.value || L.inPlace(t, pagePlace.value, projects.value, places.value) : L.inPlace(t, place, projects.value, places.value));
/** An open work step: not a standing obligation, not a fixed commitment, not an event the person waits for. */
export const isOpen = (t: T | undefined): t is T => L.isOpen(t);
/** Something the person waits for (schema 6, src/domain/events.ts): dormant, and out of every list of work. */
export const isEvent = (t: Pick<T, 'kind'> | undefined): boolean => L.isEvent(t);
/** Obligations (standing, or a copy of one) never sit in the matrix or the planner's pool; their urgent and important flags are ignored. */
export const isObligation = (t: T): boolean => L.isObligation(t, tasks.value);
/** The chains of the open steps (src/domain/chains.ts), rebuilt once whenever the steps change. */
export const chains = computed(() => C.chainIndex(tasks.value));
/** A chain's head carries the earliest due date of its chain, so the chain is ordered by its nearest deadline (the quadrant is the ticks only). */
const withChainDue = (t: T): T => { const d = C.effectiveDue(chains.value, t.id, t.due); return d === (t.due ?? null) ? t : { ...t, due: d }; };
/** The box a step is in: its two ticks, nothing else. */
export const quad = (t: T): Quadrant => L.quadOf(t);
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
/** The time already logged on a card, in seconds (every session of every run). */
export const loggedSec = (id: string): number => spentOf(id) * 60;
/** A card with logged time is continued, never started. */
export const hasLogged = (id: string): boolean => spentOf(id) > 0;
/** What a running timer shows: the card's logged total plus this run. Each run is still saved as its own session. */
export const shownSec = (t: T, now = Date.now()): number => loggedSec(t.id) + elapsedSec(t, now);
/** `started` moved back by the logged total, for the day's order: the time left in the estimate counts what is already done. */
const startedWithLogged = (t: T): string => (t.started && hasLogged(t.id) ? new Date(Date.parse(t.started) - loggedSec(t.id) * 1000).toISOString() : t.started!);

const byOrder = L.byOrder;
export { byOrder };
/** A project's open steps that can move its goal, in the project's own order: not a standing step, not something the person waits for (the Sunday review's "Moves the goal?"). */
export const goalSteps = (projectId: string): T[] => [...tasks.value.values()].filter(x => x.project === projectId && x.status === 'open' && !x.template && !L.isEvent(x)).sort(byOrder);
export const byPriority = (a: T, b: T): number => L.byPriority(withChainDue(a), withChainDue(b), { projects: projects.value });

export function candidates(k = today.value, place?: string): T[] {
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

/**
 * Yesterday's open steps to decide one at a time (Today / Another day / Drop it / Make it a decision): those still open and on no
 * later list, but not the fixed-time items whose time has passed, which are asked on their own (Move / Remove, `missedOn`).
 */
export const carriedOn = (k = today.value): string[] => {
  const missed = new Set(missedOn(addDays(k, -1)));
  return yesterdayOpen(k).filter(id => !missed.has(id) && isOpen(T(id)));
};

/**
 * The fixed-time items of a day whose time has passed and that are not done (`missed` of src/domain/dayOrder.ts), whatever the area
 * chip says: a call that was not made is not an area's business. Standing items not placed on the day are never missed; for a past
 * day it is everything of its that was not done, for a future day nothing.
 */
export function missedOn(k: string = today.value): string[] {
  const s = settings.value, zone = dayZone(k);
  const data = { tasks: tasks.value, days: days.value, decisions: decisions.value, places: places.value, stays: stays.value };
  const fixed: FixedItem[] = fixedOnDay(data, s, k).filter(e => e.taskId && T(e.taskId))
    .map(e => ({ id: e.taskId!, at: e.at, dur: e.dur, lead: e.lead, standing: !!e.template }));
  if (!fixed.length) return [];
  const floor = atOnDay(k, s.dayStart, s.dayStart, zone), rid = fixed.find(f => T(f.id)?.started);
  return dayOrder({
    now: clockNow.value, floor, end: floor + 48 * 3_600_000, cards: [], est: () => null, fixed,
    running: rid ? { id: rid.id, started: startedWithLogged(T(rid.id)!) } : null,
  }).missed.filter(id => T(id)?.status === 'open');
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
    cards, est: id => planEst(T(id)!), fixed, running: rid ? { id: rid, started: startedWithLogged(T(rid)!) } : null, optional: new Set(dayDoc(k)?.optional ?? []),
  });
}

/**
 * Plan my day's slots for a day: one per open planned step, at the start and for the length the day's one order gives it (`slotsFor`,
 * src/domain/slots.ts). Fixed-time items are not slots, and a step the day has no room left for gets none.
 */
export function slotsOfDay(k: string = today.value): Map<string, Slot> {
  const s = settings.value, zone = dayZone(k), shape = dayDoc(k)?.shape;
  return slotsFor(dayOrderOf(k), k, atOnDay(k, shape?.end || s.dayEnd, s.dayStart, zone), zone);
}

/**
 * The morning's proposal for a day (src/domain/propose.ts) from the list as it stands, and the suit and project of every step it names
 * (what the AI's reply is read against). The day is laid out from now (or its start) to the end of the day, around its fixed-time items.
 */
export function proposalFor(k: string = today.value): { proposal: Proposal; known: Map<string, { suit: Task['suit']; project: string }>; loadFor: (ids: string[], extra?: Record<string, number | null>) => Proposal['load'] } {
  const s = settings.value;
  const zone = dayZone(k), place = here.value;
  const data = { tasks: tasks.value, days: days.value, decisions: decisions.value, places: places.value, stays: stays.value };
  const events = fixedOnDay(data, s, k).filter(e => e.taskId && T(e.taskId)).sort((a, b) => a.at - b.at);
  const fixed: FixedItem[] = events.map(e => ({ id: e.taskId!, at: e.at, dur: e.dur, lead: e.lead, standing: !!e.template }));
  const timed = new Set(events.map(e => e.taskId!));
  const onList = new Set(rawPlan(k));
  const steps: PropStep[] = [...tasks.value.values()]
    // Not a standing item, a fixed-time one (those are the first section's) or a step the person put on a later day.
    .filter(x => isOpen(x) && !isObligation(x) && !x.at && !timed.has(x.id) && !((L.ownerDay(data, x.id) ?? k) > k))
    .map(x => ({
      id: x.id, suit: x.suit, project: x.project, quad: quad(x), due: x.due, blocked: blocked(x), order: x.order || 0, onList: onList.has(x.id),
      atPlace: inPlace(x, place), specific: whereOf(x) !== 'any' && inPlace(x, place),
    }));
  const floor = atOnDay(k, s.dayStart, s.dayStart, zone), shape = dayDoc(k)?.shape;
  const layout = {
    now: k === today.value ? Math.max(clockNow.value, floor) : floor, floor: shape?.start ? Math.max(floor, atOnDay(k, shape.start, s.dayStart, zone)) : floor,
    end: atOnDay(k, shape?.end || s.dayEnd, s.dayStart, zone), est: (id: string) => { const x = T(id); return x ? planEst(x) : null; }, fixed,
  };
  const checks = nudges.value.map(x => x.id);
  const carried = carriedOn(k);
  const proposal = proposeDay({
    today: k, steps, fixed: events.map(e => e.taskId!), checks, carried, layout,
    projects: [...projects.value.values()].map(p => ({ id: p.id, status: p.status, due: p.due, order: p.order || 0, hasGoal: !!outcomeOf(p) })),
  });
  const known = new Map<string, { suit: Task['suit']; project: string }>();
  for (const id of [...steps.map(x => x.id), ...timed, ...checks, ...carried]) { const x = T(id); if (x) known.set(id, { suit: x.suit, project: x.project }); }
  return { proposal, known, loadFor: (ids, extra = {}) => loadOf({ ...layout, est: id => (id in extra ? extra[id] : layout.est(id)) }, ids) };
}

/** The zone a day's clock is read in (its stay's place, else the one chosen by hand). */
export const dayZone = (k: string): string | undefined => placeOfDay(k, stays.value.values(), settings.value.here, id => zoneOfPlace(places.value, id)).timeZone;

/** The instant of a clock time (HH:MM) on a day, by the day-start rule and the day's zone. */
export const timeOnDay = (k: string, hhmm: string): number => atOnDay(k, hhmm, settings.value.dayStart, dayZone(k));

/** The card Home shows under its line now, or none (src/domain/greeting.ts): Plan the day, or Close the day. Start here is Today's alone. */
export const greetingNow = computed(() => {
  const k = today.value, o = dayOrderOf(k), first = o.order[0];
  // A fixed-time item whose time has passed is not a card played, nor one still to play: a day with only those has no list yet.
  const planned = dayCards(k).filter(id => !o.missed.includes(id) && !isWaiting(id) && showsInArea('today', T(id)!)).length;
  return greeting({
    closed: !!dayDoc(k)?.closed, planned, running: !!running(), hasFirst: !!first,
  });
});

/** A step's title in a sentence: cut at a word within 40 characters. */
const nameOf = (x: Pick<T, 'title'>): string => {
  const s = x.title.trim();
  if (s.length <= 40) return s;
  const cut = s.slice(0, 39), i = cut.lastIndexOf(' ');
  return (i > 20 ? cut.slice(0, i) : cut).trimEnd() + '…';
};

/** The clock reading where the person is, HH:MM (the signal moves with the clock, so what reads it re-renders). */
export const clockHHMM = (): string => wallOf(clockNow.value, hereZone.value);
/** Where a deadline stands today (src/domain/slots.ts): ahead, today, passed (today, its time gone) or carried (an earlier day). */
export const dueStateOf = (due: string, dueAt?: string | null, k: string = today.value): DueState => dueState(due, dueAt, k, clockHHMM(), settings.value.dayStart);
/** Is this step an event whose time has passed and that is not done? (Its day is its due date, else the list it is on.) */
export const eventMissed = (tk: Task & { id: string }): boolean =>
  tk.status === 'open' && !!tk.at && eventMissedAt(tk.due ?? L.ownerDay({ days: days.value, tasks: tasks.value }, tk.id), tk.at, tk.dur, today.value, clockHHMM(), settings.value.dayStart);
/** Where a step's slot stands against the clock: ahead, now or passed. */
export const slotStateOf = (s: Slot, k: string = today.value): SlotState => slotState(s, k, clockHHMM(), settings.value.dayStart);

/** What the greeting's line needs (src/domain/greeting.ts): the hour where the person is, for the greetings that belong to it. */
export function lineInputNow(): LineInput {
  return { clock: wallOf(clockNow.value, hereZone.value), dayStart: settings.value.dayStart };
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

/** Addresses on a place's page (its own plus Anywhere), by name; with the view on Everywhere and no `place`, all of them. */
export const addressesIn = (place?: string): A[] =>
  [...addresses.value.values()].filter(a => (place === undefined ? viewAll.value || onPage(places.value, a.placeId, pagePlace.value) : onPage(places.value, a.placeId, place))).sort((a, b) => a.name.localeCompare(b.name));
export const peopleIn = (place?: string): P[] =>
  [...people.value.values()].filter(p => (place === undefined ? viewAll.value || onPage(places.value, p.placeId, pagePlace.value) : onPage(places.value, p.placeId, place))).sort((a, b) => a.name.localeCompare(b.name));

/** What the planner offers for a leisure obligation: up to three addresses in the current place (`place`), `category` narrowing them. */
export const offerAddressesNow = (category: string | null = null, place = here.value): A[] => (addressesOn() ? offerAddresses(addresses.value.values(), { place, category, places: places.value }) : []);
/** What the planner offers for a people obligation: up to three people in the current place, seen least recently first. */
export const offerPeopleNow = (place = here.value): P[] => (addressesOn() ? offerPeople(people.value.values(), { place, places: places.value }) : []);
