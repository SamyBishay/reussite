// What the planner offers when it places a leisure or a people obligation (brief §5, Addresses and people).
// Deterministic, never random: the same list gives the same three, so the person can trust what they see.
import { norm } from './names';
import type { Address, DayKey, Person, Visit } from '../data/schema';

export const MAX_OFFERS = 3;

type WithId<T> = T & { id: string };
type AddressLike = WithId<Pick<Address, 'name' | 'placeId' | 'category' | 'state' | 'visits'>>;
type PersonLike = WithId<Pick<Person, 'name' | 'placeId' | 'lastSeen'>>;

/** A place's page: its own entries plus everything marked Anywhere (the same rule as steps). */
export const inPlace = (placeId: string, place: string) => placeId === 'any' || placeId === place;

/** The most recent visit: the latest day, and among visits on one day the last one written. */
export function lastVisit(a: Pick<Address, 'visits'>): Visit | null {
  let last: Visit | null = null;
  for (const v of a.visits ?? []) if (!last || v.day >= last.day) last = v;
  return last;
}

/** The day of the latest visit, or '' when there is none (so "never" sorts before every date). */
export const lastVisitDay = (a: Pick<Address, 'visits'>): DayKey | '' => lastVisit(a)?.day ?? '';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a: { name: string; id: string }, b: { name: string; id: string }) => cmp(norm(a.name), norm(b.name)) || cmp(a.name, b.name) || cmp(a.id, b.id);

/**
 * Up to three addresses for a place (and a category, when the obligation names one): the ones the person said
 * *again* about first, then the ones they *want to go* to, the least recently visited first (never visited
 * before any date), ties by name and then id. An address whose last verdict is *not again* is never offered.
 * An address that was been to and left at *maybe*, or with no word, is not offered either: the person did not
 * ask to see it again.
 */
export function offerAddresses<A extends AddressLike>(all: Iterable<A>, o: { place: string; category?: string | null; max?: number }): A[] {
  const tiers: [A[], A[]] = [[], []];
  for (const a of all) {
    if (!inPlace(a.placeId, o.place) || (o.category && a.category !== o.category)) continue;
    const verdict = lastVisit(a)?.verdict;
    if (verdict === 'not-again') continue;
    if (verdict === 'again') tiers[0].push(a);
    else if (a.state === 'want') tiers[1].push(a);
  }
  const order = (x: A, y: A) => cmp(lastVisitDay(x), lastVisitDay(y)) || byName(x, y);
  return [...tiers[0].sort(order), ...tiers[1].sort(order)].slice(0, o.max ?? MAX_OFFERS);
}

/** Up to three people in a place, seen least recently first (never seen before any date), ties by name and then id. */
export function offerPeople<P extends PersonLike>(all: Iterable<P>, o: { place: string; max?: number }): P[] {
  return [...all]
    .filter(p => inPlace(p.placeId, o.place))
    .sort((x, y) => cmp(x.lastSeen ?? '', y.lastSeen ?? '') || byName(x, y))
    .slice(0, o.max ?? MAX_OFFERS);
}

/**
 * The address whose visit note to ask for when a step is done: the one the step feeds, if it is still on the
 * list and no visit already came from this step. Null otherwise.
 */
export function visitPromptFor(step: { id: string; addressId?: string | null }, addresses: ReadonlyMap<string, Pick<Address, 'visits'>>): string | null {
  const a = step.addressId ? addresses.get(step.addressId) : undefined;
  if (!a || a.visits.some(v => v.stepId === step.id)) return null;
  return step.addressId!;
}

/** A person's last-seen date after a step that feeds them was done on `day`: never moves back to an earlier day. */
export const seenAfter = (lastSeen: DayKey | null | undefined, day: DayKey): DayKey => (lastSeen && lastSeen > day ? lastSeen : day);
