import { describe, expect, it } from 'vitest';
import { agenda, clockOf, fixedOnDay } from './agenda';
import { choir, day, decision, place, settings, state, stay, task, iso } from './agenda.fixture';

const S = settings();
const week = (w: Parameters<typeof state>[0], from = '2026-10-19', to = '2026-10-25', s = S) => agenda(state(w), s, from, to);
const fixed = (w: Parameters<typeof state>[0], from?: string, to?: string) => week(w, from, to).filter(e => e.kind === 'fixed');

describe('standing obligations', () => {
  it('expand on their weekdays, at the place’s wall time', () => {
    const ev = fixed({ tasks: [choir({ weekdays: [1, 4] })] }, '2026-10-19', '2026-10-30');
    expect(ev.map(e => e.id)).toEqual(['fixed:choir:2026-10-19', 'fixed:choir:2026-10-22', 'fixed:choir:2026-10-26', 'fixed:choir:2026-10-29']);
    expect(ev[0]).toMatchObject({ time: '19:00', place: 'paris', zone: 'Europe/Paris', lead: 30, dur: 90, title: 'Choir, Hill House 602', template: true, taskId: 'choir', rootId: 'choir' });
    // 19:00 on the wall is an hour later in UTC once clocks have gone back (25 October).
    expect(ev.map(e => iso(e.at))).toEqual(['2026-10-19T17:00:00.000Z', '2026-10-22T17:00:00.000Z', '2026-10-26T18:00:00.000Z', '2026-10-29T18:00:00.000Z']);
  });

  it('need weekdays and a time; an older step without them gives nothing', () => {
    expect(fixed({ tasks: [choir({ weekdays: null })] })).toEqual([]);
    expect(fixed({ tasks: [choir({ weekdays: [] })] })).toEqual([]);
    expect(fixed({ tasks: [choir({ at: null })] })).toEqual([]);
    const old = task('old', { template: true });
    delete (old as Record<string, unknown>).lead;
    expect(fixed({ tasks: [old] })).toEqual([]);
    expect(fixed({ tasks: [choir({ weekdays: [1, 9, 0, 'x' as never] })] }).map(e => e.day)).toEqual(['2026-10-19']);
  });

  it('use the default lead unless the step has its own; 0 means at the time itself', () => {
    expect(fixed({ tasks: [choir({ lead: null })] })[0]!.lead).toBe(30);
    expect(agenda(state({ tasks: [choir({ lead: undefined })] }), settings({ notifyLead: 45 }), '2026-10-19', '2026-10-19').find(e => e.kind === 'fixed')!.lead).toBe(45);
    expect(fixed({ tasks: [choir({ lead: 0 })] })[0]!.lead).toBe(0);
    expect(fixed({ tasks: [choir({ lead: 60 })] })[0]!.lead).toBe(60);
  });

  it('are skipped when dropped', () => {
    expect(fixed({ tasks: [choir({ status: 'dropped' })] })).toEqual([]);
  });
});

describe('an event step (something the person waits for)', () => {
  it('is never a fixed-time item, even with a time left on it by another device', () => {
    expect(fixed({ tasks: [task('e', { kind: 'event', at: '09:00', due: '2026-10-22', title: 'The bellman calls back' })] })).toEqual([]);
    expect(fixed({ tasks: [task('e', { kind: 'event', at: '09:00', due: '2026-10-22' }), task('s', { at: '10:00', due: '2026-10-22' })] }).map(e => e.taskId)).toEqual(['s']);
  });
});

