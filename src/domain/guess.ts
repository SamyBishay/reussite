// Which suit and which project a new card belongs to, guessed from its words, with no AI (docs/dev/home.md, "The suit and the project").
// Pure. Three sources, in this order: a project the line names; the person's own cards (which suit each word has gone to); then
// the suits themselves, as the person named and described them, matched through a small list of everyday words in English and French.
// When two suits pull as hard as each other, or nothing speaks, there is no guess: the card is made as before and the person says.
import type { SuitId } from '../data/schema';
import { mentions, norm } from './names';

const SUIT_IDS: SuitId[] = ['S', 'D', 'C', 'H'];

/** Words that say nothing about a suit. */
const STOP = new Set(('the a an and or of to for with about on in at by from my our your his her their this that it is be do does make get go new old '
  + 'le la les un une des du de et ou pour avec sur dans au aux par mon ma mes notre nos son sa ses ce cette ces est faire fait aller').split(' '));
const wordsOf = (s: string): string[] => norm(s).split(' ').filter(w => w.length >= 3 && !STOP.has(w));

// ---------- the person's own cards ----------
/** For each word, how many of the person's cards with it went to each suit. */
export type SuitHistory = Record<string, Partial<Record<SuitId, number>>>;

export function suitHistory(cards: { title: string; suit: SuitId }[]): SuitHistory {
  const h: SuitHistory = {};
  for (const c of cards) for (const w of new Set(wordsOf(c.title))) { const row = (h[w] ??= {}); row[c.suit] = (row[c.suit] ?? 0) + 1; }
  return h;
}

/**
 * The suit the person's own cards point to: each word seen at least twice votes with the share of its cards in each suit, and
 * the first suit must have half as much again as the second, and at least the weight of one word that always went there.
 */
function fromHistory(title: string, h: SuitHistory): SuitId | null {
  const score: Record<SuitId, number> = { S: 0, D: 0, C: 0, H: 0 };
  for (const w of new Set(wordsOf(title))) {
    const row = h[w];
    if (!row) continue;
    const total = SUIT_IDS.reduce((a, s) => a + (row[s] ?? 0), 0);
    if (total < 2) continue;
    for (const s of SUIT_IDS) score[s] += (row[s] ?? 0) / total;
  }
  const [a, b] = [...SUIT_IDS].sort((x, y) => score[y] - score[x]);
  return score[a!] >= 0.9 && score[a!] >= 1.5 * score[b!] ? a! : null;
}

// ---------- the suits as described ----------
// A kind of thing people do, the words a card of that kind holds (`in`), and the words a suit's name or description holds when that
// kind belongs to it (`suit`). All folded: no accents, lower case. A phrase is matched as whole words.
const KINDS: { in: string; suit: string }[] = [
  { // work and studies
    in: 'meeting slides report boss client colleague thesis exam lecture class homework essay presentation supervisor internship standup deadline seminar '
      + 'reunion rapport memoire cours examen devoir devoirs stage chef collegue presentation soutenance partiel seminaire tuteur directrice directeur',
    suit: 'work job jobs study studies school university travail emploi etudes boulot ecole universite',
  },
  { // papers and money
    in: 'bank tax taxes rent insurance form bill bills passport visa prefecture caf landlord lease subscription contract invoice payslip notary permit '
      + 'impots impot loyer assurance formulaire facture factures passeport banque bail abonnement contrat mutuelle secu urssaf notaire dossier titre attestation',
    suit: 'paperwork bureaucracy administrative admin papers money finances papiers paperasse bureaucratie administratif administratifs argent',
  },
  { // the home
    in: 'clean laundry dishes groceries vacuum tidy trash bins cook cooking kitchen bathroom '
      + 'menage lessive vaisselle courses aspirateur ranger poubelles cuisiner cuisine nettoyer linge',
    suit: 'chores home house household housework corvees maison menage menageres',
  },
  { // leisure
    in: 'film movie game games concert walk hike museum series cinema restaurant bar piano guitar draw drawing novel exhibition show theatre party '
      + 'jeu jeux balade randonnee musee serie resto dessiner roman expo exposition spectacle soiree',
    suit: 'leisure fun relaxation hobbies hobby outings play loisirs loisir detente sorties passe temps amusement',
  },
  { // people
    in: 'mum mom mother dad father sister brother friend friends birthday gift grandma grandpa family kids parents aunt uncle cousin wedding '
      + 'maman papa mere pere soeur frere ami amie amis anniversaire cadeau mamie papi famille enfants tante oncle mariage',
    suit: 'family friends people interpersonal relationships famille amis proches autres relations',
  },
  { // health
    in: 'dentist doctor pharmacy prescription gym physio therapy psychologist optician vaccine '
      + 'dentiste medecin pharmacie ordonnance kine psy psychologue opticien vaccin',
    suit: 'health body care sante corps soin soins',
  },
  { // one's own projects
    in: 'blog garden prototype portfolio side project jardin potager',
    suit: 'projects project research projets projet recherches recherche',
  },
];
const KIND_WORDS = KINDS.map(k => ({ in: new Set(k.in.split(' ')), suit: k.suit.split(' ') }));

