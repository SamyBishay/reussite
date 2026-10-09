import { describe, expect, it } from 'vitest';
import { frTypo, translate } from './index';
import { en } from './en';
import { fr } from './fr';

const NNBSP = ' ';

describe('i18n', () => {
  it('French typography: narrow no-break space before ; : ! ? and inside « »', () => {
    expect(frTypo('Reprendre : x ; y ! z ?')).toBe(`Reprendre${NNBSP}: x${NNBSP}; y${NNBSP}! z${NNBSP}?`);
    expect(frTypo('« bonjour »')).toBe(`«${NNBSP}bonjour${NNBSP}»`);
    expect(frTypo('à 14:00, ratio 4,5:1')).toBe('à 14:00, ratio 4,5:1');
    expect(frTypo('https://a.b/c')).toBe('https://a.b/c');
  });
  it('plurals follow each language', () => {
    expect(translate('en', 'cardsToday', { n: 1 })).toBe('1 card today');
    expect(translate('en', 'cardsToday', { n: 0 })).toBe('0 cards today');
    expect(translate('fr', 'cardsPlayedToday', { n: 1 })).toBe('1 carte jouée aujourd’hui.');
    expect(translate('fr', 'cardsPlayedToday', { n: 0 })).toBe('0 carte jouée aujourd’hui.');
    expect(translate('fr', 'cardsPlayedToday', { n: 2 })).toBe('2 cartes jouées aujourd’hui.');
  });
  it('fills placeholders and applies typography to French', () => {
    expect(translate('fr', 'resume', { text: 'écrire' })).toBe(`Reprendre${NNBSP}: écrire`);
  });
  it('every key exists in both languages, and plurals have the same shape', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(typeof fr[k]).toBe(typeof en[k]);
  });
});
