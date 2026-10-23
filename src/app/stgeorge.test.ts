import { describe, expect, it } from 'vitest';
import { speedLines, currentMode, rings, sparks } from './stgeorge';

describe('St George', () => {
  it('draws its speed lines all round, the same every time', () => {
    const a = speedLines(), b = speedLines();
    expect(a).toEqual(b);
    expect(a).toHaveLength(34);
    expect(Math.min(...a.map(l => l.a))).toBeLessThan(15);
    expect(Math.max(...a.map(l => l.a))).toBeGreaterThan(340);
    for (const l of a) { expect(l.r).toBeGreaterThan(0.1); expect(l.len).toBeLessThan(0.5); }
  });
  it('cuts the painted disc into rings that tile it, the outer ones flying furthest and first', () => {
    const r = rings();
    expect(r[0]!.from).toBe(0);
    expect(r.at(-1)!.to).toBe(1);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.from).toBe(r[i - 1]!.to);
      expect(r[i]!.burst).toBeGreaterThan(r[i - 1]!.burst);
      expect(r[i]!.delay).toBeLessThan(r[i - 1]!.delay);
    }
    expect(r.at(-1)!.delay).toBe(0);
  });
  it('throws its sparks all round, the same every time', () => {
    const s = sparks();
    expect(s).toEqual(sparks());
    expect(Math.max(...s.map(x => x.a)) - Math.min(...s.map(x => x.a))).toBeGreaterThan(300);
    for (const x of s) { expect(x.d).toBeGreaterThan(0.3); expect(x.d).toBeLessThan(0.75); }
  });
  it('starts from the theme the page forces, else the system one', () => {
    const el = { getAttribute: (k: string) => (k === 'data-theme' ? 'dark' : null) } as unknown as HTMLElement;
    expect(currentMode(el)).toBe('dark');
    const none = { getAttribute: () => null } as unknown as HTMLElement;
    expect(['light', 'dark']).toContain(currentMode(none));
  });
});
