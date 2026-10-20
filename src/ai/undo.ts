// Undo for an applied change-set (brief §10), one copy for the app and the connector. `UndoLog` keeps
// what each write replaced, field by field; `undoWrites` turns those records into the writes that put
// it back, and leaves alone any field changed since. Pure: the app (store.ts `recordWrites` and
// `applyUndo`) and the relay (Edits, `undo`) do the reading and writing.
import type { Collection, UndoDoc } from '../data/schema';

type Fields = Record<string, unknown>;
/** A stored document as the log needs it: its fields, and the clock of each. */
type Doc = Fields & { _hlc: Record<string, string> };

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

  created(c: Collection, id: string): void { this.mark(c, id, { c, id, created: true }); }
  removed(c: Collection, id: string): void { this.mark(c, id, { c, id, removed: true }); }

  /** `keys` are the fields the edit named; only those whose clock moved really changed. `was` is null for a field the document didn't have. */
  updated(c: Collection, id: string, cur: Doc, next: Doc, keys: Iterable<string>): void {
    const u = this.mark(c, id, { c, id, fields: {} });
    for (const k of keys) {
      if (next._hlc[k] === cur._hlc[k]) continue; // unchanged: no new clock
      u.fields ??= {};
      u.fields[k] ??= { was: k in cur ? cur[k] ?? null : null, now: null };
      u.fields[k]!.now = next[k] ?? null;
    }
  }
}

/** One write that puts something back: fields to set, or the document to tombstone. `kept` are the fields left alone because they changed since. */
export interface UndoStep {
  c: Collection;
  id: string;
  patch?: Fields;
  remove?: true;
  kept?: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The writes that undo `docs`, last first. `get` returns the live document now (undefined for none or
 * a tombstone). Something created is tombstoned (never hard-deleted); a field is put back only if it
 * still holds what the change-set wrote. A document removed by the change-set stays removed: a
 * tombstone has no way back.
 */
export function undoWrites(docs: UndoDoc[], get: (c: Collection, id: string) => Fields | undefined): UndoStep[] {
  const out: UndoStep[] = [];
  for (const d of [...docs].reverse()) {
    const cur = get(d.c, d.id);
    if (d.created) {
      if (cur) out.push({ c: d.c, id: d.id, remove: true });
      continue;
    }
    if (!cur || !d.fields) continue;
    const patch: Fields = {};
    const kept: string[] = [];
    for (const [k, f] of Object.entries(d.fields)) {
      if (same(cur[k], f.now)) patch[k] = f.was; else kept.push(k);
    }
    if (Object.keys(patch).length || kept.length) out.push({ c: d.c, id: d.id, ...(Object.keys(patch).length ? { patch } : {}), ...(kept.length ? { kept } : {}) });
  }
  return out;
}
