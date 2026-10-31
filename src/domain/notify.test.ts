import { describe, expect, it } from 'vitest';
import { buildSchedule, MAX_ITEMS, TTL, WINDOW_DAYS } from './notify';
import { choir, day, decision, settings, state, stay, task, tr, iso } from './agenda.fixture';

// Monday 19 October 2026, 10:00 in Paris.
const NOW = Date.parse('2026-10-19T08:00:00Z');
const build = (w: Parameters<typeof state>[0], s = settings(), now = NOW) => buildSchedule(state(w), now, s, tr);
const none = settings({ notify: { launch: false, fixed: false, checkin: false, close: false, decision: false, review: false, still: false } });
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
    days: [day('2026-10-19', { plan: ['s1'], launches: [{ t: '14:00', k: 'restart' }, { t: '16:00', k: 'start' }] })],
    decisions: [decision('d1', { title: 'Move to Lyon', reviewOn: '2026-10-21' })],
  };
  it('has every type, soonest first, with unique stable ids', () => {
    const items = build(w);
    expect(items.map(i => i.at)).toEqual([...items.map(i => i.at)].sort((a, b) => a - b));
    expect(new Set(items.map(i => i.id)).size).toBe(items.length);
    expect(items.slice(0, 5).map(i => [i.id, i.type])).toEqual([
      ['launch:2026-10-19:0', 'launch'], ['launch:2026-10-19:1', 'launch'], ['fixed:choir:2026-10-19', 'fixed'], ['close:2026-10-19', 'close'], ['checkin:2026-10-20', 'checkin'],
    ]);
    expect(new Set(items.map(i => i.type))).toEqual(new Set(['launch', 'fixed', 'checkin', 'close', 'decision', 'review']));
    expect(build(w)).toEqual(items);
  });

  it('writes generic text by default, and titles when allowed', () => {
    const g = Object.fromEntries(build(w).map(i => [i.id, i.text]));
    expect(g['launch:2026-10-19:0']).toBe('↻ Restart');
    expect(g['launch:2026-10-19:1']).toBe('▶ Start');
    expect(g['checkin:2026-10-20']).toBe('Morning check-in');
    expect(g['close:2026-10-19']).toBe('Close the day');
    expect(g['decision:d1:2026-10-21']).toBe('Decision check');
    expect(g['review:2026-10-25']).toBe('Weekly review');
    expect(Object.values(g).join('|')).not.toMatch(/report|Lyon|Choir/);
    const t = Object.fromEntries(build(w, settings({ notifyText: 'titles' })).map(i => [i.id, i.text]));
    expect(t['launch:2026-10-19:1']).toBe('▶ Start · Write the report');
    expect(t['launch:2026-10-19:0']).toBe('↻ Restart · Write the report');
    expect(t['decision:d1:2026-10-21']).toBe('Decision check · Move to Lyon');
    expect(t['checkin:2026-10-20']).toBe('Morning check-in');
  });

  it('only the types switched on', () => {
    expect(build(w, none)).toEqual([]);
    for (const type of ['launch', 'fixed', 'checkin', 'close', 'decision', 'review'] as const) {
      const items = build(w, only(type));
      expect(items.length).toBeGreaterThan(0);
      expect(new Set(items.map(i => i.type))).toEqual(new Set([type]));
    }
  });

  it('leaves out what is over, what was done, and what is beyond 14 days', () => {
    const items = build({
      ...w,
      days: [day('2026-10-19', { launches: [{ t: '09:00', k: 'start' }, { t: '14:00', k: 'restart' }], checkin: '2026-10-19T06:00:00Z' }), day('2026-11-05', { launches: [{ t: '09:00', k: 'start' }] })],
    }, settings());
    expect(items.map(i => i.id)).not.toContain('launch:2026-10-19:0'); // 09:00 CEST is before 10:00
    expect(items.map(i => i.id)).toContain('launch:2026-10-19:1');
    expect(items.map(i => i.id)).not.toContain('checkin:2026-10-19');
    expect(items.map(i => i.id)).not.toContain('launch:2026-11-05:0');
    expect(Math.max(...items.map(i => i.at))).toBeLessThanOrEqual(NOW + WINDOW_DAYS * 86400_000);
  });

  it('keeps the soonest 150', () => {
    const launches = Array.from({ length: 30 }, (_, i) => ({ t: String(6 + Math.floor(i / 2)).padStart(2, '0') + (i % 2 ? ':30' : ':00'), k: 'restart' as const }));
    const days = Array.from({ length: 10 }, (_, i) => day(`2026-10-${String(20 + i)}`, { launches }));
    const items = build({ days }, settings());
    expect(items).toHaveLength(MAX_ITEMS);
    expect(items.map(i => i.at)).toEqual([...items.map(i => i.at)].sort((a, b) => a - b));
    const all = buildSchedule(state({ days }), NOW, settings(), tr);
    expect(all).toEqual(items);
    // The cut falls on the latest ones: the first day's events are all there.
    expect(items.filter(i => i.id.startsWith('launch:2026-10-20:'))).toHaveLength(30);
  });
});

