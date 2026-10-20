import { describe, expect, it } from 'vitest';
import { addCategory, moveCategory, removeCategory, renameCategory } from './categories';

const L = [{ id: 'food', name: '' }, { id: 'cafe', name: '' }, { id: 'other', name: '' }];

describe('categories', () => {
  it('adds one at the end with a plain id that is not in use', () => {
    const a = addCategory(L, 'Bookshops');
    expect(a.at(-1)).toEqual({ id: 'bookshops', name: 'Bookshops' });
    expect(addCategory(a, 'Bookshops').at(-1)!.id).toBe('bookshops-2');
    expect(addCategory(L, 'Café!', ['cafe', 'cafe-2']).at(-1)!.id).toBe('cafe-3');
    expect(addCategory(L, '日本').at(-1)!.id).toBe('cat');
    expect(addCategory(L, '  ')).toEqual(L);
  });
  it('renames by id and an empty name gives back the default', () => {
    expect(renameCategory(L, 'food', ' Eating out ')[0]).toEqual({ id: 'food', name: 'Eating out' });
    expect(renameCategory(renameCategory(L, 'food', 'X'), 'food', '')[0]!.name).toBe('');
  });
  it('removes one and moves one, stopping at the ends', () => {
    expect(removeCategory(L, 'cafe').map(c => c.id)).toEqual(['food', 'other']);
    expect(moveCategory(L, 'other', -1).map(c => c.id)).toEqual(['food', 'other', 'cafe']);
    expect(moveCategory(L, 'food', -1).map(c => c.id)).toEqual(['food', 'cafe', 'other']);
    expect(moveCategory(L, 'other', 1).map(c => c.id)).toEqual(['food', 'cafe', 'other']);
  });
  it('never changes the list it was given', () => {
    const before = JSON.stringify(L);
    addCategory(L, 'x'); moveCategory(L, 'food', 1); removeCategory(L, 'food'); renameCategory(L, 'food', 'y');
    expect(JSON.stringify(L)).toBe(before);
  });
});
