import { describe, expect, it } from 'vitest';
import { matchesQuery, queryWords } from './search';

describe('searching cards', () => {
  const card = ['Call the dentist', 'dentist', 'Ask about the crown', 'Health', 'Café Léa'];
  it('an empty query matches everything', () => {
    expect(matchesQuery('', card)).toBe(true);
    expect(matchesQuery('  ', card)).toBe(true);
    expect(queryWords(' , ')).toEqual([]);
  });
  it('ignores case and accents in both the query and the card', () => {
    expect(matchesQuery('CAFE', card)).toBe(true);
    expect(matchesQuery('café lea', card)).toBe(true);
    expect(matchesQuery('léa', ['cafe lea'])).toBe(true);
    expect(matchesQuery('élève', ['Eleve du lundi'])).toBe(true);
  });
  it('finds it by title, short name, note, project or place, and by part of a word', () => {
    for (const q of ['dentist', 'crown', 'health', 'cafe', 'crow', 'Call the']) expect(matchesQuery(q, card), q).toBe(true);
  });
  it('wants every word, in any order, and finds nothing else', () => {
    expect(matchesQuery('crown dentist', card)).toBe(true);
    expect(matchesQuery('crown plumber', card)).toBe(false);
    expect(matchesQuery('plumber', card)).toBe(false);
  });
  it('copes with missing fields and punctuation', () => {
    expect(matchesQuery('dr martin', ['Dr. Martin', null, undefined, ''])).toBe(true);
    expect(matchesQuery('x', [null, undefined])).toBe(false);
  });
});
