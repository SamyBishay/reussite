import { describe, expect, it } from 'vitest';
import { create, merge, patch, remove } from '../data/doc';
import { createClock, format, tick } from '../data/hlc';
import { SCHEMA_VERSION } from '../data/schema';
import { estPointsOf, type TaskW } from '../domain/lists';
import { HEAVY, syntheticSpace, TODAY, type Docs } from '../../relay/bench/synthetic';
import type { StoredDoc } from './protocol';
import { buildParts, EXCHANGE_MARGIN_MS, FULL_EVERY_MS, hotFrom, inCold, lateExchanges, split, touchesCold } from './parts';
import { decodeSnapshot, encodeSnapshot } from './wire';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const DAY = 86_400_000;
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const cut = { day: '2026-10-19', wall: NOW, coldUpto: 5 };
const ids = (m: Record<string, StoredDoc[]> | undefined, c: string) => new Set((m?.[c] ?? []).map(d => d.id));

/** Merge every document of both parts, by id, as a reader does. */
function union(...parts: Record<string, StoredDoc[]>[]): Record<string, Map<string, StoredDoc>> {
  const out: Record<string, Map<string, StoredDoc>> = {};
  for (const p of parts) for (const [c, list] of Object.entries(p)) for (const d of list) {
    const m = (out[c] ??= new Map());
    m.set(d.id, m.has(d.id) ? merge(m.get(d.id)!, d) : d);
  }
  return out;
}
const sameAs = (got: Record<string, Map<string, StoredDoc>>, all: Docs) => {
  for (const [c, list] of Object.entries(all)) {
    expect(got[c]?.size ?? 0, c).toBe(list.length);
    for (const d of list) expect(canon(got[c]!.get(d.id)), c + '/' + d.id).toBe(canon(d));
  }
};

describe('the split into hot and cold', () => {
  const all = syntheticSpace(TODAY);
  const { hot, cold } = split(all, cut);

  it('puts open steps, every project and setting, and recent days in hot', () => {
    expect(all.tasks!.filter(t => t.status === 'open').every(t => ids(hot, 'tasks').has(t.id))).toBe(true);
    for (const c of ['projects', 'decisions', 'places', 'stays', 'meta']) expect(hot[c]?.length ?? 0, c).toBe(all[c]!.length);
    const from = hotFrom(cut);
    for (const d of all.days!) expect(ids(hot, 'days').has(d.id), d.id).toBe(String(d.date) >= from);
  });

  it('puts old finished steps and their sessions in cold, recent ones in hot', () => {
    const from = hotFrom(cut);
    for (const t of all.tasks!.filter(t => t.status === 'done')) {
      const isHot = String(t.doneDay) >= from;
      expect(ids(hot, 'tasks').has(t.id), t.id).toBe(isHot);
      expect(ids(cold, 'tasks').has(t.id), t.id).toBe(!isHot);
    }
    for (const s of all.sessions!) expect(ids(hot, 'sessions').has(s.id) || ids(cold, 'sessions').has(s.id)).toBe(true);
    expect(cold.tasks!.length).toBeGreaterThan(50);
  });

  it('holds every document exactly once across the two, and merging them gives the whole', () => {
    for (const [c, list] of Object.entries(all)) expect((hot[c]?.length ?? 0) + (cold[c]?.length ?? 0), c).toBe(list.length);
    sameAs(union(hot, cold), all);
  });

  it('puts a document touched in the last 30 days in hot, whatever it is', () => {
    const clock = createClock('phone0001');
    const old = all.tasks!.find(t => t.status === 'done' && !ids(hot, 'tasks').has(t.id))!;
    const touched = patch(old, { note: 'changed today' }, clock, SCHEMA_VERSION, ) as unknown as StoredDoc;
    clock.wall = NOW; // patch() above used the real clock; make it the test's
    const t2 = { ...touched, _hlc: { ...touched._hlc, note: tick(clock, NOW - DAY) } } as StoredDoc;
    const s = split({ ...all, tasks: all.tasks!.map(t => (t.id === old.id ? t2 : t)) }, cut);
    expect(ids(s.hot, 'tasks').has(old.id)).toBe(true);
  });

  it('keeps the steps a hot day or a decision lists in hot, however old', () => {
    const old = all.tasks!.find(t => t.status === 'done' && !ids(hot, 'tasks').has(t.id))!;
    const days = all.days!.map(d => (d.date === '2026-10-19' ? { ...d, plan: [...(d.plan as string[]), old.id] } : d));
    expect(ids(split({ ...all, days }, cut).hot, 'tasks').has(old.id)).toBe(true);
    const decisions = all.decisions!.map((d, i) => (i ? d : { ...d, taskIds: [old.id] }));
    expect(ids(split({ ...all, decisions }, cut).hot, 'tasks').has(old.id)).toBe(true);
  });
});

