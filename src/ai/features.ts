// The AI features' replies (brief §10, features 2–6): a zod schema each, and pure helpers that
// check a reply against the rules and turn it into a change-set for the review screen.
// Nothing here writes; nothing here reads the store, so every rule is unit-tested.
import { z } from 'zod';
import { checkPlan, needsBreakDown, type Plan, type PlanInput, type PlanItem, type Role } from '../domain/planner';
import { readChangeSet, type ChangeSet } from './changeset';
import type { By } from '../data/schema';

const text = (max: number) => z.string().transform(s => s.trim().slice(0, max));
const line = (max: number) => text(max).pipe(z.string().min(1));
const id = z.union([z.string().min(1), z.number()]).transform(String);
const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/);
/** Minutes, 1–600; anything else is dropped rather than failing the whole reply. */
const minutes = z.union([z.number(), z.string().regex(/^\s*\d+(\.\d+)?\s*$/).transform(Number)]).pipe(z.number().min(1).max(600)).transform(Math.round);
const note = z.string().optional().transform(s => (s ?? '').trim().slice(0, 600));

/** A proposed step: a title that is a first action, a starter, an estimate. */
export const StepSchema = z.object({
  title: line(240),
  starter: text(240).nullable().optional().catch(undefined),
  est: minutes.nullable().optional().catch(undefined),
  app: text(60).nullable().optional().catch(undefined),
});
export type AiStep = z.infer<typeof StepSchema>;

// ---------- 2. Plan my day ----------
const ROLES = ['carried', 'now', 'protect', 'quick', 'obligation', 'optional'] as const satisfies readonly Role[];
export const PlanReply = z.object({
  plan: z.array(z.object({ id, role: z.enum(ROLES), at: hhmm.optional().catch(undefined) })).max(30),
  starters: z.array(z.object({ id, starter: line(240) })).max(25).optional().default([]),
  split: z.array(z.object({ id, steps: z.array(StepSchema).min(2).max(8) })).max(5).optional().default([]),
  note,
});
export type PlanReply = z.infer<typeof PlanReply>;

/** Why an AI plan was set aside; each has one plain sentence in the UI. */
export type PlanFault = 'empty' | 'unknown' | 'twice' | 'roles' | 'tooMany' | 'twoProtect' | 'noProtect' | 'twoObligations' | 'noObligation';
const CHECK: Record<string, PlanFault> = {
  'too many work steps': 'tooMany', 'more than one Protect step': 'twoProtect', 'no Protect step': 'noProtect',
  'more than one obligation': 'twoObligations', 'no obligation': 'noObligation',
};

/**
 * Check an AI plan against the planner's rules (work-step limit, one Protect, one obligation)
 * and the list it was given. A rule the rule-based plan itself can't keep (a rest day, an hour)
 * isn't held against the AI.
 */
export function readAiPlan(r: Pick<PlanReply, 'plan'>, input: PlanInput, rule: Pick<Plan, 'items'>): { ok: true; items: PlanItem[] } | { ok: false; why: PlanFault } {
  const steps = new Map([...input.carried, ...input.candidates, ...input.optional, ...input.laterPool].map(s => [s.id, s]));
  const carried = new Set(input.carried.map(s => s.id));
  const obl = new Map(input.obligations.map(o => [o.id, o]));
  const ruleAt = new Map(rule.items.filter(i => i.at).map(i => [i.id, i.at!]));
  const items: PlanItem[] = [];
  const seen = new Set<string>();
  if (!r.plan.length) return { ok: false, why: 'empty' };
  for (const it of r.plan) {
    if (seen.has(it.id)) return { ok: false, why: 'twice' };
    seen.add(it.id);
    const s = steps.get(it.id);
    if (!s && !obl.has(it.id)) return { ok: false, why: 'unknown' };
    if (obl.has(it.id) !== (it.role === 'obligation')) return { ok: false, why: 'roles' };
    if (it.role === 'carried' && !carried.has(it.id)) return { ok: false, why: 'roles' };
    if (it.role === 'protect' && s!.quad !== 2) return { ok: false, why: 'roles' };
    if (it.role === 'obligation') items.push({ id: it.id, role: 'obligation', at: it.at ?? ruleAt.get(it.id) ?? obl.get(it.id)!.at ?? input.obligationAt });
    else items.push({ id: it.id, role: it.role, ...(it.role !== 'optional' && needsBreakDown(s!) ? { breakDown: true } : {}) });
  }
  const limits = { ...input, maxWorkSteps: input.shape.preset === 'afternoon' ? Math.max(1, input.maxWorkSteps - 1) : input.maxWorkSteps };
  const baseline = checkPlan(rule, limits);
  const errs = checkPlan({ items }, limits).filter(e => !baseline.includes(e));
  if (errs.length) return { ok: false, why: CHECK[errs[0]!] ?? 'roles' };
  return { ok: true, items };
}

/** Starters and splits from a plan reply, as a change-set; null when there's nothing to propose. */
export function planChangeSet(r: Pick<PlanReply, 'starters' | 'split'>, known: Map<string, { project: string; where?: string }>): ChangeSet | null {
  const changes: unknown[] = [];
  const split = new Set<string>();
  for (const sp of r.split) {
    const tk = known.get(sp.id);
    if (!tk || split.has(sp.id)) continue;
    split.add(sp.id);
    changes.push(...splitChanges(sp.id, tk, sp.steps));
  }
  for (const s of r.starters) if (known.has(s.id) && !split.has(s.id)) changes.push({ op: 'task.update', id: s.id, set: { starter: s.starter } });
  return toChangeSet(changes);
}

