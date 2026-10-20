import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { decryptPush, encryptPushBlob } from '../../src/push/encrypt';
import { MAX_PUSH_BLOB_CHARS, pushPath } from '../../src/push/protocol';
import { fromUtf8 } from '../../src/sync/bytes';
import { verifyVapid } from '../../src/push/vapid';
import type { Env } from '../src/env';
import { checkEndpoint } from '../src/webpush';
import { APP } from './helpers';
import { countAll, deviceRow, held, item, newDevice, pcall, pushStub, putSchedule, register } from './push.helpers';

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM push_items'), env.DB.prepare('DELETE FROM push_devices')]);
});

const NOW = () => Date.now();

describe('registering a device', () => {
  it('the first write sets the secret (only its hash is kept); the same secret updates the endpoint', async () => {
    const d = await newDevice();
    const a = await register(d);
    expect(a).toMatchObject({ status: 201, body: { ok: true } });
    const row = await deviceRow(d.pid);
    expect(row!.auth_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row!.auth_hash).not.toBe(d.secret);
    expect(row!.endpoint).toBe(d.endpoint);

    const moved = 'https://sub.push.test/new/endpoint';
    const b = await pcall('PUT', pushPath(d.pid), d, { body: { endpoint: moved } });
    expect(b).toMatchObject({ status: 200, body: { ok: true } });
    expect((await deviceRow(d.pid))!.endpoint).toBe(moved);
  });

  it('refuses a missing, malformed or wrong secret and changes nothing', async () => {
    const d = await newDevice(), other = await newDevice();
    await register(d);
    const before = await deviceRow(d.pid);
    expect((await register(d, { auth: false })).status).toBe(401);
    expect((await register(d, { auth: 'short' })).status).toBe(401);
    const wrong = await register(d, { auth: other.secret });
    expect(wrong).toMatchObject({ status: 403, body: { error: 'forbidden' } });
    expect(await deviceRow(d.pid)).toEqual(before);
    expect(await countAll('push_devices')).toBe(1);
  });

  it('refuses a bad push id or body', async () => {
    const d = await newDevice();
    expect((await pcall('PUT', '/v1/push/short', d, { body: { endpoint: d.endpoint } })).status).toBe(400);
    expect((await pcall('PUT', pushPath(d.pid), d, { body: {} })).body).toEqual({ error: 'bad_endpoint' });
    expect((await pcall('PUT', pushPath(d.pid), d, { body: { endpoint: 5 } })).status).toBe(400);
    expect((await pcall('PUT', pushPath(d.pid), d, { body: [1] })).status).toBe(400);
    expect(await countAll('push_devices')).toBe(0);
  });

  it('refuses endpoints that are not on the allow-list, and stores nothing', async () => {
    const d = await newDevice();
    for (const endpoint of [
      'http://push.test/x', // not https
      'https://evil.example/x', // other host
      'https://1.2.3.4/x', // IP literals
      'https://[::1]/x',
      'https://169.254.169.254/latest/meta-data',
      'https://push.test@evil.example/x', // userinfo trick: the host is evil.example
      'https://evil.example\\@push.test/x', // backslash trick: the host is evil.example
      'https://push.test:pass@push.test/x', // credentials, even on an allowed host
      'https://push.test.evil.example/x', // allowed name as a prefix
      'https://evilpush.test/x', // wildcard needs a dot
      'https://push.test:8443/x', // other port
      'https://push.test./x', // trailing dot
      'ftp://push.test/x', 'javascript:alert(1)', '//push.test/x', 'push.test', '',
    ]) {
      const r = await register(d, { body: { endpoint } });
      expect(r.status, endpoint).toBe(400);
      expect(r.body, endpoint).toEqual({ error: 'bad_endpoint' });
    }
    expect(await countAll('push_devices')).toBe(0);
    expect((await register(d, { body: { endpoint: 'https://push.test/' + 'a'.repeat(600) } })).status).toBe(400);
    expect((await register(d, { body: { endpoint: 'https://sub.push.test/ok' } })).status).toBe(201);
  });
});

