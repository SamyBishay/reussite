import { describe, expect, it } from 'vitest';
import { createClock, tick, receive, parse, after, ZERO } from './hlc';

describe('hlc', () => {
  it('orders by string comparison', () => {
    const c = createClock('a');
    const a = tick(c, 1000), b = tick(c, 1000), d = tick(c, 2000);
    expect(a < b && b < d).toBe(true);
    expect(ZERO < a).toBe(true);
  });
  it('never goes backwards when the wall clock does', () => {
    const c = createClock('a');
    const a = tick(c, 5000), b = tick(c, 4000);
    expect(b > a).toBe(true);
  });
  it('moves past a remote timestamp', () => {
    const c = createClock('a');
    const r = tick(createClock('b'), 9000);
    receive(c, r, 1000);
    expect(tick(c, 1000) > r).toBe(true);
    expect(parse(r)).toEqual({ wall: 9000, counter: 0, node: 'b' });
  });
  it('after: the next timestamp on the same node, and the oldest one past ZERO', () => {
    const h = '0000000000005:0001:abc';
    expect(after(h)).toBe('0000000000005:0002:abc');
    expect(after(h) > h).toBe(true);
    expect(after('0000000000005:9999:abc')).toBe('0000000000006:0000:abc');
    expect(after(undefined) > ZERO).toBe(true);
    expect(after(after(h)) > after(h)).toBe(true);
  });
});
