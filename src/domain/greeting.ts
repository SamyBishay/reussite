// What Home's greeting says (brief §5, "Home and the tab bar"): only the next step, with three
// things that change it. A fixed-time item takes over from `lead` minutes before it until it is
// over; a day with no list shows Plan the day; a closed day shows tomorrow's first step. No counts,
// no list, no streaks. Pure: the app (src/app/model.ts) gathers the data.
import type { AgendaEvent } from './agenda';
import { shiftTime } from './calendar';

const MIN = 60_000;
/** How long a fixed-time item with no length of its own keeps the greeting. */
export const DEFAULT_DURATION = 30;

export interface GreetingInput {
  /** Epoch milliseconds. */
  now: number;
  /** The agenda's fixed-time events around today (yesterday to tomorrow, for the day-start rule); done and dropped ones are not in it. */
  fixed: readonly AgendaEvent[];
  /** The step whose timer is running. */
  running: string | null;
  /** Today's list was closed. */
  closed: boolean;
  /** How many steps today's list holds. */
  planned: number;
  /** The first open step on today's list. */
  next: string | null;
  /** Tomorrow's first step; `id` is null when tomorrow has none yet. */
  tomorrow: { id: string; title: string } | null;
}

export type Greeting =
  /** A fixed-time item is close (or going on): its line and when to leave. */
  | { kind: 'fixed'; event: AgendaEvent; leave: string }
  | { kind: 'running'; id: string }
  /** The day is closed: tomorrow's first step, or none chosen yet. */
  | { kind: 'tomorrow'; step: { id: string; title: string } | null }
  | { kind: 'next'; id: string }
  /** No list for today yet. */
  | { kind: 'plan' }
  /** There is a list and nothing on it is left to start. */
  | { kind: 'allDone' };

/** The fixed-time event that has the greeting at `now`, if any: from `at - lead` until `at + dur` (30 minutes without one). The earliest wins. */
export function fixedNow(fixed: readonly AgendaEvent[], now: number): AgendaEvent | null {
  let best: AgendaEvent | null = null;
  for (const e of fixed) {
    if (e.kind !== 'fixed') continue;
    const from = e.at - (e.lead ?? 0) * MIN, to = e.at + (e.dur && e.dur > 0 ? e.dur : DEFAULT_DURATION) * MIN;
    if (now >= from && now < to && (!best || e.at < best.at)) best = e;
  }
  return best;
}

/**
 * The one "Start here" card, shared by Home's greeting and Today: from the day's cards (waiting steps already
 * left out) the running step if one is on the list, else the first open one. `planned` counts the cards.
 */
export function startHere(cards: readonly string[], isOpen: (id: string) => boolean, isRunning: (id: string) => boolean): { id: string | null; running: boolean; planned: number } {
  const open = cards.filter(isOpen);
  const run = open.find(isRunning);
  const id = run ?? open[0] ?? null;
  return { id, running: !!run, planned: cards.length };
}

export function greeting(i: GreetingInput): Greeting {
  const e = fixedNow(i.fixed, i.now);
  if (e) return { kind: 'fixed', event: e, leave: shiftTime(e.time, -(e.lead ?? 0)) };
  if (i.running) return { kind: 'running', id: i.running };
  if (i.closed) return { kind: 'tomorrow', step: i.tomorrow };
  if (i.next) return { kind: 'next', id: i.next };
  return i.planned ? { kind: 'allDone' } : { kind: 'plan' };
}
