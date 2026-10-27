import { env } from 'cloudflare:workers';
import { describe, expect, it, beforeEach } from 'vitest';
import { b64uLength, MAX_BATCH_BYTES, MAX_SNAPSHOT_BYTES } from '../../src/sync/protocol';
import { APP, blobOf, call, newSpace, push, url, freshMinute } from './helpers';

const count = async (table: string, space: string, col = 'space') => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).bind(space).first<{ n: number }>())!.n;

describe('auth', () => {
  it('the first write sets the secret; the same secret keeps working', async () => {
    const k = await newSpace();
    const a = await push(k);
    expect(a.status).toBe(201);
    expect(a.body).toEqual({ seq: 1 });
    const row = await env.DB.prepare('SELECT auth_hash FROM spaces WHERE id = ?').bind(k.spaceId).first<{ auth_hash: string }>();
    expect(row!.auth_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row!.auth_hash).not.toBe(k.authSecret);
    expect((await push(k)).body).toEqual({ seq: 2 });
  });

  it('refuses a wrong secret everywhere and writes nothing', async () => {
    const k = await newSpace(), other = await newSpace();
    await push(k);
    const snapshot = await blobOf(k);
    const bad = other.authSecret;
    const rs = [
      await call('GET', url(k, '/changes?after=0'), k, { auth: bad }),
      await push(k, 'dev2', { auth: bad }),
      await call('PUT', url(k, '/snapshot'), k, { auth: bad, body: { upto: 1, blob: snapshot } }),
      await call('POST', url(k, '/devices/dev2'), k, { auth: bad, body: {} }),
      await call('GET', url(k, '/devices'), k, { auth: bad }),
      await call('DELETE', url(k), k, { auth: bad }),
    ];
    expect(rs.map(r => r.status)).toEqual([403, 403, 403, 403, 403, 403]);
    expect(rs[0]!.body).toEqual({ error: 'forbidden' });
    expect(await count('batches', k.spaceId)).toBe(1);
    expect(await count('snapshots', k.spaceId)).toBe(0);
    expect(await count('devices', k.spaceId)).toBe(0);
    expect(await count('spaces', k.spaceId, 'id')).toBe(1);
  });

  it('wants a bearer token, and an unknown space is not found for reads', async () => {
    const k = await newSpace();
    expect((await call('GET', url(k, '/changes'), k, { auth: false })).status).toBe(401);
    expect((await call('GET', url(k, '/changes'), k, { auth: 'short' })).status).toBe(401);
    expect((await call('GET', url(k, '/changes'), k)).status).toBe(404);
    expect((await call('GET', '/v1/spaces/not-a-space/changes', k)).status).toBe(400);
  });

  it('a wrong secret on an unknown space cannot take it from the real owner', async () => {
    const k = await newSpace(), thief = await newSpace();
    await push(k);
    expect((await push(k, 'x', { auth: thief.authSecret })).status).toBe(403);
  });
});

describe('batches and changes', () => {
  it('assigns increasing seq and returns them in order after a given point', async () => {
    const k = await newSpace();
    for (const d of ['a', 'b', 'c', 'a']) await push(k, d);
    const all = await call('GET', url(k, '/changes?after=0'), k);
    expect(all.body.batches.map((b: any) => [b.seq, b.device])).toEqual([[1, 'a'], [2, 'b'], [3, 'c'], [4, 'a']]);
    expect(all.body).toMatchObject({ head: 4, more: false, snapshot: null });
    const part = await call('GET', url(k, '/changes?after=2'), k);
    expect(part.body.batches.map((b: any) => b.seq)).toEqual([3, 4]);
    const none = await call('GET', url(k, '/changes?after=4'), k);
    expect(none.body.batches).toEqual([]);
    expect((await call('GET', url(k, '/changes?after=-1'), k)).status).toBe(400);
    expect((await call('GET', url(k, '/changes?after=x'), k)).status).toBe(400);
  });

  it('returns blobs byte for byte', async () => {
    const k = await newSpace();
    const blob = await blobOf(k);
    await call('POST', url(k, '/batches'), k, { body: { device: 'a', blob } });
    expect((await call('GET', url(k, '/changes?after=0'), k)).body.batches[0].blob).toBe(blob);
  });

  it('pages the answer', async () => {
    const k = await newSpace();
    for (let i = 0; i < 103; i++) await push(k, 'a', { env: { RATE_SPACE_PER_MIN: '1000' } });
    const p1 = await call('GET', url(k, '/changes?after=0'), k);
    expect(p1.body.batches).toHaveLength(100);
    expect(p1.body.more).toBe(true);
    const p2 = await call('GET', url(k, '/changes?after=100'), k);
    expect(p2.body.batches.map((b: any) => b.seq)).toEqual([101, 102, 103]);
    expect(p2.body.more).toBe(false);
  });

  it('rejects bad bodies and oversized blobs', async () => {
    const k = await newSpace();
    expect((await call('POST', url(k, '/batches'), k, { body: { device: 'a' } })).status).toBe(400);
    expect((await call('POST', url(k, '/batches'), k, { body: { device: 'a b', blob: await blobOf(k) } })).status).toBe(400);
    expect((await call('POST', url(k, '/batches'), k, { body: { device: 'a', blob: 'not base64 !!' + 'x'.repeat(50) } })).status).toBe(400);
    const big = await call('POST', url(k, '/batches'), k, { body: { device: 'a', blob: 'A'.repeat(b64uLength(MAX_BATCH_BYTES) + 4) } });
    expect(big).toMatchObject({ status: 413, body: { error: 'too_large' } });
    const edge = await call('POST', url(k, '/batches'), k, { body: { device: 'a', blob: 'A'.repeat(b64uLength(MAX_BATCH_BYTES)) } });
    expect(edge.status).toBe(201);
    expect(await count('batches', k.spaceId)).toBe(1);
  });
});