type Suits = Record<SuitId, { name: { en: string; fr: string }; desc?: { en?: string; fr?: string } }>;

/** The suit each kind belongs to, from the suits' own words: the one that names it most; a tie, or no suit that names it, is none. */
function kindSuits(suits: Suits): (SuitId | null)[] {
  const text: Record<SuitId, Set<string>> = { S: new Set(), D: new Set(), C: new Set(), H: new Set() };
  for (const s of SUIT_IDS) for (const w of norm([suits[s].name.en, suits[s].name.fr, suits[s].desc?.en ?? '', suits[s].desc?.fr ?? ''].join(' ')).split(' ')) text[s].add(w);
  return KIND_WORDS.map(k => {
    const hits = SUIT_IDS.map(s => [s, k.suit.filter(w => text[s].has(w)).length] as const).sort((a, b) => b[1] - a[1]);
    return hits[0]![1] > 0 && hits[0]![1] > hits[1]![1] ? hits[0]![0] : null;
  });
}

function fromSuits(title: string, suits: Suits): SuitId | null {
  const of = kindSuits(suits);
  const score: Record<SuitId, number> = { S: 0, D: 0, C: 0, H: 0 };
  for (const w of new Set(norm(title).split(' '))) KIND_WORDS.forEach((k, i) => { const s = of[i]; if (s && k.in.has(w)) score[s] += 1; });
  const [a, b] = [...SUIT_IDS].sort((x, y) => score[y] - score[x]);
  return score[a!] > 0 && score[a!] > score[b!] ? a! : null;
}

/** The suit a new card's words point to, or null: the person's own cards first, then the suits as they are described. */
export function guessSuit(title: string, suits?: Suits, history?: SuitHistory): SuitId | null {
  return (history && fromHistory(title, history)) ?? (suits ? fromSuits(title, suits) : null);
}

// ---------- the project ----------
export interface ProjectRef { id: string; name: string; suit: SuitId }
/** The line's project and what is left of the line once a tag ("#thesis") or a heading ("Thesis: …") that names it is taken out. */
export function findProject(text: string, projects: ProjectRef[]): { project: ProjectRef; text: string } | null {
  // Longest name first, so that "Moving flat" is found before a project called "Flat".
  const byLength = [...projects].filter(p => norm(p.name).length >= 3).sort((a, b) => norm(b.name).length - norm(a.name).length);
  for (const p of byLength) {
    const words = norm(p.name).split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const name = words.join('[^\\p{L}\\p{N}]+'), tag = words.join('[-_]?');
    const folded = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (folded.length !== text.normalize('NFC').length) { if (mentions(text, p.name)) return { project: p, text }; continue; } // the positions would not line up: keep the line whole
    const s = text.normalize('NFC');
    const head = new RegExp('^\\s*' + name + '\\s*[:\\-–—]\\s+', 'u').exec(folded);
    if (head) return { project: p, text: s.slice(head[0].length) };
    const hash = new RegExp('(?:^|\\s)#' + tag + '(?![\\p{L}\\p{N}])', 'u').exec(folded);
    if (hash) return { project: p, text: (s.slice(0, hash.index) + ' ' + s.slice(hash.index + hash[0].length)).replace(/\s+/g, ' ').trim() };
    if (mentions(text, p.name)) return { project: p, text };
  }
  return null;
}