describe('the parts to upload', () => {
  const all = syntheticSpace(HEAVY);

  it('writes both parts with no cut, and the cold ids and a digest in hot', () => {
    const p = buildParts(all, 12, { now: NOW });
    expect(p.cold?.part).toBe('cold');
    expect(p.hot).toMatchObject({ part: 'hot', upto: 12, cut: { day: '2026-10-19', wall: NOW, coldUpto: 12 } });
    expect(p.hot.docs.tasks!.length).toBeLessThan(all.tasks!.length * 0.5);
    expect(p.hot.docs.sessions!.length).toBeLessThan(all.sessions!.length * 0.2);
    for (const t of p.cold!.docs.tasks!) expect(inCold(p.hot.cold, 'tasks', t.id)).toBe(true);
    for (const t of p.hot.docs.tasks!) if (!p.cold!.docs.tasks!.includes(t)) expect(inCold(p.hot.cold, 'tasks', t.id)).toBe(false);
    expect(inCold(p.hot.cold, 'tasks', 'nope')).toBe(false);
    // the digest carries what the estimates need from the cold steps
    const coldDone = p.cold!.docs.tasks!.filter(t => t.status === 'done' && !t._del);
    const points = estPointsOf(coldDone as unknown as TaskW[], all.sessions as never);
    expect(p.hot.x!.est.length).toBe(points.filter(x => x.doneDay >= '2025-09-14').length);
    expect(Object.values(p.hot.x!.done).reduce((a, b) => a + b, 0)).toBe(coldDone.filter(t => !t.template).length);
  });

  it('writes only the hot part, with the same cut, while the cut is recent', () => {
    const first = buildParts(all, 12, { now: NOW });
    const again = buildParts(all, 20, { now: NOW + 3 * DAY, prev: first.cut });
    expect(again.cold).toBeUndefined();
    expect(again.cut).toEqual(first.cut);
    expect(again.hot.upto).toBe(20);
    expect(again.hot.cut!.coldUpto).toBe(12);
    // and a week on, or with a clock gone backwards, it cuts again
    expect(buildParts(all, 30, { now: NOW + FULL_EVERY_MS + 1, prev: first.cut }).cold).toBeDefined();
    expect(buildParts(all, 30, { now: NOW - DAY, prev: first.cut }).cold).toBeDefined();
  });

  it('a hot-only snapshot after edits, with the old cold part, still holds the whole list', () => {
    const first = buildParts(all, 12, { now: NOW });
    const clock = createClock('phone0001');
    // touch a cold step and a cold session, delete another, add a new one, and let a day pass
    const cold = first.cold!.docs;
    let edited: Docs = { ...all };
    const [t1, t2] = cold.tasks!.filter(t => t.status === 'done');
    const nowClock = () => { clock.wall = NOW + DAY; clock.counter = 0; return clock; };
    edited = { ...edited, tasks: edited.tasks!.map(t => (t.id === t1!.id ? (patch(t, { note: 'back from the dead' }, nowClock(), SCHEMA_VERSION) as unknown as StoredDoc) : t.id === t2!.id ? (remove(t, nowClock()) as unknown as StoredDoc) : t)) };
    edited.tasks = [...edited.tasks!, { id: 'newone', _v: SCHEMA_VERSION, _hlc: { title: tick(nowClock(), NOW + DAY) }, title: 'New' } as StoredDoc];
    const hotOnly = buildParts(edited, 20, { now: NOW + 3 * DAY, prev: first.cut });
    expect(ids(hotOnly.hot.docs, 'tasks').has(t1!.id)).toBe(true);
    expect(ids(hotOnly.hot.docs, 'tasks').has('newone')).toBe(true);
    // a reader merges the NEW hot part with the OLD cold part
    sameAs(union(first.cold!.docs, hotOnly.hot.docs), edited);
    // and with the new cold part too (a rewrite elsewhere in between)
    const rewrite = buildParts(edited, 22, { now: NOW + 9 * DAY });
    sameAs(union(rewrite.cold!.docs, hotOnly.hot.docs), edited);
    sameAs(union(rewrite.cold!.docs, rewrite.hot.docs), edited);
    // (the new hot part with the old cold part is not a pairing the relay ever holds: a rewrite replaces both)
  });

  it('survives the wire', () => {
    const p = buildParts(syntheticSpace(TODAY), 3, { now: NOW });
    const back = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(p.hot))));
    expect(back.cut).toEqual(p.cut);
    expect(back.cold).toEqual(p.hot.cold);
    expect(back.x).toEqual(p.hot.x);
    expect(back.top).toBe(p.hot.top);
    sameAs(union(decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(p.cold!)))).docs, back.docs), syntheticSpace(TODAY));
  });
});

