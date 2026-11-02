import { describe, expect, it } from 'vitest';
import { agenda, clockOf, fixedOnDay, standingToPlace } from './agenda';
import { copyId, ended, standingDay, thingKey } from './standing';
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

describe('check-in, close, review, decisions', () => {
  it('a day’s old launch points make no event: they stay stored and nothing reads them', () => {
    const ev = week({ days: [day('2026-10-20', { launches: [{ t: '09:30', k: 'start' }, { t: '14:00', k: 'restart', n: 'after lunch' }] })] });
    expect(ev.filter(e => e.id.startsWith('launch:'))).toEqual([]);
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
    const ev = week({}, '2026-10-19', '2026-10-19', settings({ eveningAt: '01:00' }));
    const close = ev.find(e => e.kind === 'close')!;
    expect(close).toMatchObject({ day: '2026-10-19', time: '01:00' });
    expect(iso(close.at)).toBe('2026-10-19T23:00:00.000Z');
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

describe('a standing series ends on its last day (until)', () => {
  it('comes up to and on the last day, and not after', () => {
    const ev = fixed({ tasks: [choir({ weekdays: [1, 4], until: '2026-10-22' })] }, '2026-10-19', '2026-11-05');
    expect(ev.map(e => e.day)).toEqual(['2026-10-19', '2026-10-22']);
    expect(fixed({ tasks: [choir({ weekdays: [1], until: '2026-10-18' })] })).toEqual([]);
    expect(fixed({ tasks: [choir({ weekdays: [1], until: null })] }, '2026-10-19', '2026-11-30')).toHaveLength(7);
  });
  it('standingDay and ended read the same end date', () => {
    expect(standingDay({ weekdays: [1], until: '2026-10-19' }, '2026-10-19')).toBe(true);
    expect(standingDay({ weekdays: [1], until: '2026-10-19' }, '2026-10-26')).toBe(false);
    expect(standingDay({ weekdays: [1], until: undefined }, '2026-10-26')).toBe(true);
    expect(standingDay({ weekdays: [2], until: null }, '2026-10-26')).toBe(false);
    expect(ended({ until: '2026-10-19' }, '2026-10-19')).toBe(false);
    expect(ended({ until: '2026-10-19' }, '2026-10-20')).toBe(true);
    expect(ended({ until: null }, '2026-10-20')).toBe(false);
  });
  it('is no notification, feed line or calendar event after it either: they all read the agenda', () => {
    expect(fixedOnDay(state({ tasks: [choir({ until: '2026-10-12' })] }), S, '2026-10-19')).toEqual([]);
  });
});

describe('a one-off with the same words and time stands in for a series that day', () => {
  const twin = (o = {}) => task('t1', { title: 'choir,  Hill House 602', at: '19:00', due: '2026-10-19', ...o });
  it('is the one event; the series comes back the next week', () => {
    const ev = fixed({ tasks: [choir(), twin()] }, '2026-10-19', '2026-10-27');
    expect(ev.map(e => e.id)).toEqual(['fixed:t1:2026-10-19', 'fixed:choir:2026-10-26']);
  });
  it('also when it is only on the day’s list, and also when it was dropped or done', () => {
    expect(fixed({ tasks: [choir(), twin({ due: null })], days: [day('2026-10-19', { plan: ['t1'] })] }).map(e => e.id)).toEqual(['fixed:t1:2026-10-19']);
    expect(fixed({ tasks: [choir(), twin({ status: 'dropped' })] })).toEqual([]);
    expect(fixed({ tasks: [choir(), twin({ status: 'done' })] })).toEqual([]);
  });
  it('another time or other words is another thing', () => {
    expect(fixed({ tasks: [choir(), twin({ at: '20:00' })] }).map(e => e.id).sort()).toEqual(['fixed:choir:2026-10-19', 'fixed:t1:2026-10-19']);
    expect(fixed({ tasks: [choir(), twin({ title: 'Dentist' })] })).toHaveLength(2);
    expect(thingKey('Choir, Hill House 602', '19:00')).toBe(thingKey('choir  hill house 602', '19:00'));
  });
  it('a copy made for the day (its deterministic id) covers the series even when the person moved it away', () => {
    const moved = task(copyId('choir', '2026-10-19'), { title: 'Choir, Hill House 602', from: 'choir', at: '19:00', due: '2026-10-21' });
    expect(fixed({ tasks: [choir(), moved] }).map(e => e.id)).toEqual(['fixed:choir:2026-10-21']);
    const shelved = task(copyId('choir', '2026-10-19'), { title: 'Choir, Hill House 602', from: 'choir', at: '19:00', due: null });
    expect(fixed({ tasks: [choir(), shelved] })).toEqual([]);
  });
});

describe('standingToPlace: what the app puts on today’s list', () => {
  const NOON = Date.parse('2026-10-19T10:00:00Z'); // 12:00 in Paris on Monday the 19th
  const put = (w: Parameters<typeof state>[0], now = NOON, k = '2026-10-19') => standingToPlace(state(w), S, k, now).map(t => t.id);
  it('a series made this morning for tonight is placed once: its weekday is today and its time has not passed', () => {
    expect(put({ tasks: [choir()] })).toEqual(['choir']);
    // Not on another weekday.
    expect(put({ tasks: [choir({ weekdays: [2] })] })).toEqual([]);
  });
  it('is not placed once the copy exists, with the day’s deterministic id or any other copy of it', () => {
    expect(put({ tasks: [choir(), task(copyId('choir', '2026-10-19'), { from: 'choir', at: '19:00', due: '2026-10-19' })] })).toEqual([]);
    expect(put({ tasks: [choir(), task('x', { from: 'choir', at: '19:00', due: '2026-10-19' })] })).toEqual([]);
  });
  it('is not placed for a same-title one-off at the same time: a copy and the one-off never both come from the series', () => {
    expect(put({ tasks: [choir(), task('one', { title: 'Choir, Hill House 602', at: '19:00', due: '2026-10-19' })] })).toEqual([]);
  });
  it('is not placed after its end date, once its time is over, or when it offers an address or a person', () => {
    expect(put({ tasks: [choir({ until: '2026-10-18' })] })).toEqual([]);
    expect(put({ tasks: [choir({ until: '2026-10-19' })] })).toEqual(['choir']);
    expect(put({ tasks: [choir()] }, Date.parse('2026-10-19T19:00:00Z'))).toEqual([]); // 21:00 in Paris: 19:00 + 90 min is gone at 20:30
    expect(put({ tasks: [choir()] }, Date.parse('2026-10-19T17:50:00Z'))).toEqual(['choir']); // 19:50 in Paris: still going on
    expect(put({ tasks: [choir({ offer: 'person' })] })).toEqual([]);
    expect(put({ tasks: [choir({ status: 'dropped' })] })).toEqual([]);
  });
});
