import { describe, expect, it } from 'vitest';
import { parseCsv, parseTakeout } from './takeout';

const P = { placeId: 'paris' };
const ex = (id: string, name: string, o: Record<string, unknown> = {}) => ({ id, name, placeId: 'paris', mapsUrl: null, note: '', street: null, ...o });

describe('Takeout CSV', () => {
  it('reads the usual Saved list: Title, Note, URL, Tags, Comment', () => {
    const csv = 'Title,Note,URL,Tags,Comment\nCafé de Flore,Best hot chocolate,https://www.google.com/maps/place/Caf%C3%A9+de+Flore/data=!4m2,,Go early\n"Le ""Petit"" Zinc","two\nlines",https://maps.app.goo.gl/abc,,\n';
    const r = parseTakeout(csv, P);
    expect(r.counts).toEqual({ rows: 2, added: 2, skipped: 0, duplicates: 0, filled: 0 });
    expect(r.drafts[0]).toEqual({ name: 'Café de Flore', note: 'Best hot chocolate\nGo early', mapsUrl: 'https://www.google.com/maps/place/Caf%C3%A9+de+Flore/data=!4m2', street: null, needsName: false });
    expect(r.drafts[1]).toMatchObject({ name: 'Le "Petit" Zinc', note: 'two\nlines', mapsUrl: 'https://maps.app.goo.gl/abc' });
  });
  it('is tolerant of headers: another order, other names, a BOM, a semicolon, CRLF', () => {
    const csv = '﻿url;name;notes\r\nhttps://example.com/a;Chez A;nice\r\n;Chez B;\r\n';
    const r = parseTakeout(csv, P);
    expect(r.drafts.map(d => [d.name, d.note, d.mapsUrl])).toEqual([['Chez A', 'nice', 'https://example.com/a'], ['Chez B', '', null]]);
  });
  it('skips rows with neither title nor link, and takes the name from a link when there is no title', () => {
    const r = parseTakeout('Title,Note,URL\n,only a note,\n,,https://www.google.com/maps/place/Parc+Monceau/@1,2,3z\n,,https://maps.app.goo.gl/zzz\n', P);
    expect(r.counts).toMatchObject({ rows: 3, skipped: 1, added: 2 });
    expect(r.drafts[0]).toMatchObject({ name: 'Parc Monceau', needsName: false });
    expect(r.drafts[1]).toMatchObject({ name: '', needsName: true, mapsUrl: 'https://maps.app.goo.gl/zzz' });
  });
  it('reads a file with no header: a link is the link, the first other cell the title', () => {
    const r = parseTakeout('Chez Zed,https://example.com/z,good\n', P);
    expect(r.drafts[0]).toMatchObject({ name: 'Chez Zed', mapsUrl: 'https://example.com/z', note: 'good' });
  });
  it('parseCsv keeps newlines and commas inside quotes', () => {
    expect(parseCsv('a,"b,c","d\ne"\nf,g,h')).toEqual([['a', 'b,c', 'd\ne'], ['f', 'g', 'h']]);
  });
});

describe('Takeout JSON', () => {
  it('reads GeoJSON features', () => {
    const json = JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [2.3, 48.8] }, properties: { Title: 'Musée Rodin', 'Google Maps URL': 'http://maps.google.com/?cid=123', Comment: 'Garden', Location: { Address: '77 Rue de Varenne', 'Business Name': 'Rodin' } } },
      { type: 'Feature', properties: { name: 'Parc', google_maps_url: 'https://maps.google.com/?cid=456', note: 'Picnic' } },
      { type: 'Feature', properties: { Location: { 'Business Name': 'Only Business' } } },
      { type: 'Feature', properties: { Comment: 'nothing else' } },
    ] });
    const r = parseTakeout(json, P);
    expect(r.counts).toMatchObject({ rows: 4, added: 3, skipped: 1 });
    expect(r.drafts[0]).toEqual({ name: 'Musée Rodin', note: 'Garden', mapsUrl: 'http://maps.google.com/?cid=123', street: '77 Rue de Varenne', needsName: false });
    expect(r.drafts[1]).toMatchObject({ name: 'Parc', note: 'Picnic' });
    expect(r.drafts[2]).toMatchObject({ name: 'Only Business' });
  });
  it('reads a plain array and a wrapped list, and survives garbage', () => {
    expect(parseTakeout('[{"title":"A"},{"title":"B","url":"https://x.test/b"}]', P).drafts).toHaveLength(2);
    expect(parseTakeout('{"places":[{"name":"A"}]}', P).drafts).toHaveLength(1);
    expect(parseTakeout('{not json', P).counts.rows).toBe(0);
    expect(parseTakeout('', P).drafts).toEqual([]);
  });
});

describe('Takeout dedupe', () => {
  it('skips what is on the list by name in the place (accents and case ignored) or by link, and fills only empty fields', () => {
    const existing = [ex('a1', 'Café de Flore'), ex('a2', 'Other', { mapsUrl: 'https://maps.google.com/?cid=9', note: 'mine' }), ex('a3', 'Lyon café', { placeId: 'lyon' })];
    const csv = 'Title,Note,URL\ncafe de flore,Hot chocolate,https://x.test/flore\nSomething,theirs,https://maps.google.com/?cid=9/\nLyon café,,\n';
    const r = parseTakeout(csv, { ...P, existing });
    expect(r.counts).toEqual({ rows: 3, added: 1, skipped: 0, duplicates: 2, filled: 1 });
    expect(r.drafts.map(d => d.name)).toEqual(['Lyon café']);
    expect(r.fills).toEqual([{ id: 'a1', fields: { note: 'Hot chocolate', mapsUrl: 'https://x.test/flore' } }]);
  });
  it('dedupes within the file, and by Google\'s feature id when the links differ', () => {
    const csv = 'Title,URL\nA,https://www.google.com/maps/place/A/data=!1s0x47e:0x9f\nA,\nB,https://www.google.com/maps/place/B/data=!1s0x47e:0x9f\nC,\n';
    const r = parseTakeout(csv, P);
    expect(r.drafts.map(d => d.name)).toEqual(['A', 'C']);
    expect(r.counts.duplicates).toBe(2);
  });
});