describe('the endpoint allow-list', () => {
  const hosts = 'updates.push.services.mozilla.com,fcm.googleapis.com,*.push.apple.com,*.notify.windows.com';
  const ok = (e: string, h = hosts) => checkEndpoint(e, { PUSH_HOSTS: h }) !== null;

  it('takes the four push services, with any path', () => {
    expect(ok('https://fcm.googleapis.com/fcm/send/abc:def')).toBe(true);
    expect(ok('https://updates.push.services.mozilla.com/wpush/v2/gAAAA')).toBe(true);
    expect(ok('https://web.push.apple.com/QL3abc')).toBe(true);
    expect(ok('https://db5p.notify.windows.com/?token=abc')).toBe(true);
    expect(ok('HTTPS://FCM.GOOGLEAPIS.COM/x')).toBe(true);
  });

  it('refuses lookalikes, a bare wildcard parent, IPs and plain http', () => {
    for (const e of [
      'https://push.apple.com/x', 'https://notapple.com/x', 'https://x.push.apple.com.evil.example/x', 'https://fcm.googleapis.com.evil.example/x',
      'https://evil.example/fcm.googleapis.com', 'https://evil.example?fcm.googleapis.com', 'https://evil.example#@fcm.googleapis.com',
      'https://fcm.googleapis.com@evil.example/x', 'https://127.0.0.1/x', 'https://0x7f.1/x', 'https://2130706433/x', 'https://localhost/x',
      'http://fcm.googleapis.com/x', 'http://localhost:8080/x', 'https://fcm.googleapis.com:444/x',
    ]) expect(ok(e), e).toBe(false);
  });

  it('allows plain http only for localhost with a port the list names, as in the local tests', () => {
    const dev = hosts + ',localhost:*,127.0.0.1:9999';
    expect(ok('http://localhost:5555/x', dev)).toBe(true);
    expect(ok('http://127.0.0.1:9999/x', dev)).toBe(true);
    expect(ok('http://127.0.0.1:9998/x', dev)).toBe(false);
    expect(ok('http://localhost/x', dev)).toBe(true); // `:*` is any port, the default one too
    expect(ok('http://localhost/x', hosts + ',localhost:5555')).toBe(false);
    expect(ok('http://localhost/x', hosts + ',localhost')).toBe(false); // no port named: https only
    expect(ok('http://[::1]:5555/x', dev)).toBe(false);
    expect(ok('http://push.test:5555/x', dev + ',push.test:5555')).toBe(false); // a name that is not local stays https-only
  });

  it('an empty list allows nothing', () => {
    expect(ok('https://fcm.googleapis.com/x', '')).toBe(false);
    expect(checkEndpoint('https://fcm.googleapis.com/x', {} as Env)).toBeNull();
  });
});

