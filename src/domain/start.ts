// The simple start (2026-11-15): a new install begins with Home and Today, and the app grows as the person uses it. Pure rules, no I/O;
// `src/app/simpleStart.ts` reads the stores and writes what these say. An install from before this change never stored `simpleSince`, so
// every rule here reads it as "everything on": its tabs, places, trips, addresses and people and its weekly review stay as they were.
import { addDays, type DayKey } from './dates';

/** The tabs that arrive. Home and Today are always there. */
export type GrowTab = 'calendar' | 'projects' | 'matrix';
export const GROW_TABS: GrowTab[] = ['calendar', 'projects', 'matrix'];
export type TabsShown = Record<GrowTab, boolean>;
export const ALL_TABS: TabsShown = { calendar: true, projects: true, matrix: true };
export const NO_TABS: TabsShown = { calendar: false, projects: false, matrix: false };

/** Projects arrives at this many cards (or with the first project); the Matrix at this many open cards (or with the first weekly review). */
export const PROJECTS_AT = 8;
export const MATRIX_AT = 12;
/** The weekly review waits until the deck is this many days old and holds this many cards. */
export const REVIEW_DAYS = 7;
export const REVIEW_CARDS = 10;

/** What the rules look at, counted from the deck (`factsOf`). */
export interface DeckFacts {
  /** Cards in the deck, open or played: not standing items, events, dropped cards or the ritual's own "Deal the day" card. */
  cards: number;
  /** Of those, the ones still open. */
  open: number;
  /** A card or a standing item with a fixed time (`at`). */
  fixed: boolean;
  /** Projects other than the Inbox. */
  projects: number;
  /** A weekly review has been done (a day carries `review`). */
  reviewed: boolean;
}

interface TaskLike { status?: string; template?: boolean; kind?: string; at?: string | null; src?: string; created?: string }

export function factsOf(tasks: Iterable<TaskLike>, projects: Iterable<{ id: string }>, days: Iterable<{ review?: string | null }>): DeckFacts {
  let cards = 0, open = 0, fixed = false, n = 0, reviewed = false;
  for (const t of tasks) {
    if (t.kind === 'event') continue;
    if (t.at && t.status !== 'dropped') fixed = true;
    if (t.template || t.status === 'dropped' || t.src === 'plan') continue;
    cards++;
    if (t.status === 'open') open++;
  }
  for (const p of projects) if (p.id !== 'inbox') n++;
  for (const d of days) if (d.review) { reviewed = true; break; }
  return { cards, open, fixed, projects: n, reviewed };
}

/** Has the deck earned this tab? */
export function tabEarned(tab: GrowTab, f: DeckFacts): boolean {
  if (tab === 'calendar') return f.fixed;
  if (tab === 'projects') return f.projects > 0 || f.cards >= PROJECTS_AT;
  return f.open >= MATRIX_AT || f.reviewed;
}

/** A tab shows once it has been shown (the stored record) or as soon as the deck earns it. A tab that has appeared never goes. */
export const tabShown = (tab: GrowTab, shown: TabsShown, f: DeckFacts): boolean => shown[tab] !== false || tabEarned(tab, f);

/** The tabs the deck has just earned: to record (so they stay) and to announce once. */
export const tabsToOpen = (shown: TabsShown, f: DeckFacts): GrowTab[] => GROW_TABS.filter(x => shown[x] === false && tabEarned(x, f));

/**
 * A switch that is off for a new install (Places and trips, Addresses and people): on when the person turned it on, and, on a new install,
 * also as soon as such data exists (from sync, an import, the connector). On an install from before, the switch alone decides, as it always did.
 */
export const featureOn = (on: boolean, since: string, hasData: boolean): boolean => on !== false || (!!since && hasData);

/** Before the deck is `REVIEW_DAYS` old and holds `REVIEW_CARDS` cards, a new install has no weekly review: no box, no nudge, no push. Once done, it never waits again. */
export function reviewWaits(since: string, day: DayKey, f: Pick<DeckFacts, 'cards' | 'reviewed'>): boolean {
  if (!since || f.reviewed) return false;
  return day < addDays(since.slice(0, 10), REVIEW_DAYS) || f.cards < REVIEW_CARDS;
}

/**
 * The deck holds something made before this install's set-up (`since`, an ISO time): a backup or an export was restored into it, or it joined
 * an existing deck by sync. Such a deck is not a new one, and gets everything on.
 */
export function fromBefore(since: string, created: Iterable<string | null | undefined>): boolean {
  if (!since) return false;
  for (const c of created) if (typeof c === 'string' && c && c < since) return true;
  return false;
}
