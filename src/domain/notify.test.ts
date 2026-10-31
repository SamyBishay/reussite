import { describe, expect, it } from 'vitest';
import { buildSchedule, MAX_ITEMS, TTL, WINDOW_DAYS, roomText } from './notify';
import { choir, day, decision, settings, state, stay, task, tr, iso } from './agenda.fixture';

// Monday 19 October 2026, 10:00 in Paris.
const NOW = Date.parse('2026-10-19T08:00:00Z');
const build = (w: Parameters<typeof state>[0], s = settings(), now = NOW) => buildSchedule(state(w), now, s, tr);
const none = settings({ notify: { fixed: false, checkin: false, close: false, decision: false, review: false } });
const only = (...types: (keyof typeof none.notify)[]) => settings({ notify: { ...none.notify, ...Object.fromEntries(types.map(t => [t, true])) } });

describe('the 19 October choir', () => {
  // No plan accepted for the day: nothing but the standing item.
  it('pushes at 18:30 on its day, whether or not the day was planned', () => {
    const items = build({ tasks: [choir()] }, settings({ notifyText: 'titles', notify: only('fixed').notify }));
    expect(items[0]).toEqual({ id: 'fixed:choir:2026-10-19', type: 'fixed', at: Date.parse('2026-10-19T16:30:00Z'), ttl: TTL.fixed, text: 'Choir 19:00, Hill House 602 · leave at 18:30' });
    expect(items.map(i => i.id)).toEqual(['fixed:choir:2026-10-19', 'fixed:choir:2026-10-26']);
    expect(iso(items[1]!.at)).toBe('2026-10-26T17:30:00.000Z'); // after the clocks went back, 18:30 is an hour later in UTC
  });

  it('says only the time in the generic text', () => {
    const [it] = build({ tasks: [choir()] }, only('fixed'));
    expect(it).toMatchObject({ id: 'fixed:choir:2026-10-19', text: 'Leave now · 19:00' });
    expect(JSON.stringify(it)).not.toMatch(/Choir|Hill/);
  });

  it('after the plan is accepted the copy is the same push, once', () => {
    const copy = task('c1', { title: 'Choir, Hill House 602', from: 'choir', at: '19:00', due: '2026-10-19' });
    const items = build({ tasks: [choir(), copy], days: [day('2026-10-19', { plan: ['c1'], checkin: '2026-10-19T06:30:00Z' })] }, only('fixed'));
    expect(items.filter(i => i.id === 'fixed:choir:2026-10-19')).toHaveLength(1);
    expect(items).toHaveLength(2);
    // Done at the rehearsal, dropped, or moved: nothing left for the day, or the new time.
    expect(build({ tasks: [choir(), { ...copy, status: 'done' }] }, only('fixed')).map(i => i.id)).toEqual(['fixed:choir:2026-10-26']);
    expect(build({ tasks: [choir(), { ...copy, status: 'dropped' }] }, only('fixed')).map(i => i.id)).toEqual(['fixed:choir:2026-10-26']);
    expect(iso(build({ tasks: [choir(), { ...copy, at: '20:00' }] }, only('fixed'))[0]!.at)).toBe('2026-10-19T17:30:00.000Z');
  });

  it('is not sent once its lead time has passed', () => {
    const late = Date.parse('2026-10-19T16:30:01Z');
    expect(build({ tasks: [choir()] }, only('fixed'), late).map(i => i.id)).toEqual(['fixed:choir:2026-10-26']);
  });

  it('a lead of 0 notifies at the time and leaves the “leave at” out', () => {
    const [it] = build({ tasks: [choir({ lead: 0 })] }, settings({ notifyText: 'titles', notify: only('fixed').notify }));
    expect(it).toMatchObject({ at: Date.parse('2026-10-19T17:00:00Z'), text: 'Choir 19:00, Hill House 602' });
  });
});

