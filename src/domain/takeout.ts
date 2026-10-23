// Google Takeout "Saved" lists (brief §5, Addresses: import once). The export comes as CSV or as GeoJSON/JSON and
// varies by account, so this takes whatever title, note and link are present and ignores the rest. Pure: it
// reads text and returns drafts and counts; writing them is the app's job, and an import only adds (merge,
// never replace, invariant 1).
import { norm } from './names';
import { readMapsLink } from './mapsLink';
import type { Address } from '../data/schema';

export interface AddressDraft {
  name: string;
  note: string;
  mapsUrl: string | null;
  street: string | null;
  /** The link had no name and there was no title: the screen must ask for one. */
  needsName: boolean;
}

/** Empty fields of an address already on the list that this import can fill; never a field that has a value. */
export interface AddressFill { id: string; fields: Partial<Pick<Address, 'note' | 'mapsUrl' | 'street'>> }

export interface TakeoutResult {
  drafts: AddressDraft[];
  fills: AddressFill[];
  counts: {
    /** Rows read (a header is not a row). */
    rows: number;
    /** New addresses to write: `drafts.length`. */
    added: number;
    /** Rows with neither a title nor a link. */
    skipped: number;
    /** Rows already on the list (or earlier in the file), by name in the place or by link. */
    duplicates: number;
    /** Of those, existing addresses that gain a note, link or street. */
    filled: number;
  };
}

interface Row { title: string; note: string; url: string; street: string }

type Existing = Pick<Address, 'name' | 'placeId' | 'mapsUrl' | 'note' | 'street'> & { id: string };

/** Parse a file's text. `placeId` is where the new addresses go; `existing` is what is on the list now. */
export function parseTakeout(text: string, o: { placeId: string; existing?: Iterable<Existing> }): TakeoutResult {
  const body = text.replace(/^﻿/, '').trim();
  const rows = body.startsWith('{') || body.startsWith('[') ? jsonRows(body) : csvRows(body);

  const existing = [...(o.existing ?? [])];
  const byName = new Map<string, Existing>(), byLink = new Map<string, Existing>();
  for (const e of existing) {
    if (e.placeId === o.placeId && norm(e.name)) byName.set(norm(e.name), e);
    for (const k of linkKeys(e.mapsUrl)) byLink.set(k, e);
  }

  const drafts: AddressDraft[] = [], fills = new Map<string, AddressFill>();
  const counts = { rows: rows.length, added: 0, skipped: 0, duplicates: 0, filled: 0 };
  for (const r of rows) {
    if (!r.title && !r.url) { counts.skipped++; continue; }
    const read = r.url ? readMapsLink(r.url) : null;
    const name = r.title || read?.name || '';
    const street = r.street || read?.street || '';
    const same = (r.url ? linkKeys(r.url).map(k => byLink.get(k)).find(Boolean) : undefined) ?? (name ? byName.get(norm(name)) : undefined);
    if (same) {
      counts.duplicates++;
      const f: AddressFill['fields'] = {}, seen = fills.get(same.id)?.fields ?? {};
      if (!same.note && r.note && !seen.note) f.note = r.note;
      if (!same.mapsUrl && r.url && !seen.mapsUrl) f.mapsUrl = r.url;
      if (!same.street && street && !seen.street) f.street = street;
      if (Object.keys(f).length) {
        fills.set(same.id, { id: same.id, fields: { ...seen, ...f } });
        counts.filled = fills.size;
      }
      continue;
    }
    // Later rows of the file are checked against this one too.
    const draft: AddressDraft = { name, note: r.note, mapsUrl: r.url || null, street: street || null, needsName: !name };
    const entry: Existing = { id: 'draft' + drafts.length, name, placeId: o.placeId, mapsUrl: draft.mapsUrl, note: draft.note, street: draft.street };
    drafts.push(draft);
    if (name) byName.set(norm(name), entry);
    for (const k of linkKeys(draft.mapsUrl)) byLink.set(k, entry);
  }
  counts.added = drafts.length;
  return { drafts, fills: [...fills.values()], counts };
}

