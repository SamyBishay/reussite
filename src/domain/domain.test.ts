import { describe, expect, it } from 'vitest';
import { dayKey, addDays, daysBetween } from './dates';
import { isUrgent, quadrant } from './tasks';
import { ratio, minutesByTask } from './ratio';
import { durationButtons, roundDuration, splitWheel } from './duration';

describe('dates', () => {
  it('a day starts at 05:00 in the given zone', () => {
    expect(dayKey(new Date('2026-10-09T02:30:00Z'), '05:00', 'Europe/Paris')).toBe('2026-10-08'); // 04:30 Paris
    expect(dayKey(new Date('2026-10-09T03:30:00Z'), '05:00', 'Europe/Paris')).toBe('2026-10-09'); // 05:30 Paris
    expect(dayKey(new Date('2026-10-09T02:30:00Z'), '05:00', 'Africa/Cairo')).toBe('2026-10-09'); // 05:30 Cairo
  });
  it('adds days across months and leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-09', '2026-10-30')).toBe(21);
    expect(daysBetween('2026-10-09', null)).toBe(Infinity);
  });
});

describe('urgency and quadrants', () => {
  const today = '2026-10-09';
  it('urgent = blocker, or due within the window, or overdue', () => {
    expect(isUrgent({ due: '2026-10-30' }, today)).toBe(true);
    expect(isUrgent({ due: '2026-10-31' }, today)).toBe(false);
    expect(isUrgent({ due: '2026-10-01' }, today)).toBe(true);
    expect(isUrgent({ urgent: true }, today)).toBe(true);
    expect(isUrgent({}, today)).toBe(false);
    expect(isUrgent({ due: '2026-10-16' }, today, 5)).toBe(false);
  });
  it('places each combination in its quadrant', () => {
    expect(quadrant({ urgent: true, important: true }, today)).toBe(1);
    expect(quadrant({ important: true }, today)).toBe(2);
    expect(quadrant({ due: today }, today)).toBe(3);
    expect(quadrant({}, today)).toBe(4);
  });
});

describe('ratio', () => {
  const t = (id: string, est: number | null, status = 'done', est0?: number) => ({ id, est, est0: est0 ?? null, status });
  it('is the median of real over estimate, from 3 points', () => {
    const spent = minutesByTask([{ taskId: 'a', m: 20 }, { taskId: 'b', m: 10 }, { taskId: 'b', m: 20 }, { taskId: 'c', m: 10 }]);
    expect(ratio([t('a', 10), t('b', 10)], spent)).toEqual({ n: 2, v: null });
    expect(ratio([t('a', 10), t('b', 10), t('c', 10)], spent).v).toBe(2);
    expect(ratio([t('a', 10), t('b', 10), t('c', 10), t('d', 5)], new Map([...spent, ['d', 5]])).v).toBe(1.5);
  });
  it('ignores open steps and steps without estimate or time, and prefers est0', () => {
    const spent = new Map([['a', 30], ['b', 30], ['c', 30], ['e', 30]]);
    expect(ratio([t('a', 10, 'open'), t('b', null), t('c', 10), t('d', 10), t('e', 99, 'done', 15)], spent, 1)).toEqual({ n: 2, v: 2.5 });
  });
});

describe('duration buttons', () => {
  it('rounds to clean values', () => {
    expect([3, 7, 58, 61, 68, 83].map(roundDuration)).toEqual([5, 5, 60, 60, 75, 90]);
  });
  it('scales to the estimate and removes duplicates', () => {
    expect(durationButtons(30)).toEqual([10, 15, 30, 45, 60]);
    expect(durationButtons(60)).toEqual([15, 30, 60, 90, 120]);
    expect(durationButtons(10)).toEqual([5, 10, 15, 20]);
    expect(durationButtons(5)).toEqual([5, 10]);
    expect(durationButtons(45)).toEqual([10, 25, 45, 75, 90]);
  });
  it('falls back without an estimate', () => {
    expect(durationButtons(null)).toEqual([5, 15, 30, 45, 60, 90]);
    expect(durationButtons(0)).toEqual([5, 15, 30, 45, 60, 90]);
  });
  it('splits a duration for the wheel', () => {
    expect(splitWheel(95)).toEqual({ h: 1, m: 35 });
    expect(splitWheel(9999)).toEqual({ h: 8, m: 55 });
  });
});
