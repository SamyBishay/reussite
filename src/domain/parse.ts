// Home's local parser (brief §5, "The input"): a line the person types or dictates becomes one
// change-set (add a step with a time, place or date; done; move to a date; drop), a prefilled task
// sheet, or "unknown" (a question, several things at once, a statement about someone), which goes
// to the AI when there is one. Pure and deterministic. It reads English and French whatever the
// app's language is: the person may mix them, and dictation does.
import type { ChangeSet } from '../ai/changeset';
import type { Task } from '../data/schema';
import { addDays, type DayKey } from './dates';
import { findByName, norm, type Named } from './names';
import { isoDow, type Repeat } from './repeat';
import { atOnDay } from './zone';

export interface ParseContext {
  today: DayKey;
  places: Named[];
  tasks: { id: string; title: string; status: string; template?: boolean }[];
  /** Names and aliases of the memory notes that may be shown to an AI (a line starting with one and a verb is a statement about them). */
  notes?: string[];
  /** Now (ms), the day-start rule and the time zone: a time with no date that has passed today means tomorrow. Without `now`, it is today. */
  now?: number;
  dayStart?: string;
  zone?: string;
}

export type Intent = 'add' | 'standing' | 'done' | 'move' | 'drop';
export type Unknown = 'empty' | 'question' | 'several' | 'memory' | 'long' | 'nomatch';

export type HomeParse =
  /** One change-set (`by: 'me'`), ready for `planChanges`; `title` is the step it adds or acts on. */
  | { kind: 'changes'; cs: ChangeSet; intent: Intent; title: string }
  /** The target of a done, move or drop matches several open steps. */
  | { kind: 'pick'; intent: 'done' | 'move' | 'drop'; candidates: Named[] }
  /** Understood, but it needs the task sheet (a repeat, or a time with a repeat the schedule can't hold). */
  | { kind: 'sheet'; prefill: Partial<Task> }
  /** Not for the parser. `prefill` is what the task sheet opens with when no AI is set up. */
  | { kind: 'unknown'; reason: Unknown; prefill: Partial<Task> };

/** A title longer than this many words is not a plain line. */
export const PLAIN_WORDS = 8;

// ---------- the working text ----------
// `f` is `s` folded (accents dropped, lower case, same length), so a match found in one cuts both.
const fold = (s: string): string => s.split('').map(c => c.normalize('NFD')[0]!.toLowerCase()[0] ?? c).join('').replace(/[‘’]/g, "'");

class Work {
  s: string;
  f: string;
  constructor(text: string) { this.s = text.normalize('NFC'); this.f = fold(this.s); }
  /** The first match of `re` (on the folded text), cut out. */
  take(re: RegExp): RegExpExecArray | null {
    const m = re.exec(this.f);
    if (m) { this.was = [this.s, this.f]; this.put(m.index, m[0].length, ' '); }
    return m;
  }
  /** Put back what the last `take` cut (it matched, but turned out not to be what it looked like). */
  undo() { if (this.was) [this.s, this.f] = this.was; }
  put(i: number, n: number, text: string) { this.s = this.s.slice(0, i) + text + this.s.slice(i + n); this.f = this.f.slice(0, i) + text + this.f.slice(i + n); }
  private was: [string, string] | null = null;
}

const NOT_WORD = '(?<![\\p{L}\\p{N}])';
const END = '(?![\\p{L}\\p{N}])';

// ---------- weekdays and months ----------
const WD = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)';
const WDA = '(?:mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)\\.?';
const DOW3: Record<string, number> = { mon: 1, lun: 1, tue: 2, mar: 2, wed: 3, mer: 3, thu: 4, jeu: 4, fri: 5, ven: 5, sat: 6, sam: 6, sun: 7, dim: 7 };
const dowOf = (w: string): number => DOW3[w.slice(0, 3)]!;
const dowsIn = (s: string): number[] => [...new Set([...s.matchAll(new RegExp(WD + '|' + WDA, 'gu'))].map(m => dowOf(m[0])))].sort((a, b) => a - b);

