import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ReussiteDb, setLocal } from './db';
import { create, fieldsOf, patch, remove, type Stored } from './doc';
import { normDecision } from './normalize';
import { createClock, ZERO, tick } from './hlc';
import { SCHEMA_VERSION, type Collection } from './schema';
import { dexieSyncStore } from './syncstore';
import { RelayClient } from '../sync/client';
import { decodeRecoveryKey, deriveKeys, encodeRecoveryKey, generateKey, type SpaceKeys } from '../sync/keys';
import { collectOutgoing } from '../sync/engine';
import { syncOnce } from '../sync/run';
import { fakeRelay } from '../sync/testing';
import { openFromText } from '../sync/crypto';
import type { ChangeBatch } from '../sync/protocol';

let n = 0;
type Doc = Stored<Record<string, unknown>>;

/** A device as the app has it: its own Dexie database, a clock, and the sync store over them. */
function device(node: string) {
  const db = new ReussiteDb('sync-' + node + n++);
  const clock = createClock(node);
  const store = dexieSyncStore(db, () => clock);
  return {
    db, clock, store, node,
    add: (c: Collection, id: string, f: Record<string, unknown>) => db.table_(c).put(create(id, f, SCHEMA_VERSION, tick(clock)) as never),
    edit: async (c: Collection, id: string, f: Record<string, unknown>) => { await db.table_(c).put(patch((await db.table_(c).get(id))!, f, clock, SCHEMA_VERSION) as never); },
    del: async (c: Collection, id: string) => { await db.table_(c).put(remove((await db.table_(c).get(id))!, clock) as never); },
    get: (c: Collection, id: string) => db.table_(c).get(id) as Promise<Doc | undefined>,
  };
}
type Dev = ReturnType<typeof device>;

async function space() {
  const recovery = generateKey();
  const keys = await deriveKeys(recovery);
  const relay = fakeRelay();
  const client = (k: SpaceKeys = keys) => new RelayClient('http://relay.test', k, relay.fetch);
  return { recovery, keys, relay, client };
}
const sync = (d: Dev, c: RelayClient, o = {}) => syncOnce(d.store, c, o);

