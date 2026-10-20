// Memory as Markdown (brief §10, Import and export): read notes from Claude Code's memory files and from
// claude.ai's memory text, merge them into what is there without ever replacing a line, and write notes
// out again in the same format. Pure: no I/O, so the same rules run in the tests and in the app.
//
// Two shapes come in:
//  - a file with frontmatter (Claude Code: `name`, `description`, and `type` at the top or under `metadata:`)
//    is one note; several frontmatter blocks in one file (this module's own export) are several notes;
//  - a file without frontmatter (claude.ai's text) is one note per `##` heading, or one note named after
//    its `#` heading or the file.
// Prose paragraphs become one line each (not one per wrapped line), bullets one line each; headings are
// not lines. A MEMORY.md that only lists links (Claude Code's index) is skipped.
import { MEMORY_KINDS, type MemoryKind, type MemoryLine, type MemoryNote } from '../data/schema';
import { norm } from './names';

/** A note as read from a file: not yet matched with the notes that exist. */
export interface NoteDraft {
  name: string;
  kind: MemoryKind;
  aliases: string[];
  description?: string;
  private: boolean;
  /** One fact each, without markup. */
  lines: string[];
}

// ---------- reading ----------

/** Claude Code's `type` values (and a few spellings) as this app's kinds. Anything else is a topic. */
const KIND_WORDS: Record<string, MemoryKind> = {
  profile: 'profile', user: 'profile', me: 'profile', self: 'profile',
  person: 'person', people: 'person', contact: 'person',
  place: 'place', location: 'place',
  area: 'area', project: 'area',
  topic: 'topic', feedback: 'topic', reference: 'topic',
};
const kindOf = (v: unknown): MemoryKind | undefined => (typeof v === 'string' ? KIND_WORDS[v.trim().toLowerCase()] : undefined);
/** A heading in claude.ai's text that names the person themselves. */
const PROFILE_HEADING = /^(profile|about me|about|personal|personal info|me|moi|a propos de moi|profil)$/;

type Front = Map<string, string | string[]>;

const unquote = (v: string): string => {
  const s = v.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) { try { return JSON.parse(s) as string; } catch { return s.slice(1, -1); } }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  return s;
};

/** `[a, "b, c"]` as a list: commas split unless inside double quotes. */
function inlineList(v: string): string[] {
  const inner = v.trim().replace(/^\[/, '').replace(/\]$/, '');
  const out: string[] = [];
  let cur = '', q = false;
  for (const ch of inner) {
    if (ch === '"') q = !q;
    if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(unquote).filter(Boolean);
}

/** The small part of YAML that frontmatter uses: scalars, inline and block lists, one level of nesting, `|` and `>` blocks. */
function parseFront(lines: string[]): Front {
  const top = new Map<string, string | string[]>();
  const nested = new Map<string, string | string[]>();
  let parent = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && parent) {
      const cur = top.get(parent);
      top.set(parent, [...(Array.isArray(cur) ? cur : []), unquote(item[1]!)]);
      continue;
    }
    const kv = /^\s*([\w.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    let val = kv[2]!.trim();
    if (/^[|>][+-]?$/.test(val)) {
      const fold = val.startsWith('>');
      const parts: string[] = [];
      while (i + 1 < lines.length && (!lines[i + 1]!.trim() || /^\s/.test(lines[i + 1]!))) parts.push(lines[++i]!.trim());
      val = parts.join(fold ? ' ' : '\n').trim();
      (indent ? nested : top).set(key, val);
      continue;
    }
    if (indent === 0) {
      parent = val ? '' : key;
      if (val) top.set(key, val.startsWith('[') ? inlineList(val) : unquote(val));
      else top.set(key, []);
    } else {
      nested.set(key, val.startsWith('[') ? inlineList(val) : unquote(val));
    }
  }
  // An empty top-level key that held a nested map (`metadata:`) is not a value.
  for (const [k, v] of [...top]) if (Array.isArray(v) && !v.length) top.delete(k);
  for (const [k, v] of nested) if (!top.has(k)) top.set(k, v);
  return top;
}

const str = (f: Front, ...keys: string[]): string => {
  for (const k of keys) { const v = f.get(k); if (typeof v === 'string' && v.trim()) return v.trim(); }
  return '';
};
const list = (f: Front, ...keys: string[]): string[] => {
  for (const k of keys) {
    const v = f.get(k);
    if (Array.isArray(v)) return v.map(s => s.trim()).filter(Boolean);
    if (typeof v === 'string' && v.trim()) return (v.startsWith('[') ? inlineList(v) : v.split(',')).map(s => s.trim()).filter(Boolean);
  }
  return [];
};

interface Section { front: Front | null; body: string[] }

const FRONT_LINE = /^(\s*$|\s*#|\s+\S|[\w.-]+\s*:|-\s)/;

/** Split a file at its frontmatter blocks. A block that isn't at the very top needs a `name:` and a blank line before it. */
function sections(lines: string[]): { pre: string[]; found: Section[] } {
  const found: Section[] = [];
  const pre: string[] = [];
  let cur: Section | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === '---' && (i === 0 || !lines[i - 1]!.trim())) {
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() !== '---' && FRONT_LINE.test(lines[j]!) && j - i <= 60) j++;
      const inner = lines.slice(i + 1, j);
      if (lines[j]?.trim() === '---' && (i === 0 || inner.some(l => /^name\s*:/i.test(l)))) {
        cur = { front: parseFront(inner), body: [] };
        found.push(cur);
        i = j;
        continue;
      }
    }
    (cur ? cur.body : pre).push(lines[i]!);
  }
  return { pre, found };
}

