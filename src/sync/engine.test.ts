import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, merge } from '../data/doc';
import { createClock, tick, ZERO } from '../data/hlc';
import { SCHEMA_VERSION } from '../data/schema';
import { applyIncoming, buildSnapshot, collectOutgoing, isSynced, snapshotDocs, SYNCED_COLLECTIONS } from './engine';
import type { ChangeDoc, StoredDoc } from './protocol';
import { FakeDevice } from './testing';

let t = 1_000_000;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(t); });
afterEach(() => { vi.useRealTimers(); });
const at = (ms: number) => vi.setSystemTime((t += ms));

/** One direction of a sync, through the engine only: what `from` wrote since `mark`, folded into `to`. */
function send(from: FakeDevice, to: FakeDevice, mark: string) {
  const out = collectOutgoing(Object.fromEntries(SYNCED_COLLECTIONS.map(c => [c, from.docs.get(c)?.values() ?? []])), from.clock.node, mark);
  deliver(to, out.docs);
  return out.watermark;
}
function deliver(to: FakeDevice, docs: ChangeDoc[]) {
  const local: Record<string, Map<string, StoredDoc>> = {};
  for (const { c, d } of docs) local[c] ??= new Map(to.docs.get(c));
  const r = applyIncoming(local, docs, to.clock);
  for (const w of r.writes) (to.docs.get(w.c) ?? to.docs.set(w.c, new Map()).get(w.c)!).set(w.d.id, w.d);
  return r;
}

describe('which collections sync', () => {
  it('is every schema collection with settings, and never local or backups', () => {
    expect([...SYNCED_COLLECTIONS]).toContain('meta');
    expect([...SYNCED_COLLECTIONS]).toContain('tasks');
    for (const c of ['local', 'backups', 'sync', 'keys']) expect(isSynced(c)).toBe(false);
  });
});

describe('merging partial documents', () => {
  const base: StoredDoc = create<Record<string, unknown>>('t1', { title: 'A', est: 10, note: 'n' }, SCHEMA_VERSION, tick(createClock('z'), 100));
  const partial = (id: string, node: string, wall: number, fields: Record<string, unknown>) => {
    const h = tick(createClock(node), wall);
    return { ...fields, id, _v: SCHEMA_VERSION, _hlc: Object.fromEntries(Object.keys(fields).map(k => [k, h])) } as StoredDoc;
  };

  it('a field missing on one side keeps the other side', () => {
    const m = merge(base, partial('t1', 'a', 200, { est: 30 }));
    expect(m).toMatchObject({ title: 'A', est: 30, note: 'n' });
    expect(m._hlc.title).toBe(base._hlc.title);
    const m2 = merge(partial('t1', 'a', 200, { est: 30 }), base);
    expect(m2).toMatchObject({ title: 'A', est: 30, note: 'n' });
  });

  it('is commutative, associative and idempotent on batches of partials', () => {
    const parts = [
      partial('t1', 'a', 200, { title: 'A2' }),
      partial('t1', 'b', 200, { title: 'B2', est: 1 }),
      partial('t1', 'c', 150, { est: 2, note: 'c' }),
      { ...partial('t1', 'd', 300, {}), _del: tick(createClock('d'), 300) } as StoredDoc,
    ];
    const fold = (order: number[]) => order.map(i => parts[i]!).reduce((a, b) => merge(a, b), base);
    const ref = JSON.stringify(sorted(fold([0, 1, 2, 3])));
    for (const order of [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1], [0, 0, 1, 1, 2, 2, 3, 3]]) expect(JSON.stringify(sorted(fold(order)))).toBe(ref);
    const twice = parts.concat(parts).reduce((a, b) => merge(a, b), base);
    expect(JSON.stringify(sorted(twice))).toBe(ref);
    expect(twice._del).toBeDefined();
  });
});

const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sorted(x)])) : v);

