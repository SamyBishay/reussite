import { env } from 'cloudflare:workers';
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { decryptPush } from '../../src/push/encrypt';
import { verifyVapid } from '../../src/push/vapid';
import { fromUtf8 } from '../../src/sync/bytes';
import worker from '../src/index';
import type { Env } from '../src/env';
import { DEVICE_KEEP_MS, MAX_TRIES, runTick, TICK_LIMIT } from '../src/tick';
import { countAll, deviceRow, held, item, newDevice, pcall, pushStub, putSchedule, register, seed } from './push.helpers';

// 2026-10-20 18:30:00 UTC: minute 30, so no pruning unless a test says so.
const T = Date.parse('2026-10-20T18:30:00Z');
const MIN = 60_000;
const HOUR_PLUS = (m: number) => Date.parse('2026-10-20T19:00:00Z') + m * MIN;
/** A tick against a stub push service, with bindings overridden. */
const run = (now: number, deps: { fetch: typeof fetch }, over: Partial<Env> = {}) => runTick({ ...(env as unknown as Env), ...over }, now, deps);

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM push_items'), env.DB.prepare('DELETE FROM push_devices')]);
});

describe('a tick', () => {
  it('sends what is due (with 5 s of grace), deletes it, and leaves the rest', async () => {
    const d = await newDevice();
    await seed(d, [await item(d, 'c', T - 1000), await item(d, 'a', T - 3 * MIN), await item(d, 'b', T - MIN), await item(d, 'later', T + MIN), await item(d, 'soon', T + 4000, { text: { title: 'soon' } })]);
    const stub = pushStub();
    const r = await run(T, stub);
    expect(r).toMatchObject({ due: 4, sent: 4, retried: 0, dropped: 0, gone: 0 });
    const texts = await Promise.all(stub.seen.map(async m => JSON.parse(fromUtf8(await decryptPush(m.body, d.receiver)))));
    expect(texts.map(t => t.title).sort()).toEqual(['a', 'b', 'c', 'soon']);
    expect((await held(d.pid)).map(i => i.id)).toEqual(['later']);
    expect(await deviceRow(d.pid)).toMatchObject({ fails: 0, last_status: 201, last_sent: T });
  });

  it('sends what the push service needs: endpoint, encoding, urgency, TTL left, and one VAPID token per audience', async () => {
    const a = await newDevice('https://one.push.test/a'), b = await newDevice('https://one.push.test/b'), c = await newDevice('https://two.push.test/c');
    await seed(a, [await item(a, 'x', T - 30_000, { ttl: 600, urgency: 'normal' })]);
    await seed(b, [await item(b, 'x', T)]);
    await seed(c, [await item(c, 'x', T)]);
    const stub = pushStub();
    const r = await run(T, stub);
    expect(r).toMatchObject({ sent: 3, signed: 2 });
    const byUrl = new Map(stub.seen.map(m => [m.url, m]));
    expect(byUrl.get('https://one.push.test/a')!.headers.get('TTL')).toBe('570');
    expect(byUrl.get('https://one.push.test/a')!.headers.get('Urgency')).toBe('normal');
    expect(byUrl.get('https://one.push.test/b')!.headers.get('Urgency')).toBe('high');
    for (const m of stub.seen) expect(m.headers.get('Content-Encoding')).toBe('aes128gcm');
    const auth = (u: string) => byUrl.get(u)!.headers.get('Authorization')!;
    expect(auth('https://one.push.test/a')).toBe(auth('https://one.push.test/b')); // signed once for the audience
    expect(auth('https://one.push.test/a')).not.toBe(auth('https://two.push.test/c'));
    for (const [url, aud] of [['https://one.push.test/a', 'https://one.push.test'], ['https://two.push.test/c', 'https://two.push.test']] as const) {
      const m = /^vapid t=([^,]+), k=(\S+)$/.exec(auth(url))!;
      expect(m[2]).toBe(env.VAPID_PUBLIC_KEY);
      expect(await verifyVapid(m[1]!, env.VAPID_PUBLIC_KEY, T)).toMatchObject({ aud, sub: 'https://relay.test' });
    }
  });

  it('is end to end: an item scheduled over HTTP arrives decryptable', async () => {
    const d = await newDevice();
    await register(d);
    const soon = Date.now() + 1000;
    await putSchedule(d, [await item(d, 'fixed:x:2026-10-20', soon, { text: { title: 'Leave now · 19:00' } })]);
    const stub = pushStub();
    await run(soon, stub);
    expect(JSON.parse(fromUtf8(await decryptPush(stub.seen[0]!.body, d.receiver)))).toEqual({ title: 'Leave now · 19:00' });
    expect(await held(d.pid)).toEqual([]);
  });

  it('sends at most 36 a tick, oldest first, and the overflow carries to the next', async () => {
    const devices = await Promise.all(Array.from({ length: 5 }, () => newDevice()));
    let k = 0;
    for (const d of devices) {
      const items = [];
      for (let i = 0; i < 10; i++) items.push(await item(d, 'i' + i, T - (50 - k++) * 1000));
      await seed(d, items);
    }
    const stub = pushStub();
    expect(TICK_LIMIT).toBe(36);
    expect(await run(T, stub)).toMatchObject({ due: 36, sent: 36 });
    expect(stub.seen).toHaveLength(36);
    const left = (await env.DB.prepare('SELECT at FROM push_items').all<{ at: number }>()).results;
    expect(left).toHaveLength(14);
    expect(Math.min(...left.map(r => r.at))).toBe(T - 14_000); // the 14 newest are left
    expect(await run(T + MIN, stub)).toMatchObject({ due: 14, sent: 14 });
    expect(await countAll('push_items')).toBe(0);
  });

  it('sends six at a time', async () => {
    const d = await newDevice();
    await seed(d, await Promise.all(Array.from({ length: 20 }, (_, i) => item(d, 'i' + i, T - i))));
    const stub = pushStub(() => 201, 5);
    await run(T, stub);
    expect(stub.seen).toHaveLength(20);
    expect(stub.peak()).toBe(6);
  });

  it('sends nothing before the 5 s grace, and nothing after the TTL', async () => {
    const d = await newDevice();
    await seed(d, [
      await item(d, 'early', T + 4000), await item(d, 'toosoon', T + 6000),
      await item(d, 'edge', T - 600_000, { ttl: 600 }), // expires exactly now: still goes
      await item(d, 'stale', T - 601_000, { ttl: 600 }),
    ]);
    const stub = pushStub();
    const r = await run(T, stub);
    expect(r.sent).toBe(2);
    expect((await held(d.pid)).map(i => i.id).sort()).toEqual(['stale', 'toosoon']);
    expect(stub.seen.find(m => m.headers.get('TTL') === '0')).toBeTruthy();
  });

  it('deletes the device and its items when the push service says 410 or 404', async () => {
    const gone = await newDevice('https://push.test/gone'), missing = await newDevice('https://push.test/missing'), fine = await newDevice('https://push.test/fine');
    for (const d of [gone, missing, fine]) await seed(d, [await item(d, 'a', T - 2000), await item(d, 'b', T + MIN)]);
    const stub = pushStub(url => (url.endsWith('/gone') ? 410 : url.endsWith('/missing') ? 404 : 201));
    const r = await run(T, stub);
    expect(r).toMatchObject({ sent: 1, gone: 2 });
    expect(await deviceRow(gone.pid)).toBeNull();
    expect(await deviceRow(missing.pid)).toBeNull();
    expect(await held(gone.pid)).toEqual([]);
    expect(await held(missing.pid)).toEqual([]);
    expect(await deviceRow(fine.pid)).not.toBeNull();
    expect((await held(fine.pid)).map(i => i.id)).toEqual(['b']);
  });

  it('retries 429, 5xx and unreachable services on later ticks, then gives up after three sends', async () => {
    const d = await newDevice();
    await seed(d, [await item(d, 'a', T, { ttl: 3600 })]);
    let status = 503;
    const stub = pushStub(() => status);
    expect(MAX_TRIES).toBe(3);
    expect(await run(T, stub)).toMatchObject({ sent: 0, retried: 1 });
    expect(await held(d.pid)).toMatchObject([{ id: 'a', tries: 1 }]);
    status = 429;
    expect(await run(T + MIN, stub)).toMatchObject({ retried: 1 });
    expect(await held(d.pid)).toMatchObject([{ tries: 2 }]);
    expect(await deviceRow(d.pid)).toMatchObject({ fails: 2, last_status: 429, last_sent: null });
    expect(await run(T + 2 * MIN, stub)).toMatchObject({ retried: 0, dropped: 1 });
    expect(await held(d.pid)).toEqual([]);
    expect(stub.seen).toHaveLength(3);
    expect(await deviceRow(d.pid)).not.toBeNull(); // a service that is down is not a reason to forget the device

    // a retry that works ends it
    await seed(d, [await item(d, 'b', T, { ttl: 3600 })]);
    status = 502;
    await run(T + 3 * MIN, stub);
    status = 201;
    expect(await run(T + 4 * MIN, stub)).toMatchObject({ sent: 1 });
    expect(await held(d.pid)).toEqual([]);
    expect(await deviceRow(d.pid)).toMatchObject({ fails: 0, last_status: 201 });
  });

  it('an unreachable push service counts as a retry; a retry stops at the TTL', async () => {
    const d = await newDevice();
    await seed(d, [await item(d, 'a', T, { ttl: 100 })]);
    const down = (async () => { throw new TypeError('network'); }) as typeof fetch;
    expect(await run(T, { fetch: down })).toMatchObject({ retried: 1 });
    expect(await run(T + 99_000, { fetch: down })).toMatchObject({ retried: 1 });
    expect(await held(d.pid)).toMatchObject([{ tries: 2 }]);
    expect(await run(T + 101_000, pushStub())).toMatchObject({ due: 0, sent: 0 }); // past the TTL
  });

  it('drops an item the push service refuses for good (400, 413), keeps the device', async () => {
    const d = await newDevice();
    await seed(d, [await item(d, 'a', T - 1000), await item(d, 'b', T)]);
    const stub = pushStub((_, n) => (n === 1 ? 400 : 413));
    expect(await run(T, stub)).toMatchObject({ dropped: 2, sent: 0 });
    expect(await held(d.pid)).toEqual([]);
    expect(await deviceRow(d.pid)).toMatchObject({ fails: 1, last_status: 413 });
  });

  it('does not send to an endpoint that is no longer on the allow-list', async () => {
    const d = await newDevice('https://push.test/x');
    await seed(d, [await item(d, 'a', T)]);
    const stub = pushStub();
    expect(await run(T, stub, { PUSH_HOSTS: 'fcm.googleapis.com' })).toMatchObject({ dropped: 1, sent: 0 });
    expect(stub.seen).toHaveLength(0);
  });

  it('does nothing without VAPID keys, and leaves the items for later', async () => {
    const d = await newDevice();
    await seed(d, [await item(d, 'a', T)]);
    const stub = pushStub();
    expect(await run(T, stub, { VAPID_PRIVATE_KEY: undefined })).toMatchObject({ due: 0, sent: 0 });
    expect(await run(T, stub, { VAPID_PUBLIC_KEY: 'REPLACE_WITH_VAPID_PUBLIC_KEY' })).toMatchObject({ due: 0, sent: 0 });
    expect(stub.seen).toHaveLength(0);
    expect(await held(d.pid)).toHaveLength(1);
    expect(await run(T, stub)).toMatchObject({ sent: 1 });
  });

  it('an idle tick is one query', async () => {
    expect(await run(T, pushStub())).toEqual({ due: 0, sent: 0, retried: 0, dropped: 0, gone: 0, signed: 0 });
  });
});

