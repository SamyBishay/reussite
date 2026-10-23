import { describe, expect, it } from 'vitest';
import { activeArea, areaFor, areaOf, areasOnPage, groupByArea, groupPlan, inArea, placePath, placeRows } from './areas';

const places = new Map<string, { name: string; order: number; parentId?: string | null }>([
  ['paris', { name: 'Paris', order: 0 }],
  ['cairo', { name: 'Cairo', order: 1 }],
  ['heli', { name: 'Heliopolis', order: 4, parentId: 'cairo' }],
  ['maadi', { name: 'Maadi', order: 2, parentId: 'cairo' }],
  ['lost', { name: 'Lost', order: 3, parentId: 'gone' }],
]);

describe('areas in use', () => {
  it('lists the places by order, each followed by its areas; an area with no parent is read as a place', () => {
    expect(placeRows(places).map(r => r.id + (r.area ? '*' : ''))).toEqual(['paris', 'cairo', 'maadi*', 'heli*', 'lost']);
    expect(placePath(places, 'heli')).toBe('Cairo › Heliopolis');
    expect(placePath(places, 'cairo')).toBe('Cairo');
    expect(placePath(places, 'x')).toBe('x');
  });

  it('knows the areas of a page, from the place or from one of its areas', () => {
    expect(areasOnPage(places, 'cairo')).toEqual(['maadi', 'heli']);
    expect(areasOnPage(places, 'heli')).toEqual(['maadi', 'heli']);
    expect(areasOnPage(places, 'paris')).toEqual([]);
    expect(areasOnPage(places, 'any')).toEqual([]);
    expect(areaOf(places, 'heli')).toBe('heli');
    expect(areaOf(places, 'cairo')).toBeNull();
    expect(areaOf(places, 'any')).toBeNull();
  });

  it('an area filter keeps that area and Anywhere, not the parent’s own steps; none keeps all', () => {
    expect(inArea('heli', 'heli')).toBe(true);
    expect(inArea('any', 'heli')).toBe(true);
    expect(inArea('cairo', 'heli')).toBe(false);
    expect(inArea('maadi', 'heli')).toBe(false);
    expect(inArea('cairo', null)).toBe(true);
  });

  it('a filter on an area the page no longer has is no filter', () => {
    expect(activeArea(places, 'cairo', 'heli')).toBe('heli');
    expect(activeArea(places, 'paris', 'heli')).toBeNull();
    expect(activeArea(places, 'cairo', 'gone')).toBeNull();
    expect(activeArea(places, 'cairo', null)).toBeNull();
  });

  it('groups items under area headings: no area first, then the areas in order, empty ones left out', () => {
    const items = [['a', 'cairo'], ['b', 'heli'], ['c', 'any'], ['d', 'maadi'], ['e', 'heli']] as const;
    const g = groupByArea(items, x => x[1], places, 'cairo');
    expect(g.map(x => [x.area, x.items.map(i => i[0]).join('')])).toEqual([[null, 'ac'], ['maadi', 'd'], ['heli', 'be']]);
    // Nothing in an area, or a page with no areas: one group, which a view shows without a heading.
    expect(groupByArea(items.slice(0, 1), x => x[1], places, 'cairo').map(x => x.area)).toEqual([null]);
    expect(groupByArea(items, x => x[1], places, 'paris').map(x => x.items.length)).toEqual([5]);
    expect(groupByArea([], x => x, places, 'cairo')).toEqual([]);
  });

  it('groups a day’s list: a half day names its heading, groups come in order of their first step', () => {
    const area: Record<string, string | null> = { a: null, b: 'heli', c: null, d: 'heli', e: 'maadi' };
    const g = groupPlan(['a', 'b', 'c', 'd', 'e'], id => area[id]!, [{ half: 'pm', placeId: 'heli' }]);
    expect(g).toEqual([{ area: null, half: null, ids: ['a', 'c'] }, { area: 'heli', half: 'pm', ids: ['b', 'd'] }, { area: 'maadi', half: null, ids: ['e'] }]);
    expect(groupPlan(['a', 'c'], id => area[id]!, undefined)).toEqual([{ area: null, half: null, ids: ['a', 'c'] }]);
    expect(areaFor([{ half: 'am', placeId: 'maadi' }], 'pm')).toBeNull();
    expect(areaFor([{ half: 'am', placeId: 'maadi' }], 'am')).toBe('maadi');
    expect(areaFor(undefined, 'am')).toBeNull();
  });
});
