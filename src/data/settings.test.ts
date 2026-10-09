import { describe, expect, it } from 'vitest';
import { withDefaults, DEFAULT_SETTINGS } from './settings';

describe('settings defaults', () => {
  it('adds new keys without overwriting chosen ones', () => {
    const s = withDefaults({ accent: '#000000', suits: { S: { ...DEFAULT_SETTINGS.suits.S, glyph: 'W' } } as never });
    expect(s.accent).toBe('#000000');
    expect(s.urgencyDays).toBe(21);
    expect(s.suits.S.glyph).toBe('W');
    expect(s.suits.H.glyph).toBe('♥');
  });
  it('keeps unknown keys', () => {
    expect(withDefaults({ futureThing: 3 } as never)).toHaveProperty('futureThing', 3);
  });
});
