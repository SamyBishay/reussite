// Deadlines, appointments and slots in the change-set (plan 10 Nov): `dueAt` (the time of a deadline), `at` and `dur` (an appointment) and
// `slot` (work time) are accepted and kept apart; a slot is one per step and its log keeps the past; a standing step and an event take neither.
import { describe, expect, it } from 'vitest';
import { ChangeSchema, readChangeSet, type ChangeSet } from './changeset';
import { planChanges, type Snapshot } from './apply';
import type { Task } from '../data/schema';

const task = (id: string, o: Partial<Task> = {}): Task & { id: string } => ({
  id, title: 'Step ' + id, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me',
  status: 'open', doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: Number(id.slice(1)), created: '', ...o,
});
const SLOT = { day: '2026-10-09', at: '14:00', dur: 45 };
const snap = (): Snapshot => {
  const m = <T extends { id: string }>(xs: T[]) => new Map(xs.map(x => [x.id, x]));
  return {
    today: '2026-10-09',
    tasks: m([
      task('t1'), task('t2', { due: '2026-10-12', dueAt: '17:00' }), task('t3', { slot: SLOT, slotLog: [{ from: null, to: SLOT, at: '2026-10-08T08:00:00.000Z', by: 'me', why: 'planned' }] }),
      task('t4', { title: 'Choir', template: true, weekdays: [1], at: '19:00', dur: 90 }), task('t5', { kind: 'event', est: null, important: false }),
    ]),
    projects: m([{ id: 'p1', name: 'Thesis', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' }]),
    days: m([{ id: '2026-10-09', date: '2026-10-09', plan: ['t1'], launches: [], first: null, checkin: null, closed: null, summary: null }]),
    decisions: new Map(), places: new Map(), stays: new Map(), memory: new Map(),
  };
};
const gen = { id: (p: string) => p + 'x', now: () => '2026-10-09T10:00:00.000Z', zone: 'Europe/Paris' };
const cs = (changes: unknown[]): ChangeSet => { const r = readChangeSet({ v: 1, changes }); if (!r.ok) throw new Error(r.error); return r.cs; };
const plan = (changes: unknown[]) => planChanges(cs(changes), snap(), gen);
const issues = (c: unknown) => { const r = ChangeSchema.safeParse(c); return r.success ? [] : r.error.issues.map(i => i.path.join('.') + ': ' + i.message); };
const patchOf = (p: ReturnType<typeof plan>, i = 0) => { const op = p.items[i]!.ops[0]!; return (op.t === 'update' ? op.patch : op.t === 'task' ? op.fields : {}) as Record<string, unknown>; };

describe('the three times in a change-set', () => {
  it('a step is created with a deadline and its time, an appointment, and a slot, each in its own field', () => {
    const p = plan([{ op: 'task.create', set: { title: 'Write the report', due: '2026-10-12', dueAt: '17:00', slot: SLOT } }, { op: 'task.create', set: { title: 'Call the dentist', due: '2026-10-09', at: '10:00', dur: 30 } }]);
    expect(patchOf(p, 0)).toMatchObject({ due: '2026-10-12', dueAt: '17:00', slot: SLOT, slotLog: [{ from: null, to: SLOT, by: 'ai', why: 'set' }] });
    expect(patchOf(p, 0)).not.toHaveProperty('at');
    expect(patchOf(p, 1)).toMatchObject({ at: '10:00', dur: 30 });
    expect(patchOf(p, 1)).not.toHaveProperty('slot');
    // The review screen shows the three, not the log.
    expect(p.items[0]!.diffs.map(d => d.field).sort()).toEqual(['due', 'dueAt', 'slot']);
  });

  it('a slot moves with the old one kept in the log; the same slot is no change; null takes it off', () => {
    const moved = plan([{ op: 'task.update', id: 't3', set: { slot: { day: '2026-10-09', at: '16:00', dur: 45 } } }]);
    const f = patchOf(moved) as { slot: unknown; slotLog: { from: unknown; to: unknown; why: string }[] };
    expect(f.slot).toEqual({ day: '2026-10-09', at: '16:00', dur: 45 });
    expect(f.slotLog).toHaveLength(2);
    expect(f.slotLog[1]).toMatchObject({ from: SLOT, to: { at: '16:00' }, why: 'set' });
    expect(plan([{ op: 'task.update', id: 't3', set: { slot: { ...SLOT } } }]).items).toHaveLength(0);
    expect(patchOf(plan([{ op: 'task.update', id: 't3', set: { slot: null } }]))).toMatchObject({ slot: null, slotLog: [{}, { to: null, why: 'cleared' }] });
  });

  it('dueAt needs a due: with none the time is dropped and the reason given; clearing the due clears the time', () => {
    const none = plan([{ op: 'task.update', id: 't1', set: { dueAt: '09:00' } }]);
    expect(none.items).toHaveLength(0);
    expect((none.notes ?? []).some(r => /dueAt .* needs a due/.test(r.text))).toBe(true);
    expect(patchOf(plan([{ op: 'task.update', id: 't1', set: { dueAt: '09:00', due: '2026-10-10' } }]))).toMatchObject({ due: '2026-10-10', dueAt: '09:00' });
    expect(patchOf(plan([{ op: 'task.update', id: 't2', set: { due: null } }]))).toMatchObject({ due: null, dueAt: null });
    expect(patchOf(plan([{ op: 'task.update', id: 't2', set: { dueAt: null } }]))).toEqual({ dueAt: null });
  });

  it('a standing step takes neither a deadline time nor a slot; an event takes neither', () => {
    expect(plan([{ op: 'task.update', id: 't4', set: { slot: SLOT, dueAt: '09:00' } }]).items).toHaveLength(0);
    expect(issues({ op: 'task.create', set: { title: 'A reply', kind: 'event', slot: SLOT } }).join()).toMatch(/event .* no slot/);
    expect(issues({ op: 'task.create', set: { title: 'A reply', kind: 'event', dueAt: '09:00' } }).join()).toMatch(/no .*dueAt/);
    expect(issues({ op: 'task.create', set: { title: 'A reply', kind: 'event', slot: null, dueAt: null } })).toEqual([]);
  });

  it('a malformed slot is refused by the contract', () => {
    expect(issues({ op: 'task.create', set: { title: 'x', slot: { day: 'tomorrow', at: '14:00', dur: 30 } } })).not.toEqual([]);
    expect(issues({ op: 'task.create', set: { title: 'x', slot: { day: '2026-10-09', at: '2pm', dur: 30 } } })).not.toEqual([]);
    expect(issues({ op: 'task.create', set: { title: 'x', slot: { day: '2026-10-09', at: '14:00' } } })).not.toEqual([]);
  });
});
