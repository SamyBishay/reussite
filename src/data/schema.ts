// The v2 data model (brief §4). Field names follow v1 so the import is a straight copy.
// Unknown fields are always kept: a migration or an older device never drops what it doesn't know.
import type { Repeat } from '../domain/repeat';
import type { Option } from '../domain/decision';
export type { Repeat, Option };

export const SCHEMA_VERSION = 4;

export type SuitId = 'S' | 'D' | 'C' | 'H';
export type By = 'me' | 'ai';
/** A place id, or 'any' (Anywhere). */
export type Where = string;
export type DayKey = string; // YYYY-MM-DD
export type Status = 'open' | 'done' | 'dropped';
export type Offer = 'address' | 'person';

export interface Task {
  title: string;
  project: string;
  suit: SuitId;
  kind: 'task' | 'decision';
  urgent: boolean;
  important: boolean;
  due: DayKey | null;
  /** The current estimate, minutes. */
  est: number | null;
  /** The estimate frozen when the first session started; what the learning uses. */
  est0: number | null;
  estBy: By | null;
  app?: string | null;
  link?: string | null;
  prompt?: string | null;
  starter?: string | null;
  status: Status;
  doneDay: DayKey | null;
  doneAt: string | null;
  /** ISO time while a timer runs. */
  started: string | null;
  resume: string | null;
  carried: number;
  where: Where;
  after?: string | string[] | null;
  template: boolean;
  note: string;
  order: number;
  created: string;
  src?: string;
  from?: string;
  // v2, phase 1
  /** A repeating step: the next occurrence is created when this one is done or skipped. */
  repeat?: Repeat | null;
  /** The occurrence this one follows, for repeating steps. */
  prev?: string | null;
  /** A fixed time (HH:MM) and duration (minutes): appointments, an obligation placed on a day. */
  at?: string | null;
  dur?: number | null;
  /** Minutes before `at` to leave, and to be notified; null = the person's default (`notifyLead`). */
  lead?: number | null;
  /** A standing obligation's days (ISO, 1 = Monday … 7 = Sunday): with `at` it is placed on those days by itself. */
  weekdays?: number[] | null;
  /** A fixed commitment typed at the morning check-in: on the day, not a work step. */
  fixed?: boolean;
  /** "Before I leave": due a number of days before the end of a stay. */
  dueRule?: { beforeEndOf: string; daysBefore: number } | null;
  /** Times the person got stuck on it, and the frictions named (I'm stuck). */
  stalls?: number;
  friction?: string[];
  /** Sunday reviews where this Later step was offered and not picked. */
  laterOffers?: number;
  /** When the person last said "still going" to the long-timer question. */
  stillAt?: string | null;
  // v2, phase 4
  /** The address or the person this step feeds: its done day sets the person's `lastSeen`, and asks for the address's visit note. */
  addressId?: string | null;
  personId?: string | null;
  /**
   * On a standing obligation: what the planner offers when it places it. `address` for leisure and going out
   * (up to three addresses in the current place), `person` for seeing people. Empty or missing: nothing is offered.
   */
  offer?: Offer | null;
  [extra: string]: unknown;
}

export type SessionSource = 'timer' | 'corrected' | 'typed';
export interface Session {
  taskId: string;
  d: DayKey;
  m: number;
  why: string | null;
  at: string;
  source: SessionSource;
  [extra: string]: unknown;
}

export interface Project {
  name: string;
  suit: SuitId;
  where: Where;
  goal: string | null;
  goalBy: By | null;
  due: DayKey | null;
  order: number;
  status: 'active' | 'paused' | 'done' | 'dropped';
  created?: string;
  smart?: Smart | null;
  smartBy?: By | null;
  doneAt?: string | null;
  [extra: string]: unknown;
}

export interface Smart { specific: string; measurable: string; attainable: string; relevant: string; dated: string }

export interface Launch {
  t: string; // HH:MM
  k: 'start' | 'restart';
  n?: string;
  first?: boolean;
}

export interface Day {
  date: DayKey;
  plan: string[];
  launches: Launch[];
  first: { id: string; title: string } | null;
  checkin: string | null;
  closed: string | null;
  summary: { cards: number; minutes: number; ratio: number | null } | null;
  /** Later steps allotted to this day at the Sunday review: played only if there's room. */
  optional?: string[];
  /** The day's shape from the check-in. */
  shape?: { start: string; preset: 'normal' | 'afternoon' | 'hour' | 'rest' } | null;
  /** The plan's estimated minutes when it was accepted, for "a light day". */
  load?: number;
  /** When the Sunday review was done on this day. */
  review?: string | null;
  [extra: string]: unknown;
}

export interface Problem { what: string; should: string; gap: string; constraints: string; deadline: string; control: string }
export type DecisionStatus = 'draft' | 'decided' | 'reviewing' | 'closed';

/** A decision (brief §9). v1 decisions are migrated to this shape; their own fields stay. */
export interface Decision {
  title: string;
  projectId: string | null;
  taskId: string | null;
  problem: Problem;
  options: Option[];
  status: DecisionStatus;
  listClosedAt: string | null;
  /** The chosen option's name (as in v1) and id. */
  chosen: string | null;
  chosenId: string | null;
  why: string;
  mustBeTrue: string;
  falsifier: string;
  date: DayKey | null;
  reviewOn: DayKey | null;
  taskIds: string[];
  newFacts: { at: string; text: string }[];
  reviews: { on: DayKey; falsifierHappened: boolean; note: string }[];
  history: { at: string; scores: Record<string, number> }[];
  /** Earlier versions, kept when a review reopens the decision. */
  previous?: unknown[];
  [extra: string]: unknown;
}