describe('collectOutgoing', () => {
  it('sends only own fields above the watermark, as partial documents', () => {
    const a = new FakeDevice('aaa'), b = new FakeDevice('bbb');
    a.add('tasks', 't1', { title: 'One', est: 5 });
    const w1 = send(a, b, '');
    at(10);
    b.edit('tasks', 't1', { est: 20 });
    at(10);
    a.edit('tasks', 't1', { title: 'Uno' });

    const out = collectOutgoing({ tasks: a.docs.get('tasks')!.values() }, 'aaa', w1);
    expect(out.docs).toHaveLength(1);
    const d = out.docs[0]!.d;
    expect(d).toMatchObject({ id: 't1', title: 'Uno' });
    expect(Object.keys(d._hlc)).toEqual(['title']);
    expect('est' in d).toBe(false);
    expect(out.watermark).toBe(d._hlc.title);
  });

  it('never emits fields written by other nodes, nor imported ones, unless asked', () => {
    const a = new FakeDevice('aaa'), b = new FakeDevice('bbb');
    b.add('tasks', 't1', { title: 'Theirs' });
    send(b, a, '');
    expect(a.get('tasks', 't1')).toBeDefined();
    const imported = create<Record<string, unknown>>('t2', { title: 'Imported' }, SCHEMA_VERSION, ZERO);
    a.docs.get('tasks')!.set('t2', imported);
    const all = { tasks: a.docs.get('tasks')!.values() };
    expect(collectOutgoing(all, 'aaa', '').docs).toEqual([]);
    const imp = collectOutgoing({ tasks: a.docs.get('tasks')!.values() }, 'aaa', '', { imported: true });
    expect(imp.docs.map(x => x.d.id)).toEqual(['t2']);
  });

  it('keeps the watermark when there is nothing to send, and sends a deletion', () => {
    const a = new FakeDevice('aaa');
    a.add('tasks', 't1', { title: 'One' });
    const first = collectOutgoing({ tasks: a.docs.get('tasks')!.values() }, 'aaa', '');
    const again = collectOutgoing({ tasks: a.docs.get('tasks')!.values() }, 'aaa', first.watermark);
    expect(again).toEqual({ docs: [], watermark: first.watermark });
    at(5);
    a.del('tasks', 't1');
    const del = collectOutgoing({ tasks: a.docs.get('tasks')!.values() }, 'aaa', first.watermark);
    expect(del.docs).toHaveLength(1);
    expect(del.docs[0]!.d._del).toBeDefined();
    expect(Object.keys(del.docs[0]!.d._hlc)).toEqual([]);
    expect(del.watermark).toBe(del.docs[0]!.d._del);
  });

  it('survives JSON, so it can be encrypted as is', () => {
    const a = new FakeDevice('aaa');
    a.add('days', '2026-10-19', { date: '2026-10-19', plan: ['x', 'y'], first: null });
    const out = collectOutgoing({ days: a.docs.get('days')!.values() }, 'aaa', '');
    expect(JSON.parse(JSON.stringify(out.docs))).toEqual(out.docs);
  });
});

describe('applyIncoming', () => {
  it('moves the clock past every received timestamp', () => {
    const a = new FakeDevice('aaa'), b = new FakeDevice('bbb');
    b.clock.wall = 9_000_000_000_000;
    b.add('tasks', 't1', { title: 'Future' });
    send(b, a, '');
    expect(a.clock.wall).toBeGreaterThanOrEqual(9_000_000_000_000);
    a.edit('tasks', 't1', { title: 'After' });
    expect(a.get('tasks', 't1')!.title).toBe('After'); // wins over the future write
  });

  it('writes nothing when nothing changes', () => {
    const a = new FakeDevice('aaa'), b = new FakeDevice('bbb');
    a.add('tasks', 't1', { title: 'One' });
    const out = collectOutgoing({ tasks: a.docs.get('tasks')!.values() }, 'aaa', '');
    expect(deliver(b, out.docs).writes).toHaveLength(1);
    expect(deliver(b, out.docs).writes).toHaveLength(0);
  });

  it('reports a newer schema and applies nothing', () => {
    const a = new FakeDevice('aaa');
    const newer = create<Record<string, unknown>>('t9', { title: 'Future' }, SCHEMA_VERSION + 1, tick(createClock('z'), 5));
    const ok = create<Record<string, unknown>>('t8', { title: 'Fine' }, SCHEMA_VERSION, tick(createClock('z'), 5));
    const r = applyIncoming({}, [{ c: 'tasks', d: ok }, { c: 'tasks', d: newer }], a.clock);
    expect(r).toEqual({ writes: [], newer: true, skipped: 0 });
  });

  it('leaves out unknown collections and malformed documents', () => {
    const a = new FakeDevice('aaa');
    const ok = create<Record<string, unknown>>('t8', { title: 'Fine' }, SCHEMA_VERSION, tick(createClock('z'), 5));
    const r = applyIncoming({}, [{ c: 'local' as never, d: ok }, { c: 'tasks', d: { id: 'x' } as never }, { c: 'tasks', d: ok }], a.clock);
    expect(r.skipped).toBe(2);
    expect(r.writes.map(w => w.d.id)).toEqual(['t8']);
  });

  it('keeps fields it does not know', () => {
    const a = new FakeDevice('aaa'), b = new FakeDevice('bbb');
    b.add('tasks', 't1', { title: 'One', futureField: { x: 1 } });
    send(b, a, '');
    expect(a.get('tasks', 't1')).toMatchObject({ futureField: { x: 1 } });
  });
});

