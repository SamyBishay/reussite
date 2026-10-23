import { describe, expect, it } from 'vitest';
import { choir, day, place, state, stay, task } from './agenda.fixture';
import { appSlot, calViewEvents, endClock, gridSlot, type CalViewData, type CalViewOptions } from './calView';

const data = (o: Parameters<typeof state>[0] & { decisions?: never } = {}, more: Partial<CalViewData> = {}): CalViewData => ({
  ...(state(o) as unknown as CalViewData), projects: new Map(), addresses: new Map(), ...more,
});
const opts = (o: Partial<CalViewOptions> = {}): CalViewOptions => ({ today: '2026-10-21', dayStart: '05:00', reviewDay: 7, onPage: () => true, ...o });
const on = (evs: ReturnType<typeof calViewEvents>, k: string) => evs.filter(e => e.day === k && e.kind !== 'review');

describe('the calendar’s events', () => {
  it('puts a step with a time on the grid at its time and length, and everything else in the all-day row', () => {
    const d = data({
      tasks: [
        task('dent', { title: 'Call the dentist about the crown', at: '09:15', due: '2026-10-22', dur: 45 }),
        task('plan', { title: 'Open Mail and reply to the landlord' }), task('due', { title: 'Pay the electricity bill', due: '2026-10-22' }),
        task('over', { title: 'Replace the hinge', at: '10:00', due: '2026-10-22', est: null }),
      ],
      days: [day('2026-10-22', { plan: ['plan'] })],
    });
    const evs = on(calViewEvents(d, opts(), '2026-10-22', '2026-10-22'), '2026-10-22');
    const dent = evs.find(e => e.taskId === 'dent')!;
    expect(dent).toMatchObject({ kind: 'fixed', date: '2026-10-22', time: '09:15', endTime: '10:00', title: 'dentist crown', movable: true });
    expect(evs.find(e => e.taskId === 'over')).toMatchObject({ time: '10:00', endTime: '11:00' }); // no length: an hour
    const plan = evs.find(e => e.taskId === 'plan')!, due = evs.find(e => e.taskId === 'due')!;
    expect(plan).toMatchObject({ kind: 'plan', title: 'Mail landlord', movable: true });
    expect(plan.time).toBeUndefined();
    expect(due).toMatchObject({ kind: 'due', title: 'electricity bill' });
    // Short name, never the title; a step's own label wins.
    expect(evs.map(e => e.title)).not.toContain('Pay the electricity bill');
  });

  it('shows only the head of a chain; a waiting step’s date and place on a list put nothing on the calendar', () => {
    const d = data({
      tasks: [task('a'), task('b', { after: 'a', due: '2026-10-22' }), task('c', { after: 'b', due: '2026-10-22', at: '10:00' })],
      days: [day('2026-10-22', { plan: ['a', 'b'] })],
    });
    const evs = calViewEvents(d, opts(), '2026-10-22', '2026-10-22');
    expect(evs.map(e => e.kind + ':' + e.taskId)).toEqual(['plan:a']);
  });

  it('shows a step’s own short name', () => {
    const evs = calViewEvents(data({ tasks: [task('a', { title: 'Open Mail and reply', label: 'Landlord', due: '2026-10-22' })] }), opts(), '2026-10-22', '2026-10-22');
    expect(evs[0]!.title).toBe('Landlord');
  });

  it('does not show a step both on a list and as due, a dropped step, a standing item or a step on another page', () => {
    const d = data({
      tasks: [task('a', { due: '2026-10-22' }), task('drop', { due: '2026-10-22', status: 'dropped' }), task('std', { due: '2026-10-22', template: true }), task('far', { due: '2026-10-22', where: 'cairo' })],
      days: [day('2026-10-22', { plan: ['a', 'drop'] })],
    });
    const evs = calViewEvents(d, opts({ onPage: t => t.id !== 'far' }), '2026-10-22', '2026-10-22');
    expect(evs.map(e => e.kind + ':' + e.taskId)).toEqual(['plan:a']);
  });

  it('shows cards played on past days and a done step on its list struck, never a launch point', () => {
    const d = data({
      tasks: [task('p', { status: 'done', doneDay: '2026-10-20', doneAt: '2026-10-20T10:00:00Z' }), task('q', { status: 'done', doneDay: '2026-10-21' })],
      days: [day('2026-10-21', { plan: ['q'], launches: [{ t: '09:30', k: 'start' }] })],
    });
    const evs = calViewEvents(d, opts({ reviewDay: 5 }), '2026-10-20', '2026-10-22');
    expect(evs.map(e => [e.day, e.kind, e.done, e.movable])).toEqual([['2026-10-20', 'done', true, true], ['2026-10-21', 'done', true, true]]);
    // A done card is not shown on a future day.
    expect(calViewEvents(data({ tasks: [task('f', { status: 'done', doneDay: '2026-10-25' })] }), opts({ reviewDay: 5 }), '2026-10-24', '2026-10-26')).toEqual([]);
  });

  it('puts decision checks, a project’s due date and the review in the all-day row, and a stay as a band', () => {
    const d = data({ stays: [stay('s', 'cairo', '2026-10-20', '2026-10-24')], places: [place('paris', 'Europe/Paris'), place('cairo', 'Africa/Cairo')] }, {
      decisions: new Map([['d1', { id: 'd1', title: 'Flat', status: 'decided', reviewOn: '2026-10-22' } as never]]),
      projects: new Map([['p1', { id: 'p1', name: 'Thesis', due: '2026-10-23', status: 'active' } as never], ['p2', { id: 'p2', name: 'Old', due: '2026-10-23', status: 'done' } as never]]),
    });
    const evs = calViewEvents(d, opts({ reviewDay: 4 }), '2026-10-19', '2026-10-25');
    expect(evs.find(e => e.kind === 'stay')).toMatchObject({ date: '2026-10-20', endDate: '2026-10-24', title: 'cairo', movable: false });
    expect(evs.find(e => e.kind === 'check')).toMatchObject({ day: '2026-10-22', decisionId: 'd1', title: 'Flat' });
    expect(evs.filter(e => e.kind === 'project').map(e => e.title)).toEqual(['Thesis']);
    expect(evs.filter(e => e.kind === 'review').map(e => e.day)).toEqual(['2026-10-22']);
    // A stay outside the window is left out.
    expect(calViewEvents(d, opts(), '2026-11-01', '2026-11-07').some(e => e.kind === 'stay')).toBe(false);
  });

  it('marks later occurrences of a repeating step faintly, and not on a page it is not on', () => {
    const rep = task('r', { title: 'Water the plants', due: '2026-10-21', repeat: { every: 1, unit: 'week', from: 'due' } });
    const evs = calViewEvents(data({ tasks: [rep] }), opts(), '2026-10-21', '2026-11-05');
    expect(evs.filter(e => e.kind === 'repeat').map(e => e.day)).toEqual(['2026-10-28', '2026-11-04']);
    expect(evs.find(e => e.kind === 'repeat')!.movable).toBe(false);
    expect(calViewEvents(data({ tasks: [rep] }), opts({ onPage: () => false }), '2026-10-21', '2026-11-05').filter(e => e.kind === 'repeat')).toEqual([]);
  });

  it('does not make events of standing items until a copy is placed, and shows the copy at its time', () => {
    const tpl = choir();
    const copy = task('c', { title: tpl.title, from: 'choir', at: '19:00', due: '2026-10-26', dur: 90 });
    expect(calViewEvents(data({ tasks: [tpl] }), opts(), '2026-10-26', '2026-10-26')).toEqual([]);
    const evs = calViewEvents(data({ tasks: [tpl, copy] }), opts(), '2026-10-26', '2026-10-26');
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: 'fixed', time: '19:00', endTime: '20:30', title: 'Choir Hill House 602' });
  });

  it('says where, short: the address’s name, else the place', () => {
    const d = data({ tasks: [task('a', { title: 'Meet', at: '12:00', due: '2026-10-22', addressId: 'ad' }), task('b', { title: 'Visit', due: '2026-10-22', where: 'cairo' })], places: [place('cairo', 'Africa/Cairo')] }, {
      addresses: new Map([['ad', { id: 'ad', name: 'Chez Louise', street: '3 Rue X' } as never]]),
    });
    const evs = calViewEvents(d, opts(), '2026-10-22', '2026-10-22');
    expect(evs.find(e => e.taskId === 'a')!.where).toBe('Chez Louise');
    expect(evs.find(e => e.taskId === 'b')!.where).toBe('cairo');
  });
});

