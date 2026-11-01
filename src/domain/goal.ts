// SMART goals v2 (schema 7): what a project's bar is made of. Pure.
// The bar is measured, not counted: a count adds up the steps the person said move the goal (`advances: true`) when they
// are done, milestones are ticked one by one, and "none" has no bar. Card counts (done / total steps) never feed it.
import type { DayKey } from './dates';
import type { Measure, Milestone, Project, Task } from '../data/schema';

export const NO_MEASURE: Measure = { kind: 'none' };
export const MEASURE_KINDS = ['none', 'count', 'milestones'] as const;
/** The longest a unit or a milestone is kept. */
export const UNIT_MAX = 40;
export const MILESTONE_MAX = 120;
export const MILESTONES_MAX = 30;

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** A measure as stored, read tolerantly: anything unreadable is "none". An unknown kind from a newer app also reads as none, and is never rewritten by a read. */
export function readMeasure(raw: unknown): Measure {
  if (!raw || typeof raw !== 'object') return NO_MEASURE;
  const m = raw as Record<string, unknown>;
  if (m.kind === 'count') {
    const target = Number(m.target);
    if (!Number.isFinite(target) || target <= 0) return NO_MEASURE;
    return { kind: 'count', target, unit: text(m.unit, UNIT_MAX) };
  }
  if (m.kind === 'milestones') {
    const items: Milestone[] = [];
    const seen = new Set<string>();
    for (const [i, x] of (Array.isArray(m.items) ? m.items : []).entries()) {
      if (!x || typeof x !== 'object') continue;
      const o = x as Record<string, unknown>;
      const t = text(o.text, MILESTONE_MAX);
      if (!t) continue;
      let id = typeof o.id === 'string' && o.id ? o.id : 'm' + (i + 1);
      while (seen.has(id)) id += '_';
      seen.add(id);
      items.push({ id, text: t, done: typeof o.done === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.done) ? o.done : null });
    }
    return { kind: 'milestones', items };
  }
  return NO_MEASURE;
}

export const measureOf = (p: { measure?: unknown } | undefined | null): Measure => readMeasure(p?.measure);

/**
 * The outcome in one sentence. A project an older device wrote has no `outcome` (the field is missing): its `goal` stands in.
 * An outcome the person cleared is `null` and stays empty, whatever `goal` still says.
 */
export function outcomeOf(p: Pick<Project, 'goal'> & { outcome?: string | null }): string {
  const v = p.outcome !== undefined ? p.outcome : p.goal;
  return typeof v === 'string' ? v.trim() : '';
}

/** The day the goal starts: the one set, else the day the project was made. */
export const startOf = (p: Pick<Project, 'start' | 'created'>): DayKey | null => p.start ?? (typeof p.created === 'string' && p.created.length >= 10 ? p.created.slice(0, 10) : null);

type StepLike = Pick<Task, 'project' | 'status'> & Partial<Pick<Task, 'template' | 'kind' | 'advances' | 'advanceBy'>>;

/** A step that moves its project's goal: said so, and a real step (not a standing item or something waited for). */
export const advancing = (tk: Partial<StepLike>): boolean => tk.advances === true && !tk.template && tk.kind !== 'event';

/** What a done advancing step adds to a count. */
export const amountOf = (tk: Partial<Pick<Task, 'advanceBy'>>): number => (typeof tk.advanceBy === 'number' && Number.isFinite(tk.advanceBy) && tk.advanceBy > 0 ? tk.advanceBy : 1);

