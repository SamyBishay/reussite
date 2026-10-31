import { describe, expect, it } from 'vitest';
import { plan, checkPlan, totalOf, type PlanInput, type PStep } from '../domain/planner';
import { PlanReply, readAiPlan, planChangeSet, DecisionReply, decisionChangeSet, reviewChangeSet, BreakDownReply, StuckReply, estByOf } from './features';
import { planChanges, applyPlanned, type Snapshot, type Writer } from './apply';
import { normDecision } from '../data/normalize';
import type { Option } from '../domain/decision';

const s = (id: string, quad: PStep['quad'], o: Partial<PStep> = {}): PStep => ({ id, quad, due: null, est: 15, starter: 'Open it', ...o });
const input = (o: Partial<PlanInput> = {}): PlanInput => ({
  today: '2026-10-09', maxWorkSteps: 3, planningMin: 15, obligationAt: '18:00',
  shape: { start: '09:30', preset: 'normal', fixed: [] },
  carried: [s('c1', 1)], candidates: [s('n1', 1), s('p1', 2), s('p2', 2), s('q1', 3, { est: 45 })],
  obligations: [{ id: 'o1', lastDone: null, est: 30 }, { id: 'o2', lastDone: '2026-10-01', est: 20 }], optional: [], laterPool: [], usualLoad: null, ...o,
});
const reply = (items: unknown[], more: Record<string, unknown> = {}) => PlanReply.parse({ plan: items, ...more });

describe('Plan my day: the AI plan keeps the rules or is set aside', () => {
  const inp = input();
  const rule = plan(inp);
  it('accepts a plan that keeps the rules, and fills in the obligation time', () => {
    const r = readAiPlan(reply([{ id: 'p2', role: 'protect' }, { id: 'c1', role: 'carried' }, { id: 'q1', role: 'quick' }, { id: 'o2', role: 'obligation' }]), inp, rule);
    expect(r).toEqual({ ok: true, items: [{ id: 'p2', role: 'protect' }, { id: 'c1', role: 'carried' }, { id: 'q1', role: 'quick', breakDown: true }, { id: 'o2', role: 'obligation', at: '18:00' }] });
  });
  it('rejects two Protect steps, no Protect, too many steps, two obligations or none', () => {
    const why = (items: unknown[]) => { const r = readAiPlan(reply(items), inp, rule); return r.ok ? 'ok' : r.why; };
    expect(why([{ id: 'p1', role: 'protect' }, { id: 'p2', role: 'protect' }, { id: 'o1', role: 'obligation' }])).toBe('twoProtect');
    expect(why([{ id: 'n1', role: 'now' }, { id: 'o1', role: 'obligation' }])).toBe('noProtect');
    expect(why([{ id: 'c1', role: 'carried' }, { id: 'n1', role: 'now' }, { id: 'p1', role: 'protect' }, { id: 'q1', role: 'quick' }, { id: 'o1', role: 'obligation' }])).toBe('tooMany');
    expect(why([{ id: 'p1', role: 'protect' }, { id: 'o1', role: 'obligation' }, { id: 'o2', role: 'obligation' }])).toBe('twoObligations');
    expect(why([{ id: 'p1', role: 'protect' }])).toBe('noObligation');
    expect(checkPlan({ items: [{ id: 'p1', role: 'protect' }] }, inp)).toEqual(['no obligation']);
  });
  it('rejects steps it wasn’t given, steps twice, and roles that don’t fit', () => {
    const why = (items: unknown[]) => { const r = readAiPlan(reply(items), inp, rule); return r.ok ? 'ok' : r.why; };
    expect(why([])).toBe('empty');
    expect(why([{ id: 'zz', role: 'now' }])).toBe('unknown');
    expect(why([{ id: 'p1', role: 'protect' }, { id: 'p1', role: 'protect' }])).toBe('twice');
    expect(why([{ id: 'n1', role: 'protect' }, { id: 'o1', role: 'obligation' }])).toBe('roles');
    expect(why([{ id: 'p1', role: 'protect' }, { id: 'o1', role: 'now' }])).toBe('roles');
    expect(why([{ id: 'p1', role: 'protect' }, { id: 'n1', role: 'carried' }, { id: 'o1', role: 'obligation' }])).toBe('roles');
  });
  it('relabelling carried steps doesn’t stretch the limit', () => {
    const many = input({ carried: [s('c1', 1), s('c2', 1), s('c3', 1)] });
    const r = readAiPlan(reply([{ id: 'c1', role: 'now' }, { id: 'c2', role: 'now' }, { id: 'c3', role: 'now' }, { id: 'p1', role: 'protect' }, { id: 'o1', role: 'obligation' }]), many, plan(many));
    expect(r.ok).toBe(true);
    const r2 = readAiPlan(reply([{ id: 'c1', role: 'now' }, { id: 'c2', role: 'now' }, { id: 'c3', role: 'now' }, { id: 'n1', role: 'now' }, { id: 'p1', role: 'protect' }, { id: 'o1', role: 'obligation' }]), many, plan(many));
    expect(r2).toEqual({ ok: false, why: 'tooMany' });
  });
  it('doesn’t hold against the AI a rule the rule-based plan can’t keep either (a rest day)', () => {
    const rest = input({ shape: { start: '10:00', preset: 'rest', fixed: [] } });
    expect(readAiPlan(reply([{ id: 'o1', role: 'obligation' }]), rest, plan(rest)).ok).toBe(true);
  });
  it('rejects malformed replies at the schema', () => {
    expect(PlanReply.safeParse({ plan: [{ id: 'p1', role: 'boss' }] }).success).toBe(false);
    expect(PlanReply.safeParse({ items: [] }).success).toBe(false);
  });
  it('totals the AI plan like the planner does', () => {
    expect(totalOf(rule.items, inp)).toEqual(rule.total);
  });
  it('turns starters and splits into a change-set chained with after', () => {
    const r = reply([{ id: 'p1', role: 'protect' }], {
      starters: [{ id: 'n1', starter: 'Open Mail' }, { id: 'zz', starter: 'nope' }],
      split: [{ id: 'q1', steps: [{ title: 'Open the folder', est: 5 }, { title: 'Sort the first ten', starter: 'Pick one', est: '15' }, { title: 'Bin the rest', est: 'soon' }] }],
    });
    const cs = planChangeSet(r, new Map([['n1', { project: 'p1' }], ['q1', { project: 'p2', where: 'home' }]]))!;
    expect(cs.changes).toEqual([
      { op: 'task.update', id: 'q1', set: { title: 'Open the folder', est: 5 } },
      { op: 'task.create', ref: 'q1-1', set: { title: 'Sort the first ten', starter: 'Pick one', est: 15, project: 'p2', where: 'home', after: ['q1'] } },
      { op: 'task.create', ref: 'q1-2', set: { title: 'Bin the rest', project: 'p2', where: 'home', after: ['q1-1'] } },
      { op: 'task.update', id: 'n1', set: { starter: 'Open Mail' } },
    ]);
    expect(planChangeSet({ starters: [], split: [] }, new Map())).toBeNull();
  });
});