describe('where a time is drawn', () => {
  it('draws a time before the day starts on the next date, and puts a drop there back on the day', () => {
    expect(gridSlot('2026-10-22', '19:00', '05:00')).toEqual({ date: '2026-10-22', time: '19:00' });
    expect(gridSlot('2026-10-22', '01:30', '05:00')).toEqual({ date: '2026-10-23', time: '01:30' });
    expect(gridSlot('2026-10-22', '9:05', '05:00')).toEqual({ date: '2026-10-22', time: '09:05' });
    expect(appSlot('2026-10-23', '01:30', '05:00')).toEqual({ day: '2026-10-22', at: '01:30' });
    expect(appSlot('2026-10-23', '05:00', '05:00')).toEqual({ day: '2026-10-23', at: '05:00' });
    for (const t of ['00:00', '04:59', '05:00', '23:59']) expect(gridSlot(appSlot('2026-10-23', t, '05:00').day, t, '05:00')).toEqual({ date: '2026-10-23', time: t });
  });

  it('ends a fixed time after its length, at least 5 minutes, an hour by default, and never past 23:59', () => {
    expect(endClock('09:00', 45)).toBe('09:45');
    expect(endClock('09:00', 1)).toBe('09:05');
    expect(endClock('09:00', null)).toBe('10:00');
    expect(endClock('23:30', 120)).toBe('23:59');
  });
});
