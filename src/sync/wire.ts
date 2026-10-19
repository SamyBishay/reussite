// The wire encoding of documents inside batches and snapshots (generation 2; docs/dev/sync.md).
// Stored documents keep one HLC per field (about 27 characters each), which is 70% of a snapshot.
// On the wire a document carries one base clock and only the fields that differ from it:
//
//   { id, _v?, _del?, _h?: base, _o?: { field: clock | 0 }, ...fields }
//
// `_h` is the clock of every field that is present and not listed in `_o`; `_o` maps a field to
// its own clock, or to 0 for "present with no clock", and also carries clocks of fields the
// document doesn't hold. `_v` is left out when it equals the blob's `v`. Decoding gives back
// exactly what `merge()` needs (`_hlc` and all); nothing about the stored shape changes.
//
// A document that can't be encoded this way (it has a field named `_h` or `_o`) travels in the
// old whole form, which has `_hlc`; the decoder passes such entries through. Blobs written before
// generation 2 have no `f`, and are read as they always were.
import { isMetaKey } from '../data/doc';
import type { Collection } from '../data/schema';
import type { ChangeBatch, ChangeDoc, Snapshot, StoredDoc } from './protocol';

/** The wire generation this code writes. Its blobs use the crypto format bytes 3 and 4, which older apps refuse to open. */
export const WIRE = 2;

export type WireDoc = Record<string, unknown>;
export interface WireBatch { f: typeof WIRE; v: number; device: string; docs: { c: Collection; d: WireDoc }[] }
export type WireSnapshot = Omit<Snapshot, 'docs'> & { f: typeof WIRE; docs: Record<string, WireDoc[]> };

const LEAN_META = new Set(['id', '_v', '_del', '_h', '_o']);

/** The clock most fields carry (the newest of any tie), or undefined if no field has one. */
function baseClock(hlc: Record<string, string>): string | undefined {
  const n = new Map<string, number>();
  let best: string | undefined, bestN = 0;
  for (const h of Object.values(hlc)) {
    if (typeof h !== 'string') continue;
    const c = (n.get(h) ?? 0) + 1;
    n.set(h, c);
    if (c > bestN || (c === bestN && best !== undefined && h > best)) { best = h; bestN = c; }
  }
  return best;
}

export function encodeDoc(d: StoredDoc, v: number): WireDoc {
  if ('_h' in d || '_o' in d) return d; // can't be told apart from the lean form: send it whole
  const hlc = (d._hlc ?? {}) as Record<string, string>;
  const base = baseClock(hlc);
  const out: WireDoc = {};
  const o: Record<string, string | 0> = {};
  for (const k of Object.keys(d)) {
    if (k === '_hlc') continue;
    if (k === '_v') { if (d._v !== v) out._v = d._v; continue; }
    if (d[k] === undefined) continue; // JSON would drop it; its clock, if any, goes below
    out[k] = d[k];
    if (isMetaKey(k)) continue;
    const h = hlc[k];
    if (base === undefined) { if (h !== undefined) o[k] = h; } // no base: every clocked field says its own
    else if (h === undefined) o[k] = 0;
    else if (h !== base) o[k] = h;
  }
  for (const k of Object.keys(hlc)) if (d[k] === undefined && hlc[k] !== undefined) o[k] = hlc[k]!; // a clock without a value
  if (base !== undefined) out._h = base;
  for (const _ in o) { out._o = o; break; }
  return out;
}

/** Decodes in place (the parsed object is ours) and returns it; a whole-form entry comes back unchanged. */
export function decodeDoc(w: WireDoc, v: number): StoredDoc {
  if (w._hlc !== undefined) return w as StoredDoc;
  const base = w._h as string | undefined;
  const o = w._o as Record<string, string | 0> | undefined;
  const hlc: Record<string, string> = {};
  for (const k in w) {
    if (LEAN_META.has(k)) continue;
    const x = o !== undefined && k in o ? o[k] : base;
    if (x) hlc[k] = x;
  }
  if (o) for (const k in o) if (!(k in w) && o[k]) hlc[k] = o[k] as string;
  delete w._h;
  delete w._o;
  w._hlc = hlc;
  if (w._v === undefined) w._v = v;
  return w as StoredDoc;
}

export function encodeBatch(b: ChangeBatch): WireBatch {
  return { f: WIRE, v: b.v, device: b.device, docs: b.docs.map(x => ({ c: x.c, d: encodeDoc(x.d, b.v) })) };
}

/** A decoded batch, whatever generation it was written in. */
export function decodeBatch(raw: unknown): ChangeBatch {
  const b = raw as ChangeBatch & { f?: number };
  if (b?.f !== WIRE) return b;
  for (const x of b.docs as ChangeDoc[]) x.d = decodeDoc(x.d as WireDoc, b.v);
  delete b.f;
  return b;
}

export function encodeSnapshot(s: Snapshot): WireSnapshot {
  const docs: Record<string, WireDoc[]> = {};
  for (const [c, list] of Object.entries(s.docs)) docs[c] = list.map(d => encodeDoc(d, s.v));
  return { ...s, f: WIRE, docs };
}

/** A decoded snapshot (or one part of it), whatever generation it was written in. */
export function decodeSnapshot(raw: unknown): Snapshot {
  const s = raw as Snapshot & { f?: number };
  if (s?.f !== WIRE) return s;
  for (const list of Object.values(s.docs)) for (let i = 0; i < list.length; i++) list[i] = decodeDoc(list[i] as WireDoc, s.v);
  delete s.f;
  return s;
}
