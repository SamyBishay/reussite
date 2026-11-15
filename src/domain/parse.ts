// Home's local parser (brief §5, "The input"): a line the person types or dictates becomes one
// change-set (add a step with a time, place or date; done; move to a date; drop), a prefilled task
// sheet, or "unknown" (a question, several things at once, a statement about someone), which goes
// to the AI when there is one. Pure and deterministic. It reads English and French whatever the
// app's language is: the person may mix them, and dictation does.
import type { ChangeSet } from '../ai/changeset';
import type { SuitId, Task } from '../data/schema';
import { findProject, guessSuit, type SuitHistory } from './guess';
import { opensWithVerb } from './verbs';
import { addDays, type DayKey } from './dates';
import { findByName, norm, type Named } from './names';
import { isoDow, type Repeat } from './repeat';
import { atOnDay } from './zone';

export interface ParseContext {
  today: DayKey;
  places: Named[];
  /** `note`: what the card's note holds now (a line added to it goes after). `running`: its timer runs. */
  tasks: { id: string; title: string; status: string; template?: boolean; note?: string; running?: boolean }[];
  /** The open projects: a line that names one makes its card there, in the project's suit. */
  projects?: { id: string; name: string; suit: SuitId }[];
  /** The four suits as the person named and described them, in both languages: what a card's words are matched against to guess its suit. */
  suits?: Record<SuitId, { name: { en: string; fr: string }; desc?: { en?: string; fr?: string } }>;
  /** Which suit the person's own cards went to, by word (src/domain/guess.ts, `suitHistory`): it outranks the suits' descriptions. */
  history?: SuitHistory;
  /** The first move to write on a new card, from its title (the app gives the sentence in its language; src/domain/firstMove.ts picks which). */
  firstMove?: (title: string) => string | null;
  /** The card the person picked when asked "which one?": the line is read again and means that card, however it names it. */
  only?: string;
  /** Names and aliases of the memory notes that may be shown to an AI (a line starting with one and a verb is a statement about them). */
  notes?: string[];
  /** Now (ms), the day-start rule and the time zone: a time with no date that has passed today means tomorrow. Without `now`, it is today. */
  now?: number;
  dayStart?: string;
  zone?: string;
}

/** `note`: a line added to a card's note. `several`: more than one thing in the line. */
export type Intent = 'add' | 'standing' | 'done' | 'move' | 'drop' | 'note' | 'several';
export type Unknown = 'empty' | 'question' | 'several' | 'memory' | 'long' | 'nomatch';

export type HomeParse =
  /** One change-set (`by: 'me'`), ready for `planChanges`; `title` is the step it adds or acts on. */
  | { kind: 'changes'; cs: ChangeSet; intent: Intent; title: string; long?: true }
  /** The card a line names matches several open cards, or only nearly matches one: the person says which. */
  | { kind: 'pick'; intent: 'done' | 'move' | 'drop' | 'note' | 'start' | 'spent'; candidates: Named[] }
  /** The timer, which is no change to the list: start a card (`id`), pause the one that runs, or time spent on a card said after the fact (`min`). */
  | { kind: 'act'; act: 'start' | 'pause' | 'spent'; id?: string; min?: number; title: string }
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

const HOUR_WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const HOUR_W = '(\\d{1,2}|' + Object.keys(HOUR_WORD).join('|') + ')';

