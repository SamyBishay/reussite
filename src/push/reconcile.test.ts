import { describe, expect, it } from 'vitest';
import type { ScheduleItem } from '../domain/notify';
import { decryptPush, type ReceiverKeys } from './encrypt';
import { planUpload, readSent, type Sent } from './reconcile';
import { MAX_PUSH_ITEMS } from './protocol';
import { newReceiver } from './testing';
import { b64uDecode, fromUtf8 } from '../sync/bytes';

const NOW = Date.UTC(2026, 9, 20, 8, 0);
const item = (id: string, minutes: number, text = 'Start'): ScheduleItem => ({ id, type: 'fixed', at: NOW + minutes * 60_000, ttl: 600, text });
// A cheap stand-in for encryption: the diff is what is under test here; the round trip is below.
const fake = async (_: unknown, json: unknown) => 'enc:' + String(json);

describe('planUpload', () => {
  let rx: ReceiverKeys;
  const sub = async () => (rx ??= await newReceiver());

  it('uploads everything the first time, encrypted for the subscription', async () => {
    const r = await sub();
    const p = await planUpload([item('launch:a:0', 10, '▶ Start'), item('launch:a:1', 20)], r, {}, NOW);
    expect(p.keep).toEqual([]);
    expect(p.items.map(i => i.id)).toEqual(['launch:a:0', 'launch:a:1']);
    expect(p.items[0]).toMatchObject({ at: NOW + 600_000, ttl: 600 });
    expect(p.dirty).toBe(true);
    const open = JSON.parse(fromUtf8(await decryptPush(b64uDecode(p.items[0]!.blob), r)));
    expect(open).toMatchObject({ title: 'Réussite', body: '▶ Start', tag: 'launch:a:0' });
  });

  it('sends unchanged items as keep and encrypts only the ones that changed', async () => {
    const r = await sub();
    const first = await planUpload([item('a', 10), item('b', 20), item('c', 30)], r, {}, NOW, fake);
    let calls = 0;
    const counting = async (s: unknown, j: unknown) => { calls++; return fake(s, j); };
    const p = await planUpload([item('a', 10), item('b', 25), item('c', 30), item('d', 40)], r, first.next, NOW, counting);
    expect(p.keep).toEqual(['a', 'c']);
    expect(p.items.map(i => i.id)).toEqual(['b', 'd']);
    expect(calls).toBe(2);
    expect(Object.keys(p.next).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a changed text is a change; the same text is not', async () => {
    const r = await sub();
    const first = await planUpload([item('a', 10, 'Start')], r, {}, NOW, fake);
    expect((await planUpload([item('a', 10, 'Start')], r, first.next, NOW, fake)).dirty).toBe(false);
    expect((await planUpload([item('a', 10, 'Start · Write')], r, first.next, NOW, fake)).items).toHaveLength(1);
  });

  it('forgets removed items: they are in neither items nor keep, and make the plan dirty', async () => {
    const r = await sub();
    const first = await planUpload([item('a', 10), item('b', 20)], r, {}, NOW, fake);
    const p = await planUpload([item('a', 10)], r, first.next, NOW, fake);
    expect(p.keep).toEqual(['a']);
    expect(p.items).toEqual([]);
    expect(p.removed).toBe(1);
    expect(p.dirty).toBe(true);
    expect(Object.keys(p.next)).toEqual(['a']);
  });

  it('does not count an item whose time has passed as something to take away', async () => {
    const r = await sub();
    const first = await planUpload([item('a', 10), item('b', 20)], r, {}, NOW, fake);
    const p = await planUpload([item('b', 20)], r, first.next, NOW + 11 * 60_000, fake);
    expect(p.removed).toBe(0);
    expect(p.dirty).toBe(false);
  });

  it('a new subscription (another auth secret) re-sends everything', async () => {
    const r = await sub();
    const first = await planUpload([item('a', 10), item('b', 20)], r, {}, NOW, fake);
    const other = await newReceiver();
    const p = await planUpload([item('a', 10), item('b', 20)], other, first.next, NOW, fake);
    expect(p.keep).toEqual([]);
    expect(p.items).toHaveLength(2);
  });

  it('caps keep + items at the relay limit, and ignores a repeated id', async () => {
    const r = await sub();
    const many = Array.from({ length: MAX_PUSH_ITEMS + 30 }, (_, i) => item('i' + i, i + 1));
    const first = await planUpload(many, r, {}, NOW, fake);
    expect(first.items).toHaveLength(MAX_PUSH_ITEMS);
    const again = await planUpload([...many, item('i0', 1)], r, first.next, NOW, fake);
    expect(again.keep).toHaveLength(MAX_PUSH_ITEMS);
    expect(again.items.length + again.keep.length).toBeLessThanOrEqual(MAX_PUSH_ITEMS);
    expect(again.dirty).toBe(false);
  });
});

describe('readSent', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const v: unknown = { a: ['h', 5], b: ['h'], c: 'x', d: [1, 2] };
    expect(readSent(v)).toEqual({ a: ['h', 5] } satisfies Sent);
    expect(readSent(null)).toEqual({});
    expect(readSent('nope')).toEqual({});
  });
});
