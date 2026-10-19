// Two simulated devices running the real src/sync engine against the real Worker.
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { postToInbox, RelayClient, RelayError } from '../../src/sync/client';
import { deriveInbox, InboxError, openFromInbox, sealToInbox } from '../../src/sync/inbox';
import { DecryptError } from '../../src/sync/crypto';
import { deriveKeys, decodeRecoveryKey, encodeRecoveryKey, generateKey } from '../../src/sync/keys';
import { create } from '../../src/data/doc';
import { ZERO } from '../../src/data/hlc';
import { SCHEMA_VERSION } from '../../src/data/schema';
import { buildSnapshot } from '../../src/sync/engine';
import { syncOnce } from '../../src/sync/run';
import { FakeDevice } from '../../src/sync/testing';
import { BASE } from './helpers';

const viaWorker: typeof fetch = (input, init) => exports.default.fetch(new Request(input as RequestInfo, init));
const clientFor = async (key: Uint8Array) => new RelayClient(BASE, await deriveKeys(key), viaWorker);

describe('sync through the relay', () => {
  it('two devices edit offline and converge', async () => {
    const key = generateKey();
    const [ca, cb] = [await clientFor(key), await clientFor(key)];
    const a = new FakeDevice('aaa'), b = new FakeDevice('bbb');

    a.add('tasks', 't1', { title: 'Shared', est: 10, note: '', plan: ['x'] });
    a.add('tasks', 't2', { title: 'Doomed' });
    a.add('meta', 'settings', { language: 'fr' });
    expect((await syncOnce(a, ca)).pushed).toBe(3);
    const joined = await syncOnce(b, cb);
    expect(joined.pulled).toBe(3);
    expect(b.dump()).toEqual(a.dump());

    // Offline edits on both.
    a.edit('tasks', 't1', { title: 'From A', est: 25 });
    b.edit('tasks', 't1', { note: 'from B', plan: ['y'] });
    b.del('tasks', 't2');
    a.add('tasks', 't3', { title: 'Only A' });
    b.add('days', '2026-10-19', { date: '2026-10-19', plan: ['t1'] });
    await syncOnce(b, cb);
    await syncOnce(a, ca);
    await syncOnce(b, cb);
    expect(a.dump()).toEqual(b.dump());
    expect(a.get('tasks', 't1')).toMatchObject({ title: 'From A', est: 25, note: 'from B', plan: ['y'] });
    expect(a.get('tasks', 't2')!._del).toBeDefined();
    expect(a.get('days', '2026-10-19')).toBeDefined();

    // Nothing left to say.
    const quiet = await syncOnce(a, ca);
    expect(quiet.pushed).toBe(0);
    expect(quiet.pulled).toBe(0);
  });

  it('uploads imported (oldest-clock) data on the first sync', async () => {
    const key = generateKey();
    const a = new FakeDevice('aaa'), b = new FakeDevice('bbb');
    a.docs.set('tasks', new Map([['t1', create<Record<string, unknown>>('t1', { title: 'Imported' }, SCHEMA_VERSION, ZERO)]]));
    await syncOnce(a, await clientFor(key));
    await syncOnce(b, await clientFor(key));
    expect(b.get('tasks', 't1')).toMatchObject({ title: 'Imported' });
  });

  it('snapshots, prunes, and a device restored from the recovery key alone gets everything back', async () => {
    const key = generateKey();
    const a = new FakeDevice('aaa');
    const ca = await clientFor(key);
    for (let i = 0; i < 6; i++) { a.add('tasks', 't' + i, { title: 'Step ' + i, order: i }); await syncOnce(a, ca, { snapshotEvery: 3 }); }
    a.del('tasks', 't0');
    a.edit('tasks', 't1', { title: 'Renamed' });
    const last = await syncOnce(a, ca, { snapshotEvery: 3 });
    expect(last.state.snapshotSeq).toBeGreaterThan(0);
    const left = (await env.DB.prepare('SELECT COUNT(*) AS n FROM batches').first<{ n: number }>())!.n;
    expect(left).toBeLessThan(7);

    // A new phone: only the typed-in recovery key.
    const typed = encodeRecoveryKey(key).toLowerCase().replace(/-/g, ' ');
    const restored = new FakeDevice('phone');
    const res = await syncOnce(restored, await clientFor(decodeRecoveryKey(typed)));
    expect(res.newer).toBe(false);
    expect(restored.dump()).toEqual(a.dump());
    expect(restored.get('tasks', 't1')!.title).toBe('Renamed');
    // and it can keep going: its edit reaches the first device
    restored.edit('tasks', 't2', { title: 'From the phone' });
    await syncOnce(restored, await clientFor(key));
    await syncOnce(a, ca);
    expect(a.get('tasks', 't2')!.title).toBe('From the phone');
  });

  it('a snapshot written by A while B pushes loses nothing', async () => {
    const key = generateKey();
    const [ca, cb, cc] = [await clientFor(key), await clientFor(key), await clientFor(key)];
    const a = new FakeDevice('aaa'), b = new FakeDevice('bbb');
    for (let i = 0; i < 4; i++) { a.add('tasks', 't' + i, { title: 'Step ' + i }); await syncOnce(a, ca); }
    await syncOnce(b, cb);

    // A is caught up and will snapshot at its seq; B pushes first, then A's snapshot lands.
    b.edit('tasks', 't1', { title: 'B was here' });
    b.add('tasks', 'tb', { title: 'From B' });
    const aState = await a.loadState();
    await syncOnce(b, cb);
    await ca.putSnapshot(buildSnapshot(await a.all(), aState.seq));
    // and an older snapshot, from a device that was slow, arrives afterwards
    await ca.putSnapshot(buildSnapshot(await a.all(), Math.max(1, aState.seq - 2)));

    await syncOnce(a, ca);
    await syncOnce(b, cb);
    const joined = new FakeDevice('ccc');
    await syncOnce(joined, cc);
    expect(joined.dump()).toEqual(b.dump());
    expect(a.dump()).toEqual(b.dump());
    expect(joined.get('tasks', 't1')!.title).toBe('B was here');
    expect(joined.get('tasks', 'tb')).toBeDefined();
  });

  it('a wrong key cannot read or write', async () => {
    const key = generateKey();
    const a = new FakeDevice('aaa');
    a.add('tasks', 't1', { title: 'Secret' });
    await syncOnce(a, await clientFor(key));

    const ck = await deriveKeys(key);
    const strangerKeys = await deriveKeys(generateKey());
    // Right space, wrong secret: the relay says no.
    const wrongAuth = new RelayClient(BASE, { ...ck, authSecret: strangerKeys.authSecret }, viaWorker);
    await expect(wrongAuth.pull(0)).rejects.toMatchObject({ status: 403 });
    await expect(wrongAuth.push({ v: SCHEMA_VERSION, device: 'x', docs: [] })).rejects.toBeInstanceOf(RelayError);
    // Right secret and space, wrong encryption key (a relay operator, say): the data stays unreadable.
    const wrongEnc = new RelayClient(BASE, { ...ck, encKey: strangerKeys.encKey }, viaWorker);
    await expect(wrongEnc.pull(0)).rejects.toBeInstanceOf(DecryptError);
    // Another person's space is simply not there.
    await expect(new RelayClient(BASE, strangerKeys, viaWorker).pull(0)).rejects.toMatchObject({ status: 404 });
  });

  it('a newer schema makes the device stop and leaves the data on the relay', async () => {
    const key = generateKey();
    const [ca, cb] = [await clientFor(key), await clientFor(key)];
    await ca.push({ v: SCHEMA_VERSION + 1, device: 'future', docs: [{ c: 'tasks', d: create<Record<string, unknown>>('t1', { title: 'New shape' }, SCHEMA_VERSION + 1, '0000000000001:0000:future') }] });
    const b = new FakeDevice('bbb');
    const r = await syncOnce(b, cb);
    expect(r.newer).toBe(true);
    expect(b.get('tasks', 't1')).toBeUndefined();
    expect(r.state.seq).toBe(0); // it will pull this again after a reload
  });

  it('delete everywhere and device names', async () => {
    const key = generateKey();
    const c = await clientFor(key);
    const a = new FakeDevice('aaa');
    a.add('tasks', 't1', { title: 'x' });
    await syncOnce(a, c);
    await c.touchDevice('aaa', 'Laptop');
    await c.touchDevice('bbb');
    const list = await c.devices();
    expect(list.map(d => [d.device, d.name]).sort()).toEqual([['aaa', 'Laptop'], ['bbb', null]]);
    await c.deleteSpace();
    await expect(c.pull(0)).rejects.toMatchObject({ status: 404 });
  });

  it('a drop left by a browser that holds nothing is opened only by the person, then deleted', async () => {
    const key = generateKey();
    const keys = await deriveKeys(key);
    const c = await clientFor(key);
    const a = new FakeDevice('aaa');
    a.add('tasks', 't1', { title: 'x' });
    await syncOnce(a, c); // the space exists
    const inbox = await deriveInbox(key);
    const cs = { v: 1, changes: [{ op: 'task.done', id: 't1' }] };

    // the drop page knows the space id, the public key and the relay's address; nothing secret
    const id = await postToInbox(BASE, keys.spaceId, await sealToInbox(keys.spaceId, inbox.publicKey, cs), viaWorker);
    await expect(postToInbox(BASE, keys.spaceId, 'A'.repeat(100_000), viaWorker)).rejects.toMatchObject({ code: 'too_large' });
    const stranger = await deriveKeys(generateKey());
    await expect(postToInbox(BASE, stranger.spaceId, await sealToInbox(stranger.spaceId, inbox.publicKey, cs), viaWorker)).rejects.toMatchObject({ status: 404, code: 'unknown_space' });

    // a second device, restored from the key alone, finds it and opens it
    const other = await clientFor(key);
    const items = await other.inbox();
    expect(items.map(i => i.id)).toEqual([id]);
    expect(await openFromInbox(keys.spaceId, await deriveInbox(key), items[0]!.blob)).toEqual(cs);
    // someone else's key cannot
    await expect(openFromInbox(keys.spaceId, await deriveInbox(generateKey()), items[0]!.blob)).rejects.toBeInstanceOf(InboxError);

    await other.deleteInboxItem(id);
    expect(await c.inbox()).toEqual([]);
    // a wrong secret reads nothing
    await expect(new RelayClient(BASE, { ...keys, authSecret: stranger.authSecret }, viaWorker).inbox()).rejects.toMatchObject({ status: 403 });
  });

  it('the connector switch through the client: on with a code, a fresh code, status, off', async () => {
    const key = generateKey();
    const c = await clientFor(key);
    const a = new FakeDevice('aaa');
    a.add('tasks', 't1', { title: 'x' });
    await syncOnce(a, c);
    expect(await c.connectorStatus()).toMatchObject({ on: false, lastUsed: null });
    await expect(c.connectorCode()).rejects.toMatchObject({ code: 'connector_off' });
    const on = await c.connectorOn();
    expect(on).toMatchObject({ on: true });
    expect(on.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(on.url).toMatch(/\/mcp$/);
    expect((await c.connectorCode()).code).not.toBe(on.code);
    expect(await c.connectorStatus()).toMatchObject({ on: true, url: on.url });
    expect((await c.devices()).map(d => d.name)).toContain('Connector');
    expect(await c.connectorOff()).toMatchObject({ ok: true });
    expect(await c.connectorStatus()).toMatchObject({ on: false });
    expect((await c.devices()).map(d => d.name)).not.toContain('Connector');
  });
});
