// SMART goals v2 through the change-set: validation, planning, applying and undoing the outcome, measure, start,
// `advances` and `advanceBy`. The old `goal` name still works.
import { describe, expect, it } from 'vitest';
import { readChangeSet, parseChangeSet, type ChangeSet } from './changeset';
import { planChanges, applyPlanned, isLowRisk, type Snapshot, type Writer } from './apply';
import { UndoLog, undoWrites } from './undo';
import type { Project, Task } from '../data/schema';
import { advancing } from '../domain/goal';

const task = (id: string, o: Partial<Task> = {}): Task & { id: string } => ({
  id, title: 'Step ' + id, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me',
  status: 'open', doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: Number(id.slice(1)), created: '', ...o,
});
const proj = (o: Partial<Project> = {}): Project & { id: string } => ({ id: 'p1', name: 'Thesis', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active', ...o });
const snap = (projects: (Project & { id: string })[] = [proj()], tasks = [task('t1'), task('t2')]): Snapshot => {
  const m = <T extends { id: string }>(xs: T[]) => new Map(xs.map(x => [x.id, x]));
  return { today: '2026-10-09', tasks: m(tasks), projects: m(projects), days: new Map(), decisions: new Map(), places: new Map(), stays: new Map(), memory: new Map() };
};
let n = 0;
const gen = { id: (p: string) => p + 'x' + n++, now: () => '2026-10-09T10:00:00.000Z', zone: 'Europe/Paris' };
const cs = (changes: unknown[]): ChangeSet => { const r = readChangeSet({ v: 1, changes }); if (!r.ok) throw new Error(r.error); return r.cs; };
const patchOf = (set: object, p = proj()) => {
  const plan = planChanges(cs([{ op: 'project.update', id: 'p1', set }]), snap([p]), gen);
  return { plan, patch: (plan.items[0]?.ops[0] as { patch?: Record<string, unknown> } | undefined)?.patch };
};

describe('validating the new fields', () => {
  it('accepts a count, milestones and none; rejects a nonsense target or kind', () => {
    for (const measure of [{ kind: 'none' }, { kind: 'count', target: 10, unit: 'pages' }, { kind: 'count', target: '2,5' }, { kind: 'milestones', items: ['A', { text: 'B', done: true }, { text: 'C', done: '2026-10-01' }] }]) {
      expect(readChangeSet({ changes: [{ op: 'project.update', id: 'p1', set: { measure } }] }).ok, JSON.stringify(measure)).toBe(true);
    }
    for (const measure of [{ kind: 'count', target: 0 }, { kind: 'count', target: -1 }, { kind: 'count' }, { kind: 'bars' }, { kind: 'milestones', items: [''] }, { kind: 'milestones' }]) {
      expect(readChangeSet({ changes: [{ op: 'project.update', id: 'p1', set: { measure } }] }).ok, JSON.stringify(measure)).toBe(false);
    }
  });
  it('reads the count target and the amount from words, and a start as a day', () => {
    const r = cs([{ op: 'project.update', id: 'p1', set: { measure: { kind: 'count', target: '2,5', unit: ' km ' }, start: '2026-10-01' } }, { op: 'task.update', id: 't1', set: { advances: true, advanceBy: '3' } }]);
    expect(r.changes[0]).toMatchObject({ set: { measure: { kind: 'count', target: 2.5, unit: 'km' }, start: '2026-10-01' } });
    expect(r.changes[1]).toMatchObject({ set: { advances: true, advanceBy: 3 } });
  });
  it('an older contract still parses: goal, and no measure at all', () => {
    const r = parseChangeSet('{"v":1,"changes":[{"op":"project.update","id":"p1","set":{"goal":"Done by June","due":"2026-06-01"}}]}');
    expect(r.ok && r.cs.changes[0]).toMatchObject({ set: { goal: 'Done by June' } });
  });
  it('an event takes no advances; a bad advanceBy is refused', () => {
    expect(readChangeSet({ changes: [{ op: 'task.create', set: { title: 'The call', kind: 'event', advances: true } }] }).ok).toBe(false);
    expect(readChangeSet({ changes: [{ op: 'task.create', set: { title: 'The call', kind: 'event', advances: null } }] }).ok).toBe(true);
    expect(readChangeSet({ changes: [{ op: 'task.update', id: 't1', set: { advanceBy: 0 } }] }).ok).toBe(false);
  });
  it('an old client that does not know the fields would drop them (strict objects are not used)', () => {
    // The contract is additive: every new field is optional, so a change-set from before this version is read unchanged.
    const r = readChangeSet({ changes: [{ op: 'task.create', set: { title: 'x', project: 'p1' } }] });
    expect(r.ok && (r.cs.changes[0] as { set: object }).set).toEqual({ title: 'x', project: 'p1' });
  });
});

describe('planning a project change', () => {
  it('the old goal sets the outcome and never the stored goal', () => {
    const { patch } = patchOf({ goal: 'Done by June' });
    expect(patch).toEqual({ outcome: 'Done by June', goalBy: 'ai' });
  });
  it('outcome wins over goal; null clears it', () => {
    expect(patchOf({ outcome: 'New', goal: 'Old' }, proj({ outcome: 'Before' })).patch).toEqual({ outcome: 'New', goalBy: 'ai' });
    expect(patchOf({ outcome: null }, proj({ outcome: 'Before' })).patch).toEqual({ outcome: null, goalBy: null });
  });
  it('an outcome equal to the old goal of a project with no outcome field changes nothing', () => {
    expect(patchOf({ outcome: 'Same' }, proj({ goal: 'Same' })).plan.items).toHaveLength(0);
  });
  it('a count measure keeps the unit when none is given, and "none" over a project with no measure changes nothing', () => {
    expect(patchOf({ measure: { kind: 'count', target: 20 } }, proj({ measure: { kind: 'count', target: 10, unit: 'pages' } })).patch).toEqual({ measure: { kind: 'count', target: 20, unit: 'pages' } });
    expect(patchOf({ measure: { kind: 'none' } }).plan.items).toHaveLength(0);
    expect(patchOf({ measure: { kind: 'none' } }, proj({ measure: { kind: 'none' } })).plan.items).toHaveLength(0);
  });
  it('milestones keep the ids and ticks of the ones matched by text, and tick with done', () => {
    const p = proj({ measure: { kind: 'milestones', items: [{ id: 'a', text: 'Draft', done: '2026-09-01' }, { id: 'b', text: 'Filed', done: null }] } });
    const { patch, plan } = patchOf({ measure: { kind: 'milestones', items: ['Draft', { text: 'Filed', done: true }, 'Archived'] } }, p);
    expect(patch).toEqual({ measure: { kind: 'milestones', items: [{ id: 'a', text: 'Draft', done: '2026-09-01' }, { id: 'b', text: 'Filed', done: '2026-10-09' }, { id: expect.stringMatching(/^mx/), text: 'Archived', done: null }] } });
    expect(plan.items[0]!.diffs).toEqual([{ field: 'measure', before: p.measure, after: patch!.measure }]);
  });
  it('the diff of a measure shows "no bar" as the before for a project that has none stored', () => {
    const { plan } = patchOf({ measure: { kind: 'count', target: 5, unit: 'x' } });
    expect(plan.items[0]!.diffs[0]).toEqual({ field: 'measure', before: { kind: 'none' }, after: { kind: 'count', target: 5, unit: 'x' } });
  });
  it('start is a plain date field', () => {
    expect(patchOf({ start: '2026-10-01' }).patch).toEqual({ start: '2026-10-01' });
    expect(patchOf({ start: null }, proj({ start: null })).plan.items).toHaveLength(0);
  });
  it('a new project starts today with no bar, whatever the AI gives', async () => {
    const plan = planChanges(cs([{ op: 'project.create', ref: 'x', set: { name: 'Flat', outcome: 'Moved by June', measure: { kind: 'count', target: 8, unit: 'boxes' } } }]), snap(), gen);
    const created: Record<string, unknown>[] = [];
    const w: Writer = { createTask: async () => 'n', create: async (_c, f) => { created.push(f as never); return 'new'; }, update: async () => {}, finish: async () => {}, drop: async () => {}, day: async () => {}, stay: async () => 's' };
    await applyPlanned(plan, () => true, w);
    expect(created[0]).toMatchObject({ name: 'Flat', goal: null, outcome: 'Moved by June', measure: { kind: 'count', target: 8, unit: 'boxes' }, start: '2026-10-09', by: 'ai' });
    const bare = planChanges(cs([{ op: 'project.create', set: { name: 'Bare' } }]), snap(), gen);
    await applyPlanned(bare, () => true, w);
    expect(created[1]).toMatchObject({ outcome: null, measure: { kind: 'none' }, start: '2026-10-09' });
  });
});

describe('planning a step change', () => {
  const patchTask = (set: object, t = task('t1')) => {
    const plan = planChanges(cs([{ op: 'task.update', id: 't1', set }]), snap([proj()], [t]), gen);
    return { plan, patch: (plan.items[0]?.ops[0] as { patch?: Record<string, unknown> } | undefined)?.patch };
  };
  it('advances and advanceBy are written as given, and unchanged ones are left out', () => {
    expect(patchTask({ advances: true, advanceBy: 2 }).patch).toEqual({ advances: true, advanceBy: 2 });
    expect(patchTask({ advances: true }, task('t1', { advances: true })).plan.items).toHaveLength(0);
    expect(patchTask({ advances: null }, task('t1', { advances: null })).plan.items).toHaveLength(0);
    expect(patchTask({ advances: null }).plan.items).toHaveLength(0); // a step that never said is already "not said"
    expect(patchTask({ advances: false }, task('t1', { advances: true })).patch).toEqual({ advances: false });
  });
  it('a new step can say it moves the goal', () => {
    const plan = planChanges(cs([{ op: 'task.create', set: { title: 'Write the intro', project: 'p1', advances: true } }]), snap(), gen);
    expect(plan.items[0]!.ops[0]).toMatchObject({ t: 'task', fields: { title: 'Write the intro', advances: true } });
  });
  it('an event never moves a bar, even if it kept the answer from when it was a step', () => {
    const plan = planChanges(cs([{ op: 'task.update', id: 't1', set: { kind: 'event' } }]), snap([proj()], [task('t1', { advances: true })]), gen);
    expect(plan.items).toHaveLength(1);
    expect(advancing({ ...task('t1', { advances: true }), kind: 'event' })).toBe(false);
  });
});

describe('what waits for a yes', () => {
  it('a new step that says it moves the goal is not applied at once', () => {
    const one = (set: object) => { const c = cs([{ op: 'task.create', set }]); return isLowRisk(c, planChanges(c, snap(), gen)); };
    expect(one({ title: 'Write the intro', project: 'p1' })).toBe(true);
    expect(one({ title: 'Write the intro', project: 'p1', advances: true })).toBe(false);
    expect(one({ title: 'Write the intro', project: 'p1', advanceBy: 2 })).toBe(false);
  });
});

describe('undo', () => {
  it('puts the old measure and outcome back, field by field, and leaves a field changed since', () => {
    const before = { id: 'p1', _hlc: { outcome: 'c1', measure: 'c1' }, outcome: 'Old', measure: { kind: 'none' } };
    const next = { ...before, _hlc: { outcome: 'c2', measure: 'c2' }, outcome: 'New', measure: { kind: 'count', target: 3, unit: '' } };
    const log = new UndoLog();
    log.updated('projects', 'p1', before as never, next as never, ['outcome', 'measure']);
    const live = { ...next, _hlc: { outcome: 'c2', measure: 'c3' }, measure: { kind: 'count', target: 9, unit: '' } };
    const steps = undoWrites(log.docs, () => live as never);
    expect(steps.some(s => s.patch && 'outcome' in s.patch && s.patch.outcome === 'Old')).toBe(true);
    expect(steps.some(s => s.patch && 'measure' in s.patch)).toBe(false);
  });
});
