// The AI features' replies (brief §10, features 2–6): a zod schema each, and pure helpers that
// check a reply against the rules and turn it into a change-set for the review screen.
// Nothing here writes; nothing here reads the store, so every rule is unit-tested.
import { z } from 'zod';
import { checkPlan, needsBreakDown, PILLARS, type Plan, type PlanInput, type PlanItem, type Role } from '../domain/planner';
import type { MustWhy, Proposal } from '../domain/propose';
import { readChangeSet, type ChangeSet } from './changeset';
import type { By, SuitId } from '../data/schema';

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

// ---------- 7. The morning conversation ----------
// The AI words and ranks the candidates `proposeDay` gives it (src/domain/propose.ts); it may also write a new step for a goal or a
// pillar. Whatever it sends is checked against those candidates here: an id it was not given, a section it left out or a pillar it
// forgot falls back to the candidates themselves, so the five sections are always there. The person then keeps, swaps or skips each
// item (`swapItem`, `setSkipped`), and `morningChangeSet` turns what is left into the one change-set for the review screen.
/** The AI's words for the person: a line that names a card or a suit (the app's own jargon) is dropped. */
const plain = (max: number) => text(max).transform(s => (/\b(cards?|suits?)\b/i.test(s) ? '' : s));
const pick = z.object({
  id: id.optional().catch(undefined),
  new: StepSchema.optional().catch(undefined),
  /** The AI's wording: one short sentence on why it is there. */
  line: plain(200).optional().catch(undefined),
  /** The AI proposes leaving it out, because the day is over-full. */
  cut: z.boolean().optional().catch(undefined),
});
const list = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).max(max).optional().catch(undefined);
export const MorningReply = z.object({
  must: list(pick, 12),
  goals: list(pick.extend({ project: id.optional().catch(undefined) }), 4),
  pillars: list(pick.extend({ suit: z.enum(['S', 'D', 'C', 'H']).optional().catch(undefined) }), 8),
  here: list(pick, 8),
  /** The step to start with (an id from the sections). */
  first: id.optional().catch(undefined),
  split: z.array(z.object({ id, steps: z.array(StepSchema).min(2).max(8) })).max(5).optional().catch(undefined),
  note: plain(600).optional().transform(s => s ?? '').catch(''),
});
export type MorningReply = z.infer<typeof MorningReply>;

export type Section = 'must' | 'goals' | 'here' | 'pillars';
export interface DraftItem {
  /** The step's id, or `new:<n>` for a step the AI proposes to make. */
  key: string;
  id: string | null;
  step: AiStep | null;
  suit: SuitId;
  /** A goal's project, and the project a new step joins. */
  project: string | null;
  line: string;
  why?: MustWhy;
  skipped: boolean;
  /** A fixed-time item or an event to check: shown, not part of the choice. */
  locked?: boolean;
}
export interface Draft {
  note: string;
  must: DraftItem[];
  goals: DraftItem[];
  here: DraftItem[];
  pillars: Record<SuitId, DraftItem | null>;
  /** The key of the step the AI would start with. */
  first: string | null;
  split: { id: string; steps: AiStep[] }[];
}
export interface Known { suit: SuitId; project: string }

const mk = (id: string, known: ReadonlyMap<string, Known>, o: Partial<DraftItem> = {}): DraftItem => ({
  key: id, id, step: null, suit: known.get(id)?.suit ?? 'S', project: known.get(id)?.project ?? null, line: '', skipped: false, ...o,
});
const sectionsOf = (d: Draft): DraftItem[] => [...d.must, ...d.goals, ...d.here, ...PILLARS.flatMap(s => (d.pillars[s] ? [d.pillars[s]!] : []))];

/**
 * The first turn (and each later one): the AI's reply read against the candidates. `gone` are steps the person skipped on an earlier
 * turn, which are not offered again. With no reply (the AI failed, or the person wants no wording), the candidates are the proposal.
 */