describe('two devices', () => {
  function offlineEdits() {
    vi.setSystemTime((t = 2_000_000)); // same times in every run, so runs can be compared
    const a = new FakeDevice('aaa'), b = new FakeDevice('bbb');
    a.add('tasks', 't1', { title: 'Shared', est: 10, note: '', plan: ['x'] });
    a.add('tasks', 't2', { title: 'Doomed', est: 5 });
    a.add('days', 'd1', { date: 'd1', plan: ['t1'] });
    let wa = send(a, b, ''), wb = '';
    at(1000);
    // Offline: both edit.
    b.edit('tasks', 't1', { title: 'Shared by B', plan: ['y', 'z'] }); // same field as A's title, later or earlier
    at(5);
    a.edit('tasks', 't1', { title: 'Shared by A', est: 25 });
    at(5);
    b.edit('tasks', 't1', { note: 'only B' });
    b.del('tasks', 't2'); // B deletes while A edits it
    at(5);
    a.edit('tasks', 't2', { est: 99 });
    a.add('tasks', 't3', { title: 'Only on A' });
    b.add('tasks', 't4', { title: 'Only on B' });
    b.add('meta', 'settings', { theme: 'dark' });
    return { a, b, wa, wb };
  }

  it('converge to identical state, whichever side sends first', () => {
    const one = offlineEdits();
    send(one.a, one.b, one.wa);
    send(one.b, one.a, one.wb);
    expect(one.a.dump()).toEqual(one.b.dump());

    const two = offlineEdits();
    send(two.b, two.a, two.wb);
    send(two.a, two.b, two.wa);
    expect(two.a.dump()).toEqual(two.b.dump());
    expect(two.a.dump()).toEqual(one.a.dump());

    const s = one.a;
    expect(s.get('tasks', 't1')).toMatchObject({ title: 'Shared by A', est: 25, note: 'only B', plan: ['y', 'z'] }); // A's title is later; arrays replace whole
    expect(s.get('tasks', 't2')!._del).toBeDefined(); // the deletion stands; A's edit is kept inside the tombstone
    expect(s.get('tasks', 't2')).toMatchObject({ est: 99 });
    expect(s.get('tasks', 't3')).toBeDefined();
    expect(s.get('tasks', 't4')).toBeDefined();
    expect(s.get('meta', 'settings')).toMatchObject({ theme: 'dark' });
  });

  it('converge when the same batches arrive twice or out of order', () => {
    const { a, b, wa, wb } = offlineEdits();
    const outA = collectOutgoing({ tasks: a.docs.get('tasks')!.values(), days: a.docs.get('days')!.values(), meta: [] }, 'aaa', wa);
    const outB = collectOutgoing({ tasks: b.docs.get('tasks')!.values(), meta: b.docs.get('meta')!.values() }, 'bbb', wb);
    deliver(a, [...outB.docs].reverse());
    deliver(a, outB.docs);
    deliver(b, outA.docs);
    deliver(b, outA.docs);
    deliver(b, [...outA.docs].reverse());
    deliver(a, outB.docs);
    expect(a.dump()).toEqual(b.dump());
  });

  it('a later sync after more edits keeps them converged', () => {
    const { a, b, wa, wb } = offlineEdits();
    let ma = send(a, b, wa), mb = send(b, a, wb);
    for (let i = 0; i < 5; i++) {
      at(10);
      (i % 2 ? a : b).edit('tasks', 't1', { est: i });
      ma = send(a, b, ma); mb = send(b, a, mb);
    }
    expect(a.dump()).toEqual(b.dump());
    expect(a.get('tasks', 't1')!.est).toBe(4);
  });
});

describe('a restored device', () => {
  it('gets everything back from a snapshot and later batches', () => {
    const a = new FakeDevice('aaa');
    a.add('tasks', 't1', { title: 'One', est: 5 });
    a.add('projects', 'p1', { name: 'P' });
    a.add('meta', 'settings', { language: 'fr' });
    at(10);
    a.del('tasks', 't1');
    const snap = buildSnapshot({ tasks: a.docs.get('tasks')!.values(), projects: a.docs.get('projects')!.values(), meta: a.docs.get('meta')!.values() }, 3);
    at(10);
    a.add('tasks', 't2', { title: 'After the snapshot' });
    a.edit('projects', 'p1', { name: 'P2' });
    const later = collectOutgoing({ tasks: a.docs.get('tasks')!.values(), projects: a.docs.get('projects')!.values() }, 'aaa', snap.docs.tasks!.map(d => d._del).sort().pop()!).docs;

    const fresh = new FakeDevice('new-node');
    const r = deliver(fresh, JSON.parse(JSON.stringify([...snapshotDocs(snap), ...later])));
    expect(r.newer).toBe(false);
    expect(fresh.dump()).toEqual(a.dump());
    // and the restored device has nothing of its own to send
    expect(collectOutgoing(Object.fromEntries(SYNCED_COLLECTIONS.map(c => [c, fresh.docs.get(c)?.values() ?? []])), 'new-node', '').docs).toEqual([]);
  });
});
