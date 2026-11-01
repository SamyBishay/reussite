import { describe, it, expect } from 'vitest';
import { handAngles, phraseOf } from './clockFace';

describe('the hands', () => {
  it('point where a clock puts them', () => {
    expect(handAngles(3, 0)).toEqual({ hour: 90, minute: 0 });
    expect(handAngles(12, 0)).toEqual({ hour: 0, minute: 0 });
    expect(handAngles(0, 0)).toEqual({ hour: 0, minute: 0 });
    expect(handAngles(6, 30)).toEqual({ hour: 195, minute: 180 });
    expect(handAngles(15, 45)).toEqual({ hour: 112.5 + 0, minute: 270 });
    expect(handAngles(23, 59).minute).toBe(354);
  });
  it('keep the hour hand on the 12-hour dial', () => {
    expect(handAngles(13, 0).hour).toBe(handAngles(1, 0).hour);
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
