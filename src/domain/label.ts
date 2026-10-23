// A step's short name for calendars (schema 5, brief "labels"): five or six keywords at most, like
// "Choir · Hill House" or "CAF claim letter". The title stays a sentence that starts with an action verb.
// A label the person (or an AI) wrote is used as written; otherwise one is derived from the title when it is
// needed, and never stored, so a better rule later improves every step at once.
import { norm } from './names';
import type { Task } from '../data/schema';

/** Words kept in a derived label. */
export const LABEL_WORDS = 5;

/** The action verbs a title starts with, English and French (infinitives and the imperative), compared without accents or case. */
const VERBS = new Set(`
open call send write reply email text message ask book buy pay check find fill file submit print scan sign read review
draft prepare make take bring pick go get clean fix update plan schedule cancel renew order return register apply upload
download post phone contact look organise organize tidy wash cook try start finish complete add set remind drop collect
ring visit walk run chase confirm decide sort pack unpack prepare
ouvrir ouvre appeler appelle envoyer envoie ecrire ecris repondre reponds demander demande reserver reserve acheter achete
payer paie paye verifier verifie trouver trouve remplir remplis deposer depose imprimer imprime scanner scanne signer signe
lire lis relire relis preparer prepare faire fais prendre prends apporter apporte aller va nettoyer nettoie ranger range
reparer repare mettre mets planifier planifie annuler annule renouveler renouvelle commander commande rendre rends
inscrire inscris telecharger telecharge contacter contacte regarder regarde organiser organise laver lave cuisiner cuisine
essayer essaie commencer commence finir finis terminer termine ajouter ajoute rappeler rappelle recuperer recupere passer
passe visiter visite marcher marche courir cours relancer relance joindre joins poster poste reclamer reclame confirmer
confirme decider decide trier trie emballer
`.split(/\s+/).filter(Boolean));

/** Filler words dropped anywhere in a derived label, English and French. */
const FILLER = new Set(`
a an the to of for and or in on at with about my your our this that these those it its is are be then up out from by as into
le la les l un une des du de d a au aux en et ou pour sur dans avec ce cet cette ces mon ma mes son sa ses notre nos votre
vos par puis qu que
`.split(/\s+/).filter(Boolean));

/** Words after which an action verb is dropped too ("Open Mail and reply to…"). */
const JOIN = new Set(['and', 'then', 'et', 'puis']);

const elision = /^(?:[ldjnsmtc]|qu)['’]/i;
const trimPunct = (w: string): string => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

const wordsOf = (s: string): string[] => s.split(/\s+/).map(w => trimPunct(w.replace(elision, ''))).filter(Boolean);

/** The title with the step's starter taken off its front, when it begins with it ("Open Mail and reply…" with starter "Open Mail"). */
function withoutStarter(title: string, starter: string | null | undefined): string {
  const s = starter?.trim();
  if (!s || norm(title) === norm(s) || !norm(title).startsWith(norm(s) + ' ')) return title;
  // Walk the title's words until the starter's normalised words are used up.
  const n = norm(s).split(' ').length;
  const parts = title.trim().split(/\s+/);
  let seen = 0, i = 0;
  while (i < parts.length && seen < n) { seen += norm(parts[i]!).split(' ').filter(Boolean).length; i++; }
  return parts.slice(i).join(' ');
}

/** A label derived from a title: no leading action verb, no filler words, the first five words, no punctuation around them. Never empty when the title has a word. */
export function deriveLabel(title: string, starter?: string | null): string {
  const first = wordsOf(title).slice(0, LABEL_WORDS).join(' ');
  const rest = wordsOf(withoutStarter(title, starter));
  const kept: string[] = [];
  let verbOk = true; // at the start, and just after "and" / "then", an action verb is dropped
  for (const w of rest) {
    const n = norm(w);
    if (!n) continue;
    if (verbOk && VERBS.has(n)) { verbOk = false; continue; }
    verbOk = JOIN.has(n);
    if (FILLER.has(n)) continue;
    kept.push(w);
  }
  return kept.slice(0, LABEL_WORDS).join(' ') || first || title.trim();
}

/** What a calendar shows for a step: its own label when it has one, else one derived from its title. */
export function shortLabel(t: Pick<Task, 'title'> & { label?: string | null; starter?: string | null }): string {
  const own = typeof t.label === 'string' ? t.label.trim() : '';
  return own || deriveLabel(t.title ?? '', t.starter);
}
