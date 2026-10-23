import { describe, expect, it } from 'vitest';
import { PRESETS, themeCss, contrast, AA, lightCard, groundsOf } from './theme';
import { DEFAULT_SETTINGS, type Settings } from '../data/settings';

const with_ = (p: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...p });

describe('theme', () => {
  it('St George uses its own dark colours while its colours are untouched', () => {
    const css = themeCss(DEFAULT_SETTINGS);
    expect(css).toContain('--accent:#2D6A67');
    expect(css).toContain('--accent:#8DB0E6');
    expect(css).toContain('--suit-H:#EC9DB8');
    expect(css).not.toContain('--ground');
  });
  it('a changed colour is derived for dark mode, on St George grounds', () => {
    const css = themeCss(with_({ preset: 'custom', accent: '#225588' }));
    expect(css).toContain('--accent:#225588');
    expect(css).not.toContain('--accent:#8DB0E6');
    expect(groundsOf({ preset: 'custom' })).toBe('st-george');
  });
  it('Lilac & sea keeps its lilac grounds in both modes', () => {
    const p = PRESETS['lilac-sea']!;
    const css = themeCss(with_({ preset: 'lilac-sea', accent: p.accent, suitColors: p.suitColors }));
    expect(css).toContain('--ground:#F2F1F6');
    expect(css).toContain('--ground:#14121C');
    expect(lightCard({ preset: 'lilac-sea' })).toBe('#FFFFFF');
  });
  it('every preset passes AA on its light card, and St George on its dark card', () => {
    for (const [id, p] of Object.entries(PRESETS)) {
      const card = lightCard({ preset: id });
      for (const c of [p.accent, ...Object.values(p.suitColors)]) expect(contrast(c, card)).toBeGreaterThanOrEqual(AA);
    }
    const d = PRESETS['st-george']!.dark!;
    for (const c of [d.accent, ...Object.values(d.suitColors)]) expect(contrast(c, '#16161F')).toBeGreaterThanOrEqual(AA);
  });
});
