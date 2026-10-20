// "Still on …?" has two voices: the in-app banner (isLong) and the push (buildSchedule). They
// must agree on the moment a timer becomes long, or the push says one thing and the app another.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { days, decisions, places, sessions, settings, stays, tasks, type WithId } from './store';
import { isLong } from './sheets';
import { T } from './model';
import { withDefaults } from '../data/settings';
import { buildSchedule, type Translate } from '../domain/notify';
import type { Task } from '../data/schema';

const tr: Translate = key => key;
const MIN = 60_000;

function stillAt(now: number): number | undefined {
  const items = buildSchedule({ tasks: tasks.value, days: days.value, decisions: decisions.value, places: places.value, stays: stays.value, sessions: sessions.value }, now, settings.value, tr);
  return items.find(i => i.id === 'still:t1')?.at;
}

function run(fields: Partial<Task>, started: number, now: number) {
  settings.value = withDefaults({ dayStart: '05:00' });
  tasks.value = new Map([['t1', { id: 't1', title: 'Write', status: 'open', started: new Date(started).toISOString(), ...fields } as WithId<Task>]]);
  sessions.value = new Map();
  return stillAt(now);
}

describe('"Still on …?": the push fires at the moment the banner would call the timer long', () => {
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
