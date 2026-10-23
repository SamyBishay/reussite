import { describe, expect, it } from 'vitest';
import { speedLines, currentMode } from './stgeorge';

describe('St George', () => {
  it('draws its speed lines all round, the same every time', () => {
    const a = speedLines(), b = speedLines();
    expect(a).toEqual(b);
    expect(a).toHaveLength(34);
    expect(Math.min(...a.map(l => l.a))).toBeLessThan(15);
    expect(Math.max(...a.map(l => l.a))).toBeGreaterThan(340);
    for (const l of a) { expect(l.r).toBeGreaterThan(0.1); expect(l.len).toBeLessThan(0.5); }
  });
  it('starts from the theme the page forces, else the system one', () => {
    const el = { getAttribute: (k: string) => (k === 'data-theme' ? 'dark' : null) } as unknown as HTMLElement;
    expect(currentMode(el)).toBe('dark');
    const none = { getAttribute: () => null } as unknown as HTMLElement;
    expect(['light', 'dark']).toContain(currentMode(none));
  });
});
