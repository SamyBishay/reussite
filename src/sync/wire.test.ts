import { describe, expect, it } from 'vitest';
import { create, merge, patch, remove } from '../data/doc';
import { createClock, tick, ZERO } from '../data/hlc';
import { SCHEMA_VERSION } from '../data/schema';
import { syntheticSpace, TODAY } from '../../relay/bench/synthetic';
import type { ChangeBatch, Snapshot, StoredDoc } from './protocol';
import { decodeBatch, decodeDoc, decodeSnapshot, encodeBatch, encodeDoc, encodeSnapshot, WIRE } from './wire';

const V = SCHEMA_VERSION;
const through = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
/** Same content whatever the key order. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const roundTrip = (d: StoredDoc, v = V): StoredDoc => decodeDoc(through(encodeDoc(d, v)), v);

const clock = createClock('phone0001');
const fresh = (id: string, fields: Record<string, unknown>) => create<Record<string, unknown>>(id, fields, V, tick(clock, 1_760_000_000_000)) as unknown as StoredDoc;

describe('wire encoding of documents', () => {
  it('a created document is its fields, one base clock and nothing else', () => {
    const d = fresh('t1', { title: 'Mail the agency', est: 10, note: '', project: 'inbox' });
    const w = encodeDoc(d, V);
    expect(w._h).toBe(d._hlc.title);
    expect(w._o).toBeUndefined();
    expect(w._hlc).toBeUndefined();
    expect(w._v).toBeUndefined(); // same as the blob's
    expect(roundTrip(d)).toEqual(d);
  });

  it('lists only the fields whose clock differs from the base', () => {
    const d = patch(fresh('t1', { title: 'a', est: 10, note: 'n', status: 'open' }), { status: 'done', note: 'later' }, clock, V) as unknown as StoredDoc;
    const w = encodeDoc(d, V);
    expect(Object.keys(w._o as object)).toHaveLength(2); // two and two: either clock may be the base
    expect(w._h).toBeDefined();
    expect(canon(roundTrip(d))).toBe(canon(d));
  });

  it('keeps tombstones, fields with no clock, clocks with no field, and an older _v', () => {
    const base = fresh('t1', { title: 'a', est: 10 });
    const cases: StoredDoc[] = [
      remove(base, clock) as unknown as StoredDoc,
      { ...base, loose: 'no clock for me', _v: 3 } as StoredDoc,
      { ...base, _hlc: { ...base._hlc, ghost: '0000000000009:0001:other' } } as StoredDoc,
      { id: 'x', _v: V, _hlc: {}, a: 1, b: null } as StoredDoc, // nothing has a clock
      { id: 'y', _v: V, _hlc: { a: ZERO }, a: 1, b: 2 } as StoredDoc, // only one has
      { id: 'z', _v: V, _hlc: {} } as StoredDoc, // no fields at all
      { ...base, nested: { deep: [1, { x: 2 }] }, arr: [], _del: '0000000000099:0000:zzz' } as StoredDoc,
    ];
    for (const d of cases) {
      const back = roundTrip(d);
      expect(canon(back)).toBe(canon(d));
      // merge() itself forgets a clock with no field, so compare what it keeps
      expect(canon(merge(back, d))).toBe(canon(merge(d, d)));
      expect(canon(merge(d, back))).toBe(canon(merge(d, d)));
    }
  });

  it('sends a document with a field named like the markers whole', () => {
    const d = { id: 'q', _v: V, _hlc: { _h: ZERO, a: ZERO }, _h: 'mine', a: 1 } as unknown as StoredDoc;
    const w = encodeDoc(d, V);
    expect(w._hlc).toBeDefined();
    expect(canon(roundTrip(d))).toBe(canon(d));
  });

  it('survives a few thousand random documents', () => {
    let seed = 11;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const clocks = ['0000000000001:0000:aaa', '0000000000002:0003:bbb', ZERO, '0000000000009:0000:connector'];
    for (let i = 0; i < 3000; i++) {
      const hlc: Record<string, string> = {};
      const d: Record<string, unknown> = { id: 'd' + i, _v: r() < 0.9 ? V : V - 1, _hlc: hlc };
      for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) {
        const present = r() < 0.7;
        if (present) d[k] = r() < 0.5 ? 'v' + i : r() < 0.5 ? null : [r()];
        if (r() < 0.8 && (present || r() < 0.2)) hlc[k] = clocks[Math.floor(r() * clocks.length)]!;
      }
      if (r() < 0.1) d._del = clocks[2];
      expect(canon(roundTrip(d as unknown as StoredDoc))).toBe(canon(d));
    }
  });
});

describe('wire encoding of batches and snapshots', () => {
  it('round trips a batch, and reads one from before generation 2 as it was', () => {
    const doc = fresh('t1', { title: 'a' });
    const batch: ChangeBatch = { v: V, device: 'phone0001', docs: [{ c: 'tasks', d: doc }, { c: 'days', d: fresh('2026-10-19', { date: '2026-10-19', plan: ['t1'] }) }] };
    const wire = through(encodeBatch(batch));
    expect(wire.f).toBe(WIRE);
    expect(canon(decodeBatch(wire))).toBe(canon(batch));
    const old = through(batch); // no f: whole documents
    expect(decodeBatch(old)).toBe(old);
    expect(canon(decodeBatch(through(old)))).toBe(canon(batch));
  });

  it('round trips a snapshot, with its header, and reads an old one as it was', () => {
    const docs = syntheticSpace(TODAY);
    const snap: Snapshot = { v: V, upto: 7, docs };
    const wire = through(encodeSnapshot(snap));
    const back = decodeSnapshot(wire);
    expect(back.upto).toBe(7);
    for (const [c, list] of Object.entries(docs)) {
      expect(back.docs[c]!.length).toBe(list.length);
      list.forEach((d, i) => expect(canon(back.docs[c]![i])).toBe(canon(d)));
    }
    const old = through(snap);
    expect(decodeSnapshot(old)).toBe(old);
  });

  it('is much smaller than whole documents', () => {
    const docs = syntheticSpace(TODAY);
    const whole = JSON.stringify({ v: V, upto: 1, docs }).length;
    const lean = JSON.stringify(encodeSnapshot({ v: V, upto: 1, docs })).length;
    expect(lean).toBeLessThan(whole * 0.55);
  });
});
