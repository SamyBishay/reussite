import { describe, expect, it } from 'vitest';
import { findProject, guessSuit, suitHistory } from './guess';
import { opensWithVerb } from './verbs';

const SUITS = {
  S: { name: { en: 'Work', fr: 'Travail' }, desc: { en: 'Job or studies, bureaucracy, administrative paperwork', fr: 'Emploi ou études, bureaucratie, papiers administratifs' } },
  D: { name: { en: 'Leisure', fr: 'Loisirs' }, desc: { en: 'Fun, relaxation, consumption, hobbies, outings', fr: 'Amusement, détente, consommation, passe-temps, sorties' } },
  C: { name: { en: 'Personal projects', fr: 'Projets personnels' }, desc: { en: 'Side projects, chores, research', fr: 'Projets perso, corvées, recherches' } },
  H: { name: { en: 'Interpersonal obligations', fr: 'Obligations envers les autres' }, desc: { en: 'Functions and services for family and friends', fr: 'Fonctions et services pour la famille et les amis' } },
};
// The owner's own four: papers and family have a suit each, and life holds health.
const OWN = {
  S: { name: { en: 'Work & studies', fr: 'Travail et études' } },
  D: { name: { en: 'Money & papers', fr: 'Argent et papiers' } },
  C: { name: { en: 'Family', fr: 'Famille' } },
  H: { name: { en: 'Life: people, leisure, health', fr: 'Vie : les gens, les loisirs, la santé' } },
};

describe('the suit a card’s words point to', () => {
  it('follows the suits as they are named and described', () => {
    expect(guessSuit('Pay the rent', SUITS)).toBe('S');
    expect(guessSuit('Do the laundry', SUITS)).toBe('C');
    expect(guessSuit('Call mum', SUITS)).toBe('H');
    expect(guessSuit('Watch the new film', SUITS)).toBe('D');
    expect(guessSuit('Book the dentist', SUITS)).toBeNull(); // no suit speaks of health
  });
  it('follows other names: the same words go where those suits say', () => {
    expect(guessSuit('Pay the rent', OWN)).toBe('D');
    expect(guessSuit('Call mum', OWN)).toBe('C');
    expect(guessSuit('Book the dentist', OWN)).toBe('H');
    expect(guessSuit('Prepare the meeting', OWN)).toBe('S');
    expect(guessSuit('Watch the new film', OWN)).toBe('H');
  });
  it('gives nothing when two suits pull as hard as each other, when nothing speaks, or with no suits', () => {
    expect(guessSuit('Call mum about the rent', SUITS)).toBeNull();
    expect(guessSuit('Fix the thing', SUITS)).toBeNull();
    expect(guessSuit('Pay the rent')).toBeNull();
  });
  it('the person’s own cards outrank the descriptions, once a word has been seen twice', () => {
    const h = suitHistory([
      { title: 'Rent receipt for March', suit: 'C' }, { title: 'Pay the rent', suit: 'C' }, { title: 'Rent increase letter', suit: 'C' },
      { title: 'Call the plumber', suit: 'S' }, { title: 'Call Anna', suit: 'H' },
    ]);
    expect(guessSuit('Pay the rent', SUITS, h)).toBe('C');
    // "call" went both ways and "bank" was never seen: the descriptions decide.
    expect(guessSuit('Call the bank', SUITS, h)).toBe('S');
    // A word seen once is not a habit.
    expect(guessSuit('Plumber invoice', SUITS, suitHistory([{ title: 'Call the plumber', suit: 'H' }]))).toBe('S');
  });
});

describe('the project a line names', () => {
  const P = [{ id: 'p1', name: 'Thesis', suit: 'S' as const }, { id: 'p2', name: 'Moving flat', suit: 'C' as const }, { id: 'p3', name: 'Flat', suit: 'D' as const }, { id: 'p4', name: 'Été 2027', suit: 'D' as const }];
  it('finds it as whole words, the longest name first', () => {
    expect(findProject('write the thesis introduction', P)?.project.id).toBe('p1');
    expect(findProject('book the van for moving flat', P)?.project.id).toBe('p2');
    expect(findProject('paint the flat', P)?.project.id).toBe('p3');
    expect(findProject('hypothesis testing', P)).toBeNull();
    expect(findProject('call the bank', P)).toBeNull();
  });
  it('takes a heading or a tag out of the line', () => {
    expect(findProject('Thesis: write the introduction', P)).toMatchObject({ project: { id: 'p1' }, text: 'write the introduction' });
    expect(findProject('write the introduction #thesis', P)).toMatchObject({ project: { id: 'p1' }, text: 'write the introduction' });
    expect(findProject('book the van #moving-flat tomorrow', P)).toMatchObject({ project: { id: 'p2' }, text: 'book the van tomorrow' });
    expect(findProject('été 2027 : réserver le train', P)).toMatchObject({ project: { id: 'p4' }, text: 'réserver le train' });
  });
});

describe('a piece that is a thing to do of its own', () => {
  it.each(['call the bank', 'pay the rent friday', 'appeler la banque', 'prendre rendez-vous', 'i need to book the dentist', 'je dois payer le loyer', 'finir le rapport'])('%s', x => expect(opensWithVerb(x)).toBe(true));
  it.each(['eggs', 'the bathroom', 'tom about the trip', 'research', 'du pain', 'la salle de bain', 'dossier de bourse', 'thursday 18:30', 'sections 1 and 2', 'dentiste vendredi'])('not: %s', x => expect(opensWithVerb(x)).toBe(false));
});
