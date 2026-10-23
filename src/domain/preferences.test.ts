import { describe, expect, it } from 'vitest';
import { buildPreferences, DEFAULT_FORM, DEFAULT_PREFERENCES, preferencesPack, preferencesSystem, preferencesText } from './preferences';

describe('AI preferences', () => {
  it('the default is the template: one question, facts not praise, no guilt, no feelings, push back, short', () => {
    expect(DEFAULT_PREFERENCES).toBe(buildPreferences(DEFAULT_FORM));
    for (const w of ['One question at a time', 'never praise of character', 'No guilt', 'how I feel', 'Push back on avoidance', 'Level of detail: short.']) expect(DEFAULT_PREFERENCES).toContain(w);
    expect(DEFAULT_PREFERENCES).not.toContain('Things to know');
    expect(DEFAULT_PREFERENCES).not.toContain('Things never to do');
    expect(DEFAULT_PREFERENCES.split('\n').every(l => l.startsWith('- '))).toBe(true);
  });
  it('the form adds the level of detail and the two free lines, each on one line', () => {
    const t = buildPreferences({ detail: 'full', know: 'I start better\nwith a time', never: '  no emojis  ' });
    expect(t).toContain('- Level of detail: full explanations.');
    expect(t).toContain('- Things to know about how I work: I start better with a time');
    expect(t).toContain('- Things never to do: no emojis');
    expect(buildPreferences({ detail: 'very short', know: '', never: '' })).toContain('Level of detail: very short.');
  });
  it('is empty when the person emptied it, and then nothing is sent for it', () => {
    expect(preferencesSystem('  \n ')).toBe('');
    expect(preferencesPack('')).toBe('');
    expect(preferencesSystem(undefined)).toBe('');
    expect(preferencesText(42)).toBe('');
    expect(preferencesSystem('- Be brief.')).toContain('- Be brief.');
    expect(preferencesPack('- Be brief.')).toBe('## How I want you to work with me\n\n- Be brief.');
  });
});
