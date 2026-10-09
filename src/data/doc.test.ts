import { describe, expect, it } from 'vitest';
import { createClock, tick } from './hlc';
import { create, patch, merge, remove, fieldsOf } from './doc';

const base = () => create('t1', { title: 'A', est: 10, plan: ['x'] }, 1, tick(createClock('z'), 1));

describe('doc merge', () => {
  it('per-field last writer wins, arrays replace whole', () => {
    const ca = createClock('a'), cb = createClock('b');
    const a = patch(base(), { title: 'From A' }, (ca.wall = 100, ca), 1);
    const b = patch(base(), { est: 30, plan: ['y', 'z'] }, (cb.wall = 200, cb), 1);
    const m = merge(a, b);
    expect(fieldsOf(m)).toEqual({ title: 'From A', est: 30, plan: ['y', 'z'] });
  });

  it('is commutative, associative and idempotent', () => {
    const ca = createClock('a'), cb = createClock('b'), cc = createClock('c');
    const a = patch(base(), { title: 'A2', est: 5 }, ca, 1);
    const b = patch(base(), { title: 'B2' }, cb, 1);
    const c = remove(patch(base(), { est: 99 }, cc, 1), cc);
    const s = (x: unknown) => JSON.stringify(x, Object.keys(x as object).sort());
    expect(s(merge(a, b))).toBe(s(merge(b, a)));
    expect(s(merge(merge(a, b), c))).toBe(s(merge(a, merge(b, c))));
    expect(s(merge(a, a))).toBe(s(a));
    expect(merge(merge(a, b), c)._del).toBeDefined();
  });

  it('only stamps fields that change', () => {
    const d = base();
    const p = patch(d, { title: 'A', est: 11 }, createClock('a'), 1);
    expect(p._hlc.title).toBe(d._hlc.title);
    expect(p._hlc.est).not.toBe(d._hlc.est);
  });

  it('keeps fields it does not know', () => {
    const a = { ...base(), mystery: 1, _hlc: { ...base()._hlc, mystery: base()._hlc.title! } };
    expect(merge(a, base())).toHaveProperty('mystery', 1);
  });
});
