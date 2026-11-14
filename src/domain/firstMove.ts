// A first move to suggest for a card, from the verb its title opens with (METHOD, "Starters"): the first physical or
// on-screen action that puts the person at the task, never a search or a decision. Pure. It reads English and French
// whatever the app's language (people mix them), and answers with the name of a sentence the app says in its own
// language (`fm…` in en.ts and fr.ts). No verb it knows: null, and the person writes their own.

export type FirstMove =
  | 'fmCall' | 'fmMail' | 'fmText' | 'fmPay' | 'fmBook' | 'fmOrder' | 'fmBuy' | 'fmWrite'
  | 'fmRead' | 'fmTidy' | 'fmPaper' | 'fmStudy' | 'fmSite' | 'fmGo';

// Accents dropped, lower case: the verbs below are written that way.
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[‘’]/g, "'");

// In the order they are tried: a line that opens with "write to" or "send a message" is a message, not a document.
const VERBS: [FirstMove, string[]][] = [
  ['fmText', ['text', 'message', 'whatsapp', 'sms', 'dm', 'send a message', 'send a text', 'envoyer un message', 'envoyer un sms', 'envoyer un texto', 'ecrire a', 'texter']],
  ['fmMail', ['email', 'e-mail', 'mail', 'reply', 'reply to', 'answer', 'write to', 'send an email', 'forward', 'envoyer un mail', 'envoyer un email', 'envoyer un courriel', 'repondre', 'repondre a', 'mailer', 'relancer', 'transferer']],
  ['fmCall', ['call', 'phone', 'ring', 'telephone', 'appeler', 'rappeler', 'telephoner', 'telephoner a', 'passer un coup de fil']],
  ['fmPay', ['pay', 'transfer', 'wire', 'send money', 'payer', 'regler', 'virer', 'faire un virement', 'rembourser']],
  ['fmBook', ['book', 'schedule', 'reserve', 'make an appointment', 'reserver', 'prendre rendez-vous', 'prendre rdv', 'prendre un rendez-vous', 'planifier']],
  ['fmOrder', ['order', 'commander', 'acheter en ligne']],
  ['fmBuy', ['buy', 'get', 'pick up', 'shop', 'shop for', 'acheter', 'faire les courses', 'prendre', 'recuperer']],
  ['fmPaper', ['fill', 'fill in', 'fill out', 'sign', 'print', 'scan', 'post', 'remplir', 'signer', 'imprimer', 'scanner', 'poster']],
  ['fmSite', ['cancel', 'renew', 'register', 'sign up', 'apply', 'declare', 'file', 'submit', 'upload', 'download', 'update', 'annuler', 'resilier', 'renouveler', "s'inscrire", 'inscrire', 'postuler', 'declarer', 'deposer', 'soumettre', 'telecharger', 'mettre a jour', 'candidater']],
  ['fmStudy', ['study', 'revise', 'learn', 'practise', 'practice', 'reviser', 'etudier', 'apprendre', 'travailler']],
  ['fmRead', ['read', 'review', 'proofread', 'check', 'lire', 'relire', 'verifier', 'corriger']],
  ['fmWrite', ['write', 'draft', 'finish', 'edit', 'prepare', 'outline', 'ecrire', 'rediger', 'finir', 'terminer', 'preparer']],
  ['fmTidy', ['clean', 'tidy', 'wash', 'sort', 'declutter', 'vacuum', 'do the dishes', 'do the laundry', 'nettoyer', 'ranger', 'laver', 'trier', 'faire la vaisselle', 'faire le menage', 'faire une lessive', "passer l'aspirateur"]],
  ['fmGo', ['go', 'go to', 'return', 'drop off', 'bring', 'take', 'visit', 'aller', 'aller a', 'rapporter', 'deposer a', 'apporter', 'emmener', 'passer a', 'rendre']],
];

// Longest phrase first, so that "send a message" is found before a shorter verb that starts the same.
const TABLE: [string, FirstMove][] = VERBS.flatMap(([k, vs]) => vs.map(v => [v, k] as [string, FirstMove])).sort((a, b) => b[0].length - a[0].length);
// A polite or habitual opening is not the verb: "I need to call…", "il faut que j'appelle…" (the second is not read; the first is).
const LEAD = /^(?:(?:i (?:need|have|want|ought) to|i must|i should|need to|have to|must|should|remember to|don't forget to|je dois|il faut|il faudrait|penser a|ne pas oublier de)\s+|ne pas oublier d'\s*)/u;

/** The first move to suggest for this title, or null when it opens with no verb the list knows. */
export function suggestFirstMove(title: string): FirstMove | null {
  const f = fold(title).trim().replace(LEAD, '').replace(/^(?:to|de|d')\s*/u, '');
  for (const [verb, key] of TABLE) {
    if (f === verb || (f.startsWith(verb) && /[^\p{L}\p{N}]/u.test(f[verb.length]!))) return key;
  }
  return null;
}
