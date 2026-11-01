import { describe, it, expect } from 'vitest';
import { ringFractions, phraseOf } from './clockFace';

describe('the rings', () => {
  it('fill with the hour on a 12-hour dial and the minutes round the hour', () => {
    expect(ringFractions(3, 0)).toEqual({ hour: 0.25, minute: 0 });
    expect(ringFractions(12, 0)).toEqual({ hour: 0, minute: 0 });
    expect(ringFractions(0, 0)).toEqual({ hour: 0, minute: 0 });
    expect(ringFractions(6, 30)).toEqual({ hour: 6.5 / 12, minute: 0.5 });
    expect(ringFractions(15, 45)).toEqual({ hour: 3.75 / 12, minute: 0.75 });
    expect(ringFractions(23, 59).minute).toBeCloseTo(59 / 60, 10);
    expect(ringFractions(23, 59).hour).toBeLessThan(1);
  });
  it('keep the hour ring on the 12-hour dial', () => {
    expect(ringFractions(13, 0).hour).toBe(ringFractions(1, 0).hour);
    expect(ringFractions(18, 0).hour).toBe(0.5);
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