export function readMorning(r: Partial<MorningReply> | null, p: Proposal, known: ReadonlyMap<string, Known>, gone: ReadonlySet<string> = new Set()): Draft {
  const used = new Set<string>(gone);
  let n = 0;
  const free = (id: string | undefined | null): id is string => !!id && known.has(id) && !used.has(id);
  const take = (id: string) => { used.add(id); return id; };

  // What has to happen: the fixed items and the events to check stay whatever the AI says; the rest in its order, then any it left out.
  const locked = (m: { why: MustWhy }) => m.why === 'fixed' || m.why === 'check';
  const whyOf = new Map(p.must.filter(m => !locked(m)).map(m => [m.id, m.why]));
  const allowed = new Set([...whyOf.keys(), ...p.mustMore]);
  const said = new Map((r?.must ?? []).flatMap(x => (x.id ? [[x.id, x] as const] : [])));
  const mustIds: string[] = [];
  for (const x of r?.must ?? []) if (x.id && allowed.has(x.id) && free(x.id)) mustIds.push(take(x.id));
  for (const m of p.must) if (!locked(m) && free(m.id)) mustIds.push(take(m.id));
  const must: DraftItem[] = [
    ...p.must.filter(m => m.why === 'fixed').map(m => mk(m.id, known, { why: 'fixed', locked: true })),
    ...mustIds.map(id => mk(id, known, { why: whyOf.get(id), line: said.get(id)?.line ?? '', skipped: !!said.get(id)?.cut })),
    ...p.must.filter(m => m.why === 'check').map(m => mk(m.id, known, { why: 'check', locked: true })),
  ];

  // The main goals: at most as many as the proposal has, each a project it listed with a step of that project (or a new one).
  const options = [...p.goals, ...p.moreGoals];
  const goals: DraftItem[] = [];
  const projectsUsed = new Set<string>();
  type G = NonNullable<MorningReply['goals']>[number];
  const goalItem = (o: (typeof options)[number], g?: G): DraftItem | null => {
    const ok = new Set([o.step, ...o.more]);
    if (g?.id && ok.has(g.id) && free(g.id)) return mk(take(g.id), known, { project: o.project, line: g.line ?? '', skipped: !!g.cut });
    if (g?.new) return { key: 'new:' + ++n, id: null, step: g.new, suit: known.get(o.step)?.suit ?? 'S', project: o.project, line: g.line ?? '', skipped: !!g.cut };
    const id = [o.step, ...o.more].find(free);
    return id ? mk(take(id), known, { project: o.project, line: g?.line ?? '', skipped: !!g?.cut }) : null;
  };
  for (const g of r?.goals ?? []) {
    const o = options.find(x => x.project === g.project);
    if (!o || projectsUsed.has(o.project) || goals.length >= Math.max(1, p.goals.length)) continue;
    const it = goalItem(o, g);
    if (it) { goals.push(it); projectsUsed.add(o.project); }
  }
  if (!goals.length) for (const o of p.goals) { const it = goalItem(o); if (it) goals.push(it); }

  // Where the person is: the AI's choice among the candidates, else the candidates.
  const hereOk = new Set([...p.here.ids, ...p.here.more]);
  const asked2 = (r?.here ?? []).filter(x => x.id && hereOk.has(x.id) && free(x.id));
  const here = (asked2.length ? asked2 : p.here.ids.map(id => ({ id } as { id?: string; line?: string; cut?: boolean })))
    .filter(x => free(x.id)).map(x => mk(take(x.id!), known, { line: x.line ?? '', skipped: !!x.cut }));

  // One for each pillar: the AI's, the candidate if it said nothing, none if there is nothing.
  const pillars = { S: null, D: null, C: null, H: null } as Record<SuitId, DraftItem | null>;
  for (const suit of PILLARS) {
    const pc = p.pillars[suit], ok = new Set([pc.pick, ...pc.more].filter((x): x is string => !!x));
    const mine = (r?.pillars ?? []).filter(x => x.suit === suit);
    const byId = mine.find(x => x.id && ok.has(x.id) && free(x.id));
    const fresh = byId ? undefined : mine.find(x => x.new && !x.id);
    if (byId) pillars[suit] = mk(take(byId.id!), known, { suit, line: byId.line ?? '', skipped: !!byId.cut });
    else if (fresh) pillars[suit] = { key: 'new:' + ++n, id: null, step: fresh.new!, suit, project: null, line: fresh.line ?? '', skipped: !!fresh.cut };
    else if (free(pc.pick)) pillars[suit] = mk(take(pc.pick), known, { suit });
  }

  const draft: Draft = { note: r?.note ?? '', must, goals, here, pillars, first: null, split: [] };
  const keys = new Set(sectionsOf(draft).filter(x => !x.locked).map(x => x.key));
  draft.first = r?.first && keys.has(r.first) ? r.first : null;
  draft.split = (r?.split ?? []).filter(x => keys.has(x.id));
  return draft;
}

