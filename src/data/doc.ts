// Every stored document carries its id, the schema version it was written with,
// one HLC per field (for merging between devices), and a tombstone instead of hard deletion.
import { type Clock, type Hlc, tick, max } from './hlc';

export interface Meta {
  id: string;
  _v: number;
  _hlc: Record<string, Hlc>;
  /** Set when deleted: the HLC of the deletion. Deleted docs are kept so the deletion syncs. */
  _del?: Hlc;
}

export type Stored<T> = T & Meta;

const META_KEYS = new Set(['id', '_v', '_hlc', '_del']);
export const isMetaKey = (k: string) => META_KEYS.has(k);

/** Strip the bookkeeping, leaving the document's own fields. */
export function fieldsOf<T>(doc: Stored<T>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!isMetaKey(k)) out[k] = v;
  return out as T;
}

export function create<T extends object>(id: string, fields: T, v: number, at: Hlc): Stored<T> {
  const hlc: Record<string, Hlc> = {};
  for (const k of Object.keys(fields)) hlc[k] = at;
  return { ...fields, id, _v: v, _hlc: hlc };
}

/** Apply a local edit. Only fields whose value actually changes get a new timestamp. */
export function patch<T extends object>(doc: Stored<T>, changes: Partial<T>, clock: Clock, v: number): Stored<T> {
  const next: Record<string, unknown> = { ...doc, _hlc: { ...doc._hlc }, _v: Math.max(doc._v, v) };
  const hlc = next._hlc as Record<string, Hlc>;
  let at: Hlc | null = null;
  for (const [k, val] of Object.entries(changes)) {
    if (isMetaKey(k)) continue;
    if (sameValue((doc as Record<string, unknown>)[k], val)) continue;
    at ??= tick(clock);
    next[k] = val;
    hlc[k] = at;
  }
  return next as Stored<T>;
}

export function remove<T>(doc: Stored<T>, clock: Clock): Stored<T> {
  return { ...doc, _del: tick(clock) };
}

/**
 * Per-field last-writer-wins. Commutative, associative and idempotent: merging in any
 * order, any number of times, gives the same document. Arrays replace whole.
 */
export function merge<T>(a: Stored<T>, b: Stored<T>): Stored<T> {
  const out: Record<string, unknown> = { id: a.id, _v: Math.max(a._v, b._v) };
  const hlc: Record<string, Hlc> = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter(k => !isMetaKey(k)));
  const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
  for (const k of keys) {
    const ha = a._hlc[k], hb = b._hlc[k];
    let pickB: boolean;
    if (ha === hb) pickB = stableKey(rb[k]) > stableKey(ra[k]); // same clock: break the tie on the value
    else pickB = ha === undefined || (hb !== undefined && hb > ha);
    out[k] = pickB ? rb[k] : ra[k];
    const h = pickB ? hb : ha;
    if (h !== undefined) hlc[k] = h;
  }
  out._hlc = hlc;
  const del = max(a._del, b._del);
  if (del !== undefined) out._del = del;
  return out as Stored<T>;
}

function stableKey(v: unknown): string {
  return v === undefined ? '' : JSON.stringify(v);
}
function sameValue(a: unknown, b: unknown): boolean {
  return stableKey(a) === stableKey(b);
}
