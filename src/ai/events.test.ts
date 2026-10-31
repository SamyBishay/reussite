// Event steps in the change-set (schema 6): something the person waits for. A change-set may make one (kind "event", an
// optional nudge), mark one happened (task.done with a day), or turn a step into one; an event has nothing a step has.
import { describe, expect, it } from 'vitest';
import { ChangeSchema, readChangeSet, type ChangeSet } from './changeset';
import { isLowRisk, planChanges, type Snapshot } from './apply';
import type { Task } from '../data/schema';

const task = (id: string, o: Partial<Task> = {}): Task & { id: string } => ({
  id, title: 'Step ' + id, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me',
  status: 'open', doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: Number(id.slice(1)), created: '', ...o,
});
const snap = (): Snapshot => {
  const m = <T extends { id: string }>(xs: T[]) => new Map(xs.map(x => [x.id, x]));
  return {
    today: '2026-10-09',
    tasks: m([
      task('t1'), task('t2', { after: ['t3'] }),
      task('t3', { kind: 'event', est: null, important: false, nudge: '2026-10-07' }),
      task('t4', { est: 20, due: '2026-10-12', at: '19:00' }),
    ]),
    projects: m([{ id: 'p1', name: 'Thesis', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' }]),
    days: m([
      { id: '2026-10-09', date: '2026-10-09', plan: ['t1', 't4'], launches: [], first: null, checkin: null, closed: null, summary: null },
      { id: '2026-10-10', date: '2026-10-10', plan: ['t4'], launches: [], first: null, checkin: null, closed: null, summary: null },
    ]),
    decisions: new Map(), places: new Map(), stays: new Map(), memory: new Map(),
  };
};
const gen = { id: (p: string) => p + 'x', now: () => '2026-10-09T10:00:00.000Z', zone: 'Europe/Paris' };
const cs = (changes: unknown[]): ChangeSet => { const r = readChangeSet({ v: 1, changes }); if (!r.ok) throw new Error(r.error); return r.cs; };
const plan = (changes: unknown[]) => planChanges(cs(changes), snap(), gen);
const issues = (c: unknown) => { const r = ChangeSchema.safeParse(c); return r.success ? [] : r.error.issues.map(i => i.path.join('.') + ': ' + i.message); };

describe('an event in a change-set', () => {
  it('is made with a nudge day, and has nothing a step has', () => {
    const p = plan([{ op: 'task.create', ref: 'e', set: { title: 'The bellman calls back', kind: 'event', nudge: '2026-10-20', after: ['t1'] } }]);
    expect(p.items).toHaveLength(1);
    const op = p.items[0]!.ops[0]!;
    expect(op).toMatchObject({ t: 'task', fields: { title: 'The bellman calls back', kind: 'event', nudge: '2026-10-20', est: null, starter: null, important: false, urgent: false, due: null, at: null, template: false } });
    expect(p.items[0]!.diffs.map(d => d.field).sort()).toEqual(['after', 'kind', 'nudge']);
  });

  it('may have no nudge, or a null one', () => {
    expect(issues({ op: 'task.create', set: { title: 'A reply', kind: 'event' } })).toEqual([]);
    expect(issues({ op: 'task.create', set: { title: 'A reply', kind: 'event', nudge: null, est: null, urgent: false, due: null } })).toEqual([]);
  });

  it('is refused with an estimate, a starter, a time, a date or a flag, and the message names them', () => {
    const bad = issues({ op: 'task.create', set: { title: 'The bellman calls back', kind: 'event', est: 15, starter: 'Call', due: '2026-10-20', important: true } });
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain('kind: an event');
    expect(bad[0]).toContain('est, starter, important, due');
    expect(issues({ op: 'task.update', id: 't1', set: { kind: 'event', at: '19:00' } })[0]).toContain('has no at');
    expect(issues({ op: 'task.create', set: { title: 'x', kind: 'event', template: true, weekdays: [1], at: '19:00' } })[0]).toContain('template');
    // a decision's steps too
    expect(issues({ op: 'decision.create', set: { title: 'Which flat', steps: [{ title: 'Wait', kind: 'event', est: 5 }] } })).toHaveLength(1);
    // the whole change-set is read with the bad change counted
    expect(readChangeSet({ v: 1, changes: [{ op: 'task.create', set: { title: 'x', kind: 'event', est: 5 } }, { op: 'task.done', id: 't1' }] })).toMatchObject({ ok: true, cs: { bad: 1 } });
  });

  it('keeps a nudge for events only', () => {
    expect(issues({ op: 'task.create', set: { title: 'A step', nudge: '2026-10-20' } })[0]).toContain('nudge is the check date of an event');
    expect(issues({ op: 'task.create', set: { title: 'A step', kind: 'task', nudge: '2026-10-20' } })).toHaveLength(1);
    expect(issues({ op: 'task.update', id: 't3', set: { nudge: '2026-10-20' } })).toEqual([]);
    expect(issues({ op: 'task.update', id: 't3', set: { nudge: '10/20' } })).toHaveLength(1);
    // on an update with no kind it depends on the step named: a step is told so, and nothing is changed
    const p = plan([{ op: 'task.update', id: 't1', set: { nudge: '2026-10-20' } }]);
    expect(p.items).toHaveLength(0);
    expect(p.notes).toEqual([{ at: 0, text: expect.stringContaining('nudge is the check date') }]);
  });

  it('is marked happened with task.done, on a past day or today, never a later one', () => {
    for (const [day, want] of [['2026-10-05', '2026-10-05'], [undefined, '2026-10-09'], ['2026-10-20', '2026-10-09']] as const) {
      const p = plan([{ op: 'task.done', id: 't3', ...(day ? { day } : {}) }]);
      expect(p.items[0]).toMatchObject({ kind: 'done', ops: [{ t: 'finish', id: 't3', day: want }] });
    }
  });

  it('is low-risk to make one or to mark one happened, like a step; the rest is decided as before', () => {
    const low = (changes: unknown[]) => { const c = cs(changes); return isLowRisk(c, planChanges(c, snap(), gen)); };
    expect(low([{ op: 'task.create', set: { title: 'The bellman calls back', kind: 'event', nudge: '2026-10-20' } }])).toBe(true);
    expect(low([{ op: 'task.done', id: 't3', day: '2026-10-05' }])).toBe(true);
    expect(low([{ op: 'task.drop', id: 't3' }])).toBe(false);
    expect(low([{ op: 'task.update', id: 't3', set: { nudge: '2026-10-25' } }])).toBe(false);
    expect(low([{ op: 'task.update', id: 't1', set: { kind: 'event' } }])).toBe(false);
  });

  it('stays out of a day\'s list', () => {
    expect(plan([{ op: 'day.update', date: '2026-10-09', add: ['t3'] }]).items).toHaveLength(0);
    const both = plan([{ op: 'task.create', ref: 'e', set: { title: 'A reply', kind: 'event' } }, { op: 'day.update', date: '2026-10-09', add: ['e', 't2'] }]);
    expect(both.items[1]!.ops[0]).toMatchObject({ t: 'day', patch: { plan: ['t1', 't4', 't2'] } });
  });
});

describe('turning a step into an event, and back', () => {
  it('sets to nothing what a step has, and takes it off every list', () => {
    const p = plan([{ op: 'task.update', id: 't4', set: { kind: 'event', nudge: '2026-10-20' } }]);
    expect(p.items).toHaveLength(1);
    const [patch, ...days] = p.items[0]!.ops;
    expect(patch).toMatchObject({ t: 'update', c: 'tasks', id: 't4', patch: { kind: 'event', nudge: '2026-10-20', est: null, due: null, at: null, important: false } });
    expect(days).toEqual([
      { t: 'day', k: '2026-10-09', patch: { plan: ['t1'] } },
      { t: 'day', k: '2026-10-10', patch: { plan: [] } },
    ]);
  });

  it('is not done to a running step, a done step or a standing one', () => {
    const s = snap();
    (s.tasks as Map<string, Task & { id: string }>).set('t5', task('t5', { started: '2026-10-09T09:00:00.000Z' }));
    (s.tasks as Map<string, Task & { id: string }>).set('t6', task('t6', { status: 'done', doneDay: '2026-10-08' }));
    (s.tasks as Map<string, Task & { id: string }>).set('t7', task('t7', { template: true, weekdays: [1], at: '19:00' }));
    for (const id of ['t5', 't6', 't7']) {
      const p = planChanges(cs([{ op: 'task.update', id, set: { kind: 'event' } }]), s, gen);
      expect(p.items).toHaveLength(0);
      expect(p.notes).toHaveLength(1);
    }
  });

  it('is cut back, with the reason, when an event is given an estimate by an update', () => {
    const p = plan([{ op: 'task.update', id: 't3', set: { est: 30, nudge: '2026-10-20' } }]);
    expect(p.notes).toEqual([{ at: 0, text: expect.stringContaining('has no est') }]);
    expect(p.items[0]!.ops[0]).toMatchObject({ patch: { nudge: '2026-10-20' } });
    expect(p.items[0]!.diffs.map(d => d.field)).toEqual(['nudge']);
  });

  it('may be a step again, which has no nudge and takes an estimate', () => {
    const p = plan([{ op: 'task.update', id: 't3', set: { kind: 'task', est: 25 } }]);
    expect(p.notes).toBeUndefined();
    expect(p.items[0]!.ops[0]).toMatchObject({ patch: { kind: 'task', est: 25, nudge: null } });
  });
});
