import { describe, expect, it } from 'vitest';
import { lastVisit, offerAddresses, offerPeople, seenAfter, visitPromptFor } from './offers';
import type { Address, Person, Verdict } from '../data/schema';

type A = Address & { id: string };
const visit = (day: string, verdict: Verdict, id = day + verdict) => ({ id, day, note: '', verdict });
const addr = (id: string, name: string, o: Partial<Address> = {}): A => ({ id, name, category: 'food', placeId: 'paris', mapsUrl: null, state: 'want', visits: [], by: 'me', note: '', ...o });
const ids = (xs: { id: string }[]) => xs.map(x => x.id);

describe('offerAddresses', () => {
  it('puts again before want to go, the least recently visited first, never visited before all', () => {
    const list = [
      addr('w1', 'Want old', { state: 'want' }),
      addr('a2', 'Again recent', { state: 'been', visits: [visit('2026-10-10', 'again')] }),
      addr('a1', 'Again old', { state: 'been', visits: [visit('2026-03-01', 'again')] }),
      addr('w2', 'Want seen long ago', { state: 'want', visits: [visit('2026-01-01', 'maybe')] }),
    ];
    expect(ids(offerAddresses(list, { place: 'paris' }))).toEqual(['a1', 'a2', 'w1']);
    expect(ids(offerAddresses(list, { place: 'paris', max: 10 }))).toEqual(['a1', 'a2', 'w1', 'w2']);
  });
  it('never offers not again, and uses only the last visit\'s verdict', () => {
    const list = [
      addr('n', 'No', { state: 'been', visits: [visit('2026-01-01', 'again'), visit('2026-02-01', 'not-again')] }),
      addr('r', 'Redeemed', { state: 'been', visits: [visit('2026-01-01', 'not-again'), visit('2026-02-01', 'again')] }),
      addr('m', 'Maybe only', { state: 'been', visits: [visit('2026-02-01', 'maybe')] }),
      addr('b', 'Been, no word', { state: 'been' }),
    ];
    expect(ids(offerAddresses(list, { place: 'paris' }))).toEqual(['r']);
  });
  it('keeps to the place (and Anywhere) and the category', () => {
    const list = [addr('p', 'Paris'), addr('l', 'Lyon', { placeId: 'lyon' }), addr('x', 'Anywhere', { placeId: 'any' }), addr('c', 'Café', { category: 'cafe' })];
    expect(ids(offerAddresses(list, { place: 'paris' }))).toEqual(['x', 'c', 'p']);
    expect(ids(offerAddresses(list, { place: 'paris', category: 'cafe' }))).toEqual(['c']);
    expect(ids(offerAddresses(list, { place: 'lyon', category: null }))).toEqual(['x', 'l']);
  });
  it('breaks ties by name (accents and case ignored) then id, whatever the input order', () => {
    const list = [addr('z', 'Étoile'), addr('b2', 'bar'), addr('b1', 'Bar'), addr('a', 'Zèbre')];
    const want = ['b1', 'b2', 'z'];
    expect(ids(offerAddresses(list, { place: 'paris' }))).toEqual(want);
    expect(ids(offerAddresses([...list].reverse(), { place: 'paris' }))).toEqual(want);
  });
  it('works on any iterable and never more than three', () => {
    const many = Array.from({ length: 8 }, (_, i) => addr('i' + i, 'N' + i));
    expect(offerAddresses(new Map(many.map(a => [a.id, a])).values(), { place: 'paris' })).toHaveLength(3);
  });
});

describe('offerPeople', () => {
  const p = (id: string, name: string, lastSeen: string | null, placeId = 'paris'): Person & { id: string } => ({ id, name, placeId, reach: null, note: '', lastSeen });
  it('offers those in the place seen least recently, never seen first, up to three', () => {
    const list = [p('a', 'Ana', '2026-10-01'), p('b', 'Ben', null), p('c', 'Cleo', '2026-02-01'), p('d', 'Dan', '2026-03-01'), p('e', 'Eli', null, 'lyon'), p('f', 'Fay', '2026-09-01', 'any')];
    expect(ids(offerPeople(list, { place: 'paris' }))).toEqual(['b', 'c', 'd']);
    expect(ids(offerPeople(list, { place: 'lyon' }))).toEqual(['e', 'f']);
  });
  it('is deterministic on ties', () => {
    const list = [p('2', 'Sam', null), p('1', 'Sam', null), p('0', 'Abe', null)];
    expect(ids(offerPeople(list, { place: 'paris' }))).toEqual(['0', '1', '2']);
  });
});

describe('visits and last seen', () => {
  it('last visit is the latest day, the last written on a tie', () => {
    expect(lastVisit(addr('x', 'x', { visits: [visit('2026-05-01', 'maybe', 'v1'), visit('2026-05-01', 'again', 'v2'), visit('2026-04-01', 'again', 'v0')] }))?.id).toBe('v2');
    expect(lastVisit(addr('x', 'x'))).toBeNull();
  });
  it('asks for a visit note only for a listed address with no visit from this step', () => {
    const m = new Map([['a1', addr('a1', 'x')], ['a2', addr('a2', 'y', { visits: [{ ...visit('2026-10-01', 'again'), stepId: 's1' }] })]]);
    expect(visitPromptFor({ id: 's1', addressId: 'a1' }, m)).toBe('a1');
    expect(visitPromptFor({ id: 's1', addressId: 'a2' }, m)).toBeNull();
    expect(visitPromptFor({ id: 's9', addressId: 'a2' }, m)).toBe('a2');
    expect(visitPromptFor({ id: 's1', addressId: 'gone' }, m)).toBeNull();
    expect(visitPromptFor({ id: 's1' }, m)).toBeNull();
  });
  it('seenAfter never moves last seen back', () => {
    expect(seenAfter(null, '2026-10-10')).toBe('2026-10-10');
    expect(seenAfter('2026-10-01', '2026-10-10')).toBe('2026-10-10');
    expect(seenAfter('2026-10-20', '2026-10-10')).toBe('2026-10-20');
  });
});