describe('a check-in copy and its standing item are one event', () => {
  const copy = (o = {}) => task('c1', { title: 'Choir, Hill House 602', from: 'choir', at: '19:00', due: '2026-10-19', ...o });
  it('the copy is the event, with the same id the standing item would have had', () => {
    const ev = fixed({ tasks: [choir(), copy()] });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ id: 'fixed:choir:2026-10-19', taskId: 'c1', rootId: 'choir' });
    expect(ev[0]!.template).toBeUndefined();
    // The lead still comes from the standing item when the copy has none.
    expect(ev[0]!.lead).toBe(30);
  });
  it('a copy placed through the day’s list, without a due date, counts too', () => {
    const ev = fixed({ tasks: [choir(), copy({ due: null })], days: [day('2026-10-19', { plan: ['c1'] })] });
    expect(ev.map(e => e.id)).toEqual(['fixed:choir:2026-10-19']);
    expect(ev[0]!.taskId).toBe('c1');
  });
  it('done or dropped, the day has no event at all', () => {
    expect(fixed({ tasks: [choir(), copy({ status: 'done' })] }).map(e => e.day)).toEqual([]);
    expect(fixed({ tasks: [choir(), copy({ status: 'dropped' })] })).toEqual([]);
    // Other Mondays are untouched.
    expect(fixed({ tasks: [choir(), copy({ status: 'done' })] }, '2026-10-19', '2026-10-26').map(e => e.day)).toEqual(['2026-10-26']);
  });
  it('a copy whose time was changed notifies at the new time', () => {
    const ev = fixed({ tasks: [choir(), copy({ at: '19:30' })] });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ time: '19:30' });
    expect(iso(ev[0]!.at)).toBe('2026-10-19T17:30:00.000Z');
  });
  it('a copy placed on a day the weekdays do not name still has its event', () => {
    const ev = fixed({ tasks: [choir(), copy({ due: '2026-10-21' })] });
    expect(ev.map(e => e.id)).toEqual(['fixed:choir:2026-10-19', 'fixed:choir:2026-10-21']);
  });
  it('a copy with its time cleared hides the standing item for that day', () => {
    expect(fixed({ tasks: [choir(), copy({ at: null })] })).toEqual([]);
  });
});

describe('one-off fixed-time items', () => {
  it('are steps with a time that are due that day, or on its list when they have no due date', () => {
    const ev = fixed({
      tasks: [task('dentist', { title: 'Dentist', at: '09:15', due: '2026-10-20', dur: 45 }), task('call', { at: '14:00' }), task('plain', { due: '2026-10-20' })],
      days: [day('2026-10-21', { plan: ['call', 'plain'] })],
    });
    expect(ev.map(e => [e.id, e.time, e.dur ?? null])).toEqual([['fixed:dentist:2026-10-20', '09:15', 45], ['fixed:call:2026-10-21', '14:00', null]]);
    expect(ev[0]).toMatchObject({ lead: 30, rootId: 'dentist' });
  });
  it('done and dropped ones have none; neither has one outside the window', () => {
    expect(fixed({ tasks: [task('a', { at: '09:00', due: '2026-10-20', status: 'done' }), task('b', { at: '09:00', due: '2026-10-20', status: 'dropped' }), task('c', { at: '09:00', due: '2026-11-20' })] })).toEqual([]);
  });
  it('ignore a time that is not a clock time', () => {
    expect(fixed({ tasks: [task('a', { at: '9h', due: '2026-10-20' }), task('b', { at: '25:00', due: '2026-10-20' }), task('c', { at: '9:05', due: '2026-10-20' })] }).map(e => e.time)).toEqual(['09:05']);
    expect(clockOf('7:30')).toBe('07:30');
    expect(clockOf(null)).toBeNull();
  });
  it('fixedOnDay gives one day’s items', () => {
    const d = state({ tasks: [choir()] });
    expect(fixedOnDay(d, S, '2026-10-19').map(e => e.id)).toEqual(['fixed:choir:2026-10-19']);
    expect(fixedOnDay(d, S, '2026-10-20')).toEqual([]);
  });
});