describe('the schedule', () => {
  it('stores items, replaces the schedule atomically, and keeps what keep names', async () => {
    const d = await newDevice();
    await register(d);
    const t = NOW() + 3_600_000;
    const a = await item(d, 'launch:2026-10-20:1', t), b = await item(d, 'fixed:x:2026-10-20', t + 1000, { urgency: 'normal' }), c = await item(d, 'still:y', t + 2000, { ttl: 1800 });

    const r1 = await putSchedule(d, [a, b, c]);
    expect(r1).toMatchObject({ status: 200, body: { stored: 3, held: 3 } });
    expect(await held(d.pid)).toMatchObject([{ id: a.id, urgency: 'high', ttl: 600 }, { id: b.id, urgency: 'normal' }, { id: c.id, ttl: 1800 }]);

    // b changes, a is kept as it is, c is not mentioned: it goes.
    const b2 = await item(d, b.id, t + 5000);
    const r2 = await putSchedule(d, [b2], [a.id, 'launch:never-held']);
    expect(r2.body).toEqual({ stored: 1, held: 2 });
    expect(await held(d.pid)).toMatchObject([{ id: a.id, at: t }, { id: b.id, at: t + 5000, urgency: 'high' }]);

    // empty schedule with no keep clears it
    expect((await putSchedule(d, [])).body).toEqual({ stored: 0, held: 0 });
    expect(await held(d.pid)).toEqual([]);
  });

  it("resets the retry count of an item it writes, and leaves another device's items alone", async () => {
    const d = await newDevice(), e = await newDevice();
    await register(d); await register(e);
    const t = NOW() + 60_000;
    await putSchedule(e, [await item(e, 'same-id', t)]);
    const a = await item(d, 'same-id', t);
    await putSchedule(d, [a]);
    await env.DB.prepare('UPDATE push_items SET tries = 2 WHERE pid = ?').bind(d.pid).run();
    await putSchedule(d, [a]);
    expect((await held(d.pid))[0]!.tries).toBe(0);
    await putSchedule(d, []);
    expect(await held(e.pid)).toHaveLength(1);
  });

  it('a bad request changes nothing', async () => {
    const d = await newDevice();
    await register(d);
    const t = NOW() + 60_000;
    const a = await item(d, 'a', t);
    await putSchedule(d, [a]);
    const bad: unknown[] = [
      { ...a, id: 'has space' }, { ...a, id: '' }, { ...a, id: 'x'.repeat(97) },
      { ...a, at: NOW() + 32 * 86_400_000 }, { ...a, at: NOW() - 32 * 86_400_000 }, { ...a, at: 'soon' }, { ...a, at: t + 0.5 },
      { ...a, ttl: 59 }, { ...a, ttl: 86_401 }, { ...a, ttl: 'long' },
      { ...a, urgency: 'urgent' }, { ...a, blob: 'short' }, { ...a, blob: 'a'.repeat(MAX_PUSH_BLOB_CHARS + 1) }, { ...a, blob: '!'.repeat(80) }, 5, null,
    ];
    for (const x of bad) {
      const r = await putSchedule(d, [await item(d, 'b', t), x as never]);
      expect(r.status, JSON.stringify(x)?.slice(0, 60)).toBeOneOf([400, 413]);
    }
    expect((await putSchedule(d, [a, a])).status).toBe(400); // duplicate id
    expect((await pcall('PUT', pushPath(d.pid, 'schedule'), d, { body: { items: [] } })).status).toBe(400);
    expect((await pcall('PUT', pushPath(d.pid, 'schedule'), d, { body: { items: [], keep: [1] } })).status).toBe(400);
    expect((await pcall('PUT', pushPath(d.pid, 'schedule'), d, { body: { items: 'x', keep: [] } })).status).toBe(400);
    expect(await held(d.pid)).toMatchObject([{ id: 'a' }]);
  });

  it('holds at most 150 items', async () => {
    const d = await newDevice();
    await register(d);
    const t = NOW() + 60_000;
    const blob = (await item(d, 'x', t)).blob;
    const many = (n: number, p = 'i') => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, at: t + i, ttl: 600, blob }));
    expect((await putSchedule(d, many(150))).body).toEqual({ stored: 150, held: 150 });
    expect((await putSchedule(d, many(151))).status).toBe(413);
    expect((await putSchedule(d, many(100), many(60, 'k').map(i => i.id))).status).toBe(413); // 100 + 60 distinct
    expect((await putSchedule(d, many(100), many(100).map(i => i.id))).body).toEqual({ stored: 100, held: 100 }); // keep overlapping items counts once
    expect(await held(d.pid)).toHaveLength(100);
  });

  it('refuses a wrong secret and an unknown device, and writes nothing', async () => {
    const d = await newDevice(), other = await newDevice();
    await register(d);
    const t = NOW() + 60_000;
    expect((await putSchedule(d, [await item(d, 'a', t)], [], { auth: other.secret })).status).toBe(403);
    expect((await putSchedule(d, [], [], { auth: false })).status).toBe(401);
    expect((await putSchedule(other, [await item(other, 'a', t)])).body).toEqual({ error: 'unknown_device' });
    expect(await countAll('push_items')).toBe(0);
  });

  it('a schedule write marks the device as alive', async () => {
    const d = await newDevice();
    await register(d);
    await env.DB.prepare('UPDATE push_devices SET updated = 1 WHERE pid = ?').bind(d.pid).run();
    await putSchedule(d, []);
    expect((await deviceRow(d.pid))!.updated).toBeGreaterThan(Date.now() - 5000);
  });
});