describe('what is scheduled', () => {
  const w = {
    tasks: [choir(), task('s1', { title: 'Write the report', est: 30 })],
    days: [day('2026-10-19', { plan: ['s1'] })],
    decisions: [decision('d1', { title: 'Move to Lyon', reviewOn: '2026-10-21' })],
  };
  it('has every type, soonest first, with unique stable ids', () => {
    const items = build(w);
    expect(items.map(i => i.at)).toEqual([...items.map(i => i.at)].sort((a, b) => a - b));
    expect(new Set(items.map(i => i.id)).size).toBe(items.length);
    expect(items.slice(0, 3).map(i => [i.id, i.type])).toEqual([
      ['fixed:choir:2026-10-19', 'fixed'], ['close:2026-10-19', 'close'], ['checkin:2026-10-20', 'checkin'],
    ]);
    expect(new Set(items.map(i => i.type))).toEqual(new Set(['fixed', 'checkin', 'close', 'decision', 'review']));
    expect(build(w)).toEqual(items);
  });

  it('writes generic text by default, and titles when allowed', () => {
    const g = Object.fromEntries(build(w).map(i => [i.id, i.text]));
    expect(g['checkin:2026-10-20']).toBe('Morning. A free day so far. Plan it?');
    expect(g['close:2026-10-19']).toBe('Close the day');
    expect(g['decision:d1:2026-10-21']).toBe('Decision check');
    expect(g['review:2026-10-25']).toBe('Weekly review');
    expect(Object.values(g).join('|')).not.toMatch(/report|Lyon|Choir/);
    const t = Object.fromEntries(build(w, settings({ notifyText: 'titles' })).map(i => [i.id, i.text]));
    expect(t['decision:d1:2026-10-21']).toBe('Decision check · Move to Lyon');
    expect(t['checkin:2026-10-20']).toBe('Morning. A free day so far. Plan it?');
  });

  it('only the types switched on', () => {
    expect(build(w, none)).toEqual([]);
    for (const type of ['fixed', 'checkin', 'close', 'decision', 'review'] as const) {
      const items = build(w, only(type));
      expect(items.length).toBeGreaterThan(0);
      expect(new Set(items.map(i => i.type))).toEqual(new Set([type]));
    }
  });

  it('leaves out what is over, what was done, and what is beyond 14 days', () => {
    const items = build({
      ...w,
      days: [day('2026-10-19', { checkin: '2026-10-19T06:00:00Z' })],
    }, settings());
    expect(items.map(i => i.id)).toContain('close:2026-10-19');
    expect(items.map(i => i.id)).not.toContain('checkin:2026-10-19');
    expect(items.map(i => i.id)).not.toContain('close:2026-11-05'); // beyond 14 days
    expect(Math.max(...items.map(i => i.at))).toBeLessThanOrEqual(NOW + WINDOW_DAYS * 86400_000);
  });

  it('keeps the soonest 150', () => {
    const decisions = Array.from({ length: 200 }, (_, i) => decision('d' + i, { reviewOn: '2026-10-' + String(20 + (i % 9)) }));
    const items = build({ decisions }, settings());
    expect(items).toHaveLength(MAX_ITEMS);
    expect(items.map(i => i.at)).toEqual([...items.map(i => i.at)].sort((a, b) => a - b));
    expect(buildSchedule(state({ decisions }), NOW, settings(), tr)).toEqual(items);
  });

  it('has no launch or still-on push: a stored switch for either is ignored, and a running timer or a day’s old launch points schedule nothing', () => {
    const w = { tasks: [task('r', { title: 'Tax form', est: 20, started: '2026-10-19T07:00:00Z' })], days: [day('2026-10-19', { launches: [{ t: '14:00', k: 'restart' }] })] };
    const on = settings({ notify: { ...settings().notify, launch: true, still: true } as never });
    expect(build(w, on).filter(i => /^(launch|still):/.test(i.id))).toEqual([]);
    expect(Object.keys(TTL).sort()).toEqual(['checkin', 'close', 'decision', 'fixed', 'review']);
  });
});