describe('edits that might touch the cold part', () => {
  const all = syntheticSpace(TODAY);
  const { cold } = split(all, cut);
  const old = cold.tasks!.find(t => t.status === 'done')!;
  const open = all.tasks!.find(t => t.status === 'open')!;
  const clock = createClock('phone0001');
  const push = (c: string, doc: StoredDoc, changes: Record<string, unknown>) => {
    clock.wall = NOW;
    const next = patch(doc, changes, clock, SCHEMA_VERSION) as unknown as StoredDoc;
    const d = { id: doc.id, _v: SCHEMA_VERSION, _hlc: Object.fromEntries(Object.keys(changes).map(k => [k, next._hlc[k]!])), ...changes } as StoredDoc;
    const docs = { ...all, [c]: all[c]!.map(x => (x.id === doc.id ? next : x)) };
    return touchesCold([{ c, d }], docs, cut);
  };

  it('flags an edit to an old finished step, and the reopening of one', () => {
    expect(push('tasks', old, { note: 'again' })).toBe(true);
    expect(push('tasks', old, { status: 'open', doneDay: null })).toBe(true);
  });
  it('flags finishing an open step (its state decides its place), not a plain edit to it', () => {
    expect(push('tasks', open, { status: 'done', doneDay: '2026-10-19' })).toBe(true);
    expect(push('tasks', open, { note: 'a note' })).toBe(false);
  });
  it('does not flag a new document', () => {
    const doc = create<Record<string, unknown>>('brandnew', { title: 'x', status: 'open', due: null }, SCHEMA_VERSION, tick(clock, NOW)) as unknown as StoredDoc;
    expect(touchesCold([{ c: 'tasks', d: doc }], { ...all, tasks: [...all.tasks!, doc] }, cut)).toBe(false);
  });
  it('flags a day or a decision that now lists a step the cold part holds', () => {
    const day = all.days!.find(d => d.date === '2026-10-19')!;
    expect(push('days', day, { plan: [...(day.plan as string[]), old.id] })).toBe(true);
    expect(push('days', day, { plan: [open.id] })).toBe(false);
    expect(push('decisions', all.decisions![0]!, { taskIds: [old.id] })).toBe(true);
  });
});

