// Writes to Memory (brief §10): the person's own edits to their notes, and the import. Every write goes
// through store.ts. Forget empties a note's text before the tombstone and is never recorded for Undo
// (`recordWrites` keeps the text it replaced: "Forget deletes, it never softens").
import { db, memory, createDoc, update, removeDoc, newId } from './store';
import { fieldsOf } from '../data/doc';
import { normNote } from '../data/normalize';
import type { MemoryKind, MemoryLine, MemoryNote } from '../data/schema';
import { norm } from '../domain/names';
import type { MergePlan } from '../domain/memoryMd';

const stamp = () => new Date().toISOString();

/** The note as stored now (not as the screen last saw it), so two quick edits don't overwrite each other. */
async function current(id: string): Promise<MemoryNote | null> {
  const d = await db.table_('memory').get(id);
  return d && !d._del ? normNote(fieldsOf(d) as Record<string, unknown>) : null;
}

const edit = (id: string, changes: Partial<MemoryNote>) => update<MemoryNote>('memory', id, { ...changes, updated: stamp() });

/** A new, empty note; its id, or null when the name is empty. */
export async function addNote(name: string, kind: MemoryKind): Promise<string | null> {
  const n = name.trim();
  if (!n) return null;
  const note: MemoryNote = { kind, name: n, aliases: [], lines: [], private: false, updated: stamp() };
  return createDoc('memory', note);
}

export async function renameNote(id: string, name: string): Promise<void> {
  const n = name.trim();
  if (n) await edit(id, { name: n });
}
export const setKind = (id: string, kind: MemoryKind) => edit(id, { kind });
export const setPrivate = (id: string, on: boolean) => edit(id, { private: on });

export async function addAlias(id: string, alias: string): Promise<void> {
  const a = alias.trim(), cur = await current(id);
  if (!a || !cur || [cur.name, ...cur.aliases].some(x => norm(x) === norm(a))) return;
  await edit(id, { aliases: [...cur.aliases, a] });
}
export async function removeAlias(id: string, alias: string): Promise<void> {
  const cur = await current(id);
  if (cur) await edit(id, { aliases: cur.aliases.filter(a => a !== alias) });
}

export async function addLine(id: string, text: string): Promise<void> {
  const t = text.trim(), cur = await current(id);
  if (!t || !cur) return;
  const line: MemoryLine = { id: newId('l'), text: t, at: stamp(), by: 'me' };
  await edit(id, { lines: [...cur.lines, line] });
}

/** The person's own words now, so the line is theirs (`by: 'me'`) even if an AI wrote it first. An empty text forgets the line. */
export async function editLine(id: string, lineId: string, text: string): Promise<void> {
  const t = text.trim(), cur = await current(id);
  if (!cur) return;
  const old = cur.lines.find(l => l.id === lineId);
  if (!old || old.text === t) return;
  if (!t) return forgetLine(id, lineId);
  await edit(id, { lines: cur.lines.map(l => (l.id === lineId ? { ...l, text: t, by: 'me' as const } : l)) });
}

/** Forget one line: it is gone from the note (the old text is not kept anywhere in the app). */
export async function forgetLine(id: string, lineId: string): Promise<void> {
  const cur = await current(id);
  if (cur) await edit(id, { lines: cur.lines.filter(l => l.id !== lineId) });
}

/** Forget a whole note: its text is emptied first, then the document is tombstoned (a tombstone keeps every field). */
export async function forgetNote(id: string): Promise<void> {
  if (!(await current(id))) return;
  await update<MemoryNote>('memory', id, { name: '', aliases: [], lines: [], description: '', private: false, updated: stamp() });
  await removeDoc('memory', id);
}

/** Write what an import's plan says: new notes, and the lines and aliases a matched note gains. */
export async function applyImport(plan: MergePlan): Promise<void> {
  for (const u of plan.updates) await update<MemoryNote>('memory', u.id, u.patch);
  for (const c of plan.creates) await createDoc('memory', c);
}

export const liveNotes = () => [...memory.value.values()];
