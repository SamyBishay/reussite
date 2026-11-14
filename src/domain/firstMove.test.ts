import { describe, it, expect } from 'vitest';
import { suggestFirstMove } from './firstMove';
import { en } from '../i18n/en';
import { fr } from '../i18n/fr';

describe('a first move suggested from the verb', () => {
  const cases: [string, ReturnType<typeof suggestFirstMove>][] = [
    ['call the bank', 'fmCall'],
    ['Call the bank about the card', 'fmCall'],
    ['appeler la banque', 'fmCall'],
    ['Rappeler le notaire', 'fmCall'],
    ['email Anna the report', 'fmMail'],
    ['reply to the agency', 'fmMail'],
    ['répondre à l’agence', 'fmMail'],
    ['write to the landlord', 'fmMail'],
    ['text Noor about lunch', 'fmText'],
    ['send a message to Sam', 'fmText'],
    ['envoyer un message à Sam', 'fmText'],
    ['écrire à maman', 'fmText'],
    ['pay the rent', 'fmPay'],
    ['payer le loyer', 'fmPay'],
    ['book the dentist', 'fmBook'],
    ['prendre rendez-vous chez le dentiste', 'fmBook'],
    ['order new glasses', 'fmOrder'],
    ['buy bread', 'fmBuy'],
    ['acheter du pain', 'fmBuy'],
    ['fill in the tax form', 'fmPaper'],
    ['remplir le formulaire de la CAF', 'fmPaper'],
    ['cancel the gym', 'fmSite'],
    ['résilier la salle de sport', 'fmSite'],
    ['write the introduction', 'fmWrite'],
    ['finir le rapport', 'fmWrite'],
    ['read chapter 3', 'fmRead'],
    ['relire le chapitre 3', 'fmRead'],
    ['revise for the exam', 'fmStudy'],
    ['réviser pour l’examen', 'fmStudy'],
    ['clean the kitchen', 'fmTidy'],
    ['do the dishes', 'fmTidy'],
    ['ranger le bureau', 'fmTidy'],
    ['return the parcel', 'fmGo'],
    ['aller à la poste', 'fmGo'],
  ];
  for (const [title, key] of cases) it(`${title} → ${key}`, () => expect(suggestFirstMove(title)).toBe(key));

  it('reads past a polite opening', () => {
    expect(suggestFirstMove('I need to call the bank')).toBe('fmCall');
    expect(suggestFirstMove('je dois payer le loyer')).toBe('fmPay');
    expect(suggestFirstMove('ne pas oublier d’appeler Sam')).toBe('fmCall');
  });

  it('a verb is a whole word: "calligraphy class" and "mailbox key" suggest nothing', () => {
    expect(suggestFirstMove('calligraphy class')).toBeNull();
    expect(suggestFirstMove('mailbox key')).toBeNull();
    expect(suggestFirstMove('payeur')).toBeNull();
  });

  it('no verb it knows: nothing, the person writes their own', () => {
    expect(suggestFirstMove('the thesis')).toBeNull();
    expect(suggestFirstMove('dentist Friday')).toBeNull();
    expect(suggestFirstMove('')).toBeNull();
  });

  it('every suggestion has its sentence in English and French', () => {
    for (const [, key] of cases) {
      expect(en[key!], key!).toBeTruthy();
      expect(fr[key!], key!).toBeTruthy();
    }
  });
});