describe('the hourly prune', () => {
  const HOUR = Date.parse('2026-10-20T19:00:00Z');

  it('forgets devices with no schedule write for 45 days, items past their TTL, and orphans', async () => {
    const fresh = await newDevice(), stale = await newDevice(), edge = await newDevice();
    await seed(fresh, [await item(fresh, 'old', HOUR - 2 * 3600_000, { ttl: 600 }), await item(fresh, 'future', HOUR + 86_400_000), await item(fresh, 'running', HOUR - 100_000, { ttl: 3600 })], { updated: HOUR - DEVICE_KEEP_MS + MIN });
    await seed(stale, [await item(stale, 'x', HOUR + 86_400_000)], { updated: HOUR - DEVICE_KEEP_MS - MIN });
    await seed(edge, [], { updated: HOUR - DEVICE_KEEP_MS });
    await env.DB.prepare("INSERT INTO push_items (pid, id, at, ttl, urgency, blob) VALUES ('nobody', 'o', ?1, 600, 'high', 'x')").bind(HOUR + 1000).run();

    const stub = pushStub(() => 503); // nothing is sent now; `running` is due and fails, staying for a retry
    await run(HOUR, stub);
    expect(await deviceRow(stale.pid)).toBeNull();
    expect(await held(stale.pid)).toEqual([]);
    expect(await deviceRow(fresh.pid)).not.toBeNull();
    expect(await deviceRow(edge.pid)).not.toBeNull(); // exactly 45 days is not yet older
    expect((await held(fresh.pid)).map(i => i.id).sort()).toEqual(['future', 'running']);
    expect(await countAll('push_items')).toBe(2);
  });

  it('only runs at minute 0', async () => {
    const stale = await newDevice();
    await seed(stale, [], { updated: 1 });
    await run(HOUR_PLUS(1), pushStub());
    expect(await deviceRow(stale.pid)).not.toBeNull();
    await run(HOUR_PLUS(0), pushStub());
    expect(await deviceRow(stale.pid)).toBeNull();
  });

  it('prunes even when there is nothing to send, and even without VAPID keys', async () => {
    const stale = await newDevice();
    await seed(stale, [], { updated: 1 });
    await run(HOUR_PLUS(0), pushStub(), { VAPID_PRIVATE_KEY: undefined });
    expect(await deviceRow(stale.pid)).toBeNull();
  });
});

describe('the cron entry point', () => {
  it('runs a tick when scheduled', async () => {
    const d = await newDevice('https://push.test/none');
    await seed(d, [await item(d, 'a', Date.now() - 1_000_000, { ttl: 60 })]); // stale: nothing is sent, so no network
    const ctx = createExecutionContext();
    await worker.scheduled!(createScheduledController({ scheduledTime: new Date(T) }), env as never, ctx);
    await waitOnExecutionContext(ctx);
    expect(await countAll('push_items')).toBe(1); // untouched at minute 30
  });
});