interface Tm { at: string; start: number; end: number; midnight?: boolean }
/** Every clock time in `f`, in order. Folded text in, positions in it out; `s` tells "à" from "a". */
function timesIn(f: string, s: string): Tm[] {
  const out: Tm[] = [];
  const add = (m: RegExpExecArray, at: string | null, midnight = false) => {
    if (!at) return;
    // A span another reading already took (the earlier reading is the more exact one).
    if (out.some(o => m.index < o.end && m.index + m[0].length > o.start)) return;
    // A word before it ("at", "à", "vers") goes with it.
    const before = f.slice(0, m.index);
    const pre = /(?:at|a|vers|@|from|de|des)\s*$/u.exec(before);
    const aOk = !pre || pre[0].trimEnd() !== 'a' || s[m.index - pre[0].length] === 'à' || s[m.index - pre[0].length] === 'À';
    const start = pre && aOk && (m.index - pre[0].length === 0 || /[\s,;(]/.test(f[m.index - pre[0].length - 1] ?? ' ')) ? m.index - pre[0].length : m.index;
    out.push({ at, start, end: m.index + m[0].length, ...(midnight ? { midnight } : {}) });
  };
  // An hour said with no "am", "pm" or 24-hour figure ("at 3", "half past two", "à 8 heures"): the line's own words decide
  // (morning, tonight), else one to six are the afternoon and seven to eleven the morning.
  const spoken = (h: number): number | null => {
    if (h < 0 || h > 23) return null;
    if (h === 0 || h > 12) return h;
    if (/(?<![\p{L}\p{N}])(?:morning|matin)(?![\p{L}\p{N}])/u.test(f)) return h % 12;
    if (/(?<![\p{L}\p{N}])(?:tonight|evening|afternoon|soir|apres-midi|apres midi)(?![\p{L}\p{N}])/u.test(f)) return (h % 12) + 12;
    return h === 12 ? 12 : h <= 6 ? h + 12 : h;
  };
  const shift = (h: number | null, min: number): string | null => (h === null ? null : hm(Math.floor(((h * 60 + min + 1440) % 1440) / 60), (h * 60 + min + 1440) % 60));
  const num = (w: string): number => HOUR_WORD[w] ?? Number(w);
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
  for (const m of f.matchAll(new RegExp(NOT_WORD + '(?:noon|midi)(?:\\s+et\\s+(demie?|quart))?(?![\\p{L}\\p{N}-])', 'gu'))) add(m, m[1] ? (m[1] === 'quart' ? '12:15' : '12:30') : '12:00');
  for (const m of f.matchAll(new RegExp(NOT_WORD + '(?:midnight|minuit)' + END, 'gu'))) add(m, '00:00', true);
  // "half past two", "quarter to five", "3 o'clock".
  for (const m of f.matchAll(new RegExp(NOT_WORD + '(half|quarter)\\s+(past|to)\\s+' + HOUR_W + END, 'gu'))) {
    if (m[1] === 'half' && m[2] === 'to') continue;
    add(m, shift(spoken(num(m[3]!)), (m[2] === 'to' ? -1 : 1) * (m[1] === 'half' ? 30 : 15)));
  }
  for (const m of f.matchAll(new RegExp(NOT_WORD + HOUR_W + "\\s?o'?clock" + END, 'gu'))) add(m, shift(spoken(num(m[1]!)), 0));
  // "à 15 heures", "à 15 heures 30", "à 3 heures et demie", "à 5 heures moins le quart": a time only after "à" or "vers" (else it is a length).
  for (const m of f.matchAll(new RegExp(NOT_WORD + '(\\d{1,2})\\s?heures?(?:\\s?(\\d{2})(?!\\s?(?:min|mn)))?(?:\\s+(et\\s+demie?|et\\s+quart|moins\\s+le\\s+quart))?' + END, 'gu'))) {
    const before = f.slice(0, m.index);
    if (FOR_RE.test(before) || !AT_RE.test(before)) continue;
    const extra = m[3] ? (m[3].startsWith('moins') ? -15 : m[3].endsWith('quart') ? 15 : 30) : 0;
    add(m, shift(spoken(Number(m[1])), (m[2] ? Number(m[2]) : 0) + extra));
  }
  // A bare hour after "at" or "à", when the line ends there or goes on with a day, a length or a comma: "dentist friday at 3", "drinks tonight at 8".
  for (const m of f.matchAll(new RegExp(NOT_WORD + '(\\d{1,2})(?=\\s*$|\\s*[,;)]|\\s+(?:for|pendant|on|today|tomorrow|tonight|demain|ce\\s+soir|' + WD + ')' + END + ')', 'gu'))) {
    const before = f.slice(0, m.index), pre = /(?:^|\s)(at|a|@)\s+$/u.exec(before);
    if (!pre || (pre[1] === 'a' && s[m.index - pre[0].trimStart().length] !== 'à' && s[m.index - pre[0].trimStart().length] !== 'À')) continue;
    const h = Number(m[1]);
    if (h < 1 || h > 23) continue;
    add(m, shift(spoken(h), 0));
  }
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
/** Monday to Friday: "every weekday", "on weekdays", "tous les jours de la semaine", "en semaine". */
const WEEKDAYS = new RegExp(NOT_WORD + "(?:(?:every|each)\\s+weekday|(?:on\\s+)?weekdays|(?:tous\\s+les|chaque)\\s+jours?\\s+(?:de\\s+(?:la\\s+)?semaine|ouvres|ouvrables)|en\\s+semaine)" + END, 'u');
const RECUR = [
  new RegExp(NOT_WORD + '(?:every|each)\\s+(?:(\\d+|other)\\s+)?(?:(day|week|month)s?|(' + LIST + '))' + END, 'u'),
  new RegExp(NOT_WORD + "(?:chaque|tous\\s+les|toutes\\s+les)\\s+(?:(\\d+)\\s+)?(?:(jour|semaine|mois)s?|(" + LIST + '))' + END, 'u'),
  // "Mondays", "les lundis": a plural weekday is a repeat on its own.
  new RegExp(NOT_WORD + '(?:(?:tous\\s+)?les\\s+)?((?:' + WD + 's)(?:\\s*(?:,|&|and|et)\\s*' + WD + 's)*)' + END, 'u'),
];
const UNIT: Record<string, Recurrence['unit']> = { day: 'day', jour: 'day', week: 'week', semaine: 'week', month: 'month', mois: 'month' };

function takeRecurrence(w: Work): Recurrence | null {
  if (w.take(WEEKDAYS)) return { every: 1, unit: 'week', weekdays: [1, 2, 3, 4, 5] };
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
// A length in words. It is one only after a word that says so ("for an hour", "pendant une heure") or set apart by a comma or a bracket
// ("tidy the desk, half an hour"): "book an hour with the coach" keeps its hour.
const MIN_WORD: Record<string, number> = { five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, cinq: 5, dix: 10, quinze: 15, vingt: 20, trente: 30, quarante: 40, 'quarante-cinq': 45 };
const HOURS_WORD: Record<string, number> = { two: 2, three: 3, four: 4, deux: 2, trois: 3, quatre: 4 };
const WORD_LENGTHS: [string, (m: RegExpExecArray) => number][] = [
  ["(?:an|one)\\s+hour\\s+and\\s+a\\s+half|une\\s+heure\\s+et\\s+demie", () => 90],
  ["half\\s+an\\s+hour|(?:une\\s+)?demi[- ]heure", () => 30],
  ["a\\s+quarter\\s+of\\s+an\\s+hour|un\\s+quart\\s+d'heure", () => 15],
  ["(?:an|one)\\s+hour|une\\s+heure", () => 60],
  ['(' + Object.keys(HOURS_WORD).join('|') + ')\\s+(?:hours|heures)', m => HOURS_WORD[m[1]!]! * 60],
  ['(' + Object.keys(MIN_WORD).sort((a, b) => b.length - a.length).join('|') + ')\\s+(?:minutes?|mins?)', m => MIN_WORD[m[1]!]!],
];
const LENGTH_LEAD = '(?:' + NOT_WORD + '(?:for|pendant|during|about|around|environ)\\s+|[,(~]\\s*)';
function takeWordLength(w: Work): number | null {
  for (const [phrase, value] of WORD_LENGTHS) {
    const m = new RegExp(LENGTH_LEAD + '(?:' + phrase + ')' + END, 'u').exec(w.f);
    if (!m) continue;
    // The captured group, if the phrase has one, is the first after the lead.
    const inner = new RegExp(phrase, 'u').exec(m[0])!;
    w.put(m.index, m[0].length, m[0].startsWith(',') ? ',' : m[0].startsWith('(') ? '(' : ' ');
    return value(inner);
  }
  return null;
}

function takeDuration(w: Work): number | null {
  const m = DURATION.exec(w.f);
  if (!m) return takeWordLength(w);
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

// ---- a deadline's time ("by 17:00", "before 5pm", "avant 17h", "pour le 26/10 à 17h"): the time of a deadline, not an appointment ----
/** The words that make what follows a deadline. "pour" alone is one only when a time or a date follows it. */
const DEADLINE_WORD = "(?:by|before|due(?:\\s+(?:by|on|at))?|avant|d'ici|jusqu'a|pour)";
/** A day as it can stand between the deadline word and its time ("by Friday 17:00"): the words takeDate reads, without a deadline word before them. */
const DAY_WORDS = '(?:(?:the|le)\\s+)?(?:today|tomorrow|tmrw|demain|aujourd\'hui|' + WD + '|' + WDA + '|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|\\d{1,2}(?:st|nd|rd|th|er)?\\s+(?:of\\s+|de\\s+)?' + MONTHS + '|' + MONTHS + '\\s+\\d{1,2}(?:st|nd|rd|th)?)';
const DEADLINE_BEFORE = new RegExp(NOT_WORD + '(' + DEADLINE_WORD + ')\\s+(?:(?:the|le)\\s+)?(?:' + DAY_WORDS + '\\s+)?(?:(?:at|a|vers)\\s+)?$', 'u');
/** Where the deadline word that governs a time starts, and how long it is (with its space), in the text before the time; none when the time is bare. */
function deadlineWordBefore(before: string): { at: number; len: number } | null {
  const m = DEADLINE_BEFORE.exec(before);
  return m ? { at: m.index, len: m[1]!.length + 1 } : null;
}

/** The deadline's time and the appointment's, apart: a time right after a deadline word is `dueAt` (the word goes with it); the first other time is `at`. */
function takeTimes(w: Work): { at?: string; dur?: number; dueAt?: string } {
  let dueAt: string | undefined;
  for (const tm of timesIn(w.f, w.s)) {
    const d = deadlineWordBefore(w.f.slice(0, tm.start));
    if (!d) continue;
    dueAt = tm.midnight ? '23:59' : tm.at; // "by midnight" is the end of the day, not its first minute
    w.put(tm.start, tm.end - tm.start, ' '); // the time first, so the word's place has not moved
    w.put(d.at, d.len, ' ');
    break;
  }
  const a = takeTime(w);
  return { ...(a ? { at: a.at, ...(a.dur ? { dur: a.dur } : {}) } : {}), ...(dueAt ? { dueAt } : {}) };
}

const COUNT_WORD: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, quinze: 15 };
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
  if (tryRe(new RegExp(NOT_WORD + '(?:in|dans)\\s+(\\d+|' + Object.keys(COUNT_WORD).join('|') + ')\\s+(days?|jours?|weeks?|semaines?|months?|mois)' + END, 'u'))) {
    const n = COUNT_WORD[m![1]!] ?? Number(m![1]), u = m![2]!;
    // "Dans huit jours" is a week and "dans quinze jours" two, as French counts them.
    if (u.startsWith('j') && (m![1] === 'huit' || m![1] === 'quinze')) return addDays(today, m![1] === 'huit' ? 7 : 14);
    return u.startsWith('d') || u.startsWith('j') ? addDays(today, n) : u.startsWith('w') || u.startsWith('s') ? addDays(today, 7 * n) : addMonths(today, n);
  }
  const dow = isoDow(today);
  // The weekend is its Saturday, or today once it has begun; "next weekend" said during one is the one after.
  if (tryRe(new RegExp(NOT_WORD + PRE + 'week-?end(?:\\s+prochain)?' + END, 'u'))) {
    const after = /next|prochain/.test(m![0]);
    return dow >= 6 ? (after ? addDays(today, 13 - dow) : today) : addDays(today, 6 - dow);
  }
  // Next week is its Monday, next month its first day.
  if (tryRe(new RegExp(NOT_WORD + '(?:next\\s+week|(?:la\\s+)?semaine\\s+prochaine)' + END, 'u'))) return addDays(today, 8 - dow);
  if (tryRe(new RegExp(NOT_WORD + '(?:next\\s+month|(?:le\\s+)?mois\\s+prochain)' + END, 'u'))) return addMonths(today.slice(0, 8) + '01', 1);
  // The end of the week is its Friday (its Sunday once Friday has gone), of the month its last day, of the year 31 December.
  if (tryRe(new RegExp(NOT_WORD + PRE + "(?:end\\s+of\\s+(?:the\\s+)?|fin\\s+(?:de\\s+la\\s+|du\\s+|de\\s+l'|de\\s+)?)(week|month|year|semaine|mois|annee)" + END, 'u'))) {
    const u = m![1]!;
    if (u === 'week' || u === 'semaine') return dow <= 5 ? addDays(today, 5 - dow) : addDays(today, 7 - dow);
    if (u === 'month' || u === 'mois') return today.slice(0, 8) + pad(daysIn(year(today), Number(today.slice(5, 7))));
    return year(today) + '-12-31';
  }
  // "A week on Monday", "lundi en huit": the one after the next; "lundi en quinze", the one after that.
  if (tryRe(new RegExp(NOT_WORD + 'a\\s+week\\s+(?:on|from)\\s+(' + WD + ')' + END, 'u'))) return addDays(nextWeekday(today, dowOf(m![1]!)), 7);
  if (tryRe(new RegExp(NOT_WORD + PRE + '(' + WD + ')\\s+en\\s+(huit|quinze)' + END, 'u'))) return addDays(nextWeekday(today, dowOf(m![1]!)), m![2] === 'huit' ? 7 : 14);
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

// The last day of a repeat: "every Monday 19:00 until 31 Dec", "jusqu'au 31 décembre". Only read in a line that repeats, and only when the date follows the word.
const UNTIL = new RegExp(NOT_WORD + "(?:until|till|through|jusqu'au|jusqu'a|jusqu'en|jusque)\\s+", 'u');
function takeUntil(w: Work, today: DayKey): DayKey | null {
  const s0 = w.s, f0 = w.f;
  const m = w.take(UNTIL);
  if (!m) return null;
  const g0 = w.f;
  const k = takeDate(w, today);
  let i = 0;
  while (i < g0.length && g0[i] === w.f[i]) i++;
  if (k && !g0.slice(m.index, i).trim()) return k;
  w.s = s0; w.f = f0;
  return null;
}

/** "at <a place the person has>": the place, and it leaves the title. */
function takePlace(w: Work, places: Named[]): string | null {
  const byLength = [...places].sort((a, b) => norm(b.name).length - norm(a.name).length);
  for (const p of byLength) {
    const words = norm(p.name).split(' ').filter(Boolean);
    if (!words.length) continue;
    const name = words.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("[^\\p{L}\\p{N}]+");
    const m = new RegExp(NOT_WORD + "(?:at|a|in|dans|chez|au|aux|@)\\s+(?:(?:the|le|la)\\s+|l')?" + name + END, 'u').exec(w.f);
    if (!m) continue;
    // "at Hill House 602": the room is part of what the card says, so the words stay in the title; the place is set all the same.
    if (!/^\s*\d/.test(w.f.slice(m.index + m[0].length))) w.put(m.index, m[0].length, ' ');
    return p.id;
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
  let s = w.s.replace(/[(\[]\s*[)\]]/g, ' ').replace(/\s+/g, ' ').replace(/\s+([,;:.])/g, '$1').replace(/([,;:])\s*(?:[,;:]\s*)+/g, '$1 ').trim();
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
interface Parts { title: string; at?: string; dueAt?: string; dur?: number; est?: number; due?: DayKey; until?: DayKey; where?: string; recur?: Recurrence }

function extract(text: string, ctx: ParseContext): Parts {
  const w = new Work(text);
  const recur = takeRecurrence(w);
  const time = takeTimes(w);
  const len = takeDuration(w);
  const until = recur ? takeUntil(w, ctx.today) : null;
  const due = takeDate(w, ctx.today);
  const where = takePlace(w, ctx.places);
  const p: Parts = { title: tidy(w, !!time.at) };
  if (recur) p.recur = recur;
  if (time.at) { p.at = time.at; if (time.dur ?? len) p.dur = time.dur ?? len!; } else if (len) p.est = len;
  if (time.dueAt) p.dueAt = time.dueAt;
  if (due) p.due = due;
  if (until) p.until = until;
  if (where) p.where = where;
  return p;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const QUESTION = /^(?:what|what's|whats|who|whom|whose|when|why|how|which|qui|quoi|quand|pourquoi|comment|quel|quels|quelle|quelles|combien|est-ce)(?![\p{L}\p{N}])/u;
const STATEMENT = /^\p{Lu}[\p{L}'-]*\s+(?:is|was|has|had|likes|lives|works|est|etait|a|aime|habite|travaille)\s/u;

const BULLET = /^\s*(?:[-*•·–—]\s+|\d{1,2}[.)]\s+|\[[ xX]?\]\s*)/u;
const POLITE = /^(?:i (?:need|have|want|ought) to|i must|i should|i gotta|need to|have to|remember to|don't forget to|do not forget to|je dois|il faut|il faudrait|penser a|ne pas oublier de|ne pas oublier d')\s*/u;
/** The text without a list's bullet or number, an "R:" prefix, or a leading "add"/"ajouter"/"remind me to". */
const stripPrefix = (text: string): string =>
  text.replace(BULLET, '').replace(/^\s*r\s*:\s*/i, '').replace(/^\s*(?:add|ajouter|ajoute|new step|todo|to-do|to do|remind me to|rappelle[- ]moi de|rappelle[- ]moi)\s*[:\-]?\s+/iu, '').trim();
/** And without a polite opening ("I need to", "je dois"). */
function stripLead(text: string): string {
  const s = stripPrefix(text);
  const m = POLITE.exec(fold(s));
  return m && s.length > m[0].length ? s.slice(m[0].length).trim() : s;
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
const DONE_WORD = '(?:done|finished|completed?|fait|faite|faits|faites|fini|finie|finis|finies|termine|terminee|termines|terminees)';
const DONE_PRE = /^(?:(?:done|finished|fait|fini|finie|termine|terminee|j'ai fini|j'ai fait|c'est fait)(?:\s*[:\-]\s*|\s+)|[✓✔☑]\s*[:\-]?\s*)(.+)$/u;
const DONE_SUF = new RegExp('^(.+?)\\s+(?:(?:is|are|est|sont)\\s+)?' + DONE_WORD + '$', 'u');
// Said as something that happened: "I paid the rent", "just finished the photos", "j'ai payé le loyer". Done only when the rest names a card.
const DID = [
  /^(?:i|i've|i have|we|we've|we have)\s+(?:just\s+|already\s+|finally\s+)?(?!need\s|feed\s|speed\s)(?:[a-z]+ed|paid|sent|done|made|bought|wrote|written|did|got|read|took|gave|went|built|sold|found|met)\s+(.+)$/u,
  /^just\s+(?:finished|did|done|completed)\s+(.+)$/u,
  /^j'ai\s+(?:deja\s+|enfin\s+|bien\s+)?\p{L}+(?:e|i|u|it|is)\s+(.+)$/u,
];
const DROP = /^(?:drop|abandon|scrap|supprime|supprimer|abandonne|abandonner)\s+(.+)$/u;
// Softer words for the same: a drop only when the rest names a card ("cancel the gym" with no such card is a thing to do).
const DROP_SOFT = /^(?:forget|cancel|remove|delete|laisser tomber|laisse tomber|annuler|annule|oublier|oublie|retirer|enlever)\s+(.+)$/u;
const MOVE = /^(?:move|push|postpone|reschedule|defer|reporter|reporte|deplacer|deplace|repousser|repousse|decaler|decale)\s+(.+)$/u;
const ARROW = /^(.+?)\s*(?:→|->|=>)\s*(.+)$/u;
const MOVE_TO = /\s(?:to|until|till|a|au|pour|jusqu'a|jusqu'au|vers)\s/gu;
// A move said as a fact: "the photos are for monday", "report tomorrow instead", "les impôts plutôt vendredi". Only when the rest names a card.
const MOVE_FOR = /^(.+?)\s+(?:is|are|est|sont)\s+(?:for|pour)\s+(.+)$/u;
const MOVE_INSTEAD = /^(.+)\s+(?:instead|plutot|finalement)$/u;
const MOVE_RATHER = /^(.+?)\s+(?:plutot|finalement|rather)\s+(.+)$/u;
// A line for a card's note: "note on the rent: …", "rent note: …", "note sur le loyer : …".
const NOTE_PRE = /^(?:note|comment|commentaire|remarque)\s+(?:(?:on|for|about|sur|pour)\s+)?(.+?)\s*:\s*(.+)$/u;
const NOTE_SUF = /^(.+?)\s+(?:note|comment|commentaire)\s*:\s*(.+)$/u;
// The timer, in words.
const PAUSE = /^(?:pause|stop|(?:pause|stop)\s+(?:the\s+)?timer|(?:arreter|arrete|stopper|stoppe|pause)\s+le\s+chrono|mettre\s+en\s+pause)$/u;
const START = /^(?:start|begin|resume|continue|commencer|commence|demarrer|demarre|lancer|lance|reprendre|reprends)\s+(?:(?:the\s+)?timer\s+(?:on|for)\s+|le\s+chrono\s+(?:sur|pour)\s+)?(.+)$/u;
const TOOK = /^(.+?)\s+(?:took|a\s+pris|m'a\s+pris)\s+(.+)$/u;
const SPENT = /^(?:(?:i\s+)?spent|j'ai\s+passe)\s+(.+?)\s+(?:on|sur)\s+(.+)$/u;
const LENGTH_ON = /^(.+?)\s+(?:on|sur)\s+(.+)$/u;

const create = (set: Record<string, unknown>) => ({ op: 'task.create' as const, set: set as { title: string } });
/** The day a time with no date is on: today, or tomorrow when it has already passed today (the day-start rule decides which calendar day "today" at 09:00 is). */
function dayOfTime(at: string, ctx: ParseContext): DayKey {
  if (ctx.now === undefined) return ctx.today;
  return atOnDay(ctx.today, at, ctx.dayStart ?? '05:00', ctx.zone) <= ctx.now ? addDays(ctx.today, 1) : ctx.today;
}
const csOf = (changes: ChangeSet['changes']): ChangeSet => ({ v: 1, note: '', changes, bad: 0, by: 'me' });
const draft = (title: string): Partial<Task> => ({ title });
const upper = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** A date (and maybe a time) and nothing else: where a step moves to. */
function whenOnly(text: string, ctx: ParseContext): { due: DayKey; at?: string } | null {
  const w = new Work(text);
  const at = takeTime(w);
  const due = takeDate(w, ctx.today);
  return due && !tidy(w, false) ? { due, ...(at ? { at: at.at } : {}) } : null;
}
/** A length and nothing else ("40 min", "1h30"): minutes. */
function lengthOnly(text: string): number | null {
  const w = new Work(text);
  const n = takeDuration(w);
  return n && !tidy(w, false) ? n : null;
}

// ---------- a name that is nearly right ----------
/** Edits between two words, a swap of two neighbours counting as one; stops caring past `max`. */
function edits(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [], prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
    }
    prev2 = prev; prev = cur;
  }
  return prev[b.length]!;
}
const SMALL = new Set(['the', 'a', 'an', 'my', 'le', 'la', 'les', 'l', 'un', 'une', 'mon', 'ma', 'mes', 'des', 'du', 'de', 'd']);
/** Cards whose title has every word asked for, one or more of them only nearly (a letter off in a word of four letters or more, two in one of seven; "f" for "ph"). Never the answer: an offer. */
function nearly(q: string, pool: Named[]): Named[] {
  const ws = norm(q).split(' ').filter(w => w && !SMALL.has(w));
  if (!ws.length) return [];
  const slack = (w: string) => (w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0);
  const sound = (w: string) => w.replace(/ph/g, 'f');
  return pool.filter(p => {
    const have = norm(p.name).split(' ');
    return ws.every(w => have.includes(w) || (slack(w) > 0 && have.some(x => edits(sound(w), sound(x), slack(w)) <= slack(w))));
  }).slice(0, 5);
}

/** Done, move, drop, a note, the timer: the card and what to do, or why not; 'no' when the line is none of these. */
function command(text: string, f: string, ctx: ParseContext): HomeParse | 'no' {
  const pool = targets(ctx);
  const standing = ctx.tasks.filter(t => t.status === 'open' && t.template).map(t => ({ id: t.id, name: t.title }));
  type PickIntent = Extract<HomeParse, { kind: 'pick' }>['intent'];
  const nomatch: HomeParse = { kind: 'unknown', reason: 'nomatch', prefill: draft(text) };
  /** The card `q` names: its id, several to pick from, or nothing. `soft`: nothing is 'no' (the line is something else), not a card that was not found. */
  const only = ctx.only;
  const find = (intent: PickIntent, q: string, soft = false, from: Named[] = pool): { hit: string } | HomeParse | 'no' => {
    if (only && from.some(p => p.id === only)) return { hit: only };
    // A line that also names a standing obligation may mean it, which the parser leaves alone: never a guess at another step.
    if (from === pool && findTarget(q, standing)) return soft ? 'no' : nomatch;
    const r = findTarget(q, from);
    if (r && 'id' in r) return { hit: r.id };
    if (r) return { kind: 'pick', intent, candidates: r.many };
    const near = nearly(q, from);
    if (near.length) return { kind: 'pick', intent, candidates: near };
    return soft ? 'no' : nomatch;
  };
  const name = (id: string) => ctx.tasks.find(t => t.id === id)?.title ?? '';
  const aim = (intent: 'done' | 'move' | 'drop', q: string, change: (id: string) => ChangeSet['changes'][number], soft = false): HomeParse | 'no' => {
    const r = find(intent, q, soft);
    return r === 'no' || !('hit' in r) ? r : { kind: 'changes', cs: csOf([change(r.hit)]), intent, title: name(r.hit) };
  };
  // A captured part as written: the folded text has the same length as the text.
  const sub = (m: RegExpExecArray, i: number): string => {
    const j = f.indexOf(m[i]!, m.index);
    return text.slice(j, j + m[i]!.length).trim();
  };
  /** The last captured part, which ends the line, as written. */
  const last = (m: RegExpExecArray, i: number): string => text.slice(text.length - m[i]!.length).trim();
  let m: RegExpExecArray | null;

  // The timer: pause the one that runs.
  if (PAUSE.test(f)) return { kind: 'act', act: 'pause', title: '' };

  // A line for a card's note. Any open card may have one, a standing obligation too.
  if ((m = NOTE_PRE.exec(f)) || (m = NOTE_SUF.exec(f))) {
    const open = ctx.tasks.filter(t => t.status === 'open').map(t => ({ id: t.id, name: t.title }));
    const r = find('note', sub(m, 1), false, open);
    if (r === 'no' || !('hit' in r)) return r;
    const old = ctx.tasks.find(t => t.id === r.hit)?.note ?? '', line = upper(last(m, 2));
    return { kind: 'changes', cs: csOf([{ op: 'task.update' as const, id: r.hit, set: { note: old ? old + '\n' + line : line } }]), intent: 'note', title: name(r.hit) };
  }

  // "done X", "X done", "X is done", and a day it was done on: "yesterday" or "hier" at the end.
  const y = /\s+(?:yesterday|hier)$/u.exec(f);
  const g = y ? f.slice(0, y.index) : f;
  const day = y ? addDays(ctx.today, -1) : undefined;
  const done = (id: string) => ({ op: 'task.done' as const, id, ...(day ? { day } : {}) });
  if ((m = DONE_PRE.exec(g)) || (m = DONE_SUF.exec(g))) {
    const q = sub(m, 1);
    const one = aim('done', q, done);
    // "done the report and the rent": each name its own card, or the line is not that.
    if (one !== 'no' && one.kind === 'unknown') {
      const names = q.split(/\s*,\s*(?:and\s+|et\s+)?|\s+(?:and|et|&)\s+/u).map(x => x.trim()).filter(Boolean);
      const each = names.length > 1 ? names.map(n => find('done', n)) : [];
      if (each.length && each.every((r): r is { hit: string } => r !== 'no' && 'hit' in r)) return { kind: 'changes', cs: csOf(each.map(r => done(r.hit))), intent: 'several', title: '' };
    }
    return one;
  }
  for (const re of DID) if ((m = re.exec(g))) { const r = aim('done', sub(m, 1), done, true); if (r !== 'no') return r; }

  if ((m = DROP.exec(f))) return aim('drop', sub(m, 1), id => ({ op: 'task.drop' as const, id }));
  if ((m = DROP_SOFT.exec(f))) { const r = aim('drop', sub(m, 1), id => ({ op: 'task.drop' as const, id }), true); if (r !== 'no') return r; }

  // The timer: start a card that exists ("start the report"; with no such card the line is a thing to do), or time spent on one.
  if ((m = START.exec(f))) {
    const r = find('start', sub(m, 1), true);
    if (r !== 'no') return 'hit' in r ? { kind: 'act', act: 'start', id: r.hit, title: name(r.hit) } : r;
  }
  const spent = (q: string, len: string): HomeParse | 'no' => {
    const min = lengthOnly(len);
    if (!min) return 'no';
    const r = find('spent', q, true);
    return r === 'no' ? 'no' : 'hit' in r ? { kind: 'act', act: 'spent', id: r.hit, min, title: name(r.hit) } : r;
  };
  if ((m = TOOK.exec(f))) { const r = spent(sub(m, 1), last(m, 2)); if (r !== 'no') return r; }
  if ((m = SPENT.exec(f))) { const r = spent(last(m, 2), sub(m, 1)); if (r !== 'no') return r; }
  if ((m = LENGTH_ON.exec(f)) && lengthOnly(sub(m, 1))) { const r = spent(last(m, 2), sub(m, 1)); if (r !== 'no') return r; }

  // Move: "move X to <day>", "reporter X à <jour>", "X → <day>". The day is whatever parses as one, from the right.
  const moveTo = (q: string, to: string, soft = false): HomeParse | 'no' => {
    const when = whenOnly(to, ctx);
    return when ? aim('move', q, id => ({ op: 'task.update' as const, id, set: { due: when.due, ...(when.at ? { at: when.at } : {}) } }), soft) : 'no';
  };
  if ((m = MOVE.exec(f))) {
    const x = sub(m, 1), fx = fold(x);
    for (const c of [...fx.matchAll(MOVE_TO)].reverse()) {
      const to = x.slice(c.index + c[0].length);
      if (x.slice(0, c.index).trim() && whenOnly(to, ctx)) return moveTo(x.slice(0, c.index).trim(), to);
    }
  } else if ((m = ARROW.exec(f)) && whenOnly(sub(m, 2), ctx)) return moveTo(sub(m, 1), sub(m, 2));
  // Said as a fact, and only about a card that exists.
  if ((m = MOVE_FOR.exec(f)) || (m = MOVE_RATHER.exec(f))) { const r = moveTo(sub(m, 1), last(m, 2), true); if (r !== 'no') return r; }
  if ((m = MOVE_INSTEAD.exec(f))) {
    // "report tomorrow instead": the day is the longest end of the rest that reads as one.
    const ws = sub(m, 1).split(/\s+/);
    for (let k = Math.min(4, ws.length - 1); k >= 1; k--) {
      const r = moveTo(ws.slice(0, -k).join(' '), ws.slice(-k).join(' '), true);
      if (r !== 'no') return r;
    }
  }
  return 'no';
}

// ---------- a new card ----------
/** "urgent: …", "…, important", "… (urgent)", "… asap", "… !!": the ticks, and the line without them. An adjective inside the sentence stays in the title. */
function takeFlags(text: string): { text: string; urgent: boolean; important: boolean } {
  let s = text, urgent = false, important = false;
  const mark = (w: string | undefined) => { if (w?.startsWith('urgent')) urgent = true; else if (w?.startsWith('important')) important = true; };
  for (;;) {
    const f = fold(s);
    let m: RegExpExecArray | null;
    if ((m = /^(urgente?|importante?)(?:\s+(?:and|et|&)\s+(urgente?|importante?))?\s*[:\-–—]\s*(?=\S)/u.exec(f))) { mark(m[1]); mark(m[2]); s = s.slice(m[0].length); continue; }
    if ((m = /(?:,\s*|\s*\(\s*|\s+[-–—]\s+)(urgente?|importante?)(?:\s+(?:and|et|&)\s+(urgente?|importante?))?\s*\)?\s*$/u.exec(f)) && m.index > 0) { mark(m[1]); mark(m[2]); s = s.slice(0, m.index); continue; }
    if ((m = /(?:\s+(?:asap|urgently|en urgence|d'urgence|de toute urgence)|\s*!!+)\s*$/u.exec(f)) && m.index > 0) { urgent = true; s = s.slice(0, m.index); continue; }
    return { text: s.trim(), urgent, important };
  }
}

// Something waited for, not a thing to do: "waiting for the bank to call back", "en attente de la réponse", "j'attends le devis".
const WAITING = /^(?:waiting\s+(?:for|on)|wait\s+for|en\s+attente\s+(?:de\s+|d'|du\s+|des\s+)|j'attends|attendre)\s*(?=\S)/u;

/** A title longer than this many words is not a card at all (a pasted paragraph): it opens the sheet, as it is. */
const MAX_WORDS = 30;

/** One thing: a command, or a new card. */
function parseOne(input: string, ctx: ParseContext): HomeParse {
  const text = stripLead(input.normalize('NFC'));
  const f = fold(text);
  const unknown = (reason: Unknown, prefill: Partial<Task> = draft(text)): HomeParse => ({ kind: 'unknown', reason, prefill });
  if (!/[\p{L}\p{N}]/u.test(text)) return unknown('empty', {});
  const noted = /^comment\s+(?:on|for|about|sur|pour)\s.+:/u.test(f); // "comment on the photos: …" is a note, not the French for "how"
  if (text.endsWith('?') || (QUESTION.test(f) && !noted)) return unknown('question');
  const cmd = command(text, f, ctx);
  if (cmd !== 'no') return cmd;
  const names = (ctx.notes ?? []).map(norm).filter(n => n.length > 1);
  const n = norm(text);
  if (STATEMENT.test(text) || names.some(x => n.startsWith(x + ' ') && /^(?:is|was|has|had|likes|lives|works|est|etait|a|aime|habite|travaille)$/.test(n.slice(x.length + 1).split(' ')[0]!))) return unknown('memory');

  // Something waited for: its name, and the day to be asked about it if the line gives one.
  const wait = WAITING.exec(f);
  if (wait) {
    const w = new Work(text.slice(wait[0].length));
    const nudge = takeDate(w, ctx.today);
    const title = upper(tidy(w, false).replace(/[,;]?\s*(?:check|recheck|ask again|v[ée]rifier|relancer)$/iu, '').trim());
    if (title) return { kind: 'changes', cs: csOf([create({ title, kind: 'event', ...(nudge ? { nudge } : {}) })]), intent: 'add', title };
  }

  // A project the line names, and the ticks it says.
  const pj = ctx.projects?.length ? findProject(text, ctx.projects) : null;
  const flags = takeFlags(pj ? pj.text : text);
  const p = extract(flags.text, ctx);
  const prefill: Partial<Task> = { title: p.title };
  if (p.due) prefill.due = p.due;
  if (p.dueAt) { prefill.dueAt = p.dueAt; if (!p.due) prefill.due = dayOfTime(p.dueAt, ctx); } // a deadline's time: due that day, never an `at`
  if (p.at) { prefill.at = p.at; if (!p.due && !p.recur) prefill.due = dayOfTime(p.at, ctx); }
  if (p.dur) prefill.dur = p.dur;
  if (p.est) { prefill.est = p.est; prefill.estBy = 'me'; }
  if (p.where) prefill.where = p.where;
  if (flags.urgent) prefill.urgent = true;
  if (flags.important) prefill.important = true;
  if (!p.title) return { kind: 'sheet', prefill };
  /** The suit and the project the words point to (src/domain/guess.ts). */
  const sorted = (set: Record<string, unknown>) => {
    if (pj) { set.project = pj.project.id; set.suit = pj.project.suit; } else { const s = guessSuit(p.title, ctx.suits, ctx.history); if (s) set.suit = s; }
    return set;
  };

  if (p.recur) {
    const r = p.recur;
    // Every week (on named days) or every day, at a time, with no other date: a standing obligation.
    const days = r.unit === 'day' && r.every === 1 ? [1, 2, 3, 4, 5, 6, 7] : r.unit === 'week' && r.every === 1 ? r.weekdays : [];
    if (p.at && days.length && !p.due && words(p.title) <= PLAIN_WORDS) {
      const set: Record<string, unknown> = { title: p.title, template: true, weekdays: days, at: p.at };
      if (p.dur) set.dur = p.dur;
      if (p.where) set.where = p.where;
      if (p.until) set.until = p.until;
      return { kind: 'changes', cs: csOf([create(sorted(set))]), intent: 'standing', title: p.title };
    }
    // A repeat with no time: the sheet's Repeats field holds it (a change-set has no way to say it).
    const rep: Repeat = { every: r.every, unit: r.unit, from: 'due' };
    if (r.unit === 'week' && r.weekdays.length) rep.weekdays = r.weekdays;
    if (p.until) rep.until = p.until;
    const sheet = { ...prefill, repeat: rep };
    sheet.due = p.due ?? (r.weekdays.length ? nextWeekday(ctx.today, r.weekdays.find(d => d > isoDow(ctx.today)) ?? r.weekdays[0]!) : ctx.today);
    return { kind: 'sheet', prefill: sheet };
  }

  // A sentence, not a plain line: the words of a polite opening count ("I should probably … before the weekend" is one, as it always was).
  const long = words(p.title) + words(stripPrefix(input.normalize('NFC'))) - words(text) > PLAIN_WORDS;
  if (words(p.title) > MAX_WORDS) return unknown('long', prefill);
  const set: Record<string, unknown> = { title: p.title };
  for (const k of ['due', 'dueAt', 'at', 'dur', 'est', 'where', 'urgent', 'important'] as const) if (prefill[k] != null) set[k] = prefill[k];
  const starter = ctx.firstMove?.(p.title);
  if (starter) set.starter = starter;
  return { kind: 'changes', cs: csOf([create(sorted(set))]), intent: 'add', title: p.title, ...(long ? { long: true as const } : {}) };
}

// ---------- several things in one line ----------
const HARD = /\s*[;\n\r]+\s*|\s+(?:and then|et puis|et ensuite|then|puis|ensuite)\s+/gu;
const SOFT = /\s*,\s*(?:(?:and|et)\s+)?|\s+(?:and|et|&)\s+/gu;
const COMMAND_START = /^(?:done|finished|fait|fini|finie|termine|terminee|drop|abandon|move|push|postpone|reporter|deplacer|decaler|supprimer|abandonner)\s/u;
// "Open Mail and reply to the agency" is one card, written the way the method asks; so is a second half that leans on the first ("… and send it").
const ONE_ACTION = /^(?:open|ouvrir|ouvre|go to|aller sur|log in|sign in|se connecter)\s/u;
const LEANS = /(?<![\p{L}\p{N}])(?:it|them|him|her)(?![\p{L}\p{N}])|-(?:le|la|les|lui|leur)(?![\p{L}\p{N}])/u;

/** Cut `s` where `re` matches its folded form; the pieces as written, without the empty ones. */
function cut(s: string, re: RegExp): string[] {
  const f = fold(s), out: string[] = [];
  let at = 0;
  for (const m of f.matchAll(re)) { out.push(s.slice(at, m.index)); at = m.index + m[0].length; }
  out.push(s.slice(at));
  return out.map(x => x.trim()).filter(x => /[\p{L}\p{N}]/u.test(x));
}

/**
 * The things a line holds. A semicolon, a new line, "then" and "puis" always part two things. A comma or an "and" parts them only when
 * every piece is a thing to do of its own (it opens with a verb and has an object): "call the bank and book the dentist" is two cards,
 * "buy milk and eggs" and "call Anna and Tom" are one.
 */
function pieces(text: string): string[] {
  return cut(text, HARD).flatMap(part => {
    const soft = cut(part, SOFT);
    if (soft.length < 2) return [part];
    const fs = soft.map(x => fold(stripLead(x)));
    if (ONE_ACTION.test(fs[0]!) || fs.slice(1).some(x => LEANS.test(x))) return [part];
    return fs.every(x => opensWithVerb(x) || COMMAND_START.test(x)) ? soft : [part];
  });
}

/**
 * Read a line typed or dictated on Home. `changes` is one change-set the planner accepts (new cards, or a standing obligation;
 * done; move to a date; drop; a line for a card's note); `act` is the timer. A line that holds several things is read one thing
 * at a time, and is one change-set if every one of them was read.
 */
export function parseHome(input: string, ctx: ParseContext): HomeParse {
  const ps = pieces(input.normalize('NFC'));
  if (ps.length < 2) return parseOne(ps[0] ?? input, ctx);
  const each = ps.map(x => parseOne(x, ctx));
  const changes = each.flatMap(r => (r.kind === 'changes' ? r.cs.changes : []));
  if (each.every(r => r.kind === 'changes')) return { kind: 'changes', cs: csOf(changes), intent: 'several', title: '' };
  return { kind: 'unknown', reason: 'several', prefill: draft(stripLead(input.normalize('NFC'))) };
}