describe('the Dexie sync store', () => {
  it('two devices edit offline and converge', async () => {
    const s = await space();
    const a = device('aaaa'), b = device('bbbb');
    await a.add('tasks', 't1', { title: 'one', note: '' });
    await sync(a, s.client());
    await sync(b, s.client());
    expect((await b.get('tasks', 't1'))!.title).toBe('one');
    // both offline: A renames, B adds a note and a second step, then deletes nothing
    await a.edit('tasks', 't1', { title: 'one, renamed' });
    await b.edit('tasks', 't1', { note: 'written on B' });
    await b.add('tasks', 't2', { title: 'two' });
    await sync(a, s.client()); await sync(b, s.client()); await sync(a, s.client());
    const [x, y] = [await a.get('tasks', 't1'), await b.get('tasks', 't1')];
    expect(x).toEqual(y);
    expect(x).toMatchObject({ title: 'one, renamed', note: 'written on B' });
    expect(await a.get('tasks', 't2')).toMatchObject({ title: 'two' });
    // a deletion travels as a tombstone
    await b.del('tasks', 't2');
    await sync(b, s.client()); await sync(a, s.client());
    expect((await a.get('tasks', 't2'))!._del).toBeDefined();
  });

  it('is stable: a second round with nothing new pushes and writes nothing', async () => {
    const s = await space();
    const a = device('aaaa');
    await a.add('tasks', 't1', { title: 'one' });
    expect((await sync(a, s.client())).pushed).toBe(1);
    const r = await sync(a, s.client());
    expect(r).toMatchObject({ pushed: 0, pulled: 0, newer: false });
  });

  it('a device restored from the recovery key gets everything', async () => {
    const s = await space();
    const a = device('aaaa');
    await a.add('tasks', 't1', { title: 'one' });
    await a.add('projects', 'p1', { name: 'Thesis' });
    await a.add('meta', 'settings', { accent: '#112233' });
    await a.edit('tasks', 't1', { title: 'one!' });
    await a.del('projects', 'p1');
    await sync(a, s.client());
    const typed = encodeRecoveryKey(s.recovery).toLowerCase().replace(/-/g, ' ');
    const keys2 = await deriveKeys(decodeRecoveryKey(typed));
    const b = device('bbbb');
    const r = await sync(b, s.client(keys2));
    expect(r.emptySpace).toBe(false);
    expect(await b.get('tasks', 't1')).toMatchObject({ title: 'one!' });
    expect((await b.get('projects', 'p1'))!._del).toBeDefined();
    expect(await b.get('meta', 'settings')).toMatchObject({ accent: '#112233' });
  });

  it('joining merges with what the new device already has', async () => {
    const s = await space();
    const a = device('aaaa'), b = device('bbbb');
    await a.add('tasks', 'from-a', { title: 'A' });
    await sync(a, s.client());
    await b.add('tasks', 'from-b', { title: 'B' });
    await sync(b, s.client());
    await sync(a, s.client());
    expect(await a.get('tasks', 'from-b')).toMatchObject({ title: 'B' });
    expect(await b.get('tasks', 'from-a')).toMatchObject({ title: 'A' });
  });

  it('a document from a newer schema applies nothing and reports newer', async () => {
    const s = await space();
    const a = device('aaaa'), b = device('bbbb');
    await a.add('tasks', 't1', { title: 'one' });
    await a.db.tasks.update('t1', { _v: SCHEMA_VERSION + 1 });
    await sync(a, s.client());
    const r = await sync(b, s.client());
    expect(r.newer).toBe(true);
    expect(await b.db.tasks.count()).toBe(0);
    expect(r.state.seq).toBe(0); // not marked as applied: after a reload the same data is pulled again
  });

  it('a schema-1 decision from an old device arrives in the current shape, partial edits included', async () => {
    const s = await space();
    const b = device('bbbb');
    const old = createClock('old1');
    const h1 = tick(old);
    const full = {
      id: 'd1', _v: 1, _hlc: { title: h1, problem: h1, options: h1, chosen: h1 },
      title: 'Stay or move?', problem: 'Rent goes up', chosen: 'Stay',
      options: [{ name: 'Stay', pros: [['cheaper', 4]], cons: [], prosNot: [], consNot: [] }],
    };
    const h2 = tick(old);
    const edit = { id: 'd1', _v: 1, _hlc: { problem: h2 }, problem: 'Rent goes up again' };
    const c = s.client();
    await c.push({ v: 1, device: 'old1', docs: [{ c: 'decisions', d: full }] });
    await c.push({ v: 1, device: 'old1', docs: [{ c: 'decisions', d: edit }] });
    await c.push({ v: 1, device: 'old1', docs: [{ c: 'decisions', d: { id: 'd2', _v: 1, _hlc: { title: h1 }, title: 'Later?' } }] });
    const r = await sync(b, s.client());
    expect(r.newer).toBe(false);
    const d = (await b.get('decisions', 'd1'))!;
    expect(d._v).toBe(SCHEMA_VERSION);
    expect(d).toMatchObject({ title: 'Stay or move?', chosen: 'Stay', problem: { what: 'Rent goes up again' } });
    expect((d.options as { pros: { text: string; w: number }[] }[])[0]!.pros[0]).toMatchObject({ w: 4 });
    expect(d._hlc.problem).toBe(h2);
    expect(normDecision(fieldsOf(d)).status).toBe('decided'); // not clobbered by a default from the later partial
    expect(await b.get('decisions', 'd2')).toMatchObject({ _v: SCHEMA_VERSION, title: 'Later?' });
    // a real edit made on B stays on top of the defaults the migration added
    await b.edit('decisions', 'd2', { why: 'because' });
    await sync(b, s.client());
    expect(await b.get('decisions', 'd2')).toMatchObject({ why: 'because' });
  });

  it('nothing from the local table ever leaves the device', async () => {
    const s = await space();
    const a = device('aaaa');
    await setLocal(a.db, 'sync.key', 'SYNC-KEY-SECRET');
    await setLocal(a.db, 'aiKey.openai', 'sk-AI-KEY-SECRET');
    await setLocal(a.db, 'pushSub', { endpoint: 'https://push.example/PUSH-SECRET' });
    await a.add('tasks', 't1', { title: 'one' });
    await a.add('meta', 'settings', { accent: '#abcdef' });
    await sync(a, s.client());
    const out = collectOutgoing(await a.store.all(), 'aaaa', '', { all: true });
    expect(JSON.stringify(out)).not.toMatch(/SECRET/);
    for (const sp of s.relay.spaces.values()) {
      for (const b of sp.batches) expect(JSON.stringify(await openFromText<ChangeBatch>(s.keys, b.blob))).not.toMatch(/SECRET/);
    }
  });

  it('a full push sends fields written by other nodes and imported ones, and keeps the watermark ours', async () => {
    const a = device('aaaa');
    await a.db.tasks.put({ id: 'i1', _v: SCHEMA_VERSION, _hlc: { title: ZERO }, title: 'imported' });
    await a.db.tasks.put({ id: 'f1', _v: SCHEMA_VERSION, _hlc: { title: '0000099999999:0000:zzzz' }, title: 'foreign' });
    await a.add('tasks', 'own', { title: 'mine' });
    const own = collectOutgoing(await a.store.all(), 'aaaa', '');
    expect(own.docs.map(d => d.d.id)).toEqual(['own']);
    const full = collectOutgoing(await a.store.all(), 'aaaa', '', { all: true });
    expect(full.docs.map(d => d.d.id).sort()).toEqual(['f1', 'i1', 'own']);
    expect(full.watermark).toBe(own.watermark);
  });

  it('stops instead of recreating a space that was deleted elsewhere', async () => {
    const s = await space();
    const a = device('aaaa'), b = device('bbbb');
    await a.add('tasks', 't1', { title: 'one' });
    await sync(a, s.client());
    await sync(b, s.client());
    await sync(a, s.client(), { stopIfGone: true }); // a has seq > 0 now
    await s.client().deleteSpace();
    await b.edit('tasks', 't1', { title: 'edited after deletion' });
    const r = await sync(b, s.client(), { stopIfGone: true });
    expect(r.gone).toBe(true);
    expect(r.pushed).toBe(0);
    expect(s.relay.spaces.size).toBe(0);
    // a brand new device is not "gone": the first sync of a first device creates the space
    const c = device('cccc');
    await c.add('tasks', 'x', { title: 'x' });
    expect((await sync(c, s.client(), { stopIfGone: true })).gone).toBe(false);
    expect(s.relay.spaces.size).toBe(1);
  });

  it('a wrong key cannot read or overwrite', async () => {
    const s = await space();
    const a = device('aaaa');
    await a.add('tasks', 't1', { title: 'one' });
    await sync(a, s.client());
    const other = await deriveKeys(generateKey());
    const b = device('bbbb');
    await b.add('tasks', 'tb', { title: 'B' });
    const r = await sync(b, s.client(other));
    expect(r.emptySpace).toBe(true); // a different key names a different, empty space
    expect(await b.get('tasks', 't1')).toBeUndefined();
    expect([...s.relay.spaces.values()].map(sp => sp.batches.length)).toEqual([1, 1]);
    expect((await sync(a, s.client())).pulled).toBe(0); // A's space is untouched
  });
});
