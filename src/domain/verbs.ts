// Does a piece of a line open with a verb, as a thing to do does ("call the bank", "payer le loyer")? Home's parser asks it before
// cutting "A and B" or "A, B" into two cards: both pieces must be things to do of their own, or the line stays one card
// ("buy milk and eggs", "call Anna and Tom"). Pure; English and French; folded text (no accents, lower case).

const EN = new Set(('add answer apply arrange ask assemble attend back backup bake book borrow bring build buy call cancel change charge check choose clean clear close collect '
  + 'compare complete confirm contact cook copy correct create cut declare delete deliver download draft drop edit email empty enroll export fax fetch file fill find finish fix fold '
  + 'follow forward gather get give go hang help install invite iron join learn list look mail make measure meet message mow move open order organise organize pack paint pay phone pick plan '
  + 'plant post practise practice prepare print proofread publish put read record register remove renew repair replace reply report request research reserve return review revise ring run '
  + 'save scan schedule search sell send set sew share shop sign sort start study submit subscribe sweep take talk tell test text throw tidy transfer translate try unpack update upload '
  + 'vacuum visit wash watch water wire withdraw wrap write').split(' '));
// French verbs that do not end like an infinitive of the common kind, or are worth naming.
const FR = new Set(('faire prendre mettre dire ecrire lire voir aller venir tenir ouvrir rendre vendre repondre attendre descendre suivre conduire peindre eteindre joindre inscrire '
  + 'envoyer payer appeler acheter ranger nettoyer laver trier reserver annuler resilier renouveler declarer deposer telecharger imprimer signer scanner poster remplir finir choisir').split(' '));
// Nouns that end like a French infinitive.
const NOT_FR = new Set(('dossier papier loyer courrier premier dernier janvier fevrier hier cahier atelier quartier metier calendrier escalier panier clavier fichier chantier '
  + 'diner dejeuner gouter souvenir avenir plaisir desir loisir soir devoir pouvoir espoir trottoir couloir miroir tiroir comptoir histoire memoire notaire horaire salaire '
  + 'libraire secretaire formulaire inventaire itineraire anniversaire verre terre guerre pierre lettre fenetre chambre livre litre titre centre theatre beurre sucre offre arbre membre '
  + 'octobre novembre decembre septembre ordre cadre chiffre filtre montre pere mere frere affaire grammaire culture voiture facture ouverture lecture peinture nature heure demeure '
  + 'ordinateur').split(' '));
const LEAD = /^(?:i (?:need|have|want|ought) to|i must|i should|need to|have to|must|should|remember to|don't forget to|do not forget to|please|je dois|il faut|il faudrait|penser a|ne pas oublier de|ne pas oublier d'|merci de|merci d')\s*/u;

/** `f` is folded text. True when it opens with a verb and something follows: a thing to do that stands by itself. */
export function opensWithVerb(f: string): boolean {
  const words = f.trim().replace(LEAD, '').replace(/^(?:to|de|d')\s*/u, '').split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
  if (words.length < 2) return false;
  const w = words[0]!;
  if (EN.has(w) || FR.has(w)) return true;
  return w.length >= 5 && /(?:er|ir|re|oir)$/.test(w) && !NOT_FR.has(w);
}
