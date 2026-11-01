import { describe, it, expect } from 'vitest';
import { ringFractions, phraseOf, piePath, hourTicks, secondOf } from './clockFace';

describe('the pie and the rings', () => {
  it('fill with the hour on a 12-hour dial, the minutes round the hour and the seconds round the minute', () => {
    expect(ringFractions(3, 0)).toEqual({ hour: 0.25, minute: 0, second: 0 });
    expect(ringFractions(12, 0)).toEqual({ hour: 0, minute: 0, second: 0 });
    expect(ringFractions(0, 0)).toEqual({ hour: 0, minute: 0, second: 0 });
    expect(ringFractions(6, 30)).toEqual({ hour: 6.5 / 12, minute: 0.5, second: 0 });
    expect(ringFractions(15, 45, 15)).toEqual({ hour: 3.75 / 12, minute: 0.75, second: 0.25 });
    expect(ringFractions(9, 0, 59).second).toBeCloseTo(59 / 60, 10);
    expect(ringFractions(9, 0, 60).second).toBe(0);
    expect(ringFractions(9, 0, 30.9).second).toBe(0.5);
    expect(ringFractions(23, 59).minute).toBeCloseTo(59 / 60, 10);
    expect(ringFractions(23, 59).hour).toBeLessThan(1);
  });
  it('keep the hour ring on the 12-hour dial', () => {
    expect(ringFractions(13, 0).hour).toBe(ringFractions(1, 0).hour);
    expect(ringFractions(18, 0).hour).toBe(0.5);
  });
});

describe('the seconds', () => {
  it('are the second of the minute, whatever the moment', () => {
    expect(secondOf(0)).toBe(0);
    expect(secondOf(59_999)).toBe(59);
    expect(secondOf(60_000)).toBe(0);
    expect(secondOf(Date.UTC(2026, 10, 1, 15, 15, 42, 500))).toBe(42);
    expect(secondOf(-1000)).toBe(59);
  });
});

describe('the pie', () => {
  it('is empty at zero and a whole disc at one', () => {
    expect(piePath(50, 50, 24, 0)).toBe('');
    expect(piePath(50, 50, 24, 1)).toContain('A24 24 0 1 1');
  });
  it('runs from twelve clockwise: a quarter ends at three, a half at six, three quarters at nine, with the large arc flag past half', () => {
    expect(piePath(50, 50, 24, 0.25)).toBe('M50 50L50 26A24 24 0 0 1 74 50Z');
    expect(piePath(50, 50, 24, 0.5)).toBe('M50 50L50 26A24 24 0 0 1 50 74Z');
    expect(piePath(50, 50, 24, 0.75)).toBe('M50 50L50 26A24 24 0 1 1 26 50Z');
  });
});

describe('the hour ticks', () => {
  const ticks = hourTicks(50, 50, 29, 33, 26);
  it('are twelve, the quarters longer', () => {
    expect(ticks).toHaveLength(12);
    expect(ticks.filter(k => k.quarter).length).toBe(4);
    const len = (k: (typeof ticks)[number]) => Math.hypot(k.x2 - k.x1, k.y2 - k.y1);
    expect(len(ticks[0]!)).toBeCloseTo(7, 1);
    expect(len(ticks[1]!)).toBeCloseTo(4, 1);
  });
  it('start at twelve and go clockwise', () => {
    expect(ticks[0]).toMatchObject({ x1: 50, y1: 24, x2: 50, y2: 17, quarter: true });
    expect(ticks[3]).toMatchObject({ x1: 76, y1: 50, x2: 83, y2: 50 });
    expect(ticks[6]!.y2).toBeCloseTo(83, 1);
    expect(ticks[9]!.x2).toBeCloseTo(17, 1);
  });
});

describe('the time in words', () => {
  it('says the hour, the quarters and the half', () => {
    expect(phraseOf(9, 0)).toEqual({ kind: 'oclock', h: 9 });
    expect(phraseOf(9, 15)).toEqual({ kind: 'quarterPast', h: 9 });
    expect(phraseOf(9, 30)).toEqual({ kind: 'half', h: 9 });
    expect(phraseOf(9, 45)).toEqual({ kind: 'quarterTo', h: 10 });
  });
  it('counts to the next hour after the half, across noon and midnight', () => {
    expect(phraseOf(9, 40)).toEqual({ kind: 'to', h: 10, m: 20 });
    expect(phraseOf(11, 55)).toEqual({ kind: 'to', h: 12, m: 5 });
    expect(phraseOf(23, 50)).toEqual({ kind: 'to', h: 0, m: 10 });
    expect(phraseOf(0, 7)).toEqual({ kind: 'past', h: 0, m: 7 });
  });
});