describe('the morning push', () => {
  const dentist = task('dent', { title: 'Dentist', at: '10:00', due: '2026-10-20', lead: 0, dur: 60 });
  const call = task('call', { title: 'Call Sara', at: '14:00', due: '2026-10-20', lead: 30, dur: 30 });
  const text = (w: Parameters<typeof state>[0], s = settings()) => build(w, { ...s, notify: only('checkin').notify } as never).find(i => i.id === 'checkin:2026-10-20')!.text;
  it('names the fixed times and the room left from the push to the end of the day', () => {
    // 08:30 to 19:00 is 10 h 30; the dentist takes an hour: 9 h 30 left.
    expect(text({ tasks: [dentist] }, settings({ notifyText: 'titles' }))).toBe('Morning. Today has the 10:00 Dentist and room for about 9 h 30. Plan it?');
    // With the call (leave 13:30, until 14:30) too: 8 h 30.
    expect(text({ tasks: [dentist, call] }, settings({ notifyText: 'titles' }))).toBe('Morning. Today has the 10:00 Dentist and 1 more, with room for about 8 h 30. Plan it?');
  });
  it('says only how many in the generic text, and a free day when there are none', () => {
    expect(text({ tasks: [dentist] })).toBe('Morning. Today has a fixed time and room for about 9 h 30. Plan it?');
    expect(text({ tasks: [dentist, call] })).toBe('Morning. Today has 2 fixed times and room for about 8 h 30. Plan it?');
    expect(text({ tasks: [dentist, call] })).not.toMatch(/Dentist|Sara/);
    expect(text({})).toBe('Morning. A free day so far. Plan it?');
  });
  it('rounds the room and uses the day’s end from the settings', () => {
    expect(roomText(190)).toBe('3 h');
    expect(roomText(200)).toBe('3 h 30');
    expect(roomText(47)).toBe('45 min');
    expect(text({ tasks: [dentist] }, settings({ dayEnd: '12:00' }))).toBe('Morning. Today has a fixed time and room for about 2 h 30. Plan it?');
    // Nothing left of the day: the plain question.
    expect(text({ tasks: [dentist] }, settings({ dayEnd: '08:40' }))).toBe('Morning. Plan the day?');
  });
});

describe('an event step (something the person waits for)', () => {
  it('has no notification of any kind, whatever it carries, ', () => {
    const e = task('e', { kind: 'event', title: 'The bellman calls back', at: '09:00', due: '2026-10-20', nudge: '2026-10-20' });
    const items = build({ tasks: [e, task('s1', { title: 'Write the report' })], days: [day('2026-10-20', { plan: ['e', 's1'] })] });
    expect(items.some(i => i.id.includes(':e:'))).toBe(false);
    expect(items.filter(i => i.type === 'fixed')).toEqual([]);
    const texts = build({ tasks: [e, task('s1', { title: 'Write the report' })], days: [day('2026-10-20', { plan: ['e', 's1'] })] }, settings({ notifyText: 'titles' })).map(i => i.text).join('\n');
    expect(texts).not.toContain('bellman');
  });
});

describe('time zones and the day start', () => {
  it('the 26 October choir is at 19:00 on the wall after daylight-saving time ends on the 25th', () => {
    const [, second] = build({ tasks: [choir()] }, only('fixed'));
    expect(iso(second!.at)).toBe('2026-10-26T17:30:00.000Z');
  });

  it('a stay switches the zone for the days it covers', () => {
    const w = { tasks: [task('meet', { title: 'Meet Sara', at: '19:00', due: '2026-10-22' }), task('later', { title: 'Call', at: '19:00', due: '2026-10-26' })], stays: [stay('s1', 'cairo', '2026-10-21', '2026-10-24')] };
    const items = build(w, only('fixed'));
    expect(items.map(i => [i.id, iso(i.at)])).toEqual([
      ['fixed:meet:2026-10-22', '2026-10-22T15:30:00.000Z'], // 19:00 in Cairo (UTC+3) minus 30 minutes
      ['fixed:later:2026-10-26', '2026-10-26T17:30:00.000Z'], // back to Paris, UTC+1
    ]);
  });

  it('works from Cairo too, and says the leave time on the Cairo clock', () => {
    const w = { tasks: [choir()] };
    const items = build(w, settings({ here: 'cairo', notifyText: 'titles', notify: only('fixed').notify }));
    expect(items[0]).toMatchObject({ at: Date.parse('2026-10-19T15:30:00Z'), text: 'Choir 19:00, Hill House 602 · leave at 18:30' });
    // Egypt's clocks go back on 29 October: the same wall time moves an hour later in UTC.
    expect(iso(buildSchedule(state(w), Date.parse('2026-10-27T00:00:00Z'), settings({ here: 'cairo', notify: only('fixed').notify }), tr)[0]!.at)).toBe('2026-11-02T16:30:00.000Z');
  });

  it('the day start decides which day a small-hours reminder belongs to', () => {
    // The close of the day at 01:00 is the night after the day it closes.
    const [close] = build({}, settings({ eveningAt: '01:00', notify: only('close').notify }));
    expect(close).toMatchObject({ id: 'close:2026-10-19', at: Date.parse('2026-10-19T23:00:00Z') });
    // At 02:00 on the 20th it is still the 19th: that close hasn't been sent, and the 20th's is a day away.
    const night = build({}, settings({ eveningAt: '01:00', notify: only('close').notify }), Date.parse('2026-10-19T23:30:00Z'));
    expect(night[0]!.id).toBe('close:2026-10-20');
  });
});

