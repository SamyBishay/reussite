// What Home says (plan 2 Nov, "The greeting"; plain since the owner's 1 Nov feedback). Two things, both pure; the app (src/app/model.ts) gathers the data.
//
// 1. The card under the line (`greeting`): Plan the day when there is no list yet, or Close the day when every card on the list is played.
//    Nothing else: Start here, the running step and tomorrow's first step live on Today alone (DECISIONS.md), and Home shows no card
//    while a step runs, a plan is open or the day is closed.
// 2. The line above it (`eligibleLines`, `pickGreeting`): one plain, warm sentence chosen from templates (src/i18n) and filled with real
//    data. It never asks for anything: no "type", no "add, move or tick off". A kind is eligible only when its data exists. A template
//    is not repeated within a day while another is eligible. No counts of what was missed or carried, no streaks, and it works
//    without an AI: the template stays with an AI on.

export interface GreetingInput {
  /** Today's list was closed. */
  closed: boolean;
  /** How many steps today's list holds. */
  planned: number;
  /** A timer is running (a step, or a fixed-time item being timed). */
  running: boolean;
  /** The day's order has something to start (a step, or a fixed-time item that has taken over). */
  hasFirst: boolean;
}

export type Greeting =
  /** No list for today yet. */
  | { kind: 'plan' }
  /** There is a list and nothing on it is left to start. */
  | { kind: 'allDone' };

/** The card under the line, or none: nothing shows while a step runs, a plan is open (something is left to start) or the day is closed. */
export function greeting(i: GreetingInput): Greeting | null {
  if (i.closed || i.running) return null;
  if (!i.planned) return { kind: 'plan' };
  return i.hasFirst ? null : { kind: 'allDone' };
}

// ---------- the line ----------
/** The templates, by kind: i18n keys, each a short warm sentence that asks for nothing. */
export const GREETING_KEYS = {
  fixed: ['greetFixed1', 'greetFixed2', 'greetFixed3'],
  project: ['greetProject1', 'greetProject2', 'greetProject3'],
  morning: ['greetMorning1', 'greetMorning2'],
  afternoon: ['greetAfternoon1', 'greetAfternoon2'],
  evening: ['greetEvening1', 'greetEvening2'],
  done: ['greetDone1', 'greetDone2', 'greetDone3'],
  planned: ['greetPlanned1', 'greetPlanned2', 'greetPlanned3'],
} as const;
export type GreetingKey = (typeof GREETING_KEYS)[keyof typeof GREETING_KEYS][number];

export interface LineInput {
  /** The clock now where the person is (HH:MM), and the day-start rule. */
  clock: string;
  dayStart: string;
  /** The next fixed-time item still ahead today (not one that has passed). */
  fixed: { time: string; title: string } | null;
  /** A project close to its goal. */
  project: { name: string } | null;
  /** Steps done today (done only). */
  doneToday: number;
  /** Steps on today's list still open. */
  planned: number;
  /** A timer is running. */
  running: boolean;
}

export interface GreetingLine { key: GreetingKey; slots: Record<string, string | number> }

/** morning until noon, afternoon until six, evening after; the small hours before the day starts are evening. */
export function partOfDay(clock: string, dayStart: string): 'morning' | 'afternoon' | 'evening' {
  if (clock < dayStart || clock >= '18:00') return 'evening';
  return clock < '12:00' ? 'morning' : 'afternoon';
}

/** Every template that could be said now, with its slots filled. A kind whose data does not exist has none. */
export function eligibleLines(i: LineInput): GreetingLine[] {
  const out: GreetingLine[] = [];
  const add = (keys: readonly GreetingKey[], slots: GreetingLine['slots'] = {}) => { for (const key of keys) out.push({ key, slots }); };
  if (i.fixed) add(GREETING_KEYS.fixed, { time: i.fixed.time, title: i.fixed.title });
  if (i.project) add(GREETING_KEYS.project, { project: i.project.name });
  add(GREETING_KEYS[partOfDay(i.clock, i.dayStart)]);
  if (i.doneToday > 0) add(GREETING_KEYS.done, { n: i.doneToday });
  if (i.planned > 0 && i.doneToday === 0 && !i.running) add(GREETING_KEYS.planned, { n: i.planned });
  return out;
}

/**
 * The project closest to its goal for now: active, with a bar (a measure) that is at least 60 % full and not full. How many cards
 * are done never counts; a project with no measure has no bar and is not named. The fullest first, then the project's order.
 */
export function nearGoal(projects: readonly { name: string; order: number; frac: number | null }[]): { name: string } | null {
  const near = projects.filter(p => p.frac !== null && p.frac >= 0.6 && p.frac < 1).sort((a, b) => b.frac! - a.frac! || a.order - b.order);
  return near[0] ? { name: near[0].name } : null;
}

/** A small stable hash of a word and a seed: the order templates come in is the same all day for the same seed. */
function hash(s: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let n = 0; n < s.length; n++) h = Math.imul(h ^ s.charCodeAt(n), 16777619) >>> 0;
  return h;
}

/**
 * The template to say: the first of the candidates, in the seeded order, that was not shown today. When every one was shown,
 * the list starts over with the one shown longest ago, so the same sentence never comes twice in a row while another exists.
 * `shownToday` is in the order they were shown.
 */
export function pickGreeting<K extends string>(candidates: readonly K[], shownToday: readonly string[], seed: number): K | null {
  const keys = [...new Set(candidates)];
  if (!keys.length) return null;
  const last = (k: string) => shownToday.lastIndexOf(k);
  keys.sort((a, b) => last(a) - last(b) || hash(a, seed) - hash(b, seed) || (a < b ? -1 : 1));
  return keys[0]!;
}

/** The line to say now: the pick among the eligible templates with its slots. */
export function greetingLine(i: LineInput, shownToday: readonly string[], seed: number): GreetingLine | null {
  const lines = eligibleLines(i);
  const key = pickGreeting(lines.map(l => l.key), shownToday, seed);
  return key ? lines.find(l => l.key === key)! : null;
}

/** A number for the seed from a day key, so a day has its own order. */
export const seedOf = (day: string): number => hash(day, 0);
