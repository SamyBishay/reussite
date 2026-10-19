// What a few writes mean, as pure functions: a new step's defaults, what finishing a step changes,
// the next occurrence of a repeating step, a project completing, "before I leave" dates following
// a stay. The app (src/app/actions.ts) and the connector (relay/src/connector) both apply these,
// so a step ticked done by an AI is exactly a step ticked done by hand.
import type { DayKey } from './dates';
import { dueBeforeEnd } from './places';
import { nextDue } from './repeat';
import type { Project, SessionSource, Stay, Task } from '../data/schema';

type WithId<T> = T & { id: string };

/** A new step with every default; `extra` wins. */
export function newTaskFields(
  title: string, suit: Task['suit'] | null, project: string | null, extra: Partial<Task>,
  projects: ReadonlyMap<string, Pick<Project, 'suit' | 'where'>>, nowIso: string, nowMs: number,
): Task {
  const p = projects.get(project ?? '') ?? ({} as Partial<Pick<Project, 'suit' | 'where'>>);
  return {
    title, suit: suit || p.suit || 'S', project: project || 'inbox', kind: 'task', urgent: false, important: true, due: null,
    est: null, est0: null, estBy: null, status: 'open', doneDay: null, doneAt: null, started: null, resume: null, carried: 0,
    where: p.where || 'any', template: false, note: '', order: nowMs, created: nowIso, src: 'page', ...extra,
  };
}

export interface Finish {
  /** Fields to change on the step. */
  patch: Partial<Task>;
  /** A work session to record (a running timer's time, or typed minutes). */
  session: { m: number; source: SessionSource; why: 'done'; d: DayKey } | null;
}

/**
 * Marking a step done on `day`. With a running timer its time is saved (or `minutes`, corrected);
 * without one, `typed` minutes are saved as typed. The first session freezes the estimate.
 */
export function finishEffects(tk: Pick<Task, 'started' | 'est' | 'est0'>, o: { today: DayKey; day: DayKey; nowIso: string; nowMs: number; typed?: number | null; minutes?: number }): Finish {
  const patch: Partial<Task> = { status: 'done', doneAt: o.day === o.today ? o.nowIso : o.day + 'T12:00:00.000Z', doneDay: o.day, resume: null, started: null, stillAt: null };
  let session: Finish['session'] = null;
  if (tk.started) {
    const elapsed = Math.max(0, (o.nowMs - Date.parse(tk.started)) / 1000);
    session = { m: Math.max(1, Math.round(o.minutes ?? Math.max(1, Math.round(elapsed / 60)))), source: o.minutes != null ? 'corrected' : 'timer', why: 'done', d: o.day };
  } else if (o.typed && o.typed > 0) {
    session = { m: Math.max(1, Math.round(o.typed)), source: 'typed', why: 'done', d: o.day };
  }
  if (tk.est0 == null && tk.est) patch.est0 = tk.est;
  return { patch, session };
}

const KEEP: (keyof Task)[] = ['title', 'starter', 'est', 'estBy', 'project', 'where', 'app', 'link', 'prompt', 'suit', 'important', 'kind', 'repeat', 'at', 'dur', 'note'];

/**
 * The next occurrence of a repeating step done or skipped on `day`: its fields, or null when the
 * series has ended. `existing` is a following step already made (then nothing new is created).
 */
export function nextOccurrence(tk: WithId<Task>, day: DayKey, existing: Iterable<WithId<Task>>): { fields: Partial<Task> } | { existing: string } | null {
  if (!tk.repeat) return null;
  for (const x of existing) if (x.prev === tk.id && x.status !== 'dropped') return { existing: x.id };
  const due = nextDue(tk.repeat, tk.due, day);
  if (!due) return null;
  const extra: Partial<Task> = {};
  for (const k of KEEP) if (tk[k] !== undefined) (extra as Record<string, unknown>)[k] = tk[k];
  return { fields: { ...extra, due, prev: tk.id, est0: null, src: 'repeat' } };
}

/** A project whose real steps are all done moves to the Completed shelf (needs two or more steps). */
export function projectCompletes(pid: string, projects: ReadonlyMap<string, Pick<Project, 'status'>>, tasks: Iterable<Pick<Task, 'project' | 'template' | 'status'>>): boolean {
  const p = projects.get(pid);
  if (!p || pid === 'inbox' || p.status === 'done') return false;
  const real = [...tasks].filter(x => x.project === pid && !x.template && x.status !== 'dropped');
  return real.length >= 2 && !real.some(x => x.status === 'open');
}

/** "Before I leave" steps move with their stay's dates, so they turn urgent on their own. */
export function dueRulePatches(stayId: string, s: Pick<Stay, 'to'>, tasks: Iterable<WithId<Task>>): { id: string; due: DayKey }[] {
  const out: { id: string; due: DayKey }[] = [];
  for (const x of tasks) {
    if (x.status !== 'open' || x.dueRule?.beforeEndOf !== stayId) continue;
    const due = dueBeforeEnd(s, x.dueRule.daysBefore);
    if (x.due !== due) out.push({ id: x.id, due });
  }
  return out;
}
