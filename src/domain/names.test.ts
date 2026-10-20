import { describe, it, expect } from 'vitest';
import { findByName, norm } from './names';

const pool = [{ id: 'a', name: 'Call the agency' }, { id: 'b', name: 'Call the dentist' }, { id: 'c', name: 'Épargne' }];

describe('names', () => {
  it('norm drops case, accents and punctuation', () => {
    expect(norm('  Épargne,  d’été! ')).toBe('epargne d ete');
  });
  it('finds exactly, then by a unique prefix of whole words, ignoring accents', () => {
    expect(findByName('call the agency', pool)).toEqual({ id: 'a' });
    expect(findByName('epargne', pool)).toEqual({ id: 'c' });
    expect(findByName('Call the', [...pool.slice(1), { id: 'd', name: 'Call them back' }])).toEqual({ id: 'b' });
    expect(findByName('Call the d', pool)).toEqual({ none: true });
    expect(findByName('Épar', pool)).toEqual({ none: true });
  });
  it('reports several matches and none', () => {
    expect(findByName('call', pool)).toEqual({ many: [pool[0], pool[1]] });
    expect(findByName('zzz', pool)).toEqual({ none: true });
    expect(findByName('  ', pool)).toEqual({ none: true });
  });
});