describe('an event step (something the person waits for)', () => {
  it('has no notification of any kind, whatever it carries, and is not the step a launch names', () => {
    const e = task('e', { kind: 'event', title: 'The bellman calls back', at: '09:00', due: '2026-10-20', nudge: '2026-10-20' });
    const items = build({ tasks: [e, task('s1', { title: 'Write the report' })], days: [day('2026-10-20', { plan: ['e', 's1'], launches: [{ t: '14:00', k: 'start' }] })] });
    expect(items.some(i => i.id.includes(':e:'))).toBe(false);
    expect(items.filter(i => i.type === 'fixed')).toEqual([]);
    const texts = build({ tasks: [e, task('s1', { title: 'Write the report' })], days: [day('2026-10-20', { plan: ['e', 's1'], launches: [{ t: '14:00', k: 'start' }] })] }, settings({ notifyText: 'titles' })).map(i => i.text).join('\n');
    expect(texts).not.toContain('bellman');
    expect(texts).toContain('Write the report');
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

describe('Still on …?', () => {
  const started = '2026-10-19T07:00:00Z'; // 09:00 in Paris
  const running = (o = {}) => task('r', { title: 'Tax form', est: 20, started, ...o });
  const still = (w: Parameters<typeof state>[0], now = NOW, s = only('still')) => build(w, s, now);

  it('comes 45 minutes in for a short estimate, and says nothing of the step in generic text', () => {
    const [it] = still({ tasks: [running()] }, Date.parse('2026-10-19T07:10:00Z'));
    expect(it).toEqual({ id: 'still:r', type: 'still', at: Date.parse('2026-10-19T07:45:00Z'), ttl: TTL.still, text: 'Still on a step?' });
    // The timer started an hour ago, so 07:45 has passed: nothing to schedule, the banner shows.
    expect(still({ tasks: [running()] }, Date.parse('2026-10-19T08:00:00Z'))).toEqual([]);
  });

  it('is twice the estimate when that is longer, and names the step with titles', () => {
    const w = { tasks: [running({ est: 60 })] };
    const [it] = still(w, Date.parse('2026-10-19T07:10:00Z'), settings({ notifyText: 'titles', notify: only('still').notify }));
    expect(it).toMatchObject({ at: Date.parse('2026-10-19T09:00:00Z'), text: 'Still on Tax form?' });
  });

  it('counts from the last “still going” and gives up after twelve hours', () => {
    const now = Date.parse('2026-10-19T07:50:00Z');
    expect(still({ tasks: [running({ stillAt: '2026-10-19T07:40:00Z' })] }, now)[0]!.at).toBe(Date.parse('2026-10-19T08:25:00Z'));
    // Started 20 hours earlier: the next ask would be 13 hours in, past the limit.
    expect(still({ tasks: [running({ started: '2026-10-18T10:00:00Z', stillAt: '2026-10-19T06:50:00Z' })] }, now)).toEqual([]);
    expect(still({ tasks: [running({ started: '2026-10-19T00:00:00Z', stillAt: '2026-10-19T07:00:00Z' })] }, now)).toEqual([]);
  });

  it('comes at the next day start if that is sooner, once the timer is over four hours old', () => {
    // Started at 23:30 (Paris), a long estimate: 05:00 the next morning is sooner than 2x.
    const w = { tasks: [running({ started: '2026-10-19T21:30:00Z', est: 240 })] };
    const [it] = still(w, Date.parse('2026-10-19T22:00:00Z'));
    expect(it!.at).toBe(Date.parse('2026-10-20T03:00:00Z')); // 05:00 CEST
    // After a “still going” the day start no longer counts.
    expect(still({ tasks: [running({ started: '2026-10-19T21:30:00Z', est: 240, stillAt: '2026-10-19T21:45:00Z' })] }, Date.parse('2026-10-19T22:00:00Z'))[0]!.at)
      .toBe(Date.parse('2026-10-20T05:45:00Z')); // 480 minutes later
  });

  it('is not scheduled for a stopped timer, a done step, or when switched off', () => {
    expect(still({ tasks: [running({ started: null })] })).toEqual([]);
    expect(still({ tasks: [running({ status: 'done' })] })).toEqual([]);
    expect(build({ tasks: [running()] }, only('fixed'), Date.parse('2026-10-19T07:10:00Z'))).toEqual([]);
  });
});
