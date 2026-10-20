import { describe, expect, it } from 'vitest';
import { normNote } from '../data/normalize';
import { noteLines, notesMatching, pickNotes, tokensOf, type Note } from './memory';

let n = 0;
const note = (name: string, extra: Record<string, unknown> = {}): Note => ({ ...normNote({ name, ...extra }), id: 'n' + n++ });
const lines = (...texts: string[]) => texts.map((text, i) => ({ id: 'l' + i, text, at: '2026-10-01T10:00:00Z', by: 'me' }));

describe('notesMatching', () => {
  const ibrahim = note('Ibrahim', { kind: 'person', aliases: ['Ibra', 'Brahim'] });
  const choir = note('Choir', { kind: 'topic' });
  const elodie = note('Élodie', { kind: 'person' });
  const all = [ibrahim, choir, elodie];

  it('matches whole words, ignoring case, accents and punctuation', () => {
    expect(notesMatching('Lunch with IBRAHIM, then choir.', all)).toEqual([ibrahim, choir]);
    expect(notesMatching('rendez-vous avec elodie', all)).toEqual([elodie]);
    expect(notesMatching("Ibrahim's flat / chez d'Ibrahim", all)).toEqual([ibrahim]);
  });
  it('matches an alias', () => {
    expect(notesMatching('call Ibra tonight', all)).toEqual([ibrahim]);
    expect(notesMatching('Brahim is late', all)).toEqual([ibrahim]);
  });
  it('does not match inside a longer word', () => {
    expect(notesMatching('Ibrahimovic scored; choirmaster', all)).toEqual([]);
    expect(notesMatching('', all)).toEqual([]);
  });
  it('ignores empty and one-letter names', () => {
    const odd = [note('', { aliases: ['', ' '] }), note('M', { aliases: ['x'] })];
    expect(notesMatching('M x and more', odd)).toEqual([]);
  });
});

describe('noteLines', () => {
  it('numbers the lines from 1', () => {
    expect(noteLines(note('A', { lines: lines('first', 'second') }))).toEqual(['1. first', '2. second']);
    expect(noteLines(note('B'))).toEqual([]);
  });
});

describe('pickNotes', () => {
  const profile = note('Me', { kind: 'profile', updated: '2026-01-01', lines: lines('I work in the mornings') });
  const old = note('Ibrahim', { kind: 'person', updated: '2026-02-01', lines: lines('Moving flat in March') });
  const fresh = note('Hill House', { kind: 'place', updated: '2026-09-01', aliases: ['the manor'], lines: lines('Choir rehearsals, room 602') });
  const secret = note('Ibrahim Private', { kind: 'person', aliases: ['Ibrahim'], private: true, updated: '2026-10-01', lines: lines('hidden') });
  const other = note('Unrelated', { updated: '2026-10-10', lines: lines('nothing to do with it') });
  const notes = [other, old, secret, fresh, profile];
  const pick = (message: string, o: Partial<Parameters<typeof pickNotes>[0]> = {}) => pickNotes({ notes, message, budgetTokens: 3000, ...o }).map(x => x.name);

  it('sends the profile alone when nothing matches', () => {
    expect(pick('hello')).toEqual(['Me']);
  });
  it('puts the profile first, then matches, most recently updated first', () => {
    expect(pick('Ibrahim and the manor')).toEqual(['Me', 'Hill House', 'Ibrahim']);
  });
  it('never sends a private note, even when its alias is named', () => {
    expect(pick('Ibrahim')).not.toContain('Ibrahim Private');
    expect(pickNotes({ notes: [secret], message: 'Ibrahim', budgetTokens: 3000 })).toEqual([]);
  });
  it('also looks at the steps involved and their projects', () => {
    expect(pick('what is on today', { tasks: [{ title: 'Call Ibrahim', project: 'p1' }] })).toEqual(['Me', 'Ibrahim']);
    expect(pick('what is on today', { tasks: [{ title: 'Book the room', project: 'p1', note: 'for Friday' }], projects: [{ id: 'p1', name: 'Hill House' }] })).toEqual(['Me', 'Hill House']);
  });
  it('cuts at the budget, skipping a note that does not fit but keeping a smaller one after it', () => {
    const big = note('Bigname', { kind: 'topic', updated: '2026-10-20', lines: lines('x'.repeat(400)) });
    const small = note('Smallname', { kind: 'topic', updated: '2026-01-01', lines: lines('tiny') });
    const got = pickNotes({ notes: [profile, big, small], message: 'Bigname and Smallname', budgetTokens: 60 }).map(x => x.name);
    expect(got).toEqual(['Me', 'Smallname']);
    expect(tokensOf('abcd')).toBe(1);
    expect(pick('Ibrahim and the manor', { budgetTokens: 0 })).toEqual(['Me']); // the profile always goes
  });
  it('is stable for the same input', () => {
    expect(pick('Ibrahim and the manor')).toEqual(pick('Ibrahim and the manor'));
  });
});
