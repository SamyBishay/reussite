// Undo for an applied change-set (brief §10), one copy for the app and the connector. `UndoLog` keeps
// what each write replaced, field by field; `undoWrites` turns those records into the writes that put
// it back, and leaves alone any field changed since. Pure: the app (store.ts `recordWrites` and
// `applyUndo`) and the relay (Edits, `undo`) do the reading and writing.
import type { Collection, UndoDoc } from '../data/schema';
import { parse } from '../data/hlc';

type Fields = Record<string, unknown>;
/** A stored document as the log needs it: its fields, and the clock of each. */
type Doc = Fields & { _hlc: Record<string, string> };

/** How long after a change-set a timer it stopped may still be started again by Undo (Home's ten minutes). */
export const FRESH_MS = 10 * 60_000;

/** Collects the records of one change-set's writes, one per document. */
export class UndoLog {
  readonly docs: UndoDoc[] = [];
  private by = new Map<string, UndoDoc>();

  private mark(c: Collection, id: string, u: UndoDoc): UndoDoc {
    const key = c + '/' + id;
    const have = this.by.get(key);
    if (have) {
      if (u.removed) have.removed = true;
      return have;
    }
    this.by.set(key, u);
    this.docs.push(u);
    return u;
  }
  /** `at` is the newest clock this change-set wrote on the document: anything newer was written since. */
  private stamp(u: UndoDoc, at: string | undefined) { if (at && (!u.at || at > u.at)) u.at = at; }

  created(c: Collection, id: string, doc?: Doc): void {
    const u = this.mark(c, id, { c, id, created: true });
    if (doc) for (const h of Object.values(doc._hlc)) this.stamp(u, h);
  }
  removed(c: Collection, id: string): void { this.mark(c, id, { c, id, removed: true }); }

  /** `keys` are the fields the edit named; only those whose clock moved really changed. `was` is null for a field the document didn't have. */
  updated(c: Collection, id: string, cur: Doc, next: Doc, keys: Iterable<string>): void {
    const u = this.mark(c, id, { c, id, fields: {} });
    for (const k of keys) {
      if (next._hlc[k] === cur._hlc[k]) continue; // unchanged: no new clock
      u.fields ??= {};
      u.fields[k] ??= { was: k in cur ? cur[k] ?? null : null, now: null };
      u.fields[k]!.now = next[k] ?? null;
      this.stamp(u, next._hlc[k]);
    }
  }
}

/** One write that puts something back: fields to set, or the document to tombstone. `kept` are the fields left alone because they changed since (for a document the change-set made, the fields written to it since: it stays). */
export interface UndoStep {
  c: Collection;
  id: string;
  patch?: Fields;
  remove?: true;
  kept?: string[];
  /** Made by the change-set but kept, because something made since refers to it. */
  inUse?: true;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface UndoOpts {
  /** The time now (ms). Without it every timer is treated as stale. */
  now?: number;
  /** Whether something outside these records refers to the document (a session logged on a step the change-set made). */
  used?: (c: Collection, id: string) => boolean;
}

type Live = Fields & { _hlc?: Record<string, string> };

/** Fields written after the change-sets, by their clocks (`at`, the newest clock they wrote on it); [] when the caller gave no clocks. */
function since(at: string | undefined, cur: Live): string[] {
  const hlc = cur._hlc;
  if (!hlc) return [];
  const clocks = Object.values(hlc);
  if (!clocks.length) return [];
  const upto = at ?? clocks.reduce((a, b) => (a < b ? a : b)); // no `at` (an older record): the creation clock
  return Object.keys(hlc).filter(k => hlc[k]! > upto);
}

/**
 * The writes that undo `docs` (the records of one change-set, or of several in the order they were
 * applied), last first. `get` returns the live document now with its clocks (undefined for none or a
 * tombstone); each step is planned on what the steps before it leave. Something created is tombstoned
 * (never hard-deleted), but only if nothing was written to it since and nothing else refers to it:
 * otherwise it stays, and the fields written since count as kept. A field is put back only if it
 * still holds what the change-set wrote. A timer the change-set stopped is started again only within
 * FRESH_MS of it; after that `started` stays empty and the session that saved the timer's time stays.
 * A document removed by the change-set stays removed: a tombstone has no way back.
 */
export function undoWrites(docs: UndoDoc[], get: (c: Collection, id: string) => Live | undefined, o: UndoOpts = {}): UndoStep[] {
  const stale = (d: UndoDoc) => o.now === undefined || !d.at || o.now - parse(d.at).wall > FRESH_MS;
  // Steps whose stopped timer is not started again: the time it ran stays logged.
  const timed = new Set(docs.filter(d => d.c === 'tasks' && d.fields?.started && d.fields.started.was != null && stale(d)).map(d => d.id));
  const lastAt = new Map<string, string>();
  for (const d of docs) { const k = d.c + '/' + d.id; if (d.at && d.at > (lastAt.get(k) ?? '')) lastAt.set(k, d.at); }
  const view = new Map<string, Live | undefined>();
  const read = (d: UndoDoc) => { const k = d.c + '/' + d.id; return view.has(k) ? view.get(k) : get(d.c, d.id); };
  const out: UndoStep[] = [];
  for (const d of [...docs].reverse()) {
    const key = d.c + '/' + d.id;
    const cur = read(d);
    if (d.created) {
      if (!cur) continue;
      if (d.c === 'sessions' && timed.has(String(cur.taskId))) continue;
      const later = since(lastAt.get(key), cur);
      if (later.length) out.push({ c: d.c, id: d.id, kept: later });
      else if (o.used?.(d.c, d.id)) out.push({ c: d.c, id: d.id, inUse: true });
      else { out.push({ c: d.c, id: d.id, remove: true }); view.set(key, undefined); }
      continue;
    }
    if (!cur || !d.fields) continue;
    const patch: Fields = {};
    const kept: string[] = [];
    for (const [k, f] of Object.entries(d.fields)) {
      if (k === 'started' && f.was != null && timed.has(d.id)) continue;
      if (same(cur[k], f.now)) patch[k] = f.was; else kept.push(k);
    }
    if (Object.keys(patch).length) view.set(key, { ...cur, ...patch }); // its clocks stay: the write is the undo's own
    if (Object.keys(patch).length || kept.length) out.push({ c: d.c, id: d.id, ...(Object.keys(patch).length ? { patch } : {}), ...(kept.length ? { kept } : {}) });
  }
  return out;
}