describe('memory notes and exchanges', () => {
  const sizes = { ...TODAY, memory: 20, exchanges: 60 };
  const all = syntheticSpace(sizes);
  const clock = createClock('phone0001');
  const exchange = (day: string) => all.exchanges!.find(e => String(e.at).startsWith(day))!;
  const from = hotFrom(cut);
  const edge = format(cut.wall - EXCHANGE_MARGIN_MS, 0, '');
  const newest = (e: StoredDoc) => Object.values(e._hlc).reduce((a, b) => (a > b ? a : b));
  const recent = all.exchanges!.find(e => newest(e) >= edge)!;
  // within the 30 days other documents stay hot for, but older than the exchanges' margin
  const older = all.exchanges!.find(e => newest(e) < edge && String(e.at).slice(0, 10) >= from)!;

  it('keeps every live note hot, however old its clocks', () => {
    const { hot, cold } = split(all, cut);
    expect(ids(hot, 'memory').size).toBe(20);
    expect(cold.memory ?? []).toEqual([]);
  });

  it('puts an old tombstoned note in cold, and one deleted lately in hot', () => {
    const [a, b] = all.memory!;
    const goneOld = { ...a!, _del: format(NOW - 60 * DAY, 0, 'phone0001') } as StoredDoc;
    const goneNow = { ...b!, _del: format(NOW - DAY, 0, 'phone0001') } as StoredDoc;
    const { hot, cold } = split({ ...all, memory: [goneOld, goneNow, ...all.memory!.slice(2)] }, cut);
    expect(ids(cold, 'memory')).toEqual(new Set([a!.id]));
    expect(ids(hot, 'memory').has(b!.id)).toBe(true);
  });

  it('puts exchanges written in the two days before the cut, or since, in hot, and the rest in cold', () => {
    expect(recent && older).toBeTruthy();
    const { hot, cold } = split(all, cut);
    expect(ids(hot, 'exchanges').size).toBeLessThan(all.exchanges!.filter(e => String(e.at).slice(0, 10) >= from).length / 5);
    for (const e of all.exchanges!) {
      const isHot = newest(e) >= edge;
      expect(ids(hot, 'exchanges').has(e.id), e.id).toBe(isHot);
      expect(ids(cold, 'exchanges').has(e.id), e.id).toBe(!isHot);
    }
    expect(exchange(String(older.at).slice(0, 10))).toBeDefined();
  });

  it('puts an old exchange touched lately (an Undo) in hot', () => {
    const undone = patch(older, { undone: ['c'] }, clock, SCHEMA_VERSION) as unknown as StoredDoc;
    const { hot } = split({ ...all, exchanges: all.exchanges!.map(e => (e.id === older.id ? undone : e)) }, cut);
    expect(ids(hot, 'exchanges').has(older.id)).toBe(true);
  });

  it('holds all of it across the two parts, the cold ids indexed', () => {
    const p = buildParts(all, 7, { now: NOW });
    sameAs(union(p.hot.docs, p.cold!.docs), all);
    for (const e of p.cold!.docs.exchanges ?? []) expect(inCold(p.hot.cold, 'exchanges', e.id)).toBe(true);
    expect(p.hot.cold!.memory).toBeUndefined();
    // a hot-only snapshot a few days later still adds up
    const next = buildParts(all, 9, { now: NOW + 3 * DAY, prev: p.cut });
    sameAs(union(p.cold!.docs, next.hot.docs), all);
  });

  it('does not ask for a new snapshot when a recent exchange or a live note is edited, but does for an old one or a revived note', () => {
    const push = (c: string, doc: StoredDoc, changes: Record<string, unknown>) => {
      const next = patch(doc, changes, clock, SCHEMA_VERSION) as unknown as StoredDoc;
      const d = { id: doc.id, _v: SCHEMA_VERSION, _hlc: Object.fromEntries(Object.keys(changes).map(k => [k, next._hlc[k]!])), ...changes } as StoredDoc;
      return touchesCold([{ c, d }], { ...all, [c]: all[c]!.map(x => (x.id === doc.id ? next : x)) }, cut);
    };
    expect(push('exchanges', recent, { undone: ['c'] })).toBe(false);
    expect(push('exchanges', older, { undone: ['c'] })).toBe(true); // an Undo: the app snapshots at once, the exchange touched lately is hot
    const after = { ...cut, wall: cut.wall };
    const undone = patch(older, { undone: ['c'] }, clock, SCHEMA_VERSION) as unknown as StoredDoc;
    expect(ids(split({ ...all, exchanges: all.exchanges!.map(e => (e.id === older.id ? undone : e)) }, after).hot, 'exchanges').has(older.id)).toBe(true);
    expect(push('memory', all.memory![3]!, { aliases: ['x'] })).toBe(false);
    const gone = { ...all.memory![4]!, _del: format(NOW - 60 * DAY, 0, 'phone0001') } as StoredDoc;
    const docs = { ...all, memory: all.memory!.map(m => (m.id === gone.id ? gone : m)) };
    const revived = patch(gone, { name: 'Back' }, clock, SCHEMA_VERSION) as unknown as StoredDoc;
    expect(touchesCold([{ c: 'memory', d: { id: gone.id, _v: SCHEMA_VERSION, _hlc: { name: revived._hlc.name! }, name: 'Back' } as StoredDoc }], { ...docs, memory: docs.memory!.map(m => (m.id === gone.id ? revived : m)) }, cut)).toBe(true);
  });
});

describe('exchange writes pushed late', () => {
  const ex = (wall: number) => ({ c: 'exchanges', d: { id: 'e1', _v: SCHEMA_VERSION, _hlc: { undone: format(wall, 0, 'p') }, undone: [] } as unknown as StoredDoc });
  it('are those made more than a day before the push', () => {
    expect(lateExchanges([ex(NOW - 60_000)], NOW)).toBe(false);
    expect(lateExchanges([ex(NOW - 3 * DAY)], NOW)).toBe(true);
    expect(lateExchanges([{ ...ex(NOW - 3 * DAY), c: 'tasks' }], NOW)).toBe(false);
  });
});
