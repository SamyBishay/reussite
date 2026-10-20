// The snapshot in two parts (hot and cold), the connector reading it, compaction, and the isolate's cache.
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { b64uDecode } from '../../src/sync/bytes';
import { RelayClient } from '../../src/sync/client';
import { openFromText } from '../../src/sync/crypto';
import { SCHEMA_VERSION } from '../../src/data/schema';
import type { Collection } from '../../src/data/schema';
import { buildSnapshot } from '../../src/sync/engine';
import { dayOf, EXCHANGE_MARGIN_MS } from '../../src/sync/parts';
import { syncOnce } from '../../src/sync/run';
import { FakeDevice } from '../../src/sync/testing';
import { syntheticSpace, type Docs } from '../bench/synthetic';
import { cacheGet, cacheSize, setCacheEnabled } from '../src/connector/cache';
import { buildSpace, COMPACT_TAIL, emptyMaps } from '../src/connector/space';
import { dayText, memoryText, projectText, queryText, taskText } from '../src/connector/render';
import { View } from '../src/connector/view';
import { decodeSnapshot } from '../../src/sync/wire';
import { BASE, call, url } from './helpers';
import { newApp, signIn, switchOn, tool, viaWorker, type App } from './connector';

const TODAY = dayOf(Date.now());
const day = (n: number) => dayOf(Date.now() + n * 86_400_000);
const SIZES = { tasks: 130, sessions: 150, days: 45, projects: 8, decisions: 3, places: 2, stays: 2, memory: 12, exchanges: 40 }; // small enough for the connector to compact (COMPACT_MAX_DOCS)

let app: App;
let access: string;
let docs: Docs;
let oldDone: string;
let oldDay: string;

const space = () => app.keys.spaceId;
const rows = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).all<any>().then(r => r.results);
const parts = () => rows('SELECT kind, part, upto FROM snapshots WHERE space = ?1 ORDER BY kind, part', space());
const tailLength = async () => (await rows('SELECT COUNT(*) AS n FROM batches WHERE space = ?1', space()))[0].n as number;

/** apply_changes, saying yes when it asks. */
async function apply(changes: unknown[]) {
  const r = await tool(access, 'apply_changes', { changes });
  const id = /"confirm": "(c\w+)"/.exec(r.text)?.[1];
  return id ? tool(access, 'apply_changes', { confirm: id }) : r;
}

/** What a read of the whole list says, from the app device's own documents. */
function expected() {
  const maps = emptyMaps();
  for (const [c, m] of app.device.docs) for (const [id, d] of m) maps[c as Collection].set(id, d);
  return new View(maps);
}

/** Take the cold rows away (and give them back), to show what an answer does not depend on. */
async function withoutCold<T>(f: () => Promise<T>): Promise<T> {
  const saved = await rows("SELECT * FROM snapshots WHERE space = ?1 AND kind = 'cold'", space());
  await env.DB.prepare("DELETE FROM snapshots WHERE space = ?1 AND kind = 'cold'").bind(space()).run();
  try { return await f(); } finally {
    for (const r of saved) await env.DB.prepare('INSERT INTO snapshots (space, kind, part, upto, blob, size, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)').bind(r.space, r.kind, r.part, r.upto, r.blob, r.size, r.at).run();
  }
}

beforeAll(async () => {
  app = await newApp('app00001');
  docs = syntheticSpace(SIZES, TODAY);
  for (const [c, list] of Object.entries(docs)) app.device.docs.set(c as Collection, new Map(list.map(d => [d.id, d])));
  const d = app.device;
  d.edit('meta', 'settings', { dayStart: '00:00' });
  // a decision that lists an old finished step: the hot part must keep that step
  oldDone = docs.tasks!.find(t => t.status === 'done' && String(t.doneDay) < day(-90))!.id;
  oldDay = day(-120);
  d.add('days', oldDay, { date: oldDay, plan: [oldDone], launches: [], first: null, checkin: null, closed: null, summary: null });
  await syncOnce(d, app.client, { full: true });
  await syncOnce(d, app.client, { snapshotEvery: 1 }); // pulls its own batches, then snapshots
  access = (await signIn((await switchOn(app)).body.code)).access;
});

