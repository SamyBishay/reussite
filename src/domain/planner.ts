// The rule-based planner (brief §5, METHOD "The plan"). Deterministic, no AI: the same list
// and the same answers to the check-in always give the same plan.
import { addDays, type DayKey } from './dates';

export type Preset = 'normal' | 'afternoon' | 'hour' | 'rest';
export type Role = 'carried' | 'now' | 'protect' | 'quick' | 'obligation' | 'optional';

export interface PStep {
  id: string;
  quad: 1 | 2 | 3 | 4;
  due: DayKey | null;
  blocked?: boolean;
  /** Personal estimate when there is one, else the raw estimate; null when none. */
  est: number | null;
  lo?: number | null;
  hi?: number | null;
  starter?: string | null;
}
export interface Obligation { id: string; lastDone: DayKey | null; at?: string | null; est: number | null }
export interface Fixed { at: string; dur: number }
export interface Shape { start: string; preset: Preset; fixed: Fixed[] }

export interface PlanInput {
  today: DayKey;
  maxWorkSteps: number;
  planningMin: number;
  defaultRestarts: string[];
  obligationAt: string;
  shape: Shape;
  /** Steps carried from yesterday at the check-in, in order. */
  carried: PStep[];
  /** Open steps for the current place, not carried, sorted by priority. */
  candidates: PStep[];
  obligations: Obligation[];
  /** Later steps allotted to this day at the Sunday review. */
  optional: PStep[];
  /** Later steps that could fill a light day, oldest first. */
  laterPool: PStep[];
  /** The usual planned load in minutes, if known. */
  usualLoad: number | null;
}

export interface PlanItem { id: string; role: Role; at?: string; breakDown?: boolean }
export interface Launch { t: string; k: 'start' | 'restart' }
export interface Plan {
  items: PlanItem[];
  launches: Launch[];
  total: { est: number; lo: number; hi: number };
  /** One more Later step to offer when the day is light. */
  offerLater: string | null;
}

export const HOUR_BUDGET = 60;
export const BREAK_DOWN_OVER = 30;

const hm = (m: number) => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };

/** Over 30 minutes, or without a starter: break it down first. */
export const needsBreakDown = (s: Pick<PStep, 'est' | 'starter'>) => (s.est ?? 0) > BREAK_DOWN_OVER || !s.starter?.trim();

export function plan(input: PlanInput): Plan {
  const { shape, today } = input;
  const rest = shape.preset === 'rest';
  const limit = shape.preset === 'afternoon' ? Math.max(1, input.maxWorkSteps - 1) : Math.max(1, input.maxWorkSteps);
  const soon = addDays(today, 2);
  const dueSoon = (s: PStep) => !!s.due && s.due <= soon;
  const items: PlanItem[] = [];
  const work: PStep[] = [];
  const taken = new Set<string>();
  const add = (s: PStep, role: Role) => { work.push(s); taken.add(s.id); items.push({ id: s.id, role }); };
  let minutes = 0;
  const fits = (s: PStep) => shape.preset !== 'hour' || work.length === 0 || minutes + (s.est ?? 0) <= HOUR_BUDGET;
  const take = (s: PStep, role: Role) => { add(s, role); minutes += s.est ?? 0; };

  const pool = input.candidates.filter(s => !s.blocked && !taken.has(s.id));
  if (rest) {
    // Rest day: the obligation only, unless something is due within two days.
    for (const s of input.carried) if (dueSoon(s) && work.length < limit) take(s, 'carried');
    for (const s of pool) if ((s.quad === 1 || s.quad === 3) && dueSoon(s) && !taken.has(s.id) && work.length < limit) take(s, s.quad === 1 ? 'now' : 'quick');
  } else {
    for (const s of input.carried) if (!taken.has(s.id) && fits(s)) take(s, 'carried');
    const protect = pool.find(s => s.quad === 2);
    const hasProtect = work.some(s => s.quad === 2);
    const reserve = protect && !hasProtect ? 1 : 0;
    for (const s of pool) if (s.quad === 1 && work.length < limit - reserve && !taken.has(s.id) && fits(s)) take(s, 'now');
    // Exactly one Protect step, even when carried steps fill the day.
    if (protect && !hasProtect && fits(protect)) take(protect, 'protect');
    for (const s of pool) if (s.quad === 3 && work.length < limit && !taken.has(s.id) && fits(s)) take(s, 'quick');
  }
  for (const it of items) { const s = work.find(w => w.id === it.id)!; if (needsBreakDown(s)) it.breakDown = true; }

  // One standing obligation, the one done least recently, with a time.
  const ob = [...input.obligations].sort((a, b) => (a.lastDone ?? '') < (b.lastDone ?? '') ? -1 : (a.lastDone ?? '') > (b.lastDone ?? '') ? 1 : 0)[0];
  if (ob) items.push({ id: ob.id, role: 'obligation', at: ob.at || input.obligationAt });

  for (const s of input.optional) if (!taken.has(s.id)) { items.push({ id: s.id, role: 'optional' }); taken.add(s.id); }

  const sum = (f: (s: PStep) => number) => work.reduce((a, s) => a + f(s), 0) + (ob?.est ?? 0) + input.planningMin;
  const total = { est: sum(s => s.est ?? 0), lo: sum(s => s.lo ?? s.est ?? 0), hi: sum(s => s.hi ?? s.est ?? 0) };

  // A start at the chosen time; one or two restarts after fixed commitments, else the defaults.
  const start = mins(shape.start);
  const ends = shape.fixed.map(f => mins(f.at) + Math.max(0, f.dur || 0)).filter(m => m > start).sort((a, b) => a - b);
  const restarts = (ends.length ? ends.map(hm) : input.defaultRestarts.filter(t => mins(t) > start)).filter((t, i, a) => a.indexOf(t) === i).slice(0, 2);
  const launches: Launch[] = [{ t: shape.start, k: 'start' }, ...restarts.map(t => ({ t, k: 'restart' as const }))];

  const usual = input.usualLoad ?? input.maxWorkSteps * 30;
  const light = rest || total.est - input.planningMin < usual / 2;
  const offerLater = light ? input.laterPool.find(s => !taken.has(s.id))?.id ?? null : null;
  return { items, launches, total, offerLater };
}

/** Rules a plan must keep (used to check plans that come from elsewhere, such as an AI in phase 2). */
export function checkPlan(p: Pick<Plan, 'items'>, input: Pick<PlanInput, 'maxWorkSteps' | 'candidates' | 'carried'>): string[] {
  const errs: string[] = [];
  const work = p.items.filter(i => i.role !== 'obligation' && i.role !== 'optional');
  const carried = work.filter(i => i.role === 'carried').length;
  if (work.length > Math.max(input.maxWorkSteps, carried + 1)) errs.push('too many work steps');
  const protect = p.items.filter(i => i.role === 'protect').length;
  const anyProtect = input.candidates.some(s => s.quad === 2) || input.carried.some(s => s.quad === 2);
  if (protect > 1) errs.push('more than one Protect step');
  if (anyProtect && protect === 0 && !input.carried.some(s => s.quad === 2)) errs.push('no Protect step');
  if (p.items.filter(i => i.role === 'obligation').length > 1) errs.push('more than one obligation');
  return errs;
}
