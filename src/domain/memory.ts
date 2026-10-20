// Which memory notes go with a message (brief §10, Memory). Plain matching, no embeddings and no
// extra AI call: the profile always, then notes whose name or an alias appears in the message, the
// steps involved or their projects, most recently updated first, within a budget. Private notes are
// never picked. Pure: shared by the app's prompts and the connector's read_memory.
import type { MemoryNote } from '../data/schema';
import { norm } from './names';

export type Note = MemoryNote & { id: string };

/** The rough size of a text in tokens (characters / 4). */
export const tokensOf = (text: string): number => Math.ceil(text.length / 4);

/** A note's lines as shown to an AI, numbered from 1: the number is how a line is named in an edit. */
export const noteLines = (note: Pick<MemoryNote, 'lines'>): string[] => note.lines.map((l, i) => `${i + 1}. ${l.text}`);

/** What a note costs when sent: its name, aliases and numbered lines. */
export const noteTokens = (note: MemoryNote): number => tokensOf([note.name, ...note.aliases, ...noteLines(note)].join('\n'));

/**
 * The notes whose name or an alias appears in `text` as whole words, ignoring case, accents and
 * punctuation ("Ibrahim's" and "d'Ibrahim" both match Ibrahim). A one-letter name matches nothing.
 */
export function notesMatching<N extends MemoryNote>(text: string, notes: Iterable<N>): N[] {
  const hay = ' ' + norm(text) + ' ';
  const out: N[] = [];
  for (const n of notes) {
    if ([n.name, ...n.aliases].some(w => { const k = norm(w); return k.length >= 2 && hay.includes(' ' + k + ' '); })) out.push(n);
  }
  return out;
}

export interface PickInput {
  notes: Iterable<Note>;
  message: string;
  /** The steps the message is about (their titles and notes are searched). */
  tasks?: Iterable<{ title: string; project?: string; note?: string }>;
  /** Looked up by the steps' `project`; a matching project name counts like a name in the message. */
  projects?: Iterable<{ id: string; name: string }>;
  budgetTokens: number;
}

const recentFirst = (a: Note, b: Note): number => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.id < b.id ? -1 : 1);

/**
 * The notes to send. The profile comes first and always, whatever its size (the person keeps it short);
 * the matching notes follow, most recently updated first, as many as fit in the rest of the budget: one
 * that doesn't fit is skipped, a smaller one after it may still go.
 */
export function pickNotes(i: PickInput): Note[] {
  const live = [...i.notes].filter(n => !n.private);
  const tasks = [...(i.tasks ?? [])];
  const names = new Map([...(i.projects ?? [])].map(p => [p.id, p.name]));
  const text = [i.message, ...tasks.flatMap(t => [t.title, t.note ?? '', t.project ? names.get(t.project) ?? '' : ''])].join('\n');
  const profile = live.filter(n => n.kind === 'profile').sort(recentFirst);
  const out = [...profile];
  let left = i.budgetTokens - profile.reduce((s, n) => s + noteTokens(n), 0);
  for (const n of notesMatching(text, live.filter(n => n.kind !== 'profile')).sort(recentFirst)) {
    const cost = noteTokens(n);
    if (cost > left) continue;
    out.push(n);
    left -= cost;
  }
  return out;
}
