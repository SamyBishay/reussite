import { describe, expect, it } from 'vitest';
import { isArea, onPage, parentOf, parentProblem, placeAndAreas, rootOf, zoneOfPlace, type PlaceMap } from './places';

const P = (o: Record<string, { timeZone?: string; parentId?: string | null; order?: number }>): PlaceMap => new Map(Object.entries(o));
const places = P({
  paris: { timeZone: 'Europe/Paris', order: 0 },
  cairo: { timeZone: 'Africa/Cairo', order: 1 },
  heli: { timeZone: 'Europe/Paris', parentId: 'cairo', order: 3 }, // a stored zone on an area is ignored
  maadi: { parentId: 'cairo', order: 2 },
});

describe('areas', () => {
  it('an area belongs to its parent: root, parent, isArea', () => {
    expect(rootOf(places, 'heli')).toBe('cairo');
    expect(rootOf(places, 'cairo')).toBe('cairo');
    expect(rootOf(places, 'any')).toBe('any');
    expect(rootOf(places, 'gone')).toBe('gone');
    expect(parentOf(places, 'heli')).toBe('cairo');
    expect(parentOf(places, 'cairo')).toBeUndefined();
    expect(isArea(places, 'maadi')).toBe(true);
    expect(isArea(places, 'paris')).toBe(false);
  });

  it('the zone of a place resolves through its parent; a place keeps its own', () => {
    expect(zoneOfPlace(places, 'heli')).toBe('Africa/Cairo');
    expect(zoneOfPlace(places, 'maadi')).toBe('Africa/Cairo');
    expect(zoneOfPlace(places, 'paris')).toBe('Europe/Paris');
    expect(zoneOfPlace(places, 'any')).toBeUndefined();
  });

  it('placeAndAreas: the place first, then its areas in order, whichever of them is asked for', () => {
    expect(placeAndAreas(places, 'cairo')).toEqual(['cairo', 'maadi', 'heli']);
    expect(placeAndAreas(places, 'heli')).toEqual(['cairo', 'maadi', 'heli']);
    expect(placeAndAreas(places, 'paris')).toEqual(['paris']);
    expect(placeAndAreas(places, 'any')).toEqual(['any']);
  });

  it('onPage: an area counts as its parent in both directions, Anywhere is on every page, other places are not', () => {
    expect(onPage(places, 'heli', 'cairo')).toBe(true);
    expect(onPage(places, 'cairo', 'heli')).toBe(true);
    expect(onPage(places, 'heli', 'maadi')).toBe(true);
    expect(onPage(places, 'heli', 'paris')).toBe(false);
    expect(onPage(places, 'paris', 'cairo')).toBe(false);
    expect(onPage(places, 'any', 'heli')).toBe(true);
  });

  it('reads forgivingly: a missing parent makes a place of it, a chain goes to its top, a loop ends', () => {
    const odd = P({ a: { parentId: 'gone', timeZone: 'Asia/Tokyo' }, b: { parentId: 'c' }, c: { parentId: 'd' }, d: { timeZone: 'UTC' }, x: { parentId: 'y' }, y: { parentId: 'x' }, s: { parentId: 's' } });
    expect(rootOf(odd, 'a')).toBe('a');
    expect(zoneOfPlace(odd, 'a')).toBe('Asia/Tokyo');
    expect(rootOf(odd, 'b')).toBe('d');
    expect(zoneOfPlace(odd, 'b')).toBe('UTC');
    expect(['x', 'y']).toContain(rootOf(odd, 'x'));
    expect(rootOf(odd, 's')).toBe('s');
  });

  it('parentProblem: one level only', () => {
    expect(parentProblem(places, null, 'cairo')).toBeNull();
    expect(parentProblem(places, 'paris', 'cairo')).toBeNull(); // a place without areas can become one
    expect(parentProblem(places, 'heli', 'paris')).toBeNull(); // an area can move
    expect(parentProblem(places, 'paris', 'paris')).toBe('self');
    expect(parentProblem(places, null, 'gone')).toBe('missing');
    expect(parentProblem(places, null, 'heli')).toBe('area');
    expect(parentProblem(places, 'paris', 'heli')).toBe('area');
    expect(parentProblem(places, 'cairo', 'paris')).toBe('hasAreas');
    expect(parentProblem(places, 'cairo', 'cairo')).toBe('self');
  });
});