describe('sending now', () => {
  it('sends the blob to the device with the headers a push service expects and a VAPID token that verifies', async () => {
    const d = await newDevice('https://sub.push.test/wpush/abc');
    await register(d);
    const blob = await encryptPushBlob(d.receiver, { title: 'Test', body: 'It works' });
    const stub = pushStub();
    const r = await pcall('POST', pushPath(d.pid, 'send'), d, { body: { blob }, fetch: stub.fetch });
    expect(r).toMatchObject({ status: 201, body: { ok: true, status: 201 } });
    const m = stub.seen[0]!;
    expect(m.url).toBe('https://sub.push.test/wpush/abc');
    expect(m.headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(m.headers.get('TTL')).toBe('60');
    expect(m.headers.get('Urgency')).toBe('high');
    const auth = /^vapid t=([^,]+), k=(\S+)$/.exec(m.headers.get('Authorization')!)!;
    expect(auth[2]).toBe(env.VAPID_PUBLIC_KEY);
    expect(await verifyVapid(auth[1]!, env.VAPID_PUBLIC_KEY, Date.now())).toMatchObject({ aud: 'https://sub.push.test', sub: 'https://relay.test' });
    expect(fromUtf8(await decryptPush(m.body, d.receiver))).toBe('{"title":"Test","body":"It works"}');
    expect((await deviceRow(d.pid))!).toMatchObject({ last_status: 201, fails: 0 });
  });

  it('drops the device when the push service says it is gone, and reports other failures', async () => {
    const d = await newDevice(), e = await newDevice();
    await register(d); await register(e);
    const blob = await encryptPushBlob(d.receiver, 'x');
    await putSchedule(d, [await item(d, 'a', NOW() + 60_000)]);

    const failing = await pcall('POST', pushPath(e.pid, 'send'), e, { body: { blob }, fetch: pushStub(() => 503).fetch });
    expect(failing).toMatchObject({ status: 502, body: { error: 'push_failed', status: 503 } });
    expect(await deviceRow(e.pid)).toMatchObject({ fails: 1, last_status: 503 });

    const gone = await pcall('POST', pushPath(d.pid, 'send'), d, { body: { blob }, fetch: pushStub(() => 410).fetch });
    expect(gone).toMatchObject({ status: 410, body: { error: 'gone' } });
    expect(await deviceRow(d.pid)).toBeNull();
    expect(await held(d.pid)).toEqual([]);
  });

  it('checks the stored endpoint again, needs VAPID keys, and takes only a sane blob', async () => {
    const d = await newDevice();
    await register(d);
    const blob = await encryptPushBlob(d.receiver, 'x');
    const stub = pushStub();
    expect((await pcall('POST', pushPath(d.pid, 'send'), d, { body: { blob }, env: { PUSH_HOSTS: 'fcm.googleapis.com' }, fetch: stub.fetch })).body).toEqual({ error: 'bad_endpoint' });
    expect((await pcall('POST', pushPath(d.pid, 'send'), d, { body: { blob }, env: { VAPID_PRIVATE_KEY: undefined }, fetch: stub.fetch })).body).toEqual({ error: 'push_unavailable' });
    expect((await pcall('POST', pushPath(d.pid, 'send'), d, { body: { blob: 'short' }, fetch: stub.fetch })).status).toBe(400);
    expect((await pcall('POST', pushPath(d.pid, 'send'), d, { body: { blob: 'a'.repeat(MAX_PUSH_BLOB_CHARS + 1) }, fetch: stub.fetch })).status).toBe(413);
    expect((await pcall('POST', pushPath(d.pid, 'send'), d, { body: { blob }, auth: false, fetch: stub.fetch })).status).toBe(401);
    expect(stub.seen).toHaveLength(0);
  });

  it('follows no redirect', async () => {
    const d = await newDevice();
    await register(d);
    let init: RequestInit | undefined;
    const f = (async (_: unknown, i?: RequestInit) => { init = i; return new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } }); }) as typeof fetch;
    const r = await pcall('POST', pushPath(d.pid, 'send'), d, { body: { blob: await encryptPushBlob(d.receiver, 'x') }, fetch: f });
    expect(init!.redirect).toBe('manual');
    expect(r.status).toBe(502);
  });
});

describe('deleting', () => {
  it('removes the device and its items; only with the secret; a second delete is fine', async () => {
    const d = await newDevice(), other = await newDevice();
    await register(d);
    await putSchedule(d, [await item(d, 'a', NOW() + 60_000)]);
    expect((await pcall('DELETE', pushPath(d.pid), d, { auth: other.secret })).status).toBe(403);
    expect((await pcall('DELETE', pushPath(d.pid), d, { auth: false })).status).toBe(401);
    expect(await countAll('push_items')).toBe(1);
    expect((await pcall('DELETE', pushPath(d.pid), d)).body).toEqual({ ok: true, deleted: 1 });
    expect(await countAll('push_items')).toBe(0);
    expect(await countAll('push_devices')).toBe(0);
    expect((await pcall('DELETE', pushPath(d.pid), d)).body).toEqual({ ok: true, deleted: 0 });
  });
});