// ---------- decision help: no weights ----------
const snap = (): Snapshot => {
  const m = <T extends { id: string }>(xs: T[]) => new Map(xs.map(x => [x.id, x]));
  return {
    today: '2026-10-09', tasks: new Map(), days: new Map(), places: new Map(), stays: new Map(), memory: new Map(),
    projects: m([{ id: 'p1', name: 'Move', suit: 'D', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' }]),
    decisions: m([{ ...normDecision({ title: 'Stay or move?', projectId: 'p1', options: [{ id: 'o1', name: 'Stay', pros: [{ id: 'i1', text: 'cheap', w: 4 }] }] }), id: 'd1' }]),
  };
};
let n = 0;
const gen = { id: (p: string) => p + 'x' + n++, now: () => '2026-10-09T10:00:00.000Z', zone: 'Europe/Paris' };
function fakeWriter() {
  const calls: [string, ...unknown[]][] = [];
  const w: Writer = {
    createTask: async f => { calls.push(['createTask', f]); return 'new' + calls.length; },
    create: async (c, f) => { calls.push(['create', c, f]); return 'new' + calls.length; },
    update: async (c, i, p) => { calls.push(['update', c, i, p]); },
    finish: async () => {}, drop: async () => {}, day: async () => {}, stay: async () => 'x',
  };
  return { w, calls };
}
const d1 = () => snap().decisions.get('d1')!;

describe('Decision help', () => {
  const raw = {
    title: 'Ignored: the decision has a title',
    problem: { what: 'Rent goes up 8%', gap: 'Budget is short by 60 a month' },
    options: [
      { name: 'Stay', pros: [{ text: 'No move', w: 5 }, 'Near work'], cons: [{ text: 'Rent', weight: 1, w: 1 }], prosNot: [], consNot: [] },
      { name: 'Move in with a friend', w: 4 },
      { name: 'stay' },
    ],
    weights: { Stay: 5 },
  };
  it('strips every weight the AI sends', () => {
    const r = DecisionReply.parse(raw);
    expect(JSON.stringify(r)).not.toMatch(/"w"|weight/);
    const items = decisionChangeSet(r, d1(), 'items', 'Stay')!;
    expect(JSON.stringify(items)).not.toMatch(/"w"|weight/);
    const p = planChanges(items, snap(), gen);
    const added = p.items.flatMap(it => it.ops).flatMap(op => (op.t === 'update' ? ((op.patch.options as Option[] | undefined) ?? []) : []))
      .flatMap(o => [...o.pros, ...o.cons]).filter(i => i.id !== 'i1');
    expect(added.length).toBeGreaterThan(0);
    for (const i of added) expect(i).toMatchObject({ w: 3, by: 'ai' });
  });
  it('keeps each kind of help to its own lines', () => {
    const r = DecisionReply.parse(raw);
    expect(decisionChangeSet(r, d1(), 'problem')!.changes).toEqual([
      { op: 'decision.update', id: 'd1', set: { problem: { what: 'Rent goes up 8%' } } },
      { op: 'decision.update', id: 'd1', set: { problem: { gap: 'Budget is short by 60 a month' } } },
    ]);
    // Only missing options, by name only.
    expect(decisionChangeSet(r, d1(), 'options')!.changes).toEqual([{ op: 'decision.update', id: 'd1', set: { options: [{ name: 'Move in with a friend' }] } }]);
    // Only the option being weighed, one item per line.
    expect(decisionChangeSet(r, d1(), 'items', 'Stay')!.changes).toHaveLength(3);
    expect(decisionChangeSet(r, d1(), 'items', 'Elsewhere')).toBeNull();
    expect(decisionChangeSet(DecisionReply.parse({ goal: 'Settled by June', smart: { dated: 'June 30' } }), d1(), 'steps')!.changes).toEqual([
      { op: 'project.update', id: 'p1', set: { goal: 'Settled by June' } },
      { op: 'project.update', id: 'p1', set: { smart: { dated: 'June 30' } } },
    ]);
  });
  it('two ticked lines on the same decision both land; an unticked one doesn’t', async () => {
    const r = DecisionReply.parse({ problem: { what: 'A', should: 'B', gap: 'C' }, options: [{ name: 'Stay', pros: ['x', 'y'] }] });
    const cs = { ...decisionChangeSet(r, d1(), 'problem')!, changes: [...decisionChangeSet(r, d1(), 'problem')!.changes, ...decisionChangeSet(r, d1(), 'items', 'Stay')!.changes] };
    const p = planChanges(cs, snap(), gen);
    expect(p.items).toHaveLength(5);
    const { w, calls } = fakeWriter();
    await applyPlanned(p, i => i !== 1, w);
    const last = Object.assign({}, ...calls.filter(c => c[0] === 'update').map(c => c[3])) as { problem: Record<string, string>; options: Option[] };
    expect(last.problem).toMatchObject({ what: 'A', should: '', gap: 'C' });
    expect(last.options[0]!.pros.map(i => i.text)).toEqual(['cheap', 'x', 'y']);
    expect(last.options[0]!.pros[0]!.w).toBe(4);
  });
});

describe('Break it down, Stuck, Sunday review', () => {
  it('reads proposed steps; an estimate stays the AI’s until the person changes it', () => {
    const r = BreakDownReply.parse({ steps: [{ title: 'Open the draft', starter: 'Click the file', est: 5 }, { title: 'Write two lines', est: 'a while' }] });
    expect(r.steps[1]).toEqual({ title: 'Write two lines' });
    expect(BreakDownReply.safeParse({ steps: [] }).success).toBe(false);
    expect(estByOf('5', 5)).toBe('ai');
    expect(estByOf('10', 5)).toBe('me');
    expect(estByOf('', 5)).toBeNull();
  });
  it('needs a starter for Stuck', () => {
    expect(StuckReply.parse({ starter: ' Open the file ' })).toEqual({ starter: 'Open the file', note: '' });
    expect(StuckReply.safeParse({ starter: '' }).success).toBe(false);
  });
  it('proposes a goal, SMART lines and chained next steps, marked as the AI’s when applied', () => {
    const cs = reviewChangeSet({ goal: 'Moved by June', smart: { specific: 'A flat near work' }, next: [{ title: 'Open the listings site' }, { title: 'Write to two agencies', est: 20 }], note: '' }, { id: 'p1' })!;
    expect(cs.changes.map(c => c.op)).toEqual(['project.update', 'project.update', 'task.create', 'task.create']);
    const p = planChanges(cs, snap(), gen);
    const patch = p.items.flatMap(it => it.ops).filter(op => op.t === 'update').map(op => (op as { patch: Record<string, unknown> }).patch);
    expect(patch[0]).toMatchObject({ goal: 'Moved by June', goalBy: 'ai' });
    expect(patch[1]).toMatchObject({ smartBy: 'ai' });
    expect(reviewChangeSet({ note: 'Looks fine.' }, { id: 'p1' })).toBeNull();
  });
});
