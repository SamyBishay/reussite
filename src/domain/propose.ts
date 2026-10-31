// The morning's proposal (plan 2 Nov, "Morning" point 3): what the day could hold, in five sections, as candidates. The AI words and
// ranks them (src/ai/prompts.ts) and the person keeps, swaps or skips each; the ritual could show the same sections. Pure: ids in,
// ids out, no I/O. The app (src/flows/morning.tsx) gathers the data; nothing here reads a store or the clock.
import { PILLARS } from './planner';
import { dayLoad, type DayOrderInput } from './dayOrder';
import type { DayKey } from './dates';
import type { SuitId } from '../data/schema';

/** An open work step the day could hold: not a standing item, not an event the person waits for. */
export interface PropStep {
  id: string;
  suit: SuitId;
  project: string;
  /** 1 Now, 2 Protect, 3 Quick, 4 Later (src/domain/tasks.ts). */
  quad: 1 | 2 | 3 | 4;
  due: DayKey | null;
  /** The step waits for another one: it is never proposed. */
  blocked?: boolean;
  /** Can be done at today's place: its own place is today's place, one of its areas, or Anywhere. */
  atPlace: boolean;
  /** Has a place of its own, and it is today's place or one of its areas ("while you are there"). */
  specific: boolean;
  /** The step's place in its project, as the person ordered it (lower first). */
  order: number;
  /** Already on today's list. */
  onList?: boolean;
}
export interface PropProject { id: string; status: string; due: DayKey | null; order: number; hasGoal: boolean }

export interface ProposeInput {
  today: DayKey;
  steps: readonly PropStep[];
  /** Today's fixed-time items (one-off or standing), in time order. They happen whatever the person says. */
  fixed: readonly string[];
  /** Events whose nudge day has come: asked about, never planned. */
  checks: readonly string[];
  /** Yesterday's open steps, still undecided. */
  carried: readonly string[];
  projects: readonly PropProject[];
  /** The day laid out, as `dayOrder` takes it, without the cards (the proposal's go in). */
  layout: Omit<DayOrderInput, 'cards'>;
  limits?: Partial<Limits>;
}
export interface Limits { must: number; goals: number; here: number; pillar: number; more: number }
export const LIMITS: Limits = { must: 6, goals: 2, here: 4, pillar: 1, more: 5 };

export type MustWhy = 'fixed' | 'overdue' | 'dueToday' | 'urgent' | 'carried' | 'check';
export interface MustItem { id: string; why: MustWhy }
/** A project to move today and the step to start with; `more` are its other steps, in order, to swap in. */
export interface GoalItem { project: string; step: string; more: string[] }
export interface PillarItem { pick: string | null; more: string[]; /** Steps of this pillar already in the sections above. */ covered: string[] }
export interface Proposal {
  must: MustItem[];
  /** Due or urgent steps that did not fit under the limit: to swap in. */
  mustMore: string[];
  goals: GoalItem[];
  /** Other projects that could be moved today, each with its first step: to swap a goal for. */
  moreGoals: GoalItem[];
  here: { ids: string[]; more: string[] };
  pillars: Record<SuitId, PillarItem>;
  /** The steps the proposal puts on the day, in order, as it stands before the person chooses. */
  selected: string[];
  load: { planned: number; free: number; over: number };
}

/** The day's load against the time it has for some steps (the same figures as the ritual's "3 h 10 of 4 h 30 free"). */
export const loadOf = (layout: ProposeInput['layout'], ids: readonly string[]) => dayLoad({ ...layout, cards: ids });

const byDueThenOrder = (a: PropStep, b: PropStep) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.order - b.order || (a.id < b.id ? -1 : 1);
const byPriority = (a: PropStep, b: PropStep) => a.quad - b.quad || byDueThenOrder(a, b);

/** Why a step has to happen today, or null when it does not. */
export function mustWhy(s: PropStep, today: DayKey, carried: ReadonlySet<string>): MustWhy | null {
  if (s.due && s.due < today) return 'overdue';
  if (s.due === today) return 'dueToday';
  if (s.quad === 1 || s.quad === 3) return 'urgent';
  return carried.has(s.id) ? 'carried' : null;
}
const MUST_RANK: Record<MustWhy, number> = { fixed: 0, overdue: 1, dueToday: 2, urgent: 3, carried: 4, check: 5 };