describe('rate limits', () => {
  it('limits new devices per IP, and counts updates per device', async () => {
    const limit = { RATE_PUSH_NEW_IP_PER_MIN: '2', RATE_PUSH_UPDATE_PER_MIN: '3' };
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await register(await newDevice(), { env: limit, ip: '5.5.5.5' })).status);
    expect(codes).toEqual([201, 201, 429, 429]);
    expect((await register(await newDevice(), { env: limit, ip: '6.6.6.6' })).status).toBe(201);

    const d = await newDevice();
    await register(d, { env: limit });
    const updates: number[] = [];
    for (let i = 0; i < 5; i++) updates.push((await register(d, { env: limit })).status);
    expect(updates).toEqual([200, 200, 200, 429, 429]);
    expect((await register(d, { env: limit })).headers.get('Retry-After')).toBe('60');
    const other = await newDevice();
    await register(other, { env: limit });
    expect((await register(other, { env: limit })).status).toBe(200);
  });

  it('limits schedule writes per device, and per IP', async () => {
    const d = await newDevice(), e = await newDevice();
    await register(d); await register(e);
    const limit = { RATE_PUSH_SCHEDULE_PER_MIN: '2' };
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await putSchedule(d, [], [], { env: limit })).status);
    expect(codes).toEqual([200, 200, 429, 429]);
    expect((await putSchedule(e, [], [], { env: limit })).status).toBe(200);

    const ipLimit = { RATE_IP_PER_MIN: '3' };
    const ips: number[] = [];
    for (let i = 0; i < 5; i++) ips.push((await putSchedule(e, [], [], { env: ipLimit, ip: '4.4.4.4' })).status);
    expect(ips).toEqual([200, 200, 200, 429, 429]);
    const wrong: number[] = [];
    for (let i = 0; i < 5; i++) wrong.push((await putSchedule(d, [], [], { env: ipLimit, ip: '3.3.3.3', auth: e.secret })).status);
    expect(wrong).toEqual([403, 403, 429, 429, 429]); // guessing costs the guesser twice: the write and the failed sign-in
  });

  it('limits test sends per device', async () => {
    const d = await newDevice();
    await register(d);
    const blob = await encryptPushBlob(d.receiver, 'x');
    const stub = pushStub();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await pcall('POST', pushPath(d.pid, 'send'), d, { body: { blob }, env: { RATE_PUSH_SEND_PER_MIN: '3' }, fetch: stub.fetch })).status);
    expect(codes).toEqual([201, 201, 201, 429, 429]);
    expect(stub.seen).toHaveLength(3);
  });

  it('default limits are the plan: 5 new per IP, 10 updates, 10 schedules, 3 sends', async () => {
    const keep = { RATE_PUSH_NEW_IP_PER_MIN: undefined, RATE_PUSH_UPDATE_PER_MIN: undefined, RATE_PUSH_SCHEDULE_PER_MIN: undefined, RATE_PUSH_SEND_PER_MIN: undefined, RATE_IP_PER_MIN: '100000' };
    const news: number[] = [];
    for (let i = 0; i < 6; i++) news.push((await register(await newDevice(), { env: keep, ip: '2.2.2.2' })).status);
    expect(news).toEqual([201, 201, 201, 201, 201, 429]);
    const d = await newDevice();
    await register(d, { env: keep });
    const upd: number[] = [];
    for (let i = 0; i < 11; i++) upd.push((await register(d, { env: keep })).status);
    expect(upd.filter(s => s === 200)).toHaveLength(10); // creating the device is not an update
    const sched: number[] = [];
    for (let i = 0; i < 11; i++) sched.push((await putSchedule(d, [], [], { env: keep })).status);
    expect(sched.filter(s => s === 200)).toHaveLength(10);
  });
});

describe('CORS and routes', () => {
  it('answers preflight for the app, refuses other origins, and is silent without an Origin', async () => {
    const d = await newDevice();
    const pre = await pcall('OPTIONS', pushPath(d.pid, 'schedule'), d, { origin: APP, auth: false });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(pre.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    const r = await register(d, { origin: APP });
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    const bad = await register(d, { origin: 'https://evil.example' });
    expect(bad).toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
    expect((await register(d)).headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('knows only its own routes and methods', async () => {
    const d = await newDevice();
    expect((await pcall('GET', pushPath(d.pid), d)).status).toBe(404);
    expect((await pcall('POST', pushPath(d.pid, 'schedule'), d, { body: {} })).status).toBe(404);
    expect((await pcall('PUT', pushPath(d.pid, 'send'), d, { body: {} })).status).toBe(404);
    expect((await pcall('PUT', pushPath(d.pid) + '/other', d, { body: {} })).status).toBe(404);
  });
});
