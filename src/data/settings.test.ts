import { describe, expect, it } from 'vitest';
import { withDefaults, DEFAULT_SETTINGS, ST_GEORGE_FROM, firstWritten } from './settings';

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
  it('notification settings merge: a chosen toggle stays, new types default on', () => {
    const s = withDefaults({ notify: { launch: false } as never, notifyText: 'titles', notifyLead: 45 });
    // What was stored stays (a removed type keeps its value), and the new defaults fill the rest.
    expect(s.notify).toEqual({ launch: false, fixed: true, checkin: true, close: true, decision: true, review: true });
    expect(s.notifyText).toBe('titles');
    expect(s.notifyLead).toBe(45);
    const d = withDefaults({});
    expect(d).toMatchObject({ notifyText: 'generic', notifyLead: 30, feedDetail: 'times' });
    expect(Object.values(d.notify).every(Boolean)).toBe(true);
  });
  it('reads the old feedTitles switch as the feed level until one is chosen, and keeps the old key', () => {
    expect(withDefaults({ feedTitles: true } as never)).toMatchObject({ feedDetail: 'labels', feedTitles: true });
    expect(withDefaults({ feedTitles: false } as never).feedDetail).toBe('times');
    expect(withDefaults({}).feedDetail).toBe('times');
    expect(withDefaults({ feedTitles: true, feedDetail: 'full' } as never).feedDetail).toBe('full');
    expect(withDefaults({ feedTitles: true, feedDetail: 'times' } as never).feedDetail).toBe('times');
  });
  it('St George is the default for new people; an older document with no palette chosen keeps Lilac & sea', () => {
    expect(withDefaults(undefined)).toMatchObject({ preset: 'st-george', accent: '#2D6A67' });
    expect(withDefaults({ language: 'fr' }, ST_GEORGE_FROM + 1000).preset).toBe('st-george');
    expect(withDefaults({ language: 'fr' }, ST_GEORGE_FROM - 1000)).toMatchObject({ preset: 'lilac-sea', accent: '#6B4BA6', suitColors: { S: '#1E7568', D: '#7A55B8', C: '#1E7568', H: '#7A55B8' } });
    // A palette chosen is never touched, old or new.
    expect(withDefaults({ preset: 'classic', accent: '#3A3A44' }, ST_GEORGE_FROM - 1000)).toMatchObject({ preset: 'classic', accent: '#3A3A44' });
    expect(withDefaults({ accent: '#112233' }, ST_GEORGE_FROM - 1000)).toMatchObject({ accent: '#112233', preset: 'st-george' });
    expect(withDefaults({ preset: 'lilac-sea' } as never, ST_GEORGE_FROM + 1000).preset).toBe('lilac-sea');
  });
  it('firstWritten is the oldest field clock', () => {
    expect(firstWritten({ a: '1760000000000:0000:x', b: '1750000000000:0003:y' })).toBe(1750000000000);
    expect(firstWritten({})).toBe(Infinity);
  });
});