beforeEach(() => setCacheEnabled(false));

describe('the snapshot in two parts', () => {
  it('is stored as a hot and a cold blob, and the hot one is the small one', async () => {
    const p = await parts();
    expect(p.map(r => r.kind).sort()).toEqual(['cold', 'hot']);
    const sizes = Object.fromEntries((await rows('SELECT kind, SUM(LENGTH(blob)) AS n FROM snapshots WHERE space = ?1 GROUP BY kind', space())).map(r => [r.kind, r.n]));
    expect(sizes.hot).toBeLessThan(sizes.cold * 3); // the synthetic list is mostly finished steps, so hot is not bigger than twice cold
    const got = await call('GET', url(app.keys, '/changes?after=0'), app.keys);
    expect(got.body.snapshot.blob).toBeTruthy();
    expect(got.body.cold.blob).toBeTruthy();
    const hot = decodeSnapshot(await openFromText(app.keys, got.body.snapshot.blob));
    const cold = decodeSnapshot(await openFromText(app.keys, got.body.cold.blob));
    expect(hot.part).toBe('hot');
    expect(cold.part).toBe('cold');
    expect(hot.docs.tasks!.length + cold.docs.tasks!.length).toBeGreaterThanOrEqual(docs.tasks!.length);
    expect(hot.docs.tasks!.length).toBeLessThan(docs.tasks!.length * 0.7);
  });

  it('a device joining reads hot and cold and gets everything', async () => {
    const joined = new FakeDevice('join0001');
    const r = await syncOnce(joined, new RelayClient(BASE, app.keys, viaWorker));
    expect(r.newer).toBe(false);
    expect(joined.dump()).toEqual(app.device.dump());
    expect(joined.get('tasks', oldDone)).toBeDefined();
  });

  it('a device already past the cold part reads only the hot one', async () => {
    const hotUpto = (await parts()).find(r => r.kind === 'hot' && r.part === 0)!.upto;
    const got = await call('GET', url(app.keys, `/changes?after=${hotUpto - 1}`), app.keys);
    expect(got.body.snapshot).not.toBeNull();
    const coldUpto = (await parts()).find(r => r.kind === 'cold')!.upto;
    expect(got.body.cold ?? null).toBe(coldUpto > hotUpto - 1 ? got.body.cold : null);
    const caught = await call('GET', url(app.keys, `/changes?after=${hotUpto}`), app.keys);
    expect(caught.body.snapshot).toBeNull();
    expect(caught.body.cold ?? null).toBeNull();
  });
});

