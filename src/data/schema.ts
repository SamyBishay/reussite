// The v2 data model (brief §4). Field names follow v1 so the import is a straight copy.
// Unknown fields are always kept: a migration or an older device never drops what it doesn't know.

export const SCHEMA_VERSION = 1;

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
  [extra: string]: unknown;
}

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
  [extra: string]: unknown;
}

/** v1 decisions are kept as they are in phase 0; the structured wizard model arrives in phase 1. */
export interface Decision {
  title: string;
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
