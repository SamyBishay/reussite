// The corpus of Home's parser (docs/dev/home.md): lines a person types or dictates, in English and French, each with what it should
// become. It is the measure of the mode with no cloud AI: `parse.corpus.test.ts` reads every line and prints the score by category.
// A new rule starts here, as lines that fail. Dates are fixed: today is Saturday 14 November 2026, 10:00 in Paris.
import type { ParseContext, Unknown } from './parse';
import { suggestFirstMove, type FirstMove } from './firstMove';
import type { SuitId } from '../data/schema';

/** A card a line makes. `suit`, `project` and `first` are compared only when the case gives them (null: there must be none). */
export interface Card {
  t: string; due?: string; dueAt?: string; at?: string; dur?: number; est?: number; where?: string;
  urgent?: true; important?: true; waiting?: true; nudge?: string;
  suit?: SuitId | null; project?: string | null; first?: FirstMove | null;
}
export type Want =
  | { add: Card[] }
  | { standing: { t: string; at: string; weekdays: number[]; dur?: number; until?: string; where?: string } }
  | { done: string; day?: string }
  | { move: string; due: string; at?: string }
  | { drop: string }
  /** A line added to a card's note. */
  | { note: string; text: string }
  /** The timer: start a card, or pause the one that runs. */
  | { timer: 'start'; id: string } | { timer: 'pause' }
  /** Time spent on a card, said after the fact. */
  | { spent: string; min: number }
  | { pick: string[] }
  | { sheet: true }
  | { unknown: Unknown }
  /** Several things in one line: each as above. */
  | { all: Want[] };
export interface Case { line: string; cat: string; want: Want }

const SUITS = {
  S: { name: { en: 'Work', fr: 'Travail' }, desc: { en: 'Job or studies, bureaucracy, administrative paperwork', fr: 'Emploi ou études, bureaucratie, papiers administratifs' } },
  D: { name: { en: 'Leisure', fr: 'Loisirs' }, desc: { en: 'Fun, relaxation, consumption, hobbies, outings', fr: 'Amusement, détente, consommation, passe-temps, sorties' } },
  C: { name: { en: 'Personal projects', fr: 'Projets personnels' }, desc: { en: 'Side projects, chores, research', fr: 'Projets perso, corvées, recherches' } },
  H: { name: { en: 'Interpersonal obligations', fr: 'Obligations envers les autres' }, desc: { en: 'Functions and services for family and friends', fr: 'Fonctions et services pour la famille et les amis' } },
};

export const CORPUS_CTX: ParseContext = {
  today: '2026-11-14',
  now: Date.UTC(2026, 10, 14, 9, 0), // 10:00 in Paris
  dayStart: '05:00',
  zone: 'Europe/Paris',
  places: [{ id: 'pl-home', name: 'Home' }, { id: 'pl-office', name: 'Office' }, { id: 'pl-hill', name: 'Hill House' }],
  tasks: [
    { id: 't-dentist', title: 'Call the dentist about the cleaning', status: 'open' },
    { id: 't-rent', title: 'Pay the rent', status: 'open', note: 'By transfer' },
    { id: 't-report', title: 'Write the quarterly report', status: 'open' },
    { id: 't-agency', title: 'Call the agency', status: 'open' },
    { id: 't-choir', title: 'Choir, Hill House 602', status: 'open', template: true },
    { id: 't-plants', title: 'Water the plants', status: 'done' },
    { id: 't-landlord', title: 'Open Mail and reply to the landlord', status: 'open' },
    { id: 't-photos', title: 'Sort the holiday photos', status: 'open' },
    { id: 't-stage', title: 'Relire la convention de stage', status: 'open' },
    { id: 't-impots', title: 'Déclarer les impôts', status: 'open' },
  ],
  projects: [{ id: 'pr-thesis', name: 'Thesis', suit: 'S' }, { id: 'pr-move', name: 'Moving flat', suit: 'C' }, { id: 'pr-jardin', name: 'Jardin', suit: 'C' }],
  suits: SUITS,
  // Here the first move is the name of its sentence; the app gives the sentence in its language.
  firstMove: suggestFirstMove,
};

const add = (...cards: Card[]): Want => ({ add: cards });
const c = (cat: string, rows: [string, Want][]): Case[] => rows.map(([line, want]) => ({ line, cat, want }));

