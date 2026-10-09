import { describe, expect, it } from 'vitest';
import { fit, predict, wpercentile, medianRatio, type Point } from './estimates';

const today = '2026-10-09';
const p = (est0: number, real: number, o: Partial<Point> = {}): Point => ({ est0, real, w0: 1, doneDay: today, suit: 'S', ...o });

describe('personal estimates', () => {
  // Worked by hand: three Mail steps took twice their estimate, three others took exactly theirs.
  const fixture = [
    p(10, 20, { app: 'Mail', suit: 'D' }), p(10, 20, { app: 'Mail', suit: 'D' }), p(10, 20, { app: 'mail ', suit: 'D' }),
    p(20, 20, { project: 'p' }), p(20, 20), p(30, 30),
  ];

  it('matches a hand calculation', () => {
    const m = fit(fixture, today);
    expect(m.ready).toBe(true);
    // g = (3 ln 2) / 6 = ln 2 / 2
    expect(m.g).toBeCloseTo(Math.LN2 / 2, 10);
    expect(m.slope).toBe(0); // fewer than 15 points
    // Mail: residuals all ln2/2, n = 3, shrink 3/8 → offset 0.375 · ln2/2; total 0.47654 → ×1.6105
    const mail = predict(m, { est: 60, app: 'Mail', suit: 'D' })!;
    expect(mail.factor).toBeCloseTo(Math.exp(Math.LN2 / 2 + (3 / 8) * (Math.LN2 / 2)), 10);
    expect(mail.value).toBe(95); // 96.6 → 95
    expect(mail.basis).toEqual({ kind: 'app', key: 'mail', n: 3 });
    expect([mail.lo, mail.hi]).toEqual([95, 120]); // residuals all ln2/2 → 60 × 2 = 120
    // A spade with no app: suit S, residuals −ln2/2, shrink 3/8 → ×1.2419 → 74.5 → 75
    const s = predict(m, { est: 60, suit: 'S' })!;
    expect(s.value).toBe(75);
    expect(s.basis.kind).toBe('suit');
  });

  it('waits for 5 weighted data points (cold start)', () => {
    expect(fit(fixture.slice(0, 4), today).ready).toBe(false);
    expect(predict(fit(fixture.slice(0, 4), today), { est: 10, suit: 'S' })).toBeNull();
    // Typed times count half: nine typed points weigh 4.5.
    const typed = Array.from({ length: 9 }, () => p(10, 15, { w0: 0.5 }));
    expect(fit(typed, today).weight).toBeCloseTo(4.5);
    expect(fit(typed, today).ready).toBe(false);
    expect(fit([...typed, p(10, 15, { w0: 0.5 })], today).ready).toBe(true);
  });

  it('clips a forgotten timer at ±ln 6', () => {
    const m = fit([p(10, 1000), p(10, 1000), p(10, 1000), p(10, 1000), p(10, 1000)], today);
    expect(m.g).toBeCloseTo(Math.log(6), 10);
    expect(fit([p(60, 1)], today).g).toBeCloseTo(-Math.log(6), 10);
  });

  it('weights sources and lets old data fade (half-life 60 days)', () => {
    // A typed point (w 0.5) at ln 4 and a timed one (w 1) at 0 → g = 0.5 ln4 / 1.5
    expect(fit([p(10, 40, { w0: 0.5 }), p(10, 10)], today).g).toBeCloseTo(Math.log(4) / 3, 10);
    // 60 days old: half the weight.
    expect(fit([p(10, 40, { doneDay: '2026-08-10' }), p(10, 10)], today).g).toBeCloseTo((0.5 * Math.log(4)) / 1.5, 10);
  });

  it('fits a size slope from 15 points, shrunk towards zero', () => {
    // r = 0.5 · (ln est0 − mean): an exact slope of 0.5 before shrinking.
    const ests = [5, 10, 20, 40, 80];
    const pts: Point[] = [];
    for (let i = 0; i < 20; i++) { const e = ests[i % 5]!; pts.push(p(e, e)); }
    const xbar = ests.reduce((a, e) => a + Math.log(e), 0) / 5;
    pts.forEach(q => (q.real = q.est0 * Math.exp(0.5 * (Math.log(q.est0) - xbar))));
    const m = fit(pts, today);
    expect(m.slope).toBeCloseTo(0.5 * (20 / 35), 10);
    expect(fit(pts.slice(0, 14), today).slope).toBe(0);
  });

  it('shrinks a small class towards zero', () => {
    const base = [p(10, 10), p(10, 10), p(10, 10), p(10, 10), p(10, 10)];
    const few = fit([...base, p(10, 30, { app: 'Bank' }), p(10, 30, { app: 'Bank' }), p(10, 30, { app: 'Bank' })], today);
    const many = fit([...base, ...Array.from({ length: 30 }, () => p(10, 30, { app: 'Bank' }))], today);
    const off = (m: ReturnType<typeof fit>) => Math.log(predict(m, { est: 10, app: 'Bank', suit: 'S' })!.factor) - m.g;
    const raw = (m: ReturnType<typeof fit>) => Math.log(3) - m.g;
    expect(off(few) / raw(few)).toBeCloseTo(3 / 8, 10);
    expect(off(many) / raw(many)).toBeCloseTo(30 / 35, 10);
  });

  it('calibrates AI estimates separately', () => {
    const pts = [p(10, 10), p(10, 10), p(10, 10), p(10, 10), p(10, 10), p(10, 30, { by: 'ai' }), p(10, 30, { by: 'ai' }), p(10, 30, { by: 'ai' })];
    const m = fit(pts, today);
    expect(m.g).toBeCloseTo(0, 10);
    expect(m.gAi).toBeCloseTo(Math.log(3), 10);
    expect(predict(m, { est: 10, suit: 'S', estBy: 'ai' })!.value).toBe(30);
    expect(predict(m, { est: 10, suit: 'S', estBy: 'me' })!.value).toBe(10);
  });

  it('weighted percentiles and the median ratio', () => {
    expect(wpercentile([{ v: 1, w: 1 }, { v: 2, w: 1 }, { v: 3, w: 2 }], 0.25)).toBe(1);
    expect(wpercentile([{ v: 1, w: 1 }, { v: 2, w: 1 }, { v: 3, w: 2 }], 0.75)).toBe(3);
    expect(medianRatio([{ est0: 10, real: 20 }, { est0: 10, real: 10 }])).toBe(1.5);
    expect(medianRatio([])).toBeNull();
  });
});