export function proposeDay(i: ProposeInput): Proposal {
  const lim = { ...LIMITS, ...i.limits };
  const carried = new Set(i.carried);
  const pool = i.steps.filter(s => !s.blocked);
  const used = new Set<string>();

  // 1. What has to happen: the fixed items, then due, urgent and carried steps (those that can be done where the person is, but carried steps always).
  const fixed: MustItem[] = i.fixed.map(id => ({ id, why: 'fixed' as const }));
  const must = pool
    .map(s => ({ s, why: s.atPlace || carried.has(s.id) ? mustWhy(s, i.today, carried) : null }))
    .filter((x): x is { s: PropStep; why: MustWhy } => !!x.why)
    .sort((a, b) => MUST_RANK[a.why] - MUST_RANK[b.why] || byPriority(a.s, b.s));
  const mustItems: MustItem[] = must.slice(0, lim.must).map(x => ({ id: x.s.id, why: x.why }));
  const mustMore = must.slice(lim.must, lim.must + lim.more).map(x => x.s.id);
  for (const m of [...fixed, ...mustItems]) used.add(m.id);
  const checks: MustItem[] = i.checks.map(id => ({ id, why: 'check' as const }));

  // 2. The main goals: the one or two active projects that matter most today (the nearest date, one with a goal), each with its first open step.
  const free = pool.filter(s => s.atPlace && !used.has(s.id));
  const stepsOf = (p: string) => free.filter(s => s.project === p).sort((a, b) => a.order - b.order || byPriority(a, b));
  const projects = i.projects
    .filter(p => p.status === 'active' && p.id !== 'inbox' && stepsOf(p.id).length)
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || +b.hasGoal - +a.hasGoal || a.order - b.order || (a.id < b.id ? -1 : 1));
  const goalOf = (p: PropProject): GoalItem => {
    const [first, ...rest] = stepsOf(p.id);
    return { project: p.id, step: first!.id, more: rest.slice(0, lim.more).map(s => s.id) };
  };
  const goals = projects.slice(0, lim.goals).map(goalOf);
  const moreGoals = projects.slice(lim.goals, lim.goals + lim.more).map(goalOf);
  for (const g of goals) used.add(g.step);

  // 3. Where the person is: steps that belong to today's place or one of its areas, by priority.
  const here = pool.filter(s => s.specific && !used.has(s.id)).sort(byPriority);
  const hereIds = here.slice(0, lim.here).map(s => s.id);
  const hereMore = here.slice(lim.here, lim.here + lim.more).map(s => s.id);
  for (const id of hereIds) used.add(id);

  // 4. One for each pillar: the best of what is left (Protect before Later), with the next few to swap in.
  const suitOf = new Map(i.steps.map(s => [s.id, s.suit]));
  const pillars = {} as Record<SuitId, PillarItem>;
  for (const suit of PILLARS) {
    const rest = pool.filter(s => s.atPlace && s.suit === suit && !used.has(s.id)).sort(byPriority);
    const picks = rest.slice(0, lim.pillar).map(s => s.id);
    pillars[suit] = {
      pick: picks[0] ?? null,
      more: rest.slice(picks.length, picks.length + lim.more).map(s => s.id),
      covered: [...used].filter(id => suitOf.get(id) === suit),
    };
  }
  const selected = [
    ...mustItems.map(m => m.id), ...goals.map(g => g.step), ...hereIds,
    ...PILLARS.flatMap(s => (pillars[s].pick ? [pillars[s].pick!] : [])),
  ];
  // The day's order sees fixed items itself; the proposal's steps are what it lays out between them.
  return {
    must: [...fixed, ...mustItems, ...checks], mustMore, goals, moreGoals, here: { ids: hereIds, more: hereMore }, pillars, selected,
    load: loadOf(i.layout, selected),
  };
}
