// The v2 data model (brief §4). Field names follow v1 so the import is a straight copy.
// Unknown fields are always kept: a migration or an older device never drops what it doesn't know.
import type { Repeat } from '../domain/repeat';
import type { Option } from '../domain/decision';
export type { Repeat, Option };

export const SCHEMA_VERSION = 2;

export type SuitId = 'S' | 'D' | 'C' | 'H';
export type By = 'me' | 'ai';
/** A place id, or 'any' (Anywhere). */
export type Where = string;
export type DayKey = string; // YYYY-MM-DD
export type Status = 'open' | 'done' | 'dropped';

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

export const COLLECTIONS = ['tasks', 'sessions', 'projects', 'days', 'decisions', 'places', 'stays', 'meta'] as const;
export type Collection = (typeof COLLECTIONS)[number];