const MONTHS = '(?:janvier|january|janv?|fevrier|february|fevr?|feb|mars|march|mar|avril|april|avr|apr|mai|may|juin|june|jun|juillet|july|juil|jul|aout|august|aug|septembre|september|sept?|octobre|october|oct|novembre|november|nov|decembre|december|dec)\\.?';
const monthOf = (w: string): number => {
  const k = w.replace('.', '');
  if (k.startsWith('juil') || k === 'jul' || k === 'july') return 7;
  if (k.startsWith('jui') || k === 'jun' || k === 'june') return 6;
  return ({ jan: 1, fev: 2, feb: 2, mar: 3, avr: 4, apr: 4, mai: 5, may: 5, aou: 8, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 } as Record<string, number>)[k.slice(0, 3)] ?? 0;
};

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const key = (y: number, m: number, d: number): DayKey | null => (m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m) ? y + '-' + pad(m) + '-' + pad(d) : null);
const year = (k: DayKey) => Number(k.slice(0, 4));
/** `m`/`d` this year, or next year when that day has already gone by. */
function upcoming(today: DayKey, m: number, d: number): DayKey | null {
  const y = year(today);
  const k = key(y, m, d);
  return k && k >= today ? k : key(y + 1, m, d);
}
const fullYear = (s: string | undefined): number | null => (s ? (s.length === 2 ? 2000 + Number(s) : Number(s)) : null);
function addMonths(k: DayKey, n: number): DayKey {
  const [y, m, d] = k.split('-').map(Number) as [number, number, number];
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  return ny + '-' + pad(nm) + '-' + pad(Math.min(d, daysIn(ny, nm)));
}
/** The next `dow` after `today`, never today. */
const nextWeekday = (today: DayKey, dow: number): DayKey => addDays(today, ((dow - isoDow(today) + 6) % 7) + 1);

// ---------- times ----------
export interface Found { at: string; dur?: number; start: number; end: number }
const hm = (h: number, m: number) => pad(h) + ':' + pad(m);
const AMPM = '([ap])\\.?\\s?m\\b\\.?';
const clock = (h: number, m: number, ap?: string): string | null => {
  if (m > 59) return null;
  if (ap) { if (h < 1 || h > 12) return null; return hm(ap === 'a' ? h % 12 : (h % 12) + 12, m); }
  return h > 23 ? null : hm(h, m);
};
/** Words that make "Nh" a duration ("for 2h"), and words that make it a time ("at 5h"). */
const FOR_RE = /(?:for|pendant|during|about|around|environ|approx\.?|approximately|takes?|prend|~)\s*$/u;
const AT_RE = /(?:at|a|vers|around|@|from|de|des)\s*$/u;

