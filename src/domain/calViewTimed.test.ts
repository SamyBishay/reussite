import { describe, expect, it } from 'vitest';
import { day, state, task } from './agenda.fixture';
import { calViewEvents, type CalViewData, type CalViewOptions } from './calView';

const data = (o: Parameters<typeof state>[0]): CalViewData => ({ ...(state(o) as unknown as CalViewData), projects: new Map(), addresses: new Map() });
const opts = (o: Partial<CalViewOptions> = {}): CalViewOptions => ({
  today: '2026-10-21', dayStart: '05:00', reviewDay: 7, onPage: () => true, now: Date.parse('2026-10-21T08:00:00Z'), zone: 'Europe/Paris', ...o,
});
const card = (id: string, o = {}) => task(id, { title: 'Open ' + id, est: 30, ...o });

describe('planned cards on the grid', () => {
  it('a plan with Start 09:30 and three 30-minute cards is at 09:30, 10:00 and 10:30, none on the all-day row', () => {
    const d = data({ tasks: [card('a'), card('b'), card('c')], days: [day('2026-10-23', { plan: ['a', 'b', 'c'], launches: [{ t: '09:30', k: 'start' }] })] });
    const evs = calViewEvents(d, opts(), '2026-10-23', '2026-10-23').filter(e => e.kind === 'plan');
    expect(evs.map(e => [e.time, e.endTime, e.projected])).toEqual([['09:30', '10:00', true], ['10:00', '10:30', true], ['10:30', '11:00', true]]);
  });

  it('a past day: done cards at their real time, a card not done is left on the all-day row', () => {
    const t = [card('a', { status: 'done', doneDay: '2026-10-19', doneAt: '2026-10-19T09:00:00Z' }), card('b')];
    const sessions = new Map([['s', { id: 's', taskId: 'a', d: '2026-10-19', m: 20, why: null, at: '2026-10-19T09:00:00Z', source: 'timer' }]]);
    const d = { ...data({ tasks: t, days: [day('2026-10-19', { plan: ['a', 'b'] })] }), sessions } as unknown as CalViewData;
    const evs = calViewEvents(d, opts(), '2026-10-19', '2026-10-19');
    expect(evs.find(e => e.taskId === 'a')).toMatchObject({ kind: 'done', time: '10:40', endTime: '11:00', projected: false });
    expect(evs.find(e => e.taskId === 'b')).toMatchObject({ kind: 'plan' });
    expect(evs.find(e => e.taskId === 'b')!.time).toBeUndefined();
  });

  it('puts an "if there is room" step last, marked', () => {
    const d = data({ tasks: [card('a'), card('o')], days: [day('2026-10-23', { plan: ['a'], optional: ['o'], launches: [{ t: '09:00', k: 'start' }] })] });
    const evs = calViewEvents(d, opts(), '2026-10-23', '2026-10-23').filter(e => e.kind === 'plan');
    expect(evs.map(e => [e.taskId, e.time, !!e.optional])).toEqual([['a', '09:00', false], ['o', '09:30', true]]);
  });
});
