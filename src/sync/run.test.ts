import { describe, expect, it } from 'vitest';
import { RelayClient } from './client';
import { openFromText } from './crypto';
import { deriveKeys, generateKey } from './keys';
import { buildSnapshot } from './engine';
import { FULL_EVERY_MS } from './parts';
import { SNAPSHOT_EVERY, syncOnce } from './run';
import { fakeRelay, FakeDevice } from './testing';
import { decodeSnapshot } from './wire';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-19T10:00:00Z');

async function setup() {
  const keys = await deriveKeys(generateKey());
  const relay = fakeRelay();
  const client = () => new RelayClient('https://relay.test', keys, relay.fetch);
  const space = () => [...relay.spaces.values()][0]!;
  const snap = async (blob: string | undefined) => (blob ? decodeSnapshot(await openFromText(keys, blob)) : null);
  return { keys, relay, client, space, snap };
}

describe('the snapshot a device uploads', () => {
  it('comes after 8 batches, in two parts, with the cut remembered', async () => {
    expect(SNAPSHOT_EVERY).toBe(8);
    const { client, space, snap } = await setup();
    const a = new FakeDevice('aaa');
    const c = client();
    for (let i = 0; i < 8; i++) { a.add('tasks', 't' + i, { title: 'Step ' + i, status: 'open' }); await syncOnce(a, c, { now: () => NOW }); }
    expect(space().snapshot).toBeNull(); // a device's own batches reach its count on the round after
    a.add('tasks', 't8', { title: 'Step 8', status: 'open' });
    await syncOnce(a, c, { now: () => NOW });
    expect(space().snapshot).toMatchObject({ upto: 8 });
    const hot = await snap(space().snapshot?.blob);
    const cold = await snap(space().cold?.blob);
    expect(hot).toMatchObject({ part: 'hot', cut: { day: '2026-10-19', wall: NOW } });
    expect(cold?.part).toBe('cold');
    expect((await a.loadState()).cut).toEqual(hot!.cut);
    expect(hot!.docs.tasks).toHaveLength(9);
  });

  it('is only the hot part while the cut is recent, and both again after a week', async () => {
    const { client, space, snap } = await setup();
    const a = new FakeDevice('aaa');
    const c = client();
    const at = (n: number) => ({ snapshotEvery: 1, now: () => NOW + n });
    a.add('tasks', 't0', { title: 'x', status: 'open' });
    await syncOnce(a, c, at(0));
    await syncOnce(a, c, at(0));
    const cold1 = space().cold!.blob;
    const cut1 = (await a.loadState()).cut!;
    a.add('tasks', 't1', { title: 'y', status: 'open' });
    await syncOnce(a, c, at(2 * DAY));
    await syncOnce(a, c, at(2 * DAY));
    expect(space().cold!.blob).toBe(cold1); // not rewritten
    expect((await snap(space().snapshot!.blob))!.cut).toEqual(cut1);
    expect((await snap(space().snapshot!.blob))!.docs.tasks).toHaveLength(2);
    a.add('tasks', 't2', { title: 'z', status: 'open' });
    await syncOnce(a, c, at(FULL_EVERY_MS + DAY));
    await syncOnce(a, c, at(FULL_EVERY_MS + DAY));
    expect(space().cold!.blob).not.toBe(cold1);
    expect((await a.loadState()).cut!.wall).toBe(NOW + FULL_EVERY_MS + DAY);
  });

  it('is both parts when the relay holds a whole snapshot, which a hot part alone would replace', async () => {
    const { client, space, snap } = await setup();
    const a = new FakeDevice('aaa'), b = new FakeDevice('bbb');
    const c = client();
    a.add('tasks', 't0', { title: 'x', status: 'open' });
    await syncOnce(a, c);
    await syncOnce(a, c);
    await c.putSnapshot(buildSnapshot(await a.all(), 1)); // what an older app uploads
    expect(space().cold).toBeNull();
    // b learns there is no cold part, so its first snapshot writes both
    await syncOnce(b, c, { snapshotEvery: 1, now: () => NOW });
    b.add('tasks', 't1', { title: 'y', status: 'open' });
    await syncOnce(b, c, { snapshotEvery: 1, now: () => NOW });
    await syncOnce(b, c, { snapshotEvery: 1, now: () => NOW });
    expect((await snap(space().snapshot!.blob))!.part).toBe('hot');
    expect(space().cold).not.toBeNull();
    const fresh = new FakeDevice('ccc');
    await syncOnce(fresh, c);
    expect(fresh.dump()).toEqual(b.dump());
  });
});