describe('the connector reads hot only for the common calls', () => {
  it('today, query_tasks, get_project and get_decision agree with a read of the whole list, with the cold part gone', async () => {
    const v = expected();
    await withoutCold(async () => {
      expect((await tool(access, 'today')).text).toBe(dayText(v, v.today));
      expect((await tool(access, 'query_tasks', { quadrant: 1 })).text).toBe(queryText(v, { quadrant: 1 }, {}));
      expect((await tool(access, 'query_tasks', { text: 'tax' })).text).toBe(queryText(v, { text: 'tax' }, {}));
      for (const p of ['p1', 'p3', 'p7']) expect((await tool(access, 'get_project', { id: p })).text).toBe(projectText(v, p));
      const d = (await tool(access, 'get_decision', { id: 'd0' })).text;
      expect(d).toContain('Decision d0');
      expect((await tool(access, 'get_task', { id: docs.tasks!.find(t => t.status === 'open')!.id })).isError).toBe(false);
      expect((await tool(access, 'get_day', { date: day(-5) })).text).toBe(dayText(v, day(-5)));
    });
  });

  it('read_memory answers from the hot part alone, as a read of the whole list would', async () => {
    const v = expected();
    const named = [...v.memory.values()].find(n => !n.private && n.kind !== 'profile')!;
    const hidden = [...v.memory.values()].find(n => n.private)!;
    await withoutCold(async () => {
      expect((await tool(access, 'read_memory')).text).toBe(memoryText(v, {}));
      expect((await tool(access, 'read_memory', { name: named.name })).text).toBe(memoryText(v, { name: named.name }));
      expect((await tool(access, 'read_memory', { name: hidden.name })).text).not.toContain(hidden.lines[0]!.text);
    });
  });

  it('keeps the steps a decision lists, and the personal estimate, as the whole list says them', async () => {
    const v = expected();
    const withD = [...v.decisions.values()].find(x => x.taskIds.length);
    // the estimate range on the list is the cold steps' doing as much as the hot ones'
    const t = (await tool(access, 'today')).text;
    expect(t).toBe(dayText(v, v.today));
    if (withD) expect((await tool(access, 'get_decision', { id: withD.id })).text).toContain('steps:');
  });

  it('reaches cold data on demand: an old finished step, finished steps, an old day', async () => {
    const v = expected();
    const old = v.tasks.get(oldDone)!;
    expect((await tool(access, 'get_task', { id: oldDone })).text).toBe(taskText(v, old));
    expect((await tool(access, 'get_task', { id: old.title })).text).toContain(oldDone);
    expect((await tool(access, 'query_tasks', { status: 'done' })).text).toBe(queryText(v, { status: 'done' }, {}));
    expect((await tool(access, 'query_tasks', { status: 'all', text: old.title.split(' ')[0] })).text).toBe(queryText(v, { status: 'all', text: old.title.split(' ')[0] }, {}));
    expect((await tool(access, 'get_day', { date: oldDay })).text).toBe(dayText(v, oldDay));
    expect((await tool(access, 'get_day', { date: oldDay })).text).toContain(old.title);
  });

  it('changes an old finished step, and a day in the cold part is not made again from nothing', async () => {
    const before = (await tool(access, 'get_day', { date: oldDay })).text;
    const r = await apply([{ op: 'task.update', id: oldDone, set: { note: 'looked at again' } }]);
    expect(r.isError).toBe(false);
    expect(r.text).toContain('Done');
    const r2 = await apply([{ op: 'day.update', date: oldDay, first: oldDone }]);
    expect(r2.isError).toBe(false);
    const after = (await tool(access, 'get_day', { date: oldDay })).text;
    expect(after).toContain(oldDone);
    expect(before).toContain(oldDone); // the old plan is still there
    // the app sees both edits and the day keeps its plan
    await syncOnce(app.device, app.client);
    expect(app.device.get('tasks', oldDone)!.note).toBe('looked at again');
    expect((app.device.get('days', oldDay)!.plan as string[])).toContain(oldDone);
    // and the next call, with a cold step touched in the tail, still answers right
    const v = expected();
    expect((await tool(access, 'get_task', { id: oldDone })).text).toBe(taskText(v, v.tasks.get(oldDone)!));
    expect((await tool(access, 'today')).text).toBe(dayText(v, v.today));
  });

  it('reads the cold part first when a batch since plans a day with an old finished step', async () => {
    const old = [...expected().tasks.values()].find(t => t.status === 'done' && String(t.doneDay) < day(-100) && t.id !== oldDone)!;
    const plan = (app.device.get('days', TODAY)!.plan as string[]) ?? [];
    app.device.edit('days', TODAY, { plan: [...plan, old.id] });
    await syncOnce(app.device, app.client, { snapshotEvery: 1000 });
    const v = expected();
    const text = (await tool(access, 'today')).text;
    expect(text).toContain(old.title);
    expect(text).toBe(dayText(v, v.today));
  });

  it('a confirmation that turns out to need the cold part still works once, with the same id', async () => {
    const v = expected();
    const old = [...v.tasks.values()].filter(t => t.status === 'done' && String(t.doneDay) < day(-100)).at(-5)!;
    const first = await tool(access, 'apply_changes', { changes: [{ op: 'task.update', id: old.id, set: { note: 'asked first' } }] });
    const id = /"confirm": "(c\w+)"/.exec(first.text)?.[1];
    expect(id).toBeTruthy();
    const done = await tool(access, 'apply_changes', { confirm: id });
    expect(done.isError).toBe(false);
    expect(done.text).toContain('Undo id');
    expect((await tool(access, 'apply_changes', { confirm: id })).isError).toBe(true); // once
    await syncOnce(app.device, app.client);
    expect(app.device.get('tasks', old.id)!.note).toBe('asked first');
  });

  it('adds and ticks a step on the hot part alone', async () => {
    const open = docs.tasks!.find(t => t.status === 'open')!;
    await withoutCold(async () => {
      expect((await tool(access, 'apply_changes', { changes: [{ op: 'task.done', id: open.id }] })).isError).toBe(false);
      expect((await tool(access, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Brand new one', project: 'p1' } }] })).text).toContain('Created:');
    });
    await syncOnce(app.device, app.client);
    expect(app.device.get('tasks', open.id)!.status).toBe('done');
    expect([...app.device.docs.get('tasks')!.values()].some(t => t.title === 'Brand new one')).toBe(true);
  });
});

describe('compaction and racing writers', () => {
  it('after enough batches the connector rewrites the hot part, and a new device still gets everything', async () => {
    await syncOnce(app.device, app.client, { snapshotEvery: 1 }); // the app snapshots: the tail is clear of earlier edits to old steps
    const hotBefore = (await parts()).find(r => r.kind === 'hot')!.upto;
    const coldBefore = (await parts()).find(r => r.kind === 'cold')!.upto;
    const open = docs.tasks!.filter(t => t.status === 'open');
    // the app edits without snapshotting, so the tail grows past the threshold
    for (let i = 0; i < COMPACT_TAIL + 1; i++) { app.device.edit('tasks', open[i]!.id, { note: 'edit ' + i }); await syncOnce(app.device, app.client, { snapshotEvery: 1000 }); }
    expect(await tailLength()).toBeGreaterThan(COMPACT_TAIL);
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'The one that compacts' } }] });
    expect(r.isError).toBe(false);
    const p = await parts();
    expect(p.find(x => x.kind === 'hot')!.upto).toBeGreaterThan(hotBefore);
    expect(p.find(x => x.kind === 'cold')!.upto).toBe(coldBefore); // the cold part is left as it was
    expect(await tailLength()).toBeLessThanOrEqual(1);
    await syncOnce(app.device, app.client);
    const joined = new FakeDevice('join0002');
    await syncOnce(joined, new RelayClient(BASE, app.keys, viaWorker));
    expect(joined.dump()).toEqual(app.device.dump());
    expect((await tool(access, 'query_tasks', { text: 'compacts' })).text).toContain('The one that compacts');
  });

  it('the app snapshots at once after editing an old finished step, so the connector never sees a stub', async () => {
    await syncOnce(app.device, app.client, { snapshotEvery: 1 });
    const v0 = expected();
    const old = [...v0.tasks.values()].filter(t => t.status === 'done' && String(t.doneDay) < day(-100) && t.id !== oldDone).at(-1)!; // not one an earlier test put on a list
    app.device.edit('tasks', old.id, { note: 'a second look' });
    const r = await syncOnce(app.device, app.client); // far fewer than 8 batches: only the edit's own
    expect(r.snapshot).toBe(true);
    expect(await tailLength()).toBe(0);
    const v = expected();
    await withoutCold(async () => { expect((await tool(access, 'today')).text).toBe(dayText(v, v.today)); });
    // a plain edit to an open step does not
    const open = [...v.tasks.values()].find(t => t.status === 'open')!;
    app.device.edit('tasks', open.id, { note: 'just a note' });
    expect((await syncOnce(app.device, app.client)).snapshot).toBe(false);
  });

  it('a stub of an old step in the tail makes the connector read the cold part once, then cut the hot part again', async () => {
    await syncOnce(app.device, app.client, { snapshotEvery: 1 });
    const v0 = expected();
    const old = [...v0.tasks.values()].filter(t => t.status === 'done' && String(t.doneDay) < day(-100) && t.id !== oldDone && !t.note).at(-2)!;
    // a batch from a device that doesn't know about the split: just the field it changed
    const { RelayClient: Client } = await import('../../src/sync/client');
    const other = new FakeDevice('odd00001');
    other.clock.wall = Date.now();
    const { patch } = await import('../../src/data/doc');
    const edited = patch(app.device.get('tasks', old.id)!, { status: 'open', doneDay: null }, other.clock, SCHEMA_VERSION);
    const seq = await new Client(BASE, app.keys, viaWorker).push({ v: SCHEMA_VERSION, device: 'odd00001', docs: [{ c: 'tasks', d: { id: old.id, _v: SCHEMA_VERSION, status: 'open', doneDay: null, _hlc: { status: edited._hlc.status!, doneDay: edited._hlc.doneDay! } } }] });
    expect(seq).toBeGreaterThan(0);
    const hotBefore = (await parts()).find(r => r.kind === 'hot')!.upto;
    // the step is open again, so it belongs on the list: only a read of the cold part has the rest of it
    const q = await tool(access, 'query_tasks', { text: old.title.split(' ').slice(0, 3).join(' ') });
    expect(q.text).toContain(old.id + ' | ' + old.title);
    expect((await parts()).find(r => r.kind === 'hot')!.upto).toBeGreaterThan(hotBefore); // cut again
    expect(await tailLength()).toBe(0);
    await withoutCold(async () => {
      expect((await tool(access, 'get_task', { id: old.id })).text).toContain('status: open');
    });
    await syncOnce(app.device, app.client);
    expect(app.device.get('tasks', old.id)!.status).toBe('open');
  });

  it('a snapshot written by A while B and the connector write loses nothing', async () => {
    const a = app.device;
    const b = new FakeDevice('bdev0001');
    const cb = new RelayClient(BASE, app.keys, viaWorker);
    await syncOnce(b, cb);
    const aSeq = (await a.loadState()).seq;
    // B pushes, the connector writes, and only then A's snapshot (made from what A had applied) arrives
    b.edit('tasks', docs.tasks!.find(t => t.status === 'open')!.id, { note: 'from B' });
    await syncOnce(b, cb, { snapshotEvery: 1000 });
    await tool(access, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'From the connector' } }] });
    const { buildParts } = await import('../../src/sync/parts');
    const stale = buildParts(await a.all(), aSeq, { now: Date.now(), prev: (await a.loadState()).cut });
    const put = await app.client.putSnapshotParts(stale);
    expect(put.upto).toBeGreaterThanOrEqual(aSeq);
    await syncOnce(a, app.client);
    await syncOnce(b, cb);
    const late = new FakeDevice('late0001');
    await syncOnce(late, new RelayClient(BASE, app.keys, viaWorker));
    expect(late.dump()).toEqual(a.dump());
    expect(late.dump()).toEqual(b.dump());
    expect([...late.docs.get('tasks')!.values()].some(t => t.title === 'From the connector')).toBe(true);
    expect([...late.docs.get('tasks')!.values()].some(t => t.note === 'from B')).toBe(true);
  });

  it('refuses a hot part cut against a cold part the relay does not hold, and ignores one that is not newer', async () => {
    const k = (await import('./helpers')).newSpace;
    const keys = await k();
    const c = new RelayClient(BASE, keys, viaWorker);
    const dev = new FakeDevice('dev00001');
    dev.add('tasks', 't1', { title: 'x', status: 'open' });
    await syncOnce(dev, c);
    const { buildParts } = await import('../../src/sync/parts');
    const first = buildParts(await dev.all(), 1, { now: Date.now() });
    const hotOnly = buildParts(await dev.all(), 1, { now: Date.now(), prev: first.cut });
    await expect(c.putSnapshotParts(hotOnly)).rejects.toMatchObject({ status: 409, code: 'bad_parts' });
    // a whole (older style) snapshot is on the relay: a hot-only one can't build on it either
    await c.putSnapshot(buildSnapshot(await dev.all(), 1));
    await expect(c.putSnapshotParts(hotOnly)).rejects.toMatchObject({ status: 409, code: 'bad_parts' });
    // a later write of both parts replaces it; after that a hot part that isn't newer changes nothing
    dev.edit('tasks', 't1', { title: 'y' });
    await syncOnce(dev, c);
    const second = buildParts(await dev.all(), 2, { now: Date.now() });
    expect(await c.putSnapshotParts(second)).toMatchObject({ upto: 2 });
    expect((await rows('SELECT kind FROM snapshots WHERE space = ?1 AND part = 0 ORDER BY kind', keys.spaceId)).map(r => r.kind)).toEqual(['cold', 'hot']);
    expect(await c.putSnapshotParts(buildParts(await dev.all(), 2, { now: Date.now(), prev: second.cut }))).toEqual({ upto: 2, pruned: 0 });
    expect(await c.putSnapshotParts(buildParts(await dev.all(), 2, { now: Date.now(), prev: second.cut }))).toEqual({ upto: 2, pruned: 0 });
  });
});