/** The same draft with one item changed (by key). */
export function mapDraft(d: Draft, key: string, f: (i: DraftItem) => DraftItem): Draft {
  const one = (i: DraftItem) => (i.key === key ? f(i) : i);
  const pl = (s: SuitId) => (d.pillars[s] ? one(d.pillars[s]!) : null);
  return { ...d, must: d.must.map(one), goals: d.goals.map(one), here: d.here.map(one), pillars: { S: pl('S'), D: pl('D'), C: pl('C'), H: pl('H') } };
}
export const setSkipped = (d: Draft, key: string, skipped: boolean): Draft => mapDraft(d, key, i => (i.locked ? i : { ...i, skipped }));

/** What can take an item's place: steps of the same section that are not in the draft yet (a goal: other steps of its project, or another project's first step). */
export function swapOptions(d: Draft, section: Section, item: DraftItem, p: Proposal): { id: string; project?: string }[] {
  const inDraft = new Set(sectionsOf(d).flatMap(i => (i.id ? [i.id] : [])));
  const free = (id: string) => !inDraft.has(id);
  if (section === 'must') return p.mustMore.filter(free).map(id => ({ id }));
  if (section === 'here') return [...p.here.ids, ...p.here.more].filter(free).map(id => ({ id }));
  if (section === 'pillars') return [p.pillars[item.suit].pick, ...p.pillars[item.suit].more].filter((x): x is string => !!x && free(x)).map(id => ({ id }));
  const goals = [...p.goals, ...p.moreGoals];
  const mine = goals.find(o => o.project === item.project);
  const others = goals.filter(o => o.project !== item.project && !d.goals.some(g => g.project === o.project));
  return [
    ...(mine ? [mine.step, ...mine.more].filter(free).map(id => ({ id, project: mine.project })) : []),
    ...others.filter(o => free(o.step)).map(o => ({ id: o.step, project: o.project })),
  ];
}
/** Put a step in place of an item. */
export function swapItem(d: Draft, key: string, to: { id: string; project?: string }, known: ReadonlyMap<string, Known>): Draft {
  return mapDraft(d, key, i => mk(to.id, known, { suit: known.get(to.id)?.suit ?? i.suit, project: to.project ?? i.project }));
}

/** The steps that stay in the plan, in the order the day takes them: what has to happen, the goals, where the person is, the pillars. */
export function keptItems(d: Draft): DraftItem[] {
  return sectionsOf(d).filter(i => !i.locked && !i.skipped && (i.id || i.step));
}
/** The step to start with: the AI's, if it is still kept, else the first kept step. */
export function firstKey(d: Draft): string | null {
  const kept = keptItems(d);
  return kept.find(i => i.key === d.first)?.key ?? kept[0]?.key ?? null;
}

/**
 * The one change-set a morning ends in: new steps, broken-down steps, and `day.update` with the plan and the first step. Fixed-time
 * items already on the day's list stay on it; steps that were on it and are skipped leave it; the rest of the list is untouched.
 */
export function morningChangeSet(d: Draft, ctx: { date: string; existing: readonly string[]; known: ReadonlyMap<string, { project: string; where?: string }> }): ChangeSet | null {
  const kept = keptItems(d);
  if (!kept.length) return null;
  const ref = (i: DraftItem) => i.id ?? 'n' + i.key.slice(4);
  const changes: unknown[] = [];
  for (const i of kept) if (i.step) changes.push({ op: 'task.create', ref: ref(i), set: { ...clean(i.step), suit: i.suit, project: i.project ?? 'inbox', important: true } });
  const split = new Set<string>();
  for (const sp of d.split) {
    const tk = ctx.known.get(sp.id);
    if (!tk || split.has(sp.id) || !kept.some(i => i.id === sp.id)) continue;
    split.add(sp.id);
    changes.push(...splitChanges(sp.id, tk, sp.steps));
  }
  const all = sectionsOf(d);
  const lockedIds = new Set(all.filter(i => i.locked && i.id).map(i => i.id!));
  const touched = new Set(all.flatMap(i => (i.id ? [i.id] : [])));
  const first = firstKey(d);
  const order = [...kept].sort((a, b) => +(b.key === first) - +(a.key === first));
  const plan = [...new Set([...ctx.existing.filter(id => lockedIds.has(id) || !touched.has(id)), ...order.map(ref)])];
  changes.push({ op: 'day.update', date: ctx.date, plan, ...(first ? { first: ref(kept.find(i => i.key === first)!) } : {}) });
  return toChangeSet(changes, d.note);
}
