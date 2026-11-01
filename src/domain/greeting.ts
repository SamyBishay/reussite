// What Home says (plan 2 Nov, "The greeting"; plain since the owner's 1 Nov feedback). Two things, both pure; the app (src/app/model.ts) gathers the data.
//
// 1. The card under the line (`greeting`): Plan the day when there is no list yet, or Close the day when every card on the list is played.
//    Nothing else: Start here, the running step and tomorrow's first step live on Today alone (DECISIONS.md), and Home shows no card
//    while a step runs, a plan is open or the day is closed.
// 2. The line above it (`eligibleLines`, `pickGreeting`): a hello, picked from a long list of greetings (src/i18n) for any time of
//    day and a few for the hour. It says nothing about the day and asks for nothing. A greeting is not repeated within a day while
//    another is eligible, and it works without an AI: the line stays the same with an AI on.

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
/**
 * The greetings, by kind: i18n keys. They say hello and nothing else: nothing about the day's list, what was done or what is next
 * (the owner, 1 Nov: "the greetings shouldn't have anything to do with the cards I've played"). Any time of day, from every register,
 * place and age (Old English to a wazzaaap, a letter's salutations distinguées), plus a few that belong to the hour. Each language has
 * its own lines under the same keys: the French ones are not translations of the English.
 */
export const GREETING_KEYS = {
  any: ['greetAny1', 'greetAny2', 'greetAny3', 'greetAny4', 'greetAny5', 'greetAny6', 'greetAny7', 'greetAny8', 'greetAny9', 'greetAny10', 'greetAny11', 'greetAny12', 'greetAny13', 'greetAny14', 'greetAny15', 'greetAny16', 'greetAny17', 'greetAny18', 'greetAny19', 'greetAny20', 'greetAny21', 'greetAny22', 'greetAny23', 'greetAny24', 'greetAny25', 'greetAny26', 'greetAny27', 'greetAny28', 'greetAny29', 'greetAny30', 'greetAny31', 'greetAny32', 'greetAny33', 'greetAny34', 'greetAny35', 'greetAny36', 'greetAny37', 'greetAny38', 'greetAny39', 'greetAny40', 'greetAny41', 'greetAny42', 'greetAny43', 'greetAny44', 'greetAny45', 'greetAny46', 'greetAny47', 'greetAny48', 'greetAny49', 'greetAny50', 'greetAny51', 'greetAny52', 'greetAny53', 'greetAny54', 'greetAny55', 'greetAny56', 'greetAny57', 'greetAny58', 'greetAny59', 'greetAny60', 'greetAny61', 'greetAny62', 'greetAny63', 'greetAny64', 'greetAny65', 'greetAny66', 'greetAny67', 'greetAny68'],
  morning: ['greetMorning1', 'greetMorning2', 'greetMorning3', 'greetMorning4', 'greetMorning5', 'greetMorning6', 'greetMorning7', 'greetMorning8'],
  afternoon: ['greetAfternoon1', 'greetAfternoon2', 'greetAfternoon3', 'greetAfternoon4', 'greetAfternoon5', 'greetAfternoon6'],
  evening: ['greetEvening1', 'greetEvening2', 'greetEvening3', 'greetEvening4', 'greetEvening5', 'greetEvening6'],
  night: ['greetNight1', 'greetNight2', 'greetNight3', 'greetNight4', 'greetNight5', 'greetNight6'],
} as const;
export type GreetingKey = (typeof GREETING_KEYS)[keyof typeof GREETING_KEYS][number];

export interface LineInput {
  /** The clock now where the person is (HH:MM), and the day-start rule. */
  clock: string;
  dayStart: string;
}
export interface GreetingLine { key: GreetingKey; slots: Record<string, string | number> }

/** Morning until noon, afternoon until six, evening until ten, night after, and the small hours before the day starts. */
export function partOfDay(clock: string, dayStart: string): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (clock < dayStart || clock >= '22:00') return 'night';
  if (clock >= '18:00') return 'evening';
  return clock < '12:00' ? 'morning' : 'afternoon';
}

/** Every greeting that could be said now: the ones for any time, and the hour's own. */
export function eligibleLines(i: LineInput): GreetingLine[] {
  return [...GREETING_KEYS.any, ...GREETING_KEYS[partOfDay(i.clock, i.dayStart)]].map(key => ({ key, slots: {} }));
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