/** Markup that isn't part of what was said: bold, `[[wiki links]]`, runs of spaces. */
const clean = (s: string): string => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\s+/g, ' ').trim();

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/** A body as lines: one per bullet and one per paragraph. Headings, rules, fences and comments are not lines. */
function bodyLines(body: string[]): string[] {
  const out: string[] = [];
  let cur: string[] | null = null;
  const flush = () => {
    const s = cur ? clean(cur.join(' ')) : '';
    if (s) out.push(s);
    cur = null;
  };
  for (const raw of body) {
    const trimmed = raw.trim();
    if (!trimmed) { flush(); continue; }
    if (/^(```|~~~)/.test(trimmed) || /^([-*_])\1{2,}$/.test(trimmed) || /^<!--.*-->$/.test(trimmed) || HEADING.test(trimmed)) { flush(); continue; }
    const b = BULLET.exec(raw);
    if (b) { flush(); cur = [b[2]!]; continue; }
    const text = trimmed.replace(/^>\s?/, '');
    // `**Why:** …` starts a line of its own even when it follows a paragraph without a blank line.
    if (/^\*\*[^*]+\*\*/.test(text)) flush();
    (cur ??= []).push(text);
  }
  flush();
  return out;
}

const baseName = (fileName: string): string => fileName.split(/[\\/]/).pop() ?? fileName;
const humanise = (fileName: string): string => {
  const s = baseName(fileName).replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' ').trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : '';
};
const prepare = (text: string): string[] => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');

/** Claude Code's MEMORY.md: an index that only lists links and headings, never notes of its own. */
export function isMemoryIndex(fileName: string, text: string): boolean {
  if (baseName(fileName).toLowerCase() !== 'memory.md') return false;
  const body = prepare(text).filter(l => l.trim());
  return body.every(l => HEADING.test(l.trim()) || (BULLET.test(l) && /\]\(|\[\[/.test(l)));
}

const dedupe = (xs: string[]): string[] => {
  const seen = new Set<string>();
  return xs.filter(x => { const k = norm(x); if (!k || seen.has(k)) return false; seen.add(k); return true; });
};

/** Notes in one file or one pasted text. `fileName` names a note that has no name of its own. */
export function parseMemoryMd(fileName: string, text: string): NoteDraft[] {
  if (isMemoryIndex(fileName, text)) return [];
  const all = prepare(text);
  const { pre, found } = sections(all);
  if (found.length) {
    return found.flatMap((s): NoteDraft[] => {
      const f = s.front!;
      const heading = s.body.map(l => HEADING.exec(l.trim())).find(m => m?.[1] === '#');
      const name = str(f, 'name', 'title') || clean(heading?.[2] ?? '') || humanise(fileName);
      if (!name) return [];
      const draft: NoteDraft = {
        name,
        kind: kindOf(str(f, 'kind')) ?? kindOf(str(f, 'type')) ?? 'topic',
        aliases: dedupe(list(f, 'aliases', 'alias', 'aka')).filter(a => norm(a) !== norm(name)),
        private: /^(true|yes|1)$/i.test(str(f, 'private')),
        lines: bodyLines(s.body),
      };
      const description = str(f, 'description');
      if (description) draft.description = description;
      return [draft];
    });
  }
  // No frontmatter: split at the `##` headings; with none, at `#` headings if there are several.
  const heads = pre.map((l, i) => ({ m: HEADING.exec(l.trim()), i })).filter(h => h.m && !/^(```|~~~)/.test(pre[h.i]!.trim()));
  const level = heads.some(h => h.m![1]!.length === 2) ? 2 : heads.filter(h => h.m![1]!.length === 1).length >= 2 ? 1 : 0;
  const titleHead = heads.find(h => h.m![1]!.length === 1);
  const title = titleHead ? clean(titleHead.m![2]!) : '';
  if (!level) {
    const lines = bodyLines(pre);
    const name = title || humanise(fileName);
    return name && lines.length ? [{ name, kind: 'topic', aliases: [], private: false, lines }] : [];
  }
  const cuts = heads.filter(h => h.m![1]!.length === level);
  const out: NoteDraft[] = [];
  // What stands before the first section belongs to the document itself (named by its `#` title or the file).
  const preface = bodyLines(pre.slice(0, cuts[0]!.i));
  if (preface.length) out.push({ name: title || humanise(fileName), kind: 'topic', aliases: [], private: false, lines: preface });
  cuts.forEach((h, k) => {
    const name = clean(h.m![2]!).replace(/:$/, '').trim();
    const lines = bodyLines(pre.slice(h.i + 1, cuts[k + 1]?.i ?? pre.length));
    if (name && lines.length) out.push({ name, kind: PROFILE_HEADING.test(norm(name)) ? 'profile' : 'topic', aliases: [], private: false, lines });
  });
  return out;
}

// ---------- merging ----------

export interface Gen { id(prefix: string): string; now(): string }

export interface MergePlan {
  /** Notes to make, with every field. */
  creates: MemoryNote[];
  /** Notes that exist, with what changes: the whole `lines` (old ones first, untouched), and only fields that gained something. */
  updates: { id: string; patch: Partial<MemoryNote> }[];
  /** One row per note named by a draft, in order: what the summary lists. */
  rows: { name: string; status: 'new' | 'merged' | 'same'; added: number }[];
  /** Notes made, notes that gained something, notes that had it all already, lines added. */
  counts: { created: number; merged: number; same: number; lines: number };
}

interface Work {
  id: string | null;
  note: MemoryNote;
  lines: MemoryLine[];
  seen: Set<string>;
  added: number;
  changed: Set<string>;
  keys: Set<string>;
}

/**
 * Put drafts into the notes that exist. A draft goes to the note with the same name or alias (case, accents
 * and punctuation ignored; the same name first), else it makes a note. Only lines not there yet are added
 * (compared the same way), after the old ones; nothing is edited or removed. A note gains the draft's
 * name and aliases as aliases, a description only if it has none, and becomes private if either was.
 * Drafts for the same subject in one import join each other. Lines are `by: 'me'` (it was the person's file).
 */
export function mergeNotes(existing: readonly (MemoryNote & { id: string })[], drafts: readonly NoteDraft[], gen: Gen): MergePlan {
  const keysOf = (n: { name: string; aliases: readonly string[] }) => new Set([n.name, ...n.aliases].map(norm).filter(Boolean));
  const works: Work[] = existing.map(n => ({
    id: n.id, note: n, lines: [...n.lines], seen: new Set(n.lines.map(l => norm(l.text))), added: 0, changed: new Set(), keys: keysOf(n),
  }));
  const touched: Work[] = [];
  const isNew = new Set<Work>();
  for (const d of drafts) {
    const dKeys = keysOf(d);
    if (!dKeys.size) continue;
    const dn = norm(d.name);
    let w = works.find(x => norm(x.note.name) === dn) ?? works.find(x => [...dKeys].some(k => x.keys.has(k)));
    const now = gen.now();
    if (!w) {
      const note: MemoryNote = { kind: d.kind, name: d.name.trim(), aliases: dedupe(d.aliases), lines: [], private: d.private, updated: now };
      if (d.description) note.description = d.description;
      w = { id: null, note, lines: [], seen: new Set(), added: 0, changed: new Set(), keys: keysOf(note) };
      works.push(w);
      isNew.add(w);
    } else {
      const aliases = [...w.note.aliases];
      for (const a of [d.name, ...d.aliases]) {
        const k = norm(a);
        if (k && !w.keys.has(k)) { aliases.push(a.trim()); w.keys.add(k); }
      }
      if (aliases.length !== w.note.aliases.length) { w.note = { ...w.note, aliases }; if (!isNew.has(w)) w.changed.add('aliases'); }
    }
    if (d.description && !w.note.description) { w.note = { ...w.note, description: d.description }; w.changed.add('description'); }
    if (d.private && !w.note.private) { w.note = { ...w.note, private: true }; w.changed.add('private'); }
    for (const text of d.lines) {
      const t = text.trim(), k = norm(t);
      if (!k || w.seen.has(k)) continue;
      w.seen.add(k);
      w.lines.push({ id: gen.id('l'), text: t, at: now, by: 'me' });
      w.added++;
      w.changed.add('lines');
    }
    if (!touched.includes(w)) touched.push(w);
  }
  const plan: MergePlan = { creates: [], updates: [], rows: [], counts: { created: 0, merged: 0, same: 0, lines: 0 } };
  const now = gen.now();
  for (const w of touched) {
    plan.counts.lines += w.added;
    if (isNew.has(w)) {
      plan.creates.push({ ...w.note, lines: w.lines, updated: now });
      plan.counts.created++;
      plan.rows.push({ name: w.note.name, status: 'new', added: w.added });
    } else if (w.changed.size) {
      const patch: Partial<MemoryNote> = { updated: now };
      if (w.changed.has('lines')) patch.lines = w.lines;
      if (w.changed.has('aliases')) patch.aliases = w.note.aliases;
      if (w.changed.has('description')) patch.description = w.note.description;
      if (w.changed.has('private')) patch.private = true;
      plan.updates.push({ id: w.id!, patch });
      plan.counts.merged++;
      plan.rows.push({ name: w.note.name, status: 'merged', added: w.added });
    } else {
      plan.counts.same++;
      plan.rows.push({ name: w.note.name, status: 'same', added: 0 });
    }
  }
  return plan;
}

// ---------- writing ----------

const KIND_ORDER = new Map(MEMORY_KINDS.map((k, i) => [k, i]));
const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ').trim();

/** A YAML scalar: plain when that is safe, else double-quoted (JSON escapes are valid YAML). */
function scalar(s: string): string {
  const v = oneLine(s);
  const plain = /^[\p{L}\p{N}][\p{L}\p{N} .,'’()/&+-]*$/u.test(v) && !/(: | #)/.test(v) && !/^(true|false|null|yes|no|on|off|~|[\d.+-]+)$/i.test(v) && v === v.trimEnd();
  return plain ? v : JSON.stringify(v);
}

/** One note as a Markdown document: frontmatter (name, description, kind, aliases, private), then one bullet per line. */
export function toMarkdown(note: MemoryNote): string {
  const head = ['---', 'name: ' + scalar(note.name)];
  if (note.description?.trim()) head.push('description: ' + scalar(note.description));
  head.push('kind: ' + note.kind);
  if (note.aliases.length) head.push('aliases:', ...note.aliases.map(a => '  - ' + scalar(a)));
  if (note.private) head.push('private: true');
  head.push('---', '');
  for (const l of note.lines) { const t = oneLine(l.text); if (t) head.push('- ' + t); }
  return head.join('\n') + '\n';
}

/** Notes as one document, profile first, then by kind and name. Private notes are left out unless asked for. */
export function bundle(notes: readonly MemoryNote[], includePrivate = false): string {
  return [...notes]
    .filter(n => includePrivate || !n.private)
    .sort((a, b) => (KIND_ORDER.get(a.kind)! - KIND_ORDER.get(b.kind)!) || a.name.localeCompare(b.name))
    .map(toMarkdown)
    .join('\n');
}
