import { describe, expect, it } from 'vitest';
import { readChangeSet, type ChangeSet } from './changeset';
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
    tasks: m([task('t1'), task('t2'), task('t3', { status: 'dropped' })]),
    projects: m([{ id: 'p1', name: 'Thesis', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' }]),
    days: m([{ id: '2026-10-09', date: '2026-10-09', plan: ['t1'], launches: [], first: null, checkin: null, closed: null, summary: null }]),
    decisions: new Map(), places: new Map(), stays: new Map(), memory: new Map(),
  };
};
const gen = { id: (p: string) => p + 'x', now: () => '2026-10-09T10:00:00.000Z', zone: 'Europe/Paris' };
const cs = (changes: unknown[]): ChangeSet => { const r = readChangeSet({ v: 1, changes }); if (!r.ok) throw new Error(r.error); return r.cs; };
const low = (changes: unknown[]) => { const c = cs(changes); return isLowRisk(c, planChanges(c, snap(), gen)); };

describe('one low-risk change', () => {
  it('is a single added step, a step ticked done, or a date moved', () => {
    expect(low([{ op: 'task.create', set: { title: 'Choir, Hill House 602', due: '2026-10-12', at: '19:00' } }])).toBe(true);
    expect(low([{ op: 'task.done', id: 't1' }])).toBe(true);
    expect(low([{ op: 'task.update', id: 't1', set: { due: '2026-10-16' } }])).toBe(true);
    expect(low([{ op: 'task.update', id: 't1', set: { due: '2026-10-16', at: '18:00' } }])).toBe(true);
  });
  it('is not anything else', () => {
    expect(low([{ op: 'task.drop', id: 't1' }])).toBe(false);
    expect(low([{ op: 'task.update', id: 't1', set: { title: 'Another title' } }])).toBe(false);
    expect(low([{ op: 'task.update', id: 't1', set: { due: '2026-10-16', est: 40 } }])).toBe(false);
    expect(low([{ op: 'day.update', date: '2026-10-09', add: ['t2'] }])).toBe(false);
    expect(low([{ op: 'task.done', id: 't1' }, { op: 'task.done', id: 't2' }])).toBe(false);
    expect(low([{ op: 'task.update', id: 'nope', set: { due: '2026-10-16' } }])).toBe(false);
  });
  it('says which changes came to nothing', () => {
    const c = cs([{ op: 'task.drop', id: 't1' }, { op: 'task.update', id: 'nope', set: { due: '2026-10-10' } }, { op: 'task.drop', id: 't3' }]);
    expect(planChanges(c, snap(), gen).skippedAt).toEqual([1, 2]);
  });
});
