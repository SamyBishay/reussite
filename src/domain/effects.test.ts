import { describe, expect, it } from 'vitest';
import { dueRulePatches, finishEffects, newTaskFields, nextOccurrence, projectCompletes } from './effects';
import { whereNow } from './places';
import { estPointsOf, fixedOn, isOpen, planOf, stepLine, yesterdayOpen, type TaskW } from './lists';
import type { Task } from '../data/schema';

const NOW = '2026-10-19T10:00:00.000Z';
const base = (id: string, o: Partial<Task> = {}): TaskW => ({ ...newTaskFields('Step ' + id, 'S', 'p1', {}, new Map(), NOW, 1), id, ...o });
const proj = new Map([['p1', { suit: 'D' as const, where: 'paris', status: 'active' as const }]]);

describe('new steps', () => {
  it('take their defaults from the project', () => {
    const t = newTaskFields('Pay', null, 'p1', { est: 10 }, proj, NOW, 5);
    expect(t).toMatchObject({ title: 'Pay', suit: 'D', project: 'p1', where: 'paris', est: 10, order: 5, created: NOW, status: 'open', src: 'page' });
    expect(newTaskFields('Loose', null, null, {}, proj, NOW, 5)).toMatchObject({ project: 'inbox', suit: 'S', where: 'any' });
  });
});

describe('finishing a step', () => {
  const o = { today: '2026-10-19', day: '2026-10-19', nowIso: NOW, nowMs: Date.parse(NOW) };
  it('freezes the estimate and stamps today', () => {
    const f = finishEffects({ started: null, est: 20, est0: null }, o);
    expect(f.patch).toMatchObject({ status: 'done', doneDay: '2026-10-19', doneAt: NOW, est0: 20, started: null });
    expect(f.session).toBeNull();
  });
  it('saves a running timer, or typed minutes, as a session', () => {
    const started = new Date(Date.parse(NOW) - 25 * 60_000).toISOString();
    expect(finishEffects({ started, est: 20, est0: 20 }, o).session).toEqual({ m: 25, source: 'timer', why: 'done', d: '2026-10-19' });
    expect(finishEffects({ started, est: 20, est0: 20 }, { ...o, minutes: 12 }).session).toMatchObject({ m: 12, source: 'corrected' });
    expect(finishEffects({ started: null, est: 20, est0: 20 }, { ...o, typed: 15 }).session).toMatchObject({ m: 15, source: 'typed' });
  });
  it('dates an earlier day at noon', () => {
    expect(finishEffects({ started: null, est: null, est0: null }, { ...o, day: '2026-10-17' }).patch).toMatchObject({ doneDay: '2026-10-17', doneAt: '2026-10-17T12:00:00.000Z' });
  });
});

describe('repeats, projects and stays', () => {
  it('makes the next occurrence once', () => {
    const r = base('t1', { repeat: { every: 1, unit: 'week', from: 'due' }, due: '2026-10-19', at: '19:00' });
    expect(nextOccurrence(r, '2026-10-19', [r])).toMatchObject({ fields: { due: '2026-10-26', prev: 't1', at: '19:00', est0: null, src: 'repeat' } });
    expect(nextOccurrence(r, '2026-10-19', [r, base('t2', { prev: 't1' })])).toEqual({ existing: 't2' });
    expect(nextOccurrence(base('t3'), '2026-10-19', [])).toBeNull();
  });
  it('a repeating step that feeds a person or an address keeps feeding them', () => {
    const r = base('t1', { repeat: { every: 1, unit: 'week', from: 'due' }, due: '2026-10-19', personId: 'pe1', addressId: 'a1', offer: 'person' });
    expect(nextOccurrence(r, '2026-10-19', [r])).toMatchObject({ fields: { personId: 'pe1', addressId: 'a1' } });
  });
  it('completes a project when its real steps are all done', () => {
    const p = new Map([['p1', { status: 'active' as const }]]);
    const t = (status: Task['status']) => ({ project: 'p1', template: false, status });
    expect(projectCompletes('p1', p, [t('done'), t('done'), t('dropped')])).toBe(true);
    expect(projectCompletes('p1', p, [t('done'), t('open')])).toBe(false);
    expect(projectCompletes('p1', p, [t('done')])).toBe(false);
    expect(projectCompletes('inbox', new Map([['inbox', { status: 'active' as const }]]), [t('done'), t('done')])).toBe(false);
  });
  it('moves "before I leave" dates with the stay', () => {
    const t = base('t1', { dueRule: { beforeEndOf: 's1', daysBefore: 2 }, due: '2026-11-01' });
    expect(dueRulePatches('s1', { to: '2026-12-10' }, [t])).toEqual([{ id: 't1', due: '2026-12-08' }]);
    expect(dueRulePatches('s1', { to: '2026-11-03' }, [t])).toEqual([]);
  });
});

describe('read rules on plain data', () => {
  const tasks = new Map([base('t1'), base('t2', { status: 'done', doneDay: '2026-10-18' }), base('t3', { at: '09:00', due: '2026-10-19' }), base('t4', { status: 'dropped' })].map(t => [t.id, t]));
  const days = new Map([['2026-10-18', { id: '2026-10-18', date: '2026-10-18', plan: ['t1', 't2', 't4', 'gone'] }], ['2026-10-19', { id: '2026-10-19', date: '2026-10-19', plan: ['t2'] }]]) as never;
  it('lists a day without dropped or missing steps, and what carries over', () => {
    expect(planOf({ days, tasks }, '2026-10-18')).toEqual(['t1', 't2']);
    expect(planOf({ days, tasks }, '2026-10-19')).toEqual([]); // done on the 18th, whose list holds it: one list only
    expect(yesterdayOpen({ days, tasks }, '2026-10-19', '2026-10-18')).toEqual(['t1']);
    expect(fixedOn({ days, tasks }, '2026-10-19').map(t => t.id)).toEqual(['t3']);
    expect(isOpen(tasks.get('t2'))).toBe(false);
  });
  it('writes a compact line', () => {
    expect(stepLine({ ...tasks.get('t1')!, title: 'Call | the agency', est: 10, due: '2026-10-20' }, { today: '2026-10-19', urgencyDays: 21, projects: new Map([['p1', { name: 'Move' }]]) as never })).toBe('t1 | Call / the agency | Q1 | 2026-10-20 | 10m | Move');
  });
  it('learns from done steps with time', () => {
    const pts = estPointsOf([base('t2', { status: 'done', est0: 10, doneDay: '2026-10-10' })], [{ taskId: 't2', m: 20, source: 'timer' }, { taskId: 't2', m: 10, source: 'typed' }]);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ est0: 10, real: 30 });
  });
});

describe('where and when', () => {
  const zone = (id: string) => (id === 'tokyo' ? 'Asia/Tokyo' : 'Europe/Paris');
  it('follows the stay, in its time zone, with the day-start rule', () => {
    const at = new Date('2026-10-19T21:30:00Z'); // 06:30 in Tokyo on the 20th, 23:30 in Paris on the 19th
    expect(whereNow(at, { here: 'paris', dayStart: '05:00' }, zone, [])).toMatchObject({ today: '2026-10-19', here: 'paris', stay: null });
    const stay = { id: 's1', placeId: 'tokyo', from: '2026-10-19', to: '2026-10-25' };
    expect(whereNow(at, { here: 'paris', dayStart: '05:00' }, zone, [stay])).toMatchObject({ today: '2026-10-20', here: 'tokyo' });
  });
});
