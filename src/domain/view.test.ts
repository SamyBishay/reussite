import { describe, expect, it } from 'vitest';
import { ALL_VIEW, defaultView, parseSavedView, resolveView, savedViewFor, viewsElsewhere } from './view';

const places = new Map<string, { parentId?: string | null; timeZone?: string }>([
  ['paris', {}],
  ['cairo', { timeZone: 'Africa/Cairo' }],
  ['heli', { parentId: 'cairo' }],
  ['islamic', { parentId: 'cairo' }],
]);

describe('the view', () => {
  it('defaults to the region of where the person is, whether they are in the region or in one of its areas', () => {
    expect(defaultView(places, 'cairo')).toEqual({ id: 'cairo', page: 'cairo', area: null, all: false });
    expect(defaultView(places, 'heli')).toEqual({ id: 'cairo', page: 'cairo', area: null, all: false });
    expect(defaultView(places, 'paris').page).toBe('paris');
    // Nowhere in particular: the page is Anywhere's, as it was.
    expect(defaultView(places, 'any').page).toBe('any');
    expect(resolveView(places, 'cairo', null)).toEqual(defaultView(places, 'cairo'));
    expect(resolveView(places, 'cairo', undefined)).toEqual(defaultView(places, 'cairo'));
  });

  it('keeps a saved area or place while the person is still in the region it was made in', () => {
    expect(resolveView(places, 'cairo', { id: 'islamic', region: 'cairo' })).toEqual({ id: 'islamic', page: 'cairo', area: 'islamic', all: false });
    expect(resolveView(places, 'heli', { id: 'islamic', region: 'cairo' }).area).toBe('islamic');
    // Looking at another city from here.
    expect(resolveView(places, 'cairo', { id: 'paris', region: 'cairo' })).toEqual({ id: 'paris', page: 'paris', area: null, all: false });
  });

  it('everywhere has no area and keeps the page of the region, so the page still has a place to name', () => {
    expect(resolveView(places, 'heli', { id: ALL_VIEW, region: 'cairo' })).toEqual({ id: 'all', page: 'cairo', area: null, all: true });
  });

  it('goes back to the region when here moves to another region, by a stay or a tick', () => {
    const saved = { id: 'islamic', region: 'cairo' };
    expect(resolveView(places, 'paris', saved)).toEqual(defaultView(places, 'paris'));
    expect(resolveView(places, 'paris', { id: ALL_VIEW, region: 'cairo' }).all).toBe(false);
  });

  it('moving between areas of the same region does not reset it', () => {
    const saved = { id: 'islamic', region: 'cairo' };
    expect(resolveView(places, 'heli', saved).area).toBe('islamic');
  });

  it('falls back to the default when the place or area is gone', () => {
    expect(resolveView(places, 'cairo', { id: 'deleted', region: 'cairo' })).toEqual(defaultView(places, 'cairo'));
    const without = new Map(places);
    without.delete('islamic');
    expect(resolveView(without, 'cairo', { id: 'islamic', region: 'cairo' })).toEqual(defaultView(without, 'cairo'));
  });

  it('keeps nothing for the default, and the region it was made in for anything else', () => {
    expect(savedViewFor(places, 'cairo', null)).toBeNull();
    expect(savedViewFor(places, 'heli', 'cairo')).toBeNull();
    expect(savedViewFor(places, 'heli', 'islamic')).toEqual({ id: 'islamic', region: 'cairo' });
    expect(savedViewFor(places, 'cairo', ALL_VIEW)).toEqual({ id: 'all', region: 'cairo' });
  });

  it('says when the lists show something other than where the person is', () => {
    const at = (here: string, saved: Parameters<typeof resolveView>[2]) => viewsElsewhere(places, here, resolveView(places, here, saved));
    expect(at('cairo', null)).toBe(false);
    expect(at('heli', null)).toBe(false);
    expect(at('heli', { id: 'heli', region: 'cairo' })).toBe(false);
    expect(at('cairo', { id: 'islamic', region: 'cairo' })).toBe(true);
    expect(at('cairo', { id: 'paris', region: 'cairo' })).toBe(true);
    expect(at('cairo', { id: ALL_VIEW, region: 'cairo' })).toBe(true);
  });

  it('reads what was kept, and nothing that is not a view', () => {
    expect(parseSavedView('{"id":"islamic","region":"cairo"}')).toEqual({ id: 'islamic', region: 'cairo' });
    expect(parseSavedView(null)).toBeNull();
    expect(parseSavedView('')).toBeNull();
    expect(parseSavedView('not json')).toBeNull();
    expect(parseSavedView('{"id":3,"region":"cairo"}')).toBeNull();
    expect(parseSavedView('{"id":"x"}')).toBeNull();
    expect(parseSavedView('null')).toBeNull();
  });
});
