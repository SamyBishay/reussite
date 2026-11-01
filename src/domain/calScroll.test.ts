import { describe, expect, it } from 'vitest';
import { gridScrollTop, minutesOf } from './calScroll';

const px = 0.8; // 48px an hour

describe('gridScrollTop', () => {
  it('puts the time now in the middle of the visible hours', () => {
    // 15:30 is 930 minutes: 744px down the grid; half of 500 visible pixels above it.
    expect(gridScrollTop({ pxPerMin: px, visible: 500, now: '15:30', times: ['09:00'] })).toBeCloseTo(744 - 250);
  });
  it('does not go above the start of the day', () => {
    expect(gridScrollTop({ pxPerMin: px, visible: 600, now: '01:00', times: [] })).toBe(0);
  });
  it('on another day puts the first timed event near the top, with an hour above it', () => {
    expect(gridScrollTop({ pxPerMin: px, visible: 500, now: null, times: ['14:00', '10:30', '18:00'] })).toBeCloseTo((9 * 60 + 30) * px);
  });
  it('with no event opens at 07:30, so 08:00 is near the top', () => {
    expect(gridScrollTop({ pxPerMin: px, visible: 500, now: null, times: [] })).toBeCloseTo(450 * px);
  });
  it('reads HH:MM', () => { expect(minutesOf('07:05')).toBe(425); });
});