/** What identifies a place in a link: the link itself, and Google's feature id when it has one. */
function linkKeys(url: string | null | undefined): string[] {
  const u = (url ?? '').trim();
  if (!u) return [];
  const keys = [u.toLowerCase().replace(/#.*$/, '').replace(/\/+$/, '')];
  const ftid = /(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(u) ?? /[?&]cid=(\d+)/.exec(u);
  if (ftid) keys.push(ftid[1]!.toLowerCase());
  return keys;
}

// ---------- CSV ----------

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes; the separator is a comma or, failing that, a semicolon. */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const out: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim())) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim())) out.push(row);
  return out;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const HEAD: Record<string, keyof Row> = {
  title: 'title', name: 'title', placename: 'title', businessname: 'title',
  note: 'note', notes: 'note', comment: 'note', comments: 'note', description: 'note',
  url: 'url', link: 'url', googlemapsurl: 'url', mapsurl: 'url', maplink: 'url',
  address: 'street', street: 'street', streetaddress: 'street',
};
const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

function csvRows(text: string): Row[] {
  const grid = parseCsv(text);
  if (!grid.length) return [];
  const head = grid[0]!.map(h => HEAD[key(h)]);
  const hasHeader = head.includes('title') || head.includes('url');
  if (hasHeader) {
    const body = grid.slice(1);
    return body.map(cells => {
      const r: Row = { title: '', note: '', url: '', street: '' };
      const notes: string[] = [];
      head.forEach((h, i) => {
        const v = (cells[i] ?? '').trim();
        if (!h || !v) return;
        if (h === 'note') { if (!notes.includes(v)) notes.push(v); } else if (!r[h]) r[h] = v;
      });
      r.note = notes.join('\n');
      return r;
    });
  }
  // No header we know (or none at all): the first row is data, and a cell that starts with http is the link.
  return grid.map(cells => {
    const v = cells.map(c => c.trim()).filter(Boolean);
    const url = v.find(isUrl) ?? '';
    const rest = v.filter(c => c !== url);
    return { title: rest[0] ?? '', note: rest.slice(1).join('\n'), url, street: '' };
  });
}

// ---------- JSON ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The first value under any of these keys (case, spaces and underscores ignored), as text. */
function pick(o: Obj | undefined, keys: string[]): string {
  if (!o) return '';
  for (const [k, v] of Object.entries(o)) if (keys.includes(key(k)) && typeof v === 'string' && v.trim()) return v.trim();
  return '';
}
const sub = (o: Obj | undefined, keys: string[]): Obj | undefined => {
  if (!o) return undefined;
  for (const [k, v] of Object.entries(o)) if (keys.includes(key(k)) && isObj(v)) return v;
  return undefined;
};

function itemsOf(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (!isObj(json)) return [];
  if (Array.isArray(json.features)) return json.features;
  for (const v of Object.values(json)) if (Array.isArray(v) && v.some(isObj)) return v;
  return [];
}

function jsonRows(text: string): Row[] {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return []; }
  const rows: Row[] = [];
  for (const it of itemsOf(json)) {
    if (!isObj(it)) continue;
    const props = sub(it, ['properties']) ?? it;
    const loc = sub(props, ['location']);
    const notes: string[] = [];
    for (const n of [pick(props, ['note', 'notes']), pick(props, ['comment', 'comments'])]) if (n && !notes.includes(n)) notes.push(n);
    rows.push({
      title: pick(props, ['title', 'name', 'placename']) || pick(loc, ['businessname', 'name']),
      note: notes.join('\n'),
      url: pick(props, ['googlemapsurl', 'url', 'link', 'mapsurl']),
      street: pick(loc, ['address']) || pick(props, ['address']),
    });
  }
  return rows;
}
