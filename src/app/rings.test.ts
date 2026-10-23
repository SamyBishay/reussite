import { describe, expect, it } from 'vitest';
import { progressOf } from './Rings';

describe('timer rings', () => {
  it('fill over the estimate and stop full past it; no estimate, no fill', () => {
    expect(progressOf(0, 10)).toBe(0);
    expect(progressOf(300, 10)).toBe(0.5);
    expect(progressOf(1200, 10)).toBe(1);
    expect(progressOf(300, null)).toBeNull();
    expect(progressOf(300, 0)).toBeNull();
  });
});
