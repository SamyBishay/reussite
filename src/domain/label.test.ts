import { describe, expect, it } from 'vitest';
import { deriveLabel, shortLabel } from './label';

describe('shortLabel', () => {
  it('uses the label the step has, as written', () => {
    expect(shortLabel({ title: 'Go to choir rehearsal at Hill House', label: 'Choir · Hill House' })).toBe('Choir · Hill House');
    expect(shortLabel({ title: 'x', label: '  CAF claim letter ' })).toBe('CAF claim letter');
  });
  it('derives one when the label is missing, empty or blank', () => {
    expect(shortLabel({ title: 'Call Ibrahim' })).toBe('Ibrahim');
    expect(shortLabel({ title: 'Call Ibrahim', label: '' })).toBe('Ibrahim');
    expect(shortLabel({ title: 'Call Ibrahim', label: '   ' })).toBe('Ibrahim');
    expect(shortLabel({ title: 'Call Ibrahim', label: null })).toBe('Ibrahim');
  });
});

describe('deriveLabel', () => {
  it('drops the leading action verb and the filler words', () => {
    expect(deriveLabel('Send the CAF claim letter')).toBe('CAF claim letter');
    expect(deriveLabel('Go to choir at Hill House')).toBe('choir Hill House');
    expect(deriveLabel('Reply to the landlord about the deposit')).toBe('landlord deposit');
  });
  it('keeps at most five words', () => {
    expect(deriveLabel('Write the quarterly report for the finance team before the board meeting')).toBe('quarterly report finance team before');
    expect(deriveLabel('Write the quarterly report for the finance team before the board meeting').split(' ')).toHaveLength(5);
  });
  it('drops a second verb after "and" and the starter the title begins with', () => {
    expect(deriveLabel('Open Mail and reply to the CAF about the claim letter')).toBe('Mail CAF claim letter');
    expect(deriveLabel('Open Mail and reply to the CAF about the claim letter', 'Open Mail')).toBe('CAF claim letter');
  });
  it('trims punctuation around words', () => {
    expect(deriveLabel('Call the agency, then (maybe) the notaire.')).toBe('agency maybe notaire');
    expect(deriveLabel('Pay "Zed" — rent!')).toBe('Zed rent');
  });
  it('works in French: verbs, articles and elisions', () => {
    expect(deriveLabel("Envoyer la lettre de réclamation à la CAF")).toBe('lettre réclamation CAF');
    expect(deriveLabel("Appelle l'agence pour l'état des lieux")).toBe('agence état lieux');
    expect(deriveLabel('Réserver le train pour Lyon')).toBe('train Lyon');
  });
  it('is never empty: a title of one verb or only filler keeps its own words', () => {
    expect(deriveLabel('Call')).toBe('Call');
    expect(deriveLabel('Go to the')).toBe('Go to the');
    expect(deriveLabel('  Book  ')).toBe('Book');
    expect(deriveLabel('')).toBe('');
  });
  it('does not drop a verb that is not at the start', () => {
    expect(deriveLabel('Return book to library')).toBe('book library');
    expect(deriveLabel('Passport photo')).toBe('Passport photo');
  });
});