interface Tm { at: string; start: number; end: number }
/** Every clock time in `f`, in order. Folded text in, positions in it out; `s` tells "à" from "a". */
function timesIn(f: string, s: string): Tm[] {
  const out: Tm[] = [];
  const add = (m: RegExpExecArray, at: string | null) => {
    if (!at) return;
    // A word before it ("at", "à", "vers") goes with it.
    const before = f.slice(0, m.index);
    const pre = /(?:at|a|vers|@|from|de|des)\s*$/u.exec(before);
    const aOk = !pre || pre[0].trimEnd() !== 'a' || s[m.index - pre[0].length] === 'à' || s[m.index - pre[0].length] === 'À';
    const start = pre && aOk && (m.index - pre[0].length === 0 || /[\s,;(]/.test(f[m.index - pre[0].length - 1] ?? ' ')) ? m.index - pre[0].length : m.index;
    out.push({ at, start, end: m.index + m[0].length });
  };
  for (const m of f.matchAll(new RegExp(NOT_WORD + '(\\d{1,2}):(\\d{2})(?:\\s?' + AMPM + ')?' + END, 'gu'))) add(m, clock(Number(m[1]), Number(m[2]), m[3]));
  for (const m of f.matchAll(new RegExp(NOT_WORD + '(\\d{1,2})\\s?' + AMPM + END, 'gu'))) add(m, clock(Number(m[1]), 0, m[2]));
  for (const m of f.matchAll(new RegExp(NOT_WORD + '(\\d{1,2})\\s?h(?:\\s?(\\d{2}))?' + END, 'gu'))) {
    const n = Number(m[1]), min = m[2] ? Number(m[2]) : 0;
    const before = f.slice(0, m.index);
    if (FOR_RE.test(before)) continue;
    // "1h", "2h30" next to nothing: how long; "19h", "7h30", or anything after "at"/"à": a time.
    const marked = AT_RE.test(before);
    if (n < 5 && !marked) continue;
    if (m[2] && /^\s*(?:min|mn|minute)/u.test(f.slice(m.index + m[0].length))) continue;
    add(m, clock(n, min));
  }
  for (const m of f.matchAll(new RegExp(NOT_WORD + '(noon|midi)(?![\\p{L}\\p{N}-])', 'gu'))) add(m, '12:00');
  return out.sort((a, b) => a.start - b.start);
}
const mins = (at: string) => Number(at.slice(0, 2)) * 60 + Number(at.slice(3));

const RANGE = /^\s*(?:(?:-|\u2013|\u2014|to|until|a|au)\s*)?$/u;
/** The first time, joined to the next when the two make a range ("14h-15h30", "14h à 15h30"): when it ends, and how long it lasts. */
function rangeOf(f: string, ts: Tm[]): { end: number; dur?: number } | null {
  const [a, b] = ts;
  if (!a || !b || !RANGE.test(f.slice(a.end, b.start))) return null;
  const d = (mins(b.at) - mins(a.at) + 1440) % 1440;
  return { end: b.end, dur: d >= 5 && d <= 720 ? d : undefined };
}

/** The first clock time in `text` ("19:00", "19h", "7:30 pm", "à 19h30", "noon"), and a range's length ("14h-15h30"); an `Nh` under five is a length, not a time. */
export function findTime(text: string): Found | null {
  const f = fold(text.normalize('NFC'));
  const ts = timesIn(f, text.normalize('NFC'));
  const a = ts[0];
  if (!a) return null;
  const r = rangeOf(f, ts);
  return { at: a.at, dur: r?.dur, start: a.start, end: r?.end ?? a.end };
}

// ---------- the pieces of a line ----------
interface Recurrence { every: number; unit: 'day' | 'week' | 'month'; weekdays: number[] }
const LIST = '(?:' + WD + 's?|' + WDA + ')(?:\\s*(?:,|&|/|and|et)\\s*(?:' + WD + 's?|' + WDA + '))*';
const RECUR = [
  new RegExp(NOT_WORD + '(?:every|each)\\s+(?:(\\d+|other)\\s+)?(?:(day|week|month)s?|(' + LIST + '))' + END, 'u'),
  new RegExp(NOT_WORD + "(?:chaque|tous\\s+les|toutes\\s+les)\\s+(?:(\\d+)\\s+)?(?:(jour|semaine|mois)s?|(" + LIST + '))' + END, 'u'),
  // "Mondays", "les lundis": a plural weekday is a repeat on its own.
  new RegExp(NOT_WORD + '(?:(?:tous\\s+)?les\\s+)?((?:' + WD + 's)(?:\\s*(?:,|&|and|et)\\s*' + WD + 's)*)' + END, 'u'),
];
const UNIT: Record<string, Recurrence['unit']> = { day: 'day', jour: 'day', week: 'week', semaine: 'week', month: 'month', mois: 'month' };

function takeRecurrence(w: Work): Recurrence | null {
  for (const re of RECUR) {
    const m = w.take(re);
    if (!m) continue;
    if (re === RECUR[2]) return { every: 1, unit: 'week', weekdays: dowsIn(m[1]!) };
    const n = m[1] === 'other' ? 2 : Number(m[1] ?? 1);
    if (m[3]) return { every: n, unit: 'week', weekdays: dowsIn(m[3]) };
    return { every: Math.max(1, n), unit: UNIT[m[2]!]!, weekdays: [] };
  }
  return null;
}

const NUM = '(\\d+(?:[.,]\\d+)?)';
const DURATION = new RegExp(NOT_WORD + '(?:(?:for|pendant|during|about|around|environ|approx\\.?|approximately|takes?|prend|~)\\s*)?' + NUM + '\\s?(?:(h|hrs?|hours?|heures?)(?:\\s?(\\d{1,2})(?:\\s?(?:min(?:ute)?s?|mn))?)?|(min(?:ute)?s?|mn))' + END, 'u');
/** "10 min", "1h", "1 h 30", "2 hours", "for 45 minutes": minutes, 1 to 1440. */
function takeDuration(w: Work): number | null {
  const m = DURATION.exec(w.f);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  const total = Math.round(m[2] ? n * 60 + Number(m[3] ?? 0) : n);
  if (!(total >= 1 && total <= 1440)) return null;
  w.put(m.index, m[0].length, ' ');
  return total;
}

function takeTime(w: Work): { at: string; dur?: number } | null {
  const ts = timesIn(w.f, w.s);
  const a = ts[0];
  if (!a) return null;
  const r = rangeOf(w.f, ts);
  w.put(a.start, (r?.end ?? a.end) - a.start, ' ');
  return { at: a.at, dur: r?.dur };
}

// A word before a date that goes with it ("for Friday", "pour le 26/10", "by tomorrow").
const PRE = '(?:(?:pour|avant|jusqu\'a|jusqu\'au|d\'ici|by|before|until|for|on|next|this|ce|cette|le|la|the)\\s+){0,2}';
const MORN = '(?:\\s+(?:morning|evening|afternoon|night|matin|soir|apres-midi|apres midi))?';
const ORD = '(?:st|nd|rd|th|er|e)?';
/** A day in the line: today/tomorrow, a weekday (the next one, never today), 26/10, 26 oct, ISO, in 3 days. */
function takeDate(w: Work, today: DayKey): DayKey | null {
  let m: RegExpExecArray | null;
  const tryRe = (re: RegExp) => (m = w.take(re));
  if (tryRe(new RegExp(NOT_WORD + '(\\d{4})-(\\d{2})-(\\d{2})' + END, 'u'))) { const k = key(Number(m![1]), Number(m![2]), Number(m![3])); if (k) return k; w.undo(); }
  if (tryRe(new RegExp(NOT_WORD + PRE + '(?:the\\s+)?day\\s+after\\s+tomorrow' + END, 'u')) || tryRe(new RegExp(NOT_WORD + PRE + 'apres[- ]demain' + MORN + END, 'u'))) return addDays(today, 2);
  if (tryRe(new RegExp(NOT_WORD + PRE + '(?:tomorrow|tmrw|demain)' + MORN + END, 'u'))) return addDays(today, 1);
  if (tryRe(new RegExp(NOT_WORD + PRE + "(?:today|aujourd'hui|tonight|ce\\s+soir|ce\\s+matin|cet\\s+apres-midi|this\\s+(?:morning|evening|afternoon))" + END, 'u'))) return today;
  if (tryRe(new RegExp(NOT_WORD + '(?:in|dans)\\s+(\\d+)\\s+(days?|jours?|weeks?|semaines?|months?|mois)' + END, 'u'))) {
    const n = Number(m![1]), u = m![2]!;
    return u.startsWith('d') || u.startsWith('j') ? addDays(today, n) : u.startsWith('w') || u.startsWith('s') ? addDays(today, 7 * n) : addMonths(today, n);
  }
  if (tryRe(new RegExp(NOT_WORD + PRE + '(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?' + END, 'u')) || tryRe(new RegExp(NOT_WORD + PRE + '(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2,4})?' + END, 'u'))) {
    let a = Number(m![1]), b = Number(m![2]);
    if (a <= 12 && b > 12) [a, b] = [b, a]; // 10/26: month first, only when that is the one way it reads
    const y = fullYear(m![3]);
    const k = y ? key(y, b, a) : upcoming(today, b, a);
    if (k) return k;
    w.undo();
  }
  if (tryRe(new RegExp(NOT_WORD + PRE + '(\\d{1,2})' + ORD + "\\s+(?:of\\s+|de\\s+|d')?(" + MONTHS + ')(?:\\s+(\\d{4}))?' + END, 'u')) || tryRe(new RegExp(NOT_WORD + PRE + '(' + MONTHS + ')\\s+(\\d{1,2})' + ORD + '(?:,?\\s+(\\d{4}))?' + END, 'u'))) {
    const named = /^\d/.test(m![1]!);
    const d = Number(named ? m![1] : m![2]), mo = monthOf(named ? m![2]! : m![1]!);
    const k = m![3] ? key(Number(m![3]), mo, d) : upcoming(today, mo, d);
    if (k) return k;
    w.undo();
  }
  // A weekday by its full name, or short ("fri") after a word that says it is a day.
  if (tryRe(new RegExp(NOT_WORD + PRE + '(' + WD + ')(?:\\s+(?:prochain|next))?' + END, 'u')) || tryRe(new RegExp(NOT_WORD + '(?:(?:on|by|before|until|for|next|this|le|ce)\\s+)(' + WDA + ')' + END, 'u'))) return nextWeekday(today, dowOf(m![1]!));
  return null;
}

/** "at <a place the person has>": the place, and it leaves the title. */
function takePlace(w: Work, places: Named[]): string | null {
  const byLength = [...places].sort((a, b) => norm(b.name).length - norm(a.name).length);
  for (const p of byLength) {
    const words = norm(p.name).split(' ').filter(Boolean);
    if (!words.length) continue;
    const name = words.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("[^\\p{L}\\p{N}]+");
    const m = w.take(new RegExp(NOT_WORD + "(?:at|a|in|dans|chez|au|aux|@)\\s+(?:(?:the|le|la)\\s+|l')?" + name + END, 'u'));
    if (m) return p.id;
  }
  return null;
}

const ARTICLE = /^(?:the|my|our|a|an|this|that|la|le|les|l'|un|une|mon|ma|mes|notre|ce|cette)(?![\p{L}\p{N}])/u;
const DANGLING = /(?:^|\s)(?:on|by|for|at|to|the|and|le|la|les|pour|a|et|de|du|before|avant|vers|until|every|chaque)$/u;

/** What is left of the line, as a title: spaces and stray punctuation tidied, "at X" after a time read as ", X", first letter up. */
function tidy(w: Work, hasTime: boolean): string {
  if (hasTime) {
    const m = /(?<=\s)(at|a)\s+(?=\S)/u.exec(w.f);
    if (m && (m[1] === 'at' || w.s[m.index] === 'à' || w.s[m.index] === 'À') && !ARTICLE.test(w.f.slice(m.index + m[0].length)) && w.f.slice(0, m.index).trim()) w.put(m.index, m[0].length, ', ');
  }
  let s = w.s.replace(/\s+/g, ' ').replace(/\s+([,;:.])/g, '$1').replace(/([,;:])\s*(?:[,;:]\s*)+/g, '$1 ').trim();
  for (;;) {
    const next = s.replace(/^[\s,;:.\-–—]+/, '').replace(/[\s,;:.\-–—]+$/, '').replace(/[\s,]+$/, '');
    const f = fold(next);
    const d = DANGLING.exec(f);
    const cut = d ? next.slice(0, d.index) : next;
    if (cut === s) break;
    s = cut;
  }
  return s ? s[0]!.toUpperCase() + s.slice(1) : '';
}

// ---------- reading a line ----------
interface Parts { title: string; at?: string; dur?: number; est?: number; due?: DayKey; where?: string; recur?: Recurrence }

function extract(text: string, ctx: ParseContext): Parts {
  const w = new Work(text);
  const recur = takeRecurrence(w);
  const time = takeTime(w);
  const len = takeDuration(w);
  const due = takeDate(w, ctx.today);
  const where = takePlace(w, ctx.places);
  const p: Parts = { title: tidy(w, !!time) };
  if (recur) p.recur = recur;
  if (time) { p.at = time.at; if (time.dur ?? len) p.dur = time.dur ?? len!; } else if (len) p.est = len;
  if (due) p.due = due;
  if (where) p.where = where;
  return p;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const QUESTION = /^(?:what|what's|whats|who|whom|whose|when|why|how|which|qui|quoi|quand|pourquoi|comment|quel|quels|quelle|quelles|combien|est-ce)(?![\p{L}\p{N}])/u;
const SEVERAL = /[;\n]| and then | then | puis | et puis /u;
const STATEMENT = /^\p{Lu}[\p{L}'-]*\s+(?:is|was|has|had|likes|lives|works|est|etait|a|aime|habite|travaille)\s/u;

/** The text without an "R:" prefix, or a leading "add"/"ajouter"/"remind me to". */
function stripLead(text: string): string {
  return text.replace(/^\s*r\s*:\s*/i, '').replace(/^\s*(?:add|ajouter|ajoute|new step|todo|to-do|to do|remind me to|rappelle[- ]moi de|rappelle[- ]moi)\s*[:\-]?\s+/iu, '').trim();
}

/** Open, ordinary steps a done, move or drop may name. A standing obligation is not one: `planChanges` leaves it alone for update and drop, and "done" would close the series. */
const targets = (ctx: ParseContext): Named[] => ctx.tasks.filter(t => t.status === 'open' && !t.template).map(t => ({ id: t.id, name: t.title }));

type Target = { id: string } | { many: Named[] } | null;
function findTarget(q: string, pool: Named[]): Target {
  const bare = q.replace(/^\s*(?:the|my|a|an|le|la|les|l'|un|une|mon|ma|mes|des|du|de la)\s+/iu, '');
  for (const v of bare === q ? [q] : [q, bare]) {
    const r = findByName(v, pool);
    if ('id' in r) return r;
    if ('many' in r) return { many: r.many.slice(0, 5) };
  }
  // Not at the start of a title: the words together, then all the words anywhere in it.
  const want = norm(bare);
  if (!want) return null;
  const inside = pool.filter(p => (' ' + norm(p.name) + ' ').includes(' ' + want + ' '));
  if (inside.length === 1) return { id: inside[0]!.id };
  if (inside.length > 1) return { many: inside.slice(0, 5) };
  const ws = want.split(' ');
  const all = pool.filter(p => { const t = new Set(norm(p.name).split(' ')); return ws.every(x => t.has(x)); });
  if (all.length === 1) return { id: all[0]!.id };
  return all.length > 1 ? { many: all.slice(0, 5) } : null;
}

// The keyword is a word of its own: "finish the essay" and "terminer le rapport" are things to do, not done.
const DONE_PRE = /^(?:(?:done|finished|fait|fini|finie|termine|terminee|j'ai fini|j'ai fait|c'est fait)(?:\s*[:\-]\s*|\s+)|[✓✔☑]\s*[:\-]?\s*)(.+)$/u;
const DONE_SUF = /^(.+?)\s+(?:done|finished|fait|fini|finie|termine|terminee)$/u;
const DROP = /^(?:drop|abandon|scrap|supprime|supprimer|abandonne|abandonner)\s+(.+)$/u;
const MOVE = /^(?:move|push|postpone|reschedule|defer|reporter|reporte|deplacer|deplace|repousser|repousse|decaler|decale)\s+(.+)$/u;
const ARROW = /^(.+?)\s*(?:→|->|=>)\s*(.+)$/u;
const MOVE_TO = /\s(?:to|until|till|a|au|pour|jusqu'a|jusqu'au|vers)\s/gu;

const create = (set: Record<string, unknown>) => ({ op: 'task.create' as const, set: set as { title: string } });
/** The day a time with no date is on: today, or tomorrow when it has already passed today (the day-start rule decides which calendar day "today" at 09:00 is). */
function dayOfTime(at: string, ctx: ParseContext): DayKey {
  if (ctx.now === undefined) return ctx.today;
  return atOnDay(ctx.today, at, ctx.dayStart ?? '05:00', ctx.zone) <= ctx.now ? addDays(ctx.today, 1) : ctx.today;
}
const csOf = (changes: ChangeSet['changes']): ChangeSet => ({ v: 1, note: '', changes, bad: 0, by: 'me' });
const draft = (title: string): Partial<Task> => ({ title });

/** A date (and maybe a time) and nothing else: where a step moves to. */
function whenOnly(text: string, ctx: ParseContext): { due: DayKey; at?: string } | null {
  const w = new Work(text);
  const at = takeTime(w);
  const due = takeDate(w, ctx.today);
  return due && !tidy(w, false) ? { due, ...(at ? { at: at.at } : {}) } : null;
}

/** Done, move or drop: the target and what to do, or why not; 'no' when the line is none of these. */
function command(text: string, f: string, ctx: ParseContext): HomeParse | 'no' {
  const pool = targets(ctx);
  const standing = ctx.tasks.filter(t => t.status === 'open' && t.template).map(t => ({ id: t.id, name: t.title }));
  const aim = (intent: 'done' | 'move' | 'drop', q: string, change: (id: string) => ChangeSet['changes'][number]): HomeParse => {
    // A line that also names a standing obligation may mean it, which the parser leaves alone: never a guess at another step.
    if (findTarget(q, standing)) return { kind: 'unknown', reason: 'nomatch', prefill: draft(text) };
    const r = findTarget(q, pool);
    if (!r) return { kind: 'unknown', reason: 'nomatch', prefill: draft(text) };
    if ('many' in r) return { kind: 'pick', intent, candidates: r.many };
    return { kind: 'changes', cs: csOf([change(r.id)]), intent, title: pool.find(p => p.id === r.id)!.name };
  };
  // A captured part as written: the folded text has the same length as the text.
  const sub = (m: RegExpExecArray, i: number): string => {
    const j = f.indexOf(m[i]!, m.index);
    return text.slice(j, j + m[i]!.length).trim();
  };
  let m: RegExpExecArray | null;
  // "done X", "X done", and a day it was done on: "yesterday" or "hier" at the end.
  const y = /\s+(?:yesterday|hier)$/u.exec(f);
  const g = y ? f.slice(0, y.index) : f;
  if ((m = DONE_PRE.exec(g)) || (m = DONE_SUF.exec(g))) {
    const day = y ? addDays(ctx.today, -1) : undefined;
    return aim('done', sub(m, 1), id => ({ op: 'task.done' as const, id, ...(day ? { day } : {}) }));
  }
  if ((m = DROP.exec(f))) return aim('drop', sub(m, 1), id => ({ op: 'task.drop' as const, id }));
  // Move: "move X to <day>", "reporter X à <jour>", "X → <day>". The day is whatever parses as one, from the right.
  let pair: [string, string] | null = null;
  if ((m = MOVE.exec(f))) {
    const x = sub(m, 1), fx = fold(x);
    for (const c of [...fx.matchAll(MOVE_TO)].reverse()) {
      const to = x.slice(c.index + c[0].length);
      if (x.slice(0, c.index).trim() && whenOnly(to, ctx)) { pair = [x.slice(0, c.index).trim(), to]; break; }
    }
  } else if ((m = ARROW.exec(f)) && whenOnly(sub(m, 2), ctx)) pair = [sub(m, 1), sub(m, 2)];
  const when = pair && whenOnly(pair[1], ctx);
  if (pair && when) return aim('move', pair[0], id => ({ op: 'task.update' as const, id, set: { due: when.due, ...(when.at ? { at: when.at } : {}) } }));
  return 'no';
}

/**
 * Read a line typed or dictated on Home. `changes` is one change-set the planner accepts (add a
 * step, or a standing obligation; done; move to a date; drop). An ordinary line of up to
 * `PLAIN_WORDS` words adds a step to the Inbox.
 */
export function parseHome(input: string, ctx: ParseContext): HomeParse {
  const text = stripLead(input.normalize('NFC'));
  const f = fold(text);
  const unknown = (reason: Unknown, prefill: Partial<Task> = draft(text)): HomeParse => ({ kind: 'unknown', reason, prefill });
  if (!/[\p{L}\p{N}]/u.test(text)) return unknown('empty', {});
  if (SEVERAL.test(f)) return unknown('several');
  if (text.endsWith('?') || QUESTION.test(f)) return unknown('question');
  const cmd = command(text, f, ctx);
  if (cmd !== 'no') return cmd;
  const names = (ctx.notes ?? []).map(norm).filter(n => n.length > 1);
  const n = norm(text);
  if (STATEMENT.test(text) || names.some(x => n.startsWith(x + ' ') && /^(?:is|was|has|had|likes|lives|works|est|etait|a|aime|habite|travaille)$/.test(n.slice(x.length + 1).split(' ')[0]!))) return unknown('memory');

  const p = extract(text, ctx);
  const prefill: Partial<Task> = { title: p.title };
  if (p.due) prefill.due = p.due;
  if (p.at) { prefill.at = p.at; if (!p.due && !p.recur) prefill.due = dayOfTime(p.at, ctx); }
  if (p.dur) prefill.dur = p.dur;
  if (p.est) { prefill.est = p.est; prefill.estBy = 'me'; }
  if (p.where) prefill.where = p.where;
  if (!p.title) return { kind: 'sheet', prefill };

  if (p.recur) {
    const r = p.recur;
    // Every week (on named days) or every day, at a time, with no other date: a standing obligation.
    const days = r.unit === 'day' && r.every === 1 ? [1, 2, 3, 4, 5, 6, 7] : r.unit === 'week' && r.every === 1 ? r.weekdays : [];
    if (p.at && days.length && !p.due && words(p.title) <= PLAIN_WORDS) {
      const set: Record<string, unknown> = { title: p.title, template: true, weekdays: days, at: p.at };
      if (p.dur) set.dur = p.dur;
      if (p.where) set.where = p.where;
      return { kind: 'changes', cs: csOf([create(set)]), intent: 'standing', title: p.title };
    }
    // A repeat with no time: the sheet's Repeats field holds it (a change-set has no way to say it).
    const rep: Repeat = { every: r.every, unit: r.unit, from: 'due' };
    if (r.unit === 'week' && r.weekdays.length) rep.weekdays = r.weekdays;
    const sheet = { ...prefill, repeat: rep };
    sheet.due = p.due ?? (r.weekdays.length ? nextWeekday(ctx.today, r.weekdays.find(d => d > isoDow(ctx.today)) ?? r.weekdays[0]!) : ctx.today);
    return { kind: 'sheet', prefill: sheet };
  }

  if (words(p.title) > PLAIN_WORDS) return unknown('long', prefill);
  const set: Record<string, unknown> = { title: p.title };
  for (const k of ['due', 'at', 'dur', 'est', 'where'] as const) if (prefill[k] != null) set[k] = prefill[k];
  return { kind: 'changes', cs: csOf([create(set)]), intent: 'add', title: p.title };
}