/** A step broken down: it becomes the first action, the rest follow it, each waiting for the one before. */
export function splitChanges(id: string, tk: { project: string; where?: string }, steps: AiStep[]): unknown[] {
  const [first, ...rest] = steps;
  if (!first) return [];
  const out: unknown[] = [{ op: 'task.update', id, set: clean(first) }];
  let prev = id;
  rest.forEach((s, i) => {
    const ref = `${id}-${i + 1}`;
    out.push({ op: 'task.create', ref, set: { ...clean(s), project: tk.project, ...(tk.where ? { where: tk.where } : {}), after: [prev] } });
    prev = ref;
  });
  return out;
}
const clean = (s: AiStep) => Object.fromEntries(Object.entries(s).filter(([, v]) => v != null && v !== ''));

function toChangeSet(changes: unknown[], note = ''): ChangeSet | null {
  if (!changes.length) return null;
  const r = readChangeSet({ v: 1, note, changes });
  return r.ok ? r.cs : null;
}

// ---------- 3. Break it down ----------
export const BreakDownReply = z.object({ steps: z.array(StepSchema).min(1).max(8), note });
export type BreakDownReply = z.infer<typeof BreakDownReply>;
/** An estimate the AI gave stays marked `ai` unless the person changed it. */
export const estByOf = (est: string, est0: number | null): By | null => (Number(est) ? (Number(est) === est0 ? 'ai' : 'me') : null);

// ---------- 4. Decision help ----------
// The AI never proposes weights: an item is text only; any weight it sends is dropped here,
// and the item starts at 3, marked as a suggestion, until the person sets it.
const item = z.union([line(300), z.object({ text: line(300) }).transform(o => o.text)]);
const column = z.array(item).max(8).optional().catch(undefined);
const PROBLEM_KEYS = ['what', 'should', 'gap', 'constraints', 'deadline', 'control'] as const;
const smart = z.object({ specific: text(400), measurable: text(400), attainable: text(400), relevant: text(400), dated: text(400) }).partial();
export const DecisionReply = z.object({
  title: text(200).optional().catch(undefined),
  problem: z.object({ what: text(600), should: text(600), gap: text(600), constraints: text(600), deadline: text(200), control: text(600) }).partial().optional().catch(undefined),
  options: z.array(z.object({ name: line(200), pros: column, cons: column, prosNot: column, consNot: column })).max(12).optional().catch(undefined),
  steps: z.array(StepSchema).max(10).optional().catch(undefined),
  goal: text(400).optional().catch(undefined),
  smart: smart.optional().catch(undefined),
  note,
});
export type DecisionReply = z.infer<typeof DecisionReply>;
export type DecisionAsk = 'problem' | 'options' | 'items' | 'steps';
const COLS = ['pros', 'cons', 'prosNot', 'consNot'] as const;

/**
 * What the AI may change for each kind of decision help, one change per line so each can be
 * ticked on its own. `items` keeps only the option being weighed. Weights never get through.
 */
export function decisionChangeSet(r: DecisionReply, d: { id: string; title: string; projectId: string | null; options: { name: string }[] }, what: DecisionAsk, option?: string): ChangeSet | null {
  const ch: unknown[] = [];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (what === 'problem') {
    if (r.title && !d.title.trim()) ch.push({ op: 'decision.update', id: d.id, set: { title: r.title } });
    for (const k of PROBLEM_KEYS) { const v = r.problem?.[k]; if (v) ch.push({ op: 'decision.update', id: d.id, set: { problem: { [k]: v } } }); }
  }
  if (what === 'options') {
    for (const o of r.options ?? []) if (!d.options.some(x => same(x.name, o.name))) ch.push({ op: 'decision.update', id: d.id, set: { options: [{ name: o.name }] } });
  }
  if (what === 'items' && option) {
    for (const o of r.options ?? []) {
      if (!same(o.name, option)) continue;
      for (const c of COLS) for (const it of o[c] ?? []) ch.push({ op: 'decision.update', id: d.id, set: { options: [{ name: option, [c]: [it] }] } });
    }
  }
  if (what === 'steps' && d.projectId) {
    if (r.goal) ch.push({ op: 'project.update', id: d.projectId, set: { goal: r.goal } });
    if (r.smart && Object.values(r.smart).some(Boolean)) ch.push({ op: 'project.update', id: d.projectId, set: { smart: r.smart } });
  }
  return toChangeSet(ch, r.note);
}

// ---------- 5. Stuck ----------
export const StuckReply = z.object({ starter: line(240), note });

// ---------- 6. Sunday review help ----------
export const ReviewReply = z.object({
  goal: text(400).optional().catch(undefined),
  smart: smart.optional().catch(undefined),
  next: z.array(StepSchema).max(3).optional().catch(undefined),
  note,
});
export type ReviewReply = z.infer<typeof ReviewReply>;

/** A goal, its SMART lines and next steps for one project, each to tick. */
export function reviewChangeSet(r: ReviewReply, p: { id: string; where?: string }): ChangeSet | null {
  const ch: unknown[] = [];
  if (r.goal) ch.push({ op: 'project.update', id: p.id, set: { goal: r.goal } });
  if (r.smart && Object.values(r.smart).some(Boolean)) ch.push({ op: 'project.update', id: p.id, set: { smart: r.smart } });
  (r.next ?? []).forEach((s, i) => ch.push({ op: 'task.create', ref: 'next' + i, set: { ...clean(s), project: p.id, important: true, ...(i ? { after: ['next' + (i - 1)] } : {}) } }));
  return toChangeSet(ch, r.note);
}
