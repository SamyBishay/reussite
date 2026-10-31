// "Still on …?" is the in-app banner (isLong); the push was removed (plan 2 Nov). The banner and `stillOnDue`, the rule that
// says when a timer becomes long, must agree on the moment, in every zone and across the day boundary.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { places, sessions, settings, tasks, type WithId } from './store';
import { isLong } from './sheets';
import { T } from './model';
import { withDefaults } from '../data/settings';
import { stillOnDue } from '../domain/calendar';
import type { Task } from '../data/schema';

const MIN = 60_000;

function stillAt(_now: number): number | undefined {
  const x = T('t1')!, zone = places.value.get(settings.value.here)?.timeZone;
  return stillOnDue(Date.parse(x.started!), Date.parse(x.stillAt ?? '') || 0, x.est, settings.value.dayStart, zone);
}

function run(fields: Partial<Task>, started: number, now: number, here?: { id: string; zone: string }) {
  settings.value = withDefaults({ dayStart: '05:00', ...(here ? { here: here.id } : {}) });
  places.value = new Map(here ? [[here.id, { id: here.id, name: here.id, timeZone: here.zone, order: 0 } as never]] : []);
  tasks.value = new Map([['t1', { id: 't1', title: 'Write', status: 'open', started: new Date(started).toISOString(), ...fields } as WithId<Task>]]);
  sessions.value = new Map();
  return stillAt(now);
}

describe('"Still on …?": the banner calls the timer long at the moment stillOnDue says', () => {
  // Mid-morning, UTC and local agree on the date for hours either side.
  const started = Date.parse('2026-10-20T09:00:00Z');

  for (const [name, fields, minutes] of [
    ['no estimate: 45 minutes', {}, 45],
    ['a 20-minute estimate: still 45 minutes', { est: 20 }, 45],
    ['a 30-minute estimate: 60 minutes', { est: 30 }, 60],
    ['a 90-minute estimate: 180 minutes', { est: 90 }, 180],
  ] as const) {
    it(name, () => {
      const at = run(fields, started, started + 5 * MIN);
      expect(at).toBe(started + minutes * MIN);
      expect(isLong(T('t1')!, at! - 1)).toBe(false);
      expect(isLong(T('t1')!, at!)).toBe(true);
    });
  }

  it('counts from the last "still going" once there is one', () => {
    const still = started + 50 * MIN;
    const at = run({ est: 30, stillAt: new Date(still).toISOString() }, started, still + MIN);
    expect(at).toBe(still + 60 * MIN);
    expect(isLong(T('t1')!, at! - 1)).toBe(false);
    expect(isLong(T('t1')!, at!)).toBe(true);
  });
});

describe('"Still on …?" across the day boundary: the banner uses the one rule (stillOnDue)', () => {
  // A long estimate, so the day boundary (not the estimate) is what makes the timer long.
  const long = { est: 240 } as const;
  const paris = { id: 'paris', zone: 'Europe/Paris' };

  for (const [name, startedAt, dueAt, here] of [
    ['started at 22:00 in Paris: long at 05:00 the next morning, not at midnight', '2026-10-20T20:00:00Z', '2026-10-21T03:00:00Z', paris],
    ['the night clocks go back in Paris (25 Oct): 05:00 is then one hour later in UTC', '2026-10-24T20:00:00Z', '2026-10-25T04:00:00Z', paris],
    ['started at 03:00 (still the day before): at least four hours on, so 07:00', '2026-10-20T01:00:00Z', '2026-10-20T05:00:00Z', paris],
    ['the place Tokyo, started at 22:00 there: 05:00 there is 20:00 UTC', '2026-10-20T13:00:00Z', '2026-10-20T20:00:00Z', { id: 'tokyo', zone: 'Asia/Tokyo' }],
  ] as const) {
    it(name, () => {
      const started = Date.parse(startedAt), due = Date.parse(dueAt);
      const at = run(long, started, started + MIN, here);
      expect(at).toBe(due);
      expect(isLong(T('t1')!, due - 1)).toBe(false);
      expect(isLong(T('t1')!, due)).toBe(true);
    });
  }

  it('a timer that has been answered with "still going" ignores the day boundary', () => {
    const started = Date.parse('2026-10-20T20:00:00Z'), still = started + 30 * MIN;
    const at = run({ ...long, stillAt: new Date(still).toISOString() }, started, still + MIN, paris);
    expect(at).toBe(still + 480 * MIN);
    expect(isLong(T('t1')!, Date.parse('2026-10-21T03:00:00Z'))).toBe(false);
    expect(isLong(T('t1')!, at!)).toBe(true);
  });
});