export interface Progress {
  kind: 'count' | 'milestones';
  /** Counted so far (a count's sum, or milestones ticked). */
  value: number;
  /** The target (a count's, or the number of milestones). */
  max: number;
  /** 0 to 1. */
  frac: number;
  unit: string;
  reached: boolean;
  /** Milestones only: the ones still open, in order. */
  open: Milestone[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The bar of a project: null when it has none. `steps` are the project's steps (others are ignored). */
export function progressOf(p: { id: string; measure?: unknown }, steps: Iterable<StepLike>): Progress | null {
  const m = measureOf(p);
  if (m.kind === 'count') {
    let value = 0;
    for (const x of steps) if (x.project === p.id && x.status === 'done' && advancing(x)) value += amountOf(x);
    value = round(value);
    return { kind: 'count', value, max: m.target, frac: Math.min(1, value / m.target), unit: m.unit, reached: value >= m.target, open: [] };
  }
  if (m.kind === 'milestones') {
    const open = m.items.filter(i => !i.done);
    const value = m.items.length - open.length;
    return { kind: 'milestones', value, max: m.items.length, frac: m.items.length ? value / m.items.length : 0, unit: '', reached: m.items.length > 0 && !open.length, open };
  }
  return null;
}

export interface MovedBar { id: string; name: string; progress: Progress; /** What the day added: a count's amount, or the milestones ticked. */ gain: number }

/**
 * The bars that moved on a day (the close of the day shows them): projects that have a bar and gained on `day`, a count by the amount of the
 * advancing steps done that day, milestones by the ones ticked that day. Open steps and card counts move nothing. In the projects' order.
 */
export function movedOn(
  projects: Iterable<{ id: string; name: string; order?: number; status?: string; measure?: unknown }>,
  steps: Iterable<StepLike & { doneDay?: DayKey | null }>, day: DayKey,
): MovedBar[] {
  const list = [...steps], out: (MovedBar & { order: number })[] = [];
  for (const p of projects) {
    if (p.status && p.status !== 'active') continue;
    const pr = progressOf(p, list), m = measureOf(p);
    if (!pr) continue;
    const gain = m.kind === 'count'
      ? round(list.reduce((n, x) => (x.project === p.id && x.status === 'done' && x.doneDay === day && advancing(x) ? n + amountOf(x) : n), 0))
      : m.kind === 'milestones' ? m.items.filter(i => i.done === day).length : 0;
    if (gain > 0) out.push({ id: p.id, name: p.name, progress: pr, gain, order: p.order ?? 0 });
  }
  return out.sort((a, b) => a.order - b.order).map(({ order: _o, ...x }) => x);
}

/** Does finishing this step offer anything: it advances, and its project has a bar. Returns the project's measure kind. */
export function offerFor(tk: StepLike, p: { measure?: unknown } | undefined): 'count' | 'milestones' | null {
  if (!p || !advancing(tk)) return null;
  const m = measureOf(p);
  if (m.kind === 'count') return 'count';
  return m.kind === 'milestones' && m.items.some(i => !i.done) ? 'milestones' : null;
}

/** A milestone ticked on `day`, or opened again (`day` null). Another measure is returned unchanged. */
export function tickMilestone(m: Measure, id: string, day: DayKey | null): Measure {
  if (m.kind !== 'milestones') return m;
  return { kind: 'milestones', items: m.items.map(i => (i.id === id ? { ...i, done: day } : i)) };
}

/** A new milestone at the end. Another measure is returned unchanged; an empty text or a full list adds nothing. */
export function addMilestone(m: Measure, id: string, textIn: string): Measure {
  const t = text(textIn, MILESTONE_MAX);
  if (m.kind !== 'milestones' || !t || m.items.length >= MILESTONES_MAX) return m;
  return { kind: 'milestones', items: [...m.items, { id, text: t, done: null }] };
}

/**
 * Milestones from a list of words (an AI's, or typed): one that matches an existing milestone's text keeps its id and its tick,
 * a new one gets the next id from `newId`. `done` (a day, or true for `today`) sets a tick; false opens it again. The result is
 * exactly the list given: a milestone left out is gone from it (the review shows the before and after).
 */
export function mergeMilestones(cur: Measure, incoming: { text: string; done?: DayKey | boolean | null }[], today: DayKey, newId: () => string): Measure {
  const have = cur.kind === 'milestones' ? cur.items : [];
  const used = new Set<string>();
  const items: Milestone[] = [];
  for (const inc of incoming.slice(0, MILESTONES_MAX)) {
    const t = text(inc.text, MILESTONE_MAX);
    if (!t) continue;
    const hit = have.find(h => !used.has(h.id) && h.text.trim().toLowerCase() === t.toLowerCase());
    if (hit) used.add(hit.id);
    const done = inc.done === undefined ? hit?.done ?? null : inc.done === true ? hit?.done ?? today : inc.done === false || inc.done === null ? null : inc.done;
    items.push({ id: hit?.id ?? newId(), text: hit?.text ?? t, done });
  }
  return { kind: 'milestones', items };
}

/** Whether two measures are the same, for "nothing changes". */
export const sameMeasure = (a: Measure, b: Measure): boolean => JSON.stringify(readMeasure(a)) === JSON.stringify(readMeasure(b));

/** A number as shown: at most two decimals, none when whole. */
export const fmtAmount = (n: number): string => String(round(n));

// ---------- the migration (schema 6 → 7) and the importer ----------
/** The fields a project gets at schema 7 from what it has: the outcome is the goal copied (the goal stays), no bar, and it starts the day it was made. */
export function goalFieldsFor(p: Record<string, unknown>): { outcome: string | null; measure: Measure; start: DayKey | null } {
  const goal = typeof p.goal === 'string' && p.goal.trim() ? p.goal : null;
  const start = typeof p.created === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.created) ? p.created.slice(0, 10) : null;
  return { outcome: goal, measure: NO_MEASURE, start };
}

// ---------- what an AI reads ----------
/** The measure in a few words: "none (no bar)", "count, 4 of 10 pages", "milestones, 1 of 3 (done: A; open: B, C)". */
export function measureText(p: { id: string; measure?: unknown }, steps: Iterable<StepLike>): string {
  const m = measureOf(p);
  const pr = progressOf(p, steps);
  if (m.kind === 'count' && pr) return `count, ${fmtAmount(pr.value)} of ${fmtAmount(pr.max)}${m.unit ? ' ' + m.unit : ''}`;
  if (m.kind === 'milestones' && pr) {
    const done = m.items.filter(i => i.done).map(i => i.text);
    return `milestones, ${pr.value} of ${pr.max}` + (m.items.length ? ` (done: ${done.join('; ') || '-'}; open: ${pr.open.map(i => i.text).join(', ') || '-'})` : '');
  }
  return 'none (no bar)';
}

/**
 * The goal as the prompt context and the connector print it, after the project's first line: the outcome (labelled `goal:`
 * as before), how it is measured, when it starts, and which open steps move it. `one` flattens a text to one line.
 * `older`: done steps this reader could not load, so a count may be short.
 */
export function goalLines(
  p: { id: string; goal: string | null; outcome?: string | null; measure?: unknown; start?: DayKey | null; created?: string },
  steps: Iterable<StepLike & { id: string; title?: string }>, one: (s: string) => string, older = false,
): string[] {
  const list = [...steps];
  const out = outcomeOf(p);
  const lines = [`goal: ${out ? one(out) : '-'}`, `measure: ${measureText(p, list)}${older && measureOf(p).kind === 'count' ? ' (older done steps not counted)' : ''}`];
  const start = startOf(p);
  if (start) lines.push(`starts: ${start}`);
  const moving = list.filter(x => x.project === p.id && x.status === 'open' && advancing(x));
  if (moving.length) lines.push('moves the goal: ' + moving.slice(0, 10).map(x => `${x.id}${x.title ? ' ' + one(x.title) : ''}`).join('; '));
  return lines;
}