export interface Place {
  name: string;
  timeZone: string;
  order: number;
  [extra: string]: unknown;
}

export interface Stay {
  placeId: string;
  from: DayKey;
  to: DayKey;
  note: string;
  [extra: string]: unknown;
}

export type MemoryKind = 'profile' | 'person' | 'place' | 'area' | 'topic';
export const MEMORY_KINDS: readonly MemoryKind[] = ['profile', 'person', 'place', 'area', 'topic'];

/** One fact, in the person's words. `id` is stable, so an edit or a Forget finds the same line on every device. */
export interface MemoryLine {
  id: string;
  text: string;
  at: string;
  by: By;
}

/**
 * A memory note (brief §4, §10): one subject, one line per fact. The lines are an array, so they merge
 * whole like any other array (the last writer to the note wins the lines; docs/dev/sync.md).
 */
export interface MemoryNote {
  kind: MemoryKind;
  name: string;
  aliases: string[];
  lines: MemoryLine[];
  /** Never sent to an AI and never read by the connector. */
  private: boolean;
  updated: string;
  description?: string;
  [extra: string]: unknown;
}

/** Did the person want to go back? The note after a visit and one of these (brief §5, Addresses). */
export type Verdict = 'again' | 'maybe' | 'not-again';
export const VERDICTS: readonly Verdict[] = ['again', 'maybe', 'not-again'];
export type AddressState = 'want' | 'been';

/** One visit to an address: the day, how it was, and whether to go back. `stepId` is the step that took the person there, if any. */
export interface Visit {
  id: string;
  day: DayKey;
  note: string;
  verdict: Verdict;
  stepId?: string | null;
  [extra: string]: unknown;
}

/**
 * A good address (brief §5, Addresses and people), per place. `category` is an id from the settings list
 * `addressCategories`. `mapsUrl` opens the Maps app. `by` says who put it on the list (an AI's suggestion
 * from a trip plan has its reason in `note`). The visits are an array, so they merge whole like any array.
 */
export interface Address {
  name: string;
  category: string;
  /** A place id, or 'any'. */
  placeId: Where;
  mapsUrl: string | null;
  /** The street address, if the person typed or imported one. */
  street?: string | null;
  state: AddressState;
  visits: Visit[];
  by: By;
  note: string;
  [extra: string]: unknown;
}

/**
 * Someone the person sees (brief §5): only what the plan needs. There is no home-address field, ever: these
 * people didn't sign up. `reach` is one link that opens WhatsApp, Messages, Mail or the phone. `lastSeen` is
 * set when a step linked to them is done, and shown as a date, never as overdue. Never sent to an AI unless
 * ticked for that request.
 */
export interface Person {
  name: string;
  /** A place id, or 'any'. */
  placeId: Where;
  reach: string | null;
  note: string;
  lastSeen: DayKey | null;
  [extra: string]: unknown;
}

/** What one edit replaced, kept so it can be put back (Undo). */
export interface UndoDoc {
  c: Collection;
  id: string;
  /** Made by this change-set: undone with a tombstone, if nothing was written to it since. */
  created?: true;
  /** Removed by this change-set (tombstoned). */
  removed?: true;
  fields?: Record<string, { was: unknown; now: unknown }>;
  /** The newest clock this change-set wrote on the document: a field with a newer one was written since. */
  at?: string;
}

/**
 * One line the person typed or dictated on Home (or a link brought), and what came of it. `kind` is
 * one of (Home writes a turn only when something came of it, so there is never a half-finished one):
 *  - `add`, `standing`, `done`, `move`, `drop`: the local parser read it and a change-set was applied
 *    (a drop after the review). `reply` is the title of the step it names; `n` how many changes were written.
 *  - `changes`: a change-set that is not one of those was applied (a reply from an AI, a link). `reply` is its
 *    note, if any; `n` how many changes.
 *  - `answer`: an AI answered about the list, the memory or the method and changed nothing. `reply` is the answer.
 *  - `duration`: the person said how long a step they had just ticked done took; the session joined the
 *    Undo of the change-set before it. `text` is what they said, `reply` the step.
 * Strings stay as written (a new kind is read as a plain turn by older devices).
 */
export interface ExchangeTurn {
  at: string;
  text: string;
  reply?: string;
  kind: string;
  n?: number;
}

/** What the person typed on Home (or a link brought) and what came of it; Home's history, kept 90 days. */
export interface Exchange {
  at: string;
  text: string;
  turns: ExchangeTurn[];
  /** The ids of the applied change-sets; `undo` holds each one's records. */
  changes: string[];
  undo: Record<string, UndoDoc[]>;
  /** The ids (from `changes`) that have been undone. */
  undone: string[];
  src: 'home' | 'link' | 'inbox' | 'paste';
  [extra: string]: unknown;
}

export const COLLECTIONS = ['tasks', 'sessions', 'projects', 'days', 'decisions', 'places', 'stays', 'memory', 'exchanges', 'addresses', 'people', 'meta'] as const;
export type Collection = (typeof COLLECTIONS)[number];