describe('snapshots', () => {
  it('prunes covered batches; a pull returns the snapshot and only later batches', async () => {
    const k = await newSpace();
    for (let i = 0; i < 5; i++) await push(k);
    const snap = await blobOf(k, { whole: 'space' });
    const put = await call('PUT', url(k, '/snapshot'), k, { body: { upto: 3, blob: snap } });
    expect(put).toMatchObject({ status: 200, body: { upto: 3, pruned: 3 } });
    expect(await count('batches', k.spaceId)).toBe(2);

    const fresh = await call('GET', url(k, '/changes?after=0'), k);
    expect(fresh.body.snapshot).toMatchObject({ upto: 3, blob: snap });
    expect(fresh.body.batches.map((b: any) => b.seq)).toEqual([4, 5]);
    const behind = await call('GET', url(k, '/changes?after=2'), k);
    expect(behind.body.snapshot.upto).toBe(3);
    expect(behind.body.batches.map((b: any) => b.seq)).toEqual([4, 5]);
    const current = await call('GET', url(k, '/changes?after=3'), k);
    expect(current.body.snapshot).toBeNull();
    expect(current.body.batches.map((b: any) => b.seq)).toEqual([4, 5]);

    // seq keeps rising after everything is pruned
    await call('PUT', url(k, '/snapshot'), k, { body: { upto: 5, blob: snap } });
    expect(await count('batches', k.spaceId)).toBe(0);
    expect((await push(k)).body.seq).toBe(6);
  });

  it('keeps only the latest, ignores an older one, rejects one beyond the head', async () => {
    const k = await newSpace();
    for (let i = 0; i < 4; i++) await push(k);
    expect((await call('PUT', url(k, '/snapshot'), k, { body: { upto: 5, blob: await blobOf(k) } })).status).toBe(409);
    const newer = await blobOf(k, { v: 'newer' });
    await call('PUT', url(k, '/snapshot'), k, { body: { upto: 2, blob: await blobOf(k, { v: 'older' }) } });
    await call('PUT', url(k, '/snapshot'), k, { body: { upto: 4, blob: newer } });
    expect((await call('PUT', url(k, '/snapshot'), k, { body: { upto: 3, blob: await blobOf(k) } })).body).toEqual({ upto: 4, pruned: 0 });
    expect((await call('GET', url(k, '/changes?after=0'), k)).body.snapshot).toMatchObject({ upto: 4, blob: newer });
    expect((await call('PUT', url(k, '/snapshot'), k, { body: { upto: 0, blob: newer } })).status).toBe(400);
  });

  it('writers racing past the check can not leave an older snapshot over a newer one', async () => {
    const k = await newSpace();
    for (let i = 0; i < 6; i++) await push(k);
    const [b3, b5, b4] = [await blobOf(k, { n: 3 }), await blobOf(k, { n: 5 }), await blobOf(k, { n: 4 })];
    const put = (upto: number, blob: string) => call('PUT', url(k, '/snapshot'), k, { body: { upto, blob } });
    const rs = await Promise.all([put(3, b3), put(5, b5), put(4, b4)]);
    expect(rs.every(r => r.status === 200)).toBe(true);
    const got = (await call('GET', url(k, '/changes?after=0'), k)).body;
    expect(got.snapshot).toMatchObject({ upto: 5, blob: b5 });
    expect(got.batches.map((b: any) => b.seq)).toEqual([6]);
    expect(await count('snapshots', k.spaceId)).toBe(1);
  });

  it('stores a large snapshot in parts and gives it back whole', async () => {
    const k = await newSpace();
    await push(k);
    const blob = 'AbCd'.repeat(600_000); // 2.4M characters: three parts
    expect(blob.length).toBeLessThanOrEqual(b64uLength(MAX_SNAPSHOT_BYTES));
    expect((await call('PUT', url(k, '/snapshot'), k, { body: { upto: 1, blob } })).status).toBe(200);
    expect(await count('snapshots', k.spaceId)).toBe(3);
    expect((await call('GET', url(k, '/changes?after=0'), k)).body.snapshot.blob).toBe(blob);
  });

  it('refuses a snapshot over the cap', async () => {
    const k = await newSpace();
    await push(k);
    const r = await call('PUT', url(k, '/snapshot'), k, { body: { upto: 1, blob: 'A'.repeat(b64uLength(MAX_SNAPSHOT_BYTES) + 8) } });
    expect(r).toMatchObject({ status: 413, body: { error: 'too_large' } });
  });
});