describe('an old single-part snapshot', () => {
  it('is still read by a device and by the connector, and the connector writes on top of it', async () => {
    const old = await newApp('old00001');
    old.device.add('meta', 'settings', { dayStart: '00:00' });
    old.device.add('projects', 'p1', { name: 'Old project', suit: 'C', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
    old.device.add('tasks', 'a1', { title: 'Before the split', project: 'p1', status: 'open', suit: 'S', est: 10, due: null, important: true, urgent: false, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z' });
    await old.sync();
    await old.sync();
    // exactly what an app from before the split uploads: one whole snapshot, whole documents
    const whole = buildSnapshot(await old.device.all(), (await old.device.loadState()).seq);
    const { sealToText } = await import('../../src/sync/crypto');
    expect((await call('PUT', url(old.keys, '/snapshot'), old.keys, { body: { upto: whole.upto, blob: await sealToText(old.keys, whole) } })).status).toBe(200);
    expect((await rows('SELECT kind FROM snapshots WHERE space = ?1', old.keys.spaceId)).map(r => r.kind)).toEqual(['full']);

    const joined = new FakeDevice('join0003');
    await syncOnce(joined, new RelayClient(BASE, old.keys, viaWorker));
    expect(joined.dump()).toEqual(old.device.dump());

    const t = (await signIn((await switchOn(old)).body.code)).access;
    expect((await tool(t, 'query_tasks', { text: 'split' })).text).toContain('a1 | Before the split');
    expect((await tool(t, 'apply_changes', { changes: [{ op: 'task.done', id: 'a1' }] })).isError).toBe(false);
    expect((await tool(t, 'get_task', { id: 'a1' })).text).toContain('status: done');
    await syncOnce(old.device, old.client);
    expect(old.device.get('tasks', 'a1')!.status).toBe('done');
  });
});

describe("the isolate's cache", () => {
  it('a hit answers the same as a cold read, and only newer batches are read', async () => {
    setCacheEnabled(true);
    const first = await tool(access, 'today');
    const second = await tool(access, 'today');
    expect(second.text).toBe(first.text);
    // a change made elsewhere shows up on the next call, cache or not
    app.device.add('tasks', 'cache1', { title: 'Seen through the cache', project: 'p1', status: 'open', suit: 'S', est: 5, due: null, important: true, urgent: true, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z' });
    await syncOnce(app.device, app.client, { snapshotEvery: 1000 });
    const withCache = (await tool(access, 'query_tasks', { text: 'through the cache' })).text;
    expect(withCache).toContain('cache1 | Seen through the cache');
    setCacheEnabled(false);
    expect((await tool(access, 'query_tasks', { text: 'through the cache' })).text).toBe(withCache);
    expect((await tool(access, 'today')).text).toBe(first.text.includes('cache1') ? first.text : (await tool(access, 'today')).text);
  });

  it('a hit really comes from memory: it still answers with the snapshot taken away', async () => {
    setCacheEnabled(true);
    const warm = (await tool(access, 'query_tasks', { quadrant: 1 })).text;
    expect(cacheGet(space(), (await rows('SELECT wrapped FROM connector WHERE space = ?1', space()))[0].wrapped)).toBeDefined();
    const saved = await rows("SELECT * FROM snapshots WHERE space = ?1 AND kind = 'hot'", space());
    await env.DB.prepare("DELETE FROM snapshots WHERE space = ?1 AND kind = 'hot'").bind(space()).run();
    try {
      expect((await tool(access, 'query_tasks', { quadrant: 1 })).text).toBe(warm);
      setCacheEnabled(false); // a cold isolate has only the tail to go on now
      expect((await tool(access, 'query_tasks', { quadrant: 1 })).text).not.toBe(warm);
    } finally {
      for (const r of saved) await env.DB.prepare('INSERT INTO snapshots (space, kind, part, upto, blob, size, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)').bind(r.space, r.kind, r.part, r.upto, r.blob, r.size, r.at).run();
    }
    expect((await tool(access, 'query_tasks', { quadrant: 1 })).text).toBe(warm);
  });

  it('a write is not seen by another call until it is stored, and a refused write leaves the cache alone', async () => {
    setCacheEnabled(true);
    await tool(access, 'today');
    const open = docs.tasks!.filter(t => t.status === 'open' && t.title !== 'x')[3]!;
    const r = await apply([{ op: 'task.update', id: open.id, set: { note: 'cached write' } }]);
    expect(r.isError).toBe(false);
    expect((await tool(access, 'get_task', { id: open.id })).text).toContain('cached write');
    setCacheEnabled(false);
    expect((await tool(access, 'get_task', { id: open.id })).text).toContain('cached write');
  });

  it('is dropped when the connector is switched off, and a call then fails', async () => {
    setCacheEnabled(true);
    const o = await newApp('cache001');
    o.device.add('meta', 'settings', { dayStart: '00:00' });
    o.device.add('tasks', 'k1', { title: 'Only while on', project: 'inbox', status: 'open', suit: 'S', est: 5, due: null, important: true, urgent: false, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z' });
    await o.sync();
    const t = (await signIn((await switchOn(o)).body.code)).access;
    expect((await tool(t, 'query_tasks', { text: 'while on' })).text).toContain('k1');
    const wrapped = (await rows('SELECT wrapped FROM connector WHERE space = ?1', o.keys.spaceId))[0].wrapped as string;
    expect(cacheSize()).toBeGreaterThan(0);
    expect(cacheGet(o.keys.spaceId, wrapped)).toBeDefined();
    expect((await call('DELETE', url(o.keys, '/connector'), o.keys)).status).toBe(200);
    expect(cacheGet(o.keys.spaceId, wrapped)).toBeUndefined();
    expect((await tool(t, 'query_tasks', { text: 'while on' })).isError).toBe(true);
    // switched on again: a new wrapped key, so an old entry (in any isolate) is not used
    const t2 = (await signIn((await switchOn(o)).body.code)).access;
    expect((await tool(t2, 'query_tasks', { text: 'while on' })).text).toContain('k1');
  });
});

void b64uDecode; void SCHEMA_VERSION;

describe('memory notes and exchanges in the two parts', () => {
  it('a hot-only read holds every live note and the exchanges of the two days before the cut, and the View reads them', async () => {
    const hotBlob = (await rows("SELECT blob FROM snapshots WHERE space = ?1 AND kind = 'hot' ORDER BY part", space())).map(r => r.blob).join('');
    const s = await buildSpace(space(), app.keys, hotBlob, [], { wall: 0, counter: 0 });
    expect(s.newer).toBe(false);
    const v = new View(s.maps, undefined, { x: s.split!.x, from: s.split!.from });
    const whole = expected();
    expect(whole.memory.size).toBe(SIZES.memory);
    expect([...v.memory.keys()].sort()).toEqual([...whole.memory.keys()].sort());
    const note = [...v.memory.values()][0]!;
    expect(note.lines.length).toBe(8);
    expect(typeof note.private).toBe('boolean');
    const edge = s.split!.cut.wall - EXCHANGE_MARGIN_MS;
    const recent = [...whole.exchanges.values()].filter(e => Date.parse(e.at) >= edge);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThan(whole.exchanges.size);
    expect([...v.exchanges.keys()].sort()).toEqual(recent.map(e => e.id).sort());
    expect(v.exchanges.get(recent[0]!.id)!.undone).toEqual([]);
  });
});
