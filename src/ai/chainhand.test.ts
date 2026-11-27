// A chain is one card in a day's hand (src/domain/lists.ts, planOf): a change-set that takes one of its steps off a hand
// takes the whole chain off, as "Take off today" does in the app; otherwise the head would stand in for the step left behind.
import { describe, expect, it } from 'vitest';
import { readChangeSet, type ChangeSet } from './changeset';
import { planChanges, type Snapshot } from './apply';
import type { Task } from '../data/schema';

const task = (id: string, o: Partial<Task> = {}): Task & { id: string } => ({
  id, title: 'Card ' + id, project: 'p1', suit: 'C', kind: 'task', urgent: true, important: true, due: null, est: 10, est0: null, estBy: 'me',
  status: 'open', doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: Number(id.slice(1)), created: '', ...o,
});
const snap = (): Snapshot => {
  const m = <T extends { id: string }>(xs: T[]) => new Map(xs.map(x => [x.id, x]));
  return {
    today: '2026-11-27',
    tasks: m([task('t1'), task('t2'), task('t3', { after: ['t2'] })]),
    projects: m([{ id: 'p1', name: 'Inbox', suit: 'C', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' }]),
    days: m([{ id: '2026-11-27', date: '2026-11-27', plan: ['t1', 't2', 't3'], launches: [], first: null, checkin: null, closed: null, summary: null }]),
    decisions: new Map(), places: new Map(), stays: new Map(), memory: new Map(),
  };
};
const gen = { id: (p: string) => p + 'x', now: () => '2026-11-27T10:00:00.000Z', zone: 'Africa/Cairo' };
const cs = (changes: unknown[]): ChangeSet => { const r = readChangeSet({ v: 1, changes }); if (!r.ok) throw new Error(r.error); return r.cs; };

describe('day.update remove on a chain', () => {
  it('taking the head off takes the steps that wait on it off too', () => {
    const p = planChanges(cs([{ op: 'day.update', date: '2026-11-27', remove: ['t2'] }]), snap(), gen);
    expect(p.items[0]!.ops[0]).toMatchObject({ t: 'day', patch: { plan: ['t1'] } });
  });
  it('taking a waiting step off takes its chain off', () => {
    const p = planChanges(cs([{ op: 'day.update', date: '2026-11-27', remove: ['t3'] }]), snap(), gen);
    expect(p.items[0]!.ops[0]).toMatchObject({ t: 'day', patch: { plan: ['t1'] } });
  });
});