describe('devices and deleting', () => {
  it('records devices with an encrypted label, keeping the label when only seen', async () => {
    const k = await newSpace();
    await push(k);
    const label = await blobOf(k, { name: 'Phone' });
    expect((await call('POST', url(k, '/devices/d1'), k, { body: { label } })).status).toBe(200);
    expect((await call('POST', url(k, '/devices/d2'), k, { body: {} })).status).toBe(200);
    expect((await call('POST', url(k, '/devices/d1'), k, { body: {} })).status).toBe(200);
    const list = await call('GET', url(k, '/devices'), k);
    expect(list.body.devices).toHaveLength(2);
    expect(list.body.devices.find((d: any) => d.device === 'd1')).toMatchObject({ label });
    expect(list.body.devices.find((d: any) => d.device === 'd2').label).toBeNull();
    expect((await call('POST', url(k, '/devices/d3'), k, { body: { label: 'not b64!' } })).status).toBe(400);
  });

  it('delete everywhere removes the space and nothing else', async () => {
    const k = await newSpace(), keep = await newSpace();
    await push(k); await push(keep);
    await call('PUT', url(k, '/snapshot'), k, { body: { upto: 1, blob: await blobOf(k) } });
    await call('POST', url(k, '/devices/d1'), k, { body: {} });
    expect((await call('DELETE', url(k), k)).status).toBe(200);
    for (const [t, c] of [['batches', 'space'], ['snapshots', 'space'], ['devices', 'space'], ['spaces', 'id']]) expect(await count(t!, k.spaceId, c)).toBe(0);
    expect(await count('batches', keep.spaceId)).toBe(1);
    expect((await call('GET', url(k, '/changes'), k)).status).toBe(404);
    // the space can start over, with a new secret
    expect((await push(k)).body.seq).toBe(1);
  });
});

describe('CORS', () => {
  it('answers the preflight for a listed origin, with a wildcard preview and localhost', async () => {
    const k = await newSpace();
    for (const origin of [APP, 'https://abc123.app-test.pages.dev', 'http://localhost:5173']) {
      const r = await call('OPTIONS', url(k, '/batches'), k, { origin, auth: false });
      expect(r.status).toBe(204);
      expect(r.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(r.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
      expect(r.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    }
  });

  it('adds the header to real responses, including errors', async () => {
    const k = await newSpace();
    const ok = await push(k, 'a', { origin: APP });
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    const bad = await call('GET', url(k, '/changes'), k, { origin: APP, auth: 'x'.repeat(30) });
    expect(bad.status).toBe(403);
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBe(APP);
  });

  it('refuses another origin, a lookalike and a nested subdomain', async () => {
    const k = await newSpace();
    for (const origin of ['https://evil.example', 'https://app.example.evil.com', 'https://a.b.app-test.pages.dev', 'http://app.example', 'https://app-test.pages.dev', 'http://localhost']) {
      const pre = await call('OPTIONS', url(k, '/batches'), k, { origin, auth: false });
      expect(pre.status, origin).toBe(403);
      expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect((await push(k, 'a', { origin })).status, origin).toBe(403);
    }
    expect(await count('batches', k.spaceId)).toBe(0);
  });
});

describe('rate limits', () => {
  beforeEach(() => freshMinute());
  it('limits writes per space per minute', async () => {
    const k = await newSpace();
    const limit = { RATE_SPACE_PER_MIN: '3' };
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await push(k, 'a', { env: limit })).status);
    expect(codes).toEqual([201, 201, 201, 429, 429]);
    expect((await push(k, 'a', { env: limit })).headers.get('Retry-After')).toBe('60');
    expect(await count('batches', k.spaceId)).toBe(3);
    const other = await newSpace(); // another space is not affected
    expect((await push(other, 'a', { env: limit })).status).toBe(201);
  });

  it('limits writes and failed sign-ins per IP', async () => {
    const limit = { RATE_IP_PER_MIN: '4' };
    const a = await newSpace(), b = await newSpace(), c = await newSpace();
    const codes: number[] = [];
    for (const k of [a, b, c, a, b, c]) codes.push((await push(k, 'x', { env: limit, ip: '9.9.9.9' })).status);
    expect(codes).toEqual([201, 201, 201, 201, 429, 429]);
    expect((await push(a, 'x', { env: limit, ip: '8.8.8.8' })).status).toBe(201);

    const guesser = '7.7.7.7', victim = await newSpace();
    await push(victim);
    const wrong = await newSpace();
    const reads: number[] = [];
    for (let i = 0; i < 6; i++) reads.push((await call('GET', url(victim, '/changes'), victim, { auth: wrong.authSecret, env: limit, ip: guesser })).status);
    expect(reads.slice(0, 4)).toEqual([403, 403, 403, 403]);
    expect(await count('batches', victim.spaceId)).toBe(1);
  });
});
