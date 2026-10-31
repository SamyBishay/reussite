import { describe, expect, it } from 'vitest';
import { choir, day, place, state, stay, task } from './agenda.fixture';
import { appSlot, calViewEvents, endClock, gridSlot, type CalViewData, type CalViewOptions } from './calView';

const data = (o: Parameters<typeof state>[0] = {}, more: Partial<CalViewData> = {}): CalViewData => ({
  ...(state(o) as unknown as CalViewData), projects: new Map(), addresses: new Map(), ...more,
});
const opts = (o: Partial<CalViewOptions> = {}): CalViewOptions => ({ dayStart: '05:00', ...o });
const kinds = (evs: ReturnType<typeof calViewEvents>) => evs.map(e => e.kind + ':' + (e.taskId ?? e.title));

describe('the calendar’s events', () => {
  it('puts a step with a time on the grid at its time and length and nothing else: no planned card, due step or marker', () => {
    const d = data({
      tasks: [
        task('dent', { title: 'Call the dentist about the crown', at: '09:15', due: '2026-10-22', dur: 45 }),
        task('plan', { title: 'Open Mail and reply to the landlord' }), task('due', { title: 'Pay the electricity bill', due: '2026-10-22' }),
        task('over', { title: 'Replace the hinge', at: '10:00', due: '2026-10-22', est: null }),
        task('rep', { title: 'Water the plants', due: '2026-10-22', repeat: { every: 1, unit: 'week', from: 'due' } }),
      ],
      days: [day('2026-10-22', { plan: ['plan'], launches: [{ t: '09:30', k: 'start' }] })],
      decisions: [{ id: 'd1', title: 'Flat', status: 'decided', reviewOn: '2026-10-22' } as never],
    });
    const evs = calViewEvents({ ...d, projects: new Map([['p1', { id: 'p1', name: 'Thesis', due: '2026-10-22', status: 'active' } as never]]) }, opts(), '2026-10-19', '2026-10-25');
    expect(evs.find(e => e.taskId === 'dent')).toMatchObject({ kind: 'fixed', date: '2026-10-22', time: '09:15', endTime: '10:00', title: 'dentist crown', movable: true });
    expect(evs.find(e => e.taskId === 'over')).toMatchObject({ time: '10:00', endTime: '11:00' }); // no length: an hour
    expect(kinds(evs).sort()).toEqual(['fixed:dent', 'fixed:over']);
    // Short name, never the title.
    expect(evs.map(e => e.title)).not.toContain('Call the dentist about the crown');
  });

  it('shows only the head of a chain; a waiting step’s time puts nothing on the calendar', () => {
    const d = data({
      tasks: [task('a', { at: '09:00', due: '2026-10-22' }), task('b', { after: 'a', due: '2026-10-22', at: '10:00' }), task('c', { after: 'b', due: '2026-10-22', at: '11:00' })],
    });
    expect(kinds(calViewEvents(d, opts(), '2026-10-22', '2026-10-22'))).toEqual(['fixed:a']);
  });

  it('has no event for a step the person waits for, even with a time left on it', () => {
    const d = data({ tasks: [task('e', { kind: 'event', title: 'The bellman calls back', at: '09:00', due: '2026-10-22' }), task('s', { at: '10:00', due: '2026-10-22' })] });
    expect(kinds(calViewEvents(d, opts(), '2026-10-22', '2026-10-22'))).toEqual(['fixed:s']);
  });

  it('shows a step’s own short name', () => {
    const evs = calViewEvents(data({ tasks: [task('a', { title: 'Open Mail and reply', label: 'Landlord', at: '10:00', due: '2026-10-22' })] }), opts(), '2026-10-22', '2026-10-22');
    expect(evs[0]!.title).toBe('Landlord');
  });

  it('shows a fixed item that is on a day’s list with no due date, and a done one struck, on past days too; not a dropped one', () => {
    const d = data({
      tasks: [task('a', { at: '08:00' }), task('p', { at: '09:00', due: '2026-10-20', status: 'done', doneDay: '2026-10-20' }), task('x', { at: '10:00', due: '2026-10-22', status: 'dropped' }), task('q', { status: 'done', doneDay: '2026-10-21' })],
      days: [day('2026-10-22', { plan: ['a'] }), day('2026-10-21', { plan: ['q'] })],
    });
    const evs = calViewEvents(d, opts(), '2026-10-20', '2026-10-22');
    expect(evs.map(e => [e.day, e.taskId, e.done, e.movable])).toEqual([['2026-10-20', 'p', true, false], ['2026-10-22', 'a', false, true]]);
  });

  it('puts a stay as a band, and leaves one outside the window out', () => {
    const d = data({ stays: [stay('s', 'cairo', '2026-10-20', '2026-10-24')], places: [place('paris', 'Europe/Paris'), place('cairo', 'Africa/Cairo')] });
    const evs = calViewEvents(d, opts(), '2026-10-19', '2026-10-25');
    expect(evs.find(e => e.kind === 'stay')).toMatchObject({ date: '2026-10-20', endDate: '2026-10-24', title: 'cairo', movable: false });
    expect(calViewEvents(d, opts(), '2026-11-01', '2026-11-07').some(e => e.kind === 'stay')).toBe(false);
  });

  it('shows a standing item on its weekdays at its time until a copy is placed, then only the copy', () => {
    const tpl = choir();
    const copy = task('c', { title: tpl.title, from: 'choir', at: '19:00', due: '2026-10-26', dur: 90 });
    // 2026-10-26 is a Monday; the 27th is not.
    const bare = calViewEvents(data({ tasks: [tpl] }), opts(), '2026-10-26', '2026-10-27');
    expect(bare).toHaveLength(1);
    expect(bare[0]).toMatchObject({ kind: 'fixed', taskId: 'choir', day: '2026-10-26', time: '19:00', endTime: '20:30', title: 'Choir Hill House 602', movable: false });
    const evs = calViewEvents(data({ tasks: [tpl, copy] }), opts(), '2026-10-26', '2026-10-26');
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: 'fixed', taskId: 'c', time: '19:00', endTime: '20:30', movable: true });
  });

  it('says where, short: the address’s name, else the place', () => {
    const d = data({ tasks: [task('a', { title: 'Meet', at: '12:00', due: '2026-10-22', addressId: 'ad' }), task('b', { title: 'Visit', at: '14:00', due: '2026-10-22', where: 'cairo' })], places: [place('cairo', 'Africa/Cairo')] }, {
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

  describe('areas', () => {
    const heli = { ...place('heli', 'Europe/Paris'), name: 'Heliopolis', parentId: 'cairo' };
    const world = () => data({
      places: [place('paris', 'Europe/Paris'), place('cairo', 'Africa/Cairo'), heli],
      tasks: [task('h', { title: 'Buy the sim', where: 'heli', at: '10:00', due: '2026-10-22' }), task('c', { title: 'Renew the visa', where: 'cairo', at: '11:00', due: '2026-10-22' }), task('a', { title: 'Call home', where: 'any', at: '12:00', due: '2026-10-22' })],
      days: [day('2026-10-22', { areas: [{ half: 'pm', placeId: 'heli' }] })],
    });
    const ids = kinds;

    it('shows a half day as a label on the day, with the area’s name', () => {
      const evs = calViewEvents(world(), opts(), '2026-10-22', '2026-10-22');
      expect(evs.find(e => e.kind === 'half')).toMatchObject({ half: 'pm', title: 'Heliopolis', day: '2026-10-22', movable: false });
      expect(ids(evs)).toContain('fixed:c');
    });

    it('narrowed to an area, keeps that area’s steps and Anywhere’s, not the place’s own', () => {
      const evs = calViewEvents(world(), opts({ area: 'heli' }), '2026-10-22', '2026-10-22');
      expect(ids(evs).sort()).toEqual(['fixed:a', 'fixed:h', 'half:Heliopolis']);
    });

    it('narrowed to another area, a half day spent elsewhere is not shown', () => {
      const evs = calViewEvents(world(), opts({ area: 'maadi' }), '2026-10-22', '2026-10-22');
      expect(evs.some(e => e.kind === 'half')).toBe(false);
    });
  });
});