describe('launch points, check-in, close, review, decisions', () => {
  it('launches come from the days’ lists, in order, with a stable index', () => {
    const ev = week({ days: [day('2026-10-20', { launches: [{ t: '09:30', k: 'start' }, { t: '14:00', k: 'restart', n: 'after lunch' }] })] }).filter(e => e.kind === 'launch');
    expect(ev.map(e => [e.id, e.time, e.launch!.k, iso(e.at)])).toEqual([
      ['launch:2026-10-20:0', '09:30', 'start', '2026-10-20T07:30:00.000Z'],
      ['launch:2026-10-20:1', '14:00', 'restart', '2026-10-20T12:00:00.000Z'],
    ]);
    expect(ev[1]!.launch!.note).toBe('after lunch');
  });
  it('the daily prompts follow the settings, and not on days where they were done', () => {
    const ev = (w = {}, s = S) => week(w, '2026-10-19', '2026-10-20', s).filter(e => e.kind !== 'fixed').map(e => e.id);
    expect(ev()).toEqual(['checkin:2026-10-19', 'close:2026-10-19', 'checkin:2026-10-20', 'close:2026-10-20']);
    expect(ev({ days: [day('2026-10-19', { checkin: '2026-10-19T07:00:00Z' }), day('2026-10-20', { closed: '2026-10-20T20:00:00Z' })] }))
      .toEqual(['close:2026-10-19', 'checkin:2026-10-20']);
    const at = week({}, '2026-10-19', '2026-10-19', settings({ morningAt: '07:45', eveningAt: '22:15' }));
    expect(at.map(e => [e.id, iso(e.at)])).toEqual([['checkin:2026-10-19', '2026-10-19T05:45:00.000Z'], ['close:2026-10-19', '2026-10-19T20:15:00.000Z']]);
  });
  it('the review is on its weekday at its time, unless that Sunday’s review is done', () => {
    const ev = week({}).filter(e => e.kind === 'review');
    expect(ev.map(e => [e.id, iso(e.at)])).toEqual([['review:2026-10-25', '2026-10-25T17:00:00.000Z']]); // 18:00 CET after clocks went back
    expect(week({ days: [day('2026-10-25', { review: '2026-10-25T17:00:00Z' })] }).filter(e => e.kind === 'review')).toEqual([]);
    expect(week({}, '2026-10-19', '2026-10-25', settings({ reviewDay: 6, reviewTime: '10:00' })).filter(e => e.kind === 'review').map(e => e.day)).toEqual(['2026-10-24']);
  });
  it('a decision is checked on its review date, in the morning; only while decided', () => {
    const ev = week({ decisions: [decision('d1', { reviewOn: '2026-10-22' }), decision('d2', { reviewOn: '2026-10-22', status: 'closed' }), decision('d3', { reviewOn: '2026-12-01' }), decision('d4', { reviewOn: null })] }).filter(e => e.kind === 'decision');
    expect(ev.map(e => [e.id, e.decisionId, iso(e.at)])).toEqual([['decision:d1:2026-10-22', 'd1', '2026-10-22T06:30:00.000Z']]);
  });
});

describe('day start and places', () => {
  it('a time before the day starts is on the next calendar date, still that day’s event', () => {
    const ev = week({ days: [day('2026-10-19', { launches: [{ t: '01:30', k: 'restart' }] })] }, '2026-10-19', '2026-10-19', settings({ eveningAt: '01:00' }));
    const close = ev.find(e => e.kind === 'close')!;
    expect(close).toMatchObject({ day: '2026-10-19', time: '01:00' });
    expect(iso(close.at)).toBe('2026-10-19T23:00:00.000Z');
    expect(iso(ev.find(e => e.kind === 'launch')!.at)).toBe('2026-10-19T23:30:00.000Z');
  });
  it('a day inside a stay uses the stay’s place and zone, and another day uses the place chosen by hand', () => {
    const w = { tasks: [task('t', { title: 'Meet', at: '19:00', due: '2026-10-21' }), task('u', { title: 'Call', at: '19:00', due: '2026-10-25' })], stays: [stay('s1', 'cairo', '2026-10-20', '2026-10-24')] };
    const ev = fixed(w);
    expect(ev.map(e => [e.id, e.place, iso(e.at)])).toEqual([
      ['fixed:t:2026-10-21', 'cairo', '2026-10-21T16:00:00.000Z'],
      ['fixed:u:2026-10-25', 'paris', '2026-10-25T18:00:00.000Z'],
    ]);
    expect(fixed({ ...w, stays: [] })[0]).toMatchObject({ place: 'paris' });
  });
  it('a stay in an area uses its parent place’s zone, not the zone stored on the area', () => {
    const area = { ...place('heli', 'Asia/Tokyo'), parentId: 'cairo' };
    const w = { tasks: [task('t', { title: 'Meet', at: '19:00', due: '2026-10-21' })], places: [place('paris', 'Europe/Paris'), place('cairo', 'Africa/Cairo'), area], stays: [stay('s1', 'heli', '2026-10-20', '2026-10-24')] };
    expect(fixed(w).map(e => [e.place, e.zone, iso(e.at)])).toEqual([['heli', 'Africa/Cairo', '2026-10-21T16:00:00.000Z']]);
  });
  it('a place with an unknown zone does not break the agenda', () => {
    expect(() => week({ places: [place('paris', 'Nowhere/Land')], tasks: [choir()] })).not.toThrow();
  });
});