export const CORPUS: Case[] = [
  ...c('plain', [
    ['call the bank', add({ t: 'Call the bank' })],
    ['buy bread', add({ t: 'Buy bread' })],
    ['appeler la banque', add({ t: 'Appeler la banque' })],
    ['acheter du pain', add({ t: 'Acheter du pain' })],
    ['R: renew the passport', add({ t: 'Renew the passport' })],
    ['add water the plants', add({ t: 'Water the plants' })],
    ['todo: fix the bike', add({ t: 'Fix the bike' })],
    ['ajouter ranger le bureau', add({ t: 'Ranger le bureau' })],
    ['remind me to call Sam', add({ t: 'Call Sam' })],
    ['rappelle-moi de sortir les poubelles', add({ t: 'Sortir les poubelles' })],
    ['Dentist', add({ t: 'Dentist' })],
    ['passport photos', add({ t: 'Passport photos' })],
    ['buy milk, eggs and bread', add({ t: 'Buy milk, eggs and bread' })],
    ['email Anna and Tom about the trip', add({ t: 'Email Anna and Tom about the trip' })],
    ['acheter du lait, des œufs et du pain', add({ t: 'Acheter du lait, des œufs et du pain' })],
    ['- call the bank', add({ t: 'Call the bank' })],
    ['• buy bread', add({ t: 'Buy bread' })],
    ['1. book the dentist', add({ t: 'Book the dentist' })],
    ['[ ] renew the passport', add({ t: 'Renew the passport' })],
    ['finish the essay', add({ t: 'Finish the essay' })],
    ['terminer le rapport', add({ t: 'Terminer le rapport' })],
  ]),

  ...c('lead', [
    ['I need to call the bank', add({ t: 'Call the bank' })],
    ['I have to pay the rent', add({ t: 'Pay the rent' })],
    ['i must renew my passport', add({ t: 'Renew my passport' })],
    ['I should book the dentist', add({ t: 'Book the dentist' })],
    ['need to buy bread', add({ t: 'Buy bread' })],
    ["don't forget to water the plants", add({ t: 'Water the plants' })],
    ['remember to send the form', add({ t: 'Send the form' })],
    ['je dois appeler la banque', add({ t: 'Appeler la banque' })],
    ['il faut payer le loyer', add({ t: 'Payer le loyer' })],
    ['il faudrait ranger le garage', add({ t: 'Ranger le garage' })],
    ['penser à acheter du pain', add({ t: 'Acheter du pain' })],
    ['ne pas oublier d’appeler Sam', add({ t: 'Appeler Sam' })],
    ['ne pas oublier de sortir les poubelles', add({ t: 'Sortir les poubelles' })],
    ['I need to call the bank tomorrow', add({ t: 'Call the bank', due: '2026-11-15' })],
    ['je dois appeler la banque demain', add({ t: 'Appeler la banque', due: '2026-11-15' })],
  ]),

  ...c('date', [
    ['call the bank tomorrow', add({ t: 'Call the bank', due: '2026-11-15' })],
    ['call the bank tmrw', add({ t: 'Call the bank', due: '2026-11-15' })],
    ['appeler la banque demain', add({ t: 'Appeler la banque', due: '2026-11-15' })],
    ['appeler la banque demain matin', add({ t: 'Appeler la banque', due: '2026-11-15' })],
    ['appeler la banque après-demain', add({ t: 'Appeler la banque', due: '2026-11-16' })],
    ['call the bank the day after tomorrow', add({ t: 'Call the bank', due: '2026-11-16' })],
    ['email Alex today', add({ t: 'Email Alex', due: '2026-11-14' })],
    ['email Alex tonight', add({ t: 'Email Alex', due: '2026-11-14' })],
    ['envoyer le dossier aujourd’hui', add({ t: 'Envoyer le dossier', due: '2026-11-14' })],
    ['envoyer le dossier ce soir', add({ t: 'Envoyer le dossier', due: '2026-11-14' })],
    ['send photos friday', add({ t: 'Send photos', due: '2026-11-20' })],
    ['send photos on Friday', add({ t: 'Send photos', due: '2026-11-20' })],
    ['send photos next friday', add({ t: 'Send photos', due: '2026-11-20' })],
    ['send photos by fri', add({ t: 'Send photos', due: '2026-11-20' })],
    ['envoyer les photos vendredi', add({ t: 'Envoyer les photos', due: '2026-11-20' })],
    ['envoyer les photos vendredi prochain', add({ t: 'Envoyer les photos', due: '2026-11-20' })],
    ['envoyer les photos pour vendredi', add({ t: 'Envoyer les photos', due: '2026-11-20' })],
    ['laundry saturday', add({ t: 'Laundry', due: '2026-11-21' })],
    ['brunch sunday', add({ t: 'Brunch', due: '2026-11-15' })],
    ['dentist monday', add({ t: 'Dentist', due: '2026-11-16' })],
    ['dentiste lundi', add({ t: 'Dentiste', due: '2026-11-16' })],
    ['pay the rent in 3 days', add({ t: 'Pay the rent', due: '2026-11-17' })],
    ['pay the rent in 2 weeks', add({ t: 'Pay the rent', due: '2026-11-28' })],
    ['renew the lease in 1 month', add({ t: 'Renew the lease', due: '2026-12-14' })],
    ['payer le loyer dans 3 jours', add({ t: 'Payer le loyer', due: '2026-11-17' })],
    ['payer le loyer dans 2 semaines', add({ t: 'Payer le loyer', due: '2026-11-28' })],
    ['tax form 26/11', add({ t: 'Tax form', due: '2026-11-26' })],
    ['tax form 3 dec', add({ t: 'Tax form', due: '2026-12-03' })],
    ['tax form december 3', add({ t: 'Tax form', due: '2026-12-03' })],
    ['tax form on the 3rd of December', add({ t: 'Tax form', due: '2026-12-03' })],
    ['déclaration le 3 décembre', add({ t: 'Déclaration', due: '2026-12-03' })],
    ['visa 5 jan', add({ t: 'Visa', due: '2027-01-05' })],
    ['visa 2027-01-05', add({ t: 'Visa', due: '2027-01-05' })],
    // Said in words and by the week or the month.
    ['pay the rent in two days', add({ t: 'Pay the rent', due: '2026-11-16' })],
    ['pay the rent in a week', add({ t: 'Pay the rent', due: '2026-11-21' })],
    ['renew the lease in a month', add({ t: 'Renew the lease', due: '2026-12-14' })],
    ['payer le loyer dans deux jours', add({ t: 'Payer le loyer', due: '2026-11-16' })],
    ['payer le loyer dans une semaine', add({ t: 'Payer le loyer', due: '2026-11-21' })],
    ['payer le loyer dans quinze jours', add({ t: 'Payer le loyer', due: '2026-11-28' })],
    ['clean the flat this weekend', add({ t: 'Clean the flat', due: '2026-11-14' })],
    ['ranger l’appartement ce week-end', add({ t: 'Ranger l’appartement', due: '2026-11-14' })],
    ['call the plumber next week', add({ t: 'Call the plumber', due: '2026-11-16' })],
    ['appeler le plombier la semaine prochaine', add({ t: 'Appeler le plombier', due: '2026-11-16' })],
    ['send the invoice by the end of the month', add({ t: 'Send the invoice', due: '2026-11-30' })],
    ['envoyer la facture avant la fin du mois', add({ t: 'Envoyer la facture', due: '2026-11-30' })],
    ['finish the slides by the end of the week', add({ t: 'Finish the slides', due: '2026-11-15' })],
    ['finir les diapos d’ici la fin de la semaine', add({ t: 'Finir les diapos', due: '2026-11-15' })],
    ['dentiste lundi en huit', add({ t: 'Dentiste', due: '2026-11-23' })],
    ['dentist a week on monday', add({ t: 'Dentist', due: '2026-11-23' })],
    ['renew the pass next month', add({ t: 'Renew the pass', due: '2026-12-01' })],
    ['renouveler le pass le mois prochain', add({ t: 'Renouveler le pass', due: '2026-12-01' })],
  ]),

  ...c('time', [
    ['dentist friday 14h', add({ t: 'Dentist', due: '2026-11-20', at: '14:00' })],
    ['dentiste vendredi 14h', add({ t: 'Dentiste', due: '2026-11-20', at: '14:00' })],
    ['dentist friday 2pm', add({ t: 'Dentist', due: '2026-11-20', at: '14:00' })],
    ['dentist friday at 2:30 pm', add({ t: 'Dentist', due: '2026-11-20', at: '14:30' })],
    ['dentist friday 14:30', add({ t: 'Dentist', due: '2026-11-20', at: '14:30' })],
    ['dentiste vendredi à 14h30', add({ t: 'Dentiste', due: '2026-11-20', at: '14:30' })],
    ['lunch with Noor tomorrow noon', add({ t: 'Lunch with Noor', due: '2026-11-15', at: '12:00' })],
    ['déjeuner avec Noor demain midi', add({ t: 'Déjeuner avec Noor', due: '2026-11-15', at: '12:00' })],
    ['call mum 19:00', add({ t: 'Call mum', due: '2026-11-14', at: '19:00' })],
    ['call mum 9:00', add({ t: 'Call mum', due: '2026-11-15', at: '09:00' })],
    ['appeler maman vers 19h', add({ t: 'Appeler maman', due: '2026-11-14', at: '19:00' })],
    ['meeting monday 14h-15h30', add({ t: 'Meeting', due: '2026-11-16', at: '14:00', dur: 90 })],
    ['réunion lundi de 14h à 15h30', add({ t: 'Réunion', due: '2026-11-16', at: '14:00', dur: 90 })],
    ['meeting monday 14:00 to 15:30', add({ t: 'Meeting', due: '2026-11-16', at: '14:00', dur: 90 })],
    ['piano monday 19:00 for 45 min', add({ t: 'Piano', due: '2026-11-16', at: '19:00', dur: 45 })],
    ['choir Monday 19:00 at Hill House', add({ t: 'Choir', due: '2026-11-16', at: '19:00', where: 'pl-hill' })],
    ['lunch Monday 12:30 at Chez Louise', add({ t: 'Lunch, Chez Louise', due: '2026-11-16', at: '12:30' })],
    // Said in words.
    ['dentist friday at half past two', add({ t: 'Dentist', due: '2026-11-20', at: '14:30' })],
    ['dentist friday at quarter past two', add({ t: 'Dentist', due: '2026-11-20', at: '14:15' })],
    ['dentist friday at quarter to five', add({ t: 'Dentist', due: '2026-11-20', at: '16:45' })],
    ['dentist friday at 3 o’clock', add({ t: 'Dentist', due: '2026-11-20', at: '15:00' })],
    ['standup monday at 9 o’clock', add({ t: 'Standup', due: '2026-11-16', at: '09:00' })],
    ['dentiste vendredi à 15 heures', add({ t: 'Dentiste', due: '2026-11-20', at: '15:00' })],
    ['dentiste vendredi à 15 heures 30', add({ t: 'Dentiste', due: '2026-11-20', at: '15:30' })],
    ['déjeuner demain à midi et demi', add({ t: 'Déjeuner', due: '2026-11-15', at: '12:30' })],
    ['dentiste vendredi à 3 heures et demie', add({ t: 'Dentiste', due: '2026-11-20', at: '15:30' })],
    ['dentiste vendredi à 3 heures et quart', add({ t: 'Dentiste', due: '2026-11-20', at: '15:15' })],
    ['dentiste vendredi à 5 heures moins le quart', add({ t: 'Dentiste', due: '2026-11-20', at: '16:45' })],
    ['dentist friday at 3', add({ t: 'Dentist', due: '2026-11-20', at: '15:00' })],
    ['drinks tonight at 8', add({ t: 'Drinks', due: '2026-11-14', at: '20:00' })],
    ['train tomorrow morning at 7', add({ t: 'Train', due: '2026-11-15', at: '07:00' })],
    ['dîner ce soir à 8 heures', add({ t: 'Dîner', due: '2026-11-14', at: '20:00' })],
  ]),

  ...c('deadline', [
    ['pay the rent by 17:00', add({ t: 'Pay the rent', due: '2026-11-14', dueAt: '17:00' })],
    ['pay the rent before 5pm', add({ t: 'Pay the rent', due: '2026-11-14', dueAt: '17:00' })],
    ['payer le loyer avant 17h', add({ t: 'Payer le loyer', due: '2026-11-14', dueAt: '17:00' })],
    ['send the form by friday 17:00', add({ t: 'Send the form', due: '2026-11-20', dueAt: '17:00' })],
    ['envoyer le formulaire d’ici vendredi 17h', add({ t: 'Envoyer le formulaire', due: '2026-11-20', dueAt: '17:00' })],
    ['dossier pour le 26/11 à 17h', add({ t: 'Dossier', due: '2026-11-26', dueAt: '17:00' })],
    ['tax form due 26/11 at 9:30', add({ t: 'Tax form', due: '2026-11-26', dueAt: '09:30' })],
    ['send the report by friday', add({ t: 'Send the report', due: '2026-11-20' })],
    ['rendre le rapport avant vendredi', add({ t: 'Rendre le rapport', due: '2026-11-20' })],
    ['submit the essay by midnight', add({ t: 'Submit the essay', due: '2026-11-14', dueAt: '23:59' })],
    ['rendre le devoir avant minuit', add({ t: 'Rendre le devoir', due: '2026-11-14', dueAt: '23:59' })],
    ['submit the essay by noon tomorrow', add({ t: 'Submit the essay', due: '2026-11-15', dueAt: '12:00' })],
  ]),

  ...c('length', [
    ['call the bank tomorrow, 10 min', add({ t: 'Call the bank', due: '2026-11-15', est: 10 })],
    ['write the intro 45 min', add({ t: 'Write the intro', est: 45 })],
    ['write the intro for 2 hours', add({ t: 'Write the intro', est: 120 })],
    ['write the intro 1h30', add({ t: 'Write the intro', est: 90 })],
    ['write the intro about 20 minutes', add({ t: 'Write the intro', est: 20 })],
    ['écrire l’intro pendant 2 heures', add({ t: 'Écrire l’intro', est: 120 })],
    ['écrire l’intro environ 20 minutes', add({ t: 'Écrire l’intro', est: 20 })],
    ['écrire l’intro 1 h 30', add({ t: 'Écrire l’intro', est: 90 })],
    ['tidy the desk ~15 min', add({ t: 'Tidy the desk', est: 15 })],
    ['tidy the desk (15 min)', add({ t: 'Tidy the desk', est: 15 })],
    ['tidy the desk, half an hour', add({ t: 'Tidy the desk', est: 30 })],
    ['ranger le bureau, une demi-heure', add({ t: 'Ranger le bureau', est: 30 })],
    ['write the intro for an hour', add({ t: 'Write the intro', est: 60 })],
    ['écrire l’intro pendant une heure', add({ t: 'Écrire l’intro', est: 60 })],
    ['read the paper, an hour and a half', add({ t: 'Read the paper', est: 90 })],
    ['quick call with Sam 5 minutes', add({ t: 'Quick call with Sam', est: 5 })],
  ]),

  ...c('place', [
    ['print the form at Office', add({ t: 'Print the form', where: 'pl-office' })],
    ['print the form at the office', add({ t: 'Print the form', where: 'pl-office' })],
    ['piano at Hill House', add({ t: 'Piano', where: 'pl-hill' })],
    ['imprimer le formulaire au Office', add({ t: 'Imprimer le formulaire', where: 'pl-office' })],
    ['water the plants at home tomorrow', add({ t: 'Water the plants', due: '2026-11-15', where: 'pl-home' })],
    ['buy stamps at the post office', add({ t: 'Buy stamps at the post office' })],
  ]),

  ...c('standing', [
    ['choir every Monday 19:00 at Hill House 602', { standing: { t: 'Choir, Hill House 602', at: '19:00', weekdays: [1], where: 'pl-hill' } }],
    ['chorale tous les lundis 19h à Hill House 602', { standing: { t: 'Chorale, Hill House 602', at: '19:00', weekdays: [1], where: 'pl-hill' } }],
    ['yoga every tuesday and thursday 18:30', { standing: { t: 'Yoga', at: '18:30', weekdays: [2, 4] } }],
    ['yoga les mardis et jeudis à 18h30', { standing: { t: 'Yoga', at: '18:30', weekdays: [2, 4] } }],
    ['walk every day 8:00', { standing: { t: 'Walk', at: '08:00', weekdays: [1, 2, 3, 4, 5, 6, 7] } }],
    ['choir every Tuesday 18:00 until 31 Dec', { standing: { t: 'Choir', at: '18:00', weekdays: [2], until: '2026-12-31' } }],
    ['piano every wednesday 17:00 for 45 min', { standing: { t: 'Piano', at: '17:00', weekdays: [3], dur: 45 } }],
    ['gym every weekday 7:00', { standing: { t: 'Gym', at: '07:00', weekdays: [1, 2, 3, 4, 5] } }],
    ['sport tous les jours de la semaine à 7h', { standing: { t: 'Sport', at: '07:00', weekdays: [1, 2, 3, 4, 5] } }],
    ['water the plants every week', { sheet: true }],
    ['pay the rent every month', { sheet: true }],
  ]),

  ...c('done', [
    ['done pay the rent', { done: 't-rent' }],
    ['pay the rent done', { done: 't-rent' }],
    ['done the report', { done: 't-report' }],
    ['finished the report yesterday', { done: 't-report', day: '2026-11-13' }],
    ['fait : payer le loyer', { unknown: 'nomatch' }],
    ['fini les impôts', { done: 't-impots' }],
    ['j’ai fini les impôts hier', { done: 't-impots', day: '2026-11-13' }],
    ['✓ rent', { done: 't-rent' }],
    ['done call', { pick: ['t-dentist', 't-agency'] }],
    ['done choir', { unknown: 'nomatch' }],
    ['done the laundry', { unknown: 'nomatch' }],
    ['I paid the rent', { done: 't-rent' }],
    ['I’ve done the report', { done: 't-report' }],
    ['just finished the photos', { done: 't-photos' }],
    ['rent is done', { done: 't-rent' }],
    ['the report is finished', { done: 't-report' }],
    ['les impôts sont faits', { done: 't-impots' }],
    ['j’ai fait les impôts', { done: 't-impots' }],
  ]),

  ...c('move', [
    ['move the photos to monday', { move: 't-photos', due: '2026-11-16' }],
    ['push the report to friday', { move: 't-report', due: '2026-11-20' }],
    ['postpone the rent until tomorrow', { move: 't-rent', due: '2026-11-15' }],
    ['reporter les impôts à vendredi', { move: 't-impots', due: '2026-11-20' }],
    ['décaler la convention à lundi', { move: 't-stage', due: '2026-11-16' }],
    ['photos → monday', { move: 't-photos', due: '2026-11-16' }],
    ['move the agency call to tomorrow 15:00', { move: 't-agency', due: '2026-11-15', at: '15:00' }],
    ['the photos are for monday', { move: 't-photos', due: '2026-11-16' }],
    ['report tomorrow instead', { move: 't-report', due: '2026-11-15' }],
    ['les impôts plutôt vendredi', { move: 't-impots', due: '2026-11-20' }],
    ['move the report to next week', { move: 't-report', due: '2026-11-16' }],
    ['move call to monday', { pick: ['t-dentist', 't-agency'] }],
  ]),

  ...c('drop', [
    ['drop the photos', { drop: 't-photos' }],
    ['abandon the report', { drop: 't-report' }],
    ['supprimer les impôts', { drop: 't-impots' }],
    ['abandonner la convention', { drop: 't-stage' }],
    ['forget the photos', { drop: 't-photos' }],
    ['laisser tomber les photos', { drop: 't-photos' }],
    ['cancel the agency call', { drop: 't-agency' }],
    ['drop call', { pick: ['t-dentist', 't-agency'] }],
  ]),

  ...c('several', [
    ['call the bank; buy bread', add({ t: 'Call the bank' }, { t: 'Buy bread' })],
    ['call the bank\nbuy bread\nbook the dentist', add({ t: 'Call the bank' }, { t: 'Buy bread' }, { t: 'Book the dentist' })],
    ['- call the bank\n- buy bread', add({ t: 'Call the bank' }, { t: 'Buy bread' })],
    ['1. call the bank\n2. buy bread', add({ t: 'Call the bank' }, { t: 'Buy bread' })],
    ['call the bank, pay the rent and book the dentist', add({ t: 'Call the bank' }, { t: 'Pay the rent' }, { t: 'Book the dentist' })],
    ['call the bank and book the dentist', add({ t: 'Call the bank' }, { t: 'Book the dentist' })],
    ['call the bank then buy bread', add({ t: 'Call the bank' }, { t: 'Buy bread' })],
    ['call the bank and then buy bread', add({ t: 'Call the bank' }, { t: 'Buy bread' })],
    ['appeler la banque puis acheter du pain', add({ t: 'Appeler la banque' }, { t: 'Acheter du pain' })],
    ['appeler la banque, payer le loyer et prendre rendez-vous chez le dentiste', add({ t: 'Appeler la banque' }, { t: 'Payer le loyer' }, { t: 'Prendre rendez-vous chez le dentiste' })],
    ['appeler la banque et acheter du pain', add({ t: 'Appeler la banque' }, { t: 'Acheter du pain' })],
    ['call the bank tomorrow; buy bread friday', add({ t: 'Call the bank', due: '2026-11-15' }, { t: 'Buy bread', due: '2026-11-20' })],
    ['call the bank tomorrow and pay the rent friday', add({ t: 'Call the bank', due: '2026-11-15' }, { t: 'Pay the rent', due: '2026-11-20' })],
    ['dentist friday 14h; call mum 19:00', add({ t: 'Dentist', due: '2026-11-20', at: '14:00' }, { t: 'Call mum', due: '2026-11-14', at: '19:00' })],
    ['I need to call the bank and I have to book the dentist', add({ t: 'Call the bank' }, { t: 'Book the dentist' })],
    ['je dois appeler la banque et je dois payer le loyer', add({ t: 'Appeler la banque' }, { t: 'Payer le loyer' })],
    ['done the report; call the bank tomorrow', { all: [{ done: 't-report' }, add({ t: 'Call the bank', due: '2026-11-15' })] }],
    ['done the report and the rent', { all: [{ done: 't-report' }, { done: 't-rent' }] }],
    ['fini les impôts ; appeler la banque demain', { all: [{ done: 't-impots' }, add({ t: 'Appeler la banque', due: '2026-11-15' })] }],
    // One thing, though it has a comma or an "and".
    ['buy milk and eggs', add({ t: 'Buy milk and eggs' })],
    ['call Anna and Tom', add({ t: 'Call Anna and Tom' })],
    ['read chapter 3, sections 1 and 2', add({ t: 'Read chapter 3, sections 1 and 2' })],
    ['clean the kitchen and the bathroom', add({ t: 'Clean the kitchen and the bathroom' })],
    ['nettoyer la cuisine et la salle de bain', add({ t: 'Nettoyer la cuisine et la salle de bain' })],
    ['research and write the intro', add({ t: 'Research and write the intro' })],
  ]),

  ...c('long', [
    ['ask the landlord whether the deposit comes back before the end of the month', add({ t: 'Ask the landlord whether the deposit comes back', due: '2026-11-30' })],
    ['find out which documents the prefecture wants for the renewal of the residence permit', add({ t: 'Find out which documents the prefecture wants for the renewal of the residence permit' })],
    ['write to the insurance company about the water damage in the bathroom last week', add({ t: 'Write to the insurance company about the water damage in the bathroom last week' })],
    ['demander au propriétaire si la caution est rendue avant la fin du mois', add({ t: 'Demander au propriétaire si la caution est rendue', due: '2026-11-30' })],
    ['prendre rendez-vous avec le service des étrangers de la préfecture pour le renouvellement du titre', add({ t: 'Prendre rendez-vous avec le service des étrangers de la préfecture pour le renouvellement du titre' })],
    ['send Anna the photos from the trip to Lisbon that she wanted tomorrow', add({ t: 'Send Anna the photos from the trip to Lisbon that she wanted', due: '2026-11-15' })],
    ['I need to call the bank about the card that was blocked on Thursday evening tomorrow', add({ t: 'Call the bank about the card that was blocked on Thursday evening', due: '2026-11-15' })],
  ]),

  ...c('suit', [
    ['prepare the slides for the meeting', add({ t: 'Prepare the slides for the meeting', suit: 'S' })],
    ['email my supervisor about the thesis chapter', add({ t: 'Email my supervisor about the thesis chapter', suit: 'S' })],
    ['revise for the exam', add({ t: 'Revise for the exam', suit: 'S' })],
    ['fill in the tax form', add({ t: 'Fill in the tax form', suit: 'S' })],
    ['call the bank about the card', add({ t: 'Call the bank about the card', suit: 'S' })],
    ['pay the rent', add({ t: 'Pay the rent', suit: 'S' })],
    ['renew the passport', add({ t: 'Renew the passport', suit: 'S' })],
    ['préparer la réunion de lundi', add({ t: 'Préparer la réunion', due: '2026-11-16', suit: 'S' })],
    ['payer la facture d’électricité', add({ t: 'Payer la facture d’électricité', suit: 'S' })],
    ['envoyer le dossier à la CAF', add({ t: 'Envoyer le dossier à la CAF', suit: 'S' })],
    ['watch the new film', add({ t: 'Watch the new film', suit: 'D' })],
    ['book concert tickets', add({ t: 'Book concert tickets', suit: 'D' })],
    ['go for a hike sunday', add({ t: 'Go for a hike', due: '2026-11-15', suit: 'D' })],
    ['aller au cinéma', add({ t: 'Aller au cinéma', suit: 'D' })],
    ['réserver le resto pour samedi', add({ t: 'Réserver le resto', due: '2026-11-21', suit: 'D' })],
    ['do the laundry', add({ t: 'Do the laundry', suit: 'C' })],
    ['clean the kitchen', add({ t: 'Clean the kitchen', suit: 'C' })],
    ['buy groceries', add({ t: 'Buy groceries', suit: 'C' })],
    ['faire le ménage', add({ t: 'Faire le ménage', suit: 'C' })],
    ['faire les courses', add({ t: 'Faire les courses', suit: 'C' })],
    ['call mum', add({ t: 'Call mum', suit: 'H' })],
    ['buy a gift for my sister’s birthday', add({ t: 'Buy a gift for my sister’s birthday', suit: 'H' })],
    ['help Dad with his phone', add({ t: 'Help Dad with his phone', suit: 'H' })],
    ['appeler maman', add({ t: 'Appeler maman', suit: 'H' })],
    ['acheter un cadeau pour l’anniversaire de Léa', add({ t: 'Acheter un cadeau pour l’anniversaire de Léa', suit: 'H' })],
    // Nothing in the four suits speaks of health, and nothing here says which: no guess.
    ['book the dentist', add({ t: 'Book the dentist', suit: null })],
    ['renew the prescription', add({ t: 'Renew the prescription', suit: null })],
    ['fix the thing', add({ t: 'Fix the thing', suit: null })],
    // Two suits pull as hard as each other: no guess.
    ['call mum about the rent', add({ t: 'Call mum about the rent', suit: null })],
  ]),

  ...c('project', [
    ['write the thesis introduction', add({ t: 'Write the thesis introduction', project: 'pr-thesis', suit: 'S' })],
    ['thesis: write the introduction', add({ t: 'Write the introduction', project: 'pr-thesis', suit: 'S' })],
    ['write the introduction #thesis', add({ t: 'Write the introduction', project: 'pr-thesis', suit: 'S' })],
    ['book the van for moving flat', add({ t: 'Book the van for moving flat', project: 'pr-move', suit: 'C' })],
    ['jardin : tailler les rosiers', add({ t: 'Tailler les rosiers', project: 'pr-jardin', suit: 'C' })],
    ['tailler les rosiers du jardin', add({ t: 'Tailler les rosiers du jardin', project: 'pr-jardin', suit: 'C' })],
    ['call the bank', add({ t: 'Call the bank', project: null })],
    ['hypothesis testing notes', add({ t: 'Hypothesis testing notes', project: null })],
  ]),

  ...c('first', [
    ['call the bank', add({ t: 'Call the bank', first: 'fmCall' })],
    ['email Anna the report', add({ t: 'Email Anna the report', first: 'fmMail' })],
    ['text Noor about lunch', add({ t: 'Text Noor about lunch', first: 'fmText' })],
    ['pay the rent', add({ t: 'Pay the rent', first: 'fmPay' })],
    ['book the dentist', add({ t: 'Book the dentist', first: 'fmBook' })],
    ['fill in the tax form', add({ t: 'Fill in the tax form', first: 'fmPaper' })],
    ['appeler la banque demain', add({ t: 'Appeler la banque', due: '2026-11-15', first: 'fmCall' })],
    ['répondre à l’agence', add({ t: 'Répondre à l’agence', first: 'fmMail' })],
    ['I need to call the bank', add({ t: 'Call the bank', first: 'fmCall' })],
    ['dentist friday 14h', add({ t: 'Dentist', due: '2026-11-20', at: '14:00', first: null })],
    ['the thesis', add({ t: 'The thesis', first: null })],
    // A title that already opens with its first action needs no other.
    ['Open Mail and reply to the agency', add({ t: 'Open Mail and reply to the agency', first: null })],
    ['Ouvrir Mail et répondre à l’agence', add({ t: 'Ouvrir Mail et répondre à l’agence', first: null })],
  ]),

  ...c('flag', [
    ['urgent: call the bank', add({ t: 'Call the bank', urgent: true })],
    ['call the bank, urgent', add({ t: 'Call the bank', urgent: true })],
    ['call the bank (urgent)', add({ t: 'Call the bank', urgent: true })],
    ['call the bank asap', add({ t: 'Call the bank', urgent: true })],
    ['important: write the cover letter', add({ t: 'Write the cover letter', important: true })],
    ['write the cover letter, important', add({ t: 'Write the cover letter', important: true })],
    ['urgent and important: send the visa file', add({ t: 'Send the visa file', urgent: true, important: true })],
    ['urgent : appeler la banque', add({ t: 'Appeler la banque', urgent: true })],
    ['appeler la banque, important', add({ t: 'Appeler la banque', important: true })],
    ['appeler la banque en urgence', add({ t: 'Appeler la banque', urgent: true })],
    ['call the bank!!', add({ t: 'Call the bank', urgent: true })],
    // An adjective inside the sentence is part of the title.
    ['read the important chapter', add({ t: 'Read the important chapter' })],
    ['book the urgent care visit', add({ t: 'Book the urgent care visit' })],
  ]),

  ...c('waiting', [
    ['waiting for the bank to call back', add({ t: 'The bank to call back', waiting: true })],
    ['wait for Anna’s reply', add({ t: 'Anna’s reply', waiting: true })],
    ['waiting on the parcel', add({ t: 'The parcel', waiting: true })],
    ['en attente de la réponse de la CAF', add({ t: 'La réponse de la CAF', waiting: true })],
    ['j’attends le devis du plombier', add({ t: 'Le devis du plombier', waiting: true })],
    ['attendre le retour de Léa', add({ t: 'Le retour de Léa', waiting: true })],
    ['waiting for the parcel, check friday', add({ t: 'The parcel', waiting: true, nudge: '2026-11-20' })],
    ['en attente du colis, vérifier vendredi', add({ t: 'Colis', waiting: true, nudge: '2026-11-20' })],
    ['wait until the paint is dry', add({ t: 'Wait until the paint is dry' })],
  ]),

  ...c('note', [
    ['note on the rent: the landlord wants a transfer', { note: 't-rent', text: 'The landlord wants a transfer' }],
    ['note rent: IBAN is in the lease', { note: 't-rent', text: 'IBAN is in the lease' }],
    ['rent note: ask for a receipt', { note: 't-rent', text: 'Ask for a receipt' }],
    ['note for the report: start with the figures', { note: 't-report', text: 'Start with the figures' }],
    ['note sur les impôts : le numéro fiscal est dans le mail', { note: 't-impots', text: 'Le numéro fiscal est dans le mail' }],
    ['note pour la convention : demander la signature du tuteur', { note: 't-stage', text: 'Demander la signature du tuteur' }],
    ['comment on the photos: only keep the best ten', { note: 't-photos', text: 'Only keep the best ten' }],
    ['note on call: ask about fees', { pick: ['t-dentist', 't-agency'] }],
    ['note on the laundry: use the cold cycle', { unknown: 'nomatch' }],
  ]),

  ...c('timer', [
    ['start the report', { timer: 'start', id: 't-report' }],
    ['start pay the rent', { timer: 'start', id: 't-rent' }],
    ['commencer les impôts', { timer: 'start', id: 't-impots' }],
    ['lancer le chrono sur la convention', { timer: 'start', id: 't-stage' }],
    ['start the timer on the photos', { timer: 'start', id: 't-photos' }],
    ['pause', { timer: 'pause' }],
    ['stop the timer', { timer: 'pause' }],
    ['pause the timer', { timer: 'pause' }],
    ['arrêter le chrono', { timer: 'pause' }],
    ['the report took 40 min', { spent: 't-report', min: 40 }],
    ['spent 25 minutes on the photos', { spent: 't-photos', min: 25 }],
    ['j’ai passé 1h30 sur les impôts', { spent: 't-impots', min: 90 }],
    ['40 min on the report', { spent: 't-report', min: 40 }],
    // No card by that name: a new card that opens with "start".
    ['start the visa application', add({ t: 'Start the visa application' })],
    ['commencer le dossier de bourse', add({ t: 'Commencer le dossier de bourse' })],
  ]),

  ...c('fuzzy', [
    ['done the reprot', { pick: ['t-report'] }],
    ['done the quaterly report', { pick: ['t-report'] }],
    ['drop the fotos', { pick: ['t-photos'] }],
    ['fini les impots', { done: 't-impots' }],
    ['fini les impot', { pick: ['t-impots'] }],
    ['move the reort to friday', { pick: ['t-report'] }],
    ['done the xyz', { unknown: 'nomatch' }],
  ]),

  // What the parser reads wrong today, as it reads it: each line here is a limit that is known, and a fix flips it.
  ...c('limit', [
    // "for" before a day goes with the day ("for tomorrow"), even when it ends the words before it.
    ['send Anna the photos she asked for tomorrow', add({ t: 'Send Anna the photos she asked', due: '2026-11-15' })],
    // A number of minutes is the card's length wherever it stands.
    ['wait 10 minutes before calling again', add({ t: 'Wait before calling again', est: 10 })],
    // One breath with no comma between two things is one card.
    ['call the bank tomorrow pay the rent friday', add({ t: 'Call the bank pay the rent friday', due: '2026-11-15' })],
    // "And" between two things to do makes two cards, even when the second leans on the first without a pronoun.
    ['pick up the parcel and bring the receipt', add({ t: 'Pick up the parcel' }, { t: 'Bring the receipt' })],
    // A day in the middle of a sentence is the card's day, even when it tells what happened ("blocked on Thursday"), and leaves a hole in the title.
    ['call the bank about the card they blocked on Thursday evening when I was at the shop', add({ t: 'Call the bank about the card they blocked evening when I was at the shop', due: '2026-11-19' })],
  ]),

  ...c('other', [
    ['what is due this week?', { unknown: 'question' }],
    ['how long did the report take', { unknown: 'question' }],
    ['qu’est-ce que je dois faire demain ?', { unknown: 'question' }],
    ['Ibrahim is my landlord', { unknown: 'memory' }],
    ['', { unknown: 'empty' }],
    ['...', { unknown: 'empty' }],
  ]),
];
