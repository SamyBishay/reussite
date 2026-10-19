import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { b64uLength, MAX_INBOX_BYTES, MAX_INBOX_ITEMS } from '../../src/sync/protocol';
import { APP, call, newSpace, push, url } from './helpers';

const blob = (n = 80) => 'A'.repeat(n);
const post = (k: Awaited<ReturnType<typeof newSpace>>, b: unknown = blob(), o: Parameters<typeof call>[3] = {}) =>
  call('POST', url(k, '/inbox'), k, { auth: false, body: { blob: b }, ...o });
const count = async (space: string) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM inbox WHERE space = ?').bind(space).first<{ n: number }>())!.n;

describe('inbox', () => {
  it('takes a blob without any secret, for a space that exists, and the owner reads and deletes it', async () => {
    const k = await newSpace();
    await push(k);
    const a = await post(k, blob(100));
    expect(a.status).toBe(201);
    expect(a.body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    await post(k, blob(120));

    expect((await call('GET', url(k, '/inbox'), k, { auth: false })).status).toBe(401);
    const other = await newSpace();
    expect((await call('GET', url(k, '/inbox'), k, { auth: other.authSecret })).status).toBe(403);

    const list = await call('GET', url(k, '/inbox'), k);
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: any) => i.blob)).toEqual([blob(100), blob(120)]);
    expect(list.body.items[0].id).toBe(a.body.id);

    expect((await call('DELETE', url(k, '/inbox/' + a.body.id), k, { auth: other.authSecret })).status).toBe(403);
    expect(await count(k.spaceId)).toBe(2);
    expect((await call('DELETE', url(k, '/inbox/' + a.body.id), k)).body).toEqual({ ok: true, deleted: 1 });
    expect((await call('DELETE', url(k, '/inbox/' + a.body.id), k)).body).toEqual({ ok: true, deleted: 0 });
    expect((await call('GET', url(k, '/inbox'), k)).body.items).toHaveLength(1);
    expect((await call('DELETE', url(k, '/inbox/short'), k)).status).toBe(400);
  });

  it("one space's secret cannot delete another space's item", async () => {
    const a = await newSpace(), b = await newSpace();
    await push(a); await push(b);
    const item = await post(a);
    expect((await call('DELETE', url(b, '/inbox/' + item.body.id), b)).body.deleted).toBe(0);
    expect(await count(a.spaceId)).toBe(1);
  });

  it('refuses an unknown space, bad bodies and oversized blobs, and stores nothing', async () => {
    const k = await newSpace();
    expect(await post(k)).toMatchObject({ status: 404, body: { error: 'unknown_space' } });
    await push(k);
    expect((await call('POST', url(k, '/inbox'), k, { auth: false, body: {} })).status).toBe(400);
    expect((await post(k, 'short')).status).toBe(400);
    expect((await post(k, 'not base64 !!' + 'x'.repeat(50))).status).toBe(400);
    expect((await call('POST', '/v1/spaces/nope/inbox', k, { auth: false, body: { blob: blob() } })).status).toBe(400);
    expect(await post(k, blob(b64uLength(MAX_INBOX_BYTES) + 4))).toMatchObject({ status: 413, body: { error: 'too_large' } });
    expect((await post(k, blob(b64uLength(MAX_INBOX_BYTES)))).status).toBe(201);
    expect(await count(k.spaceId)).toBe(1);
  });

  it('is limited per IP and per space', async () => {
    const k = await newSpace();
    await push(k);
    const lim = { RATE_INBOX_IP_PER_MIN: '3', RATE_INBOX_SPACE_PER_MIN: '5' };
    const same = (i: string) => post(k, blob(), { ip: i, env: lim });
    expect([(await same('a')).status, (await same('a')).status, (await same('a')).status, (await same('a')).status]).toEqual([201, 201, 201, 429]);
    expect((await same('a')).headers.get('Retry-After')).toBe('60');
    // other IPs still get in until the space's own minute is used up
    expect((await same('b')).status).toBe(201);
    expect((await same('c')).status).toBe(201);
    expect((await same('d')).status).toBe(429);
    expect(await count(k.spaceId)).toBe(5);
  });

  it('holds at most 50 unread items, and a read item makes room', async () => {
    const k = await newSpace();
    await push(k);
    const lim = { RATE_INBOX_IP_PER_MIN: '1000', RATE_INBOX_SPACE_PER_MIN: '1000' };
    let first = '';
    for (let i = 0; i < MAX_INBOX_ITEMS; i++) { const r = await post(k, blob(), { env: lim }); if (!i) first = r.body.id; }
    expect((await post(k, blob(), { env: lim })).status).toBe(429);
    await call('DELETE', url(k, '/inbox/' + first), k);
    expect((await post(k, blob(), { env: lim })).status).toBe(201);
  });

  it('keeps items 30 days: older ones are not listed and are cleared by the next drop', async () => {
    const k = await newSpace();
    await push(k);
    const old = Date.now() - 31 * 86_400_000;
    await env.DB.prepare('INSERT INTO inbox (id, space, blob, at) VALUES (?1, ?2, ?3, ?4)').bind('old-item-0123456789', k.spaceId, blob(), old).run();
    await post(k, blob(90));
    expect((await call('GET', url(k, '/inbox'), k)).body.items.map((i: any) => i.blob)).toEqual([blob(90)]);
    expect(await count(k.spaceId)).toBe(1);
    await env.DB.prepare('INSERT INTO inbox (id, space, blob, at) VALUES (?1, ?2, ?3, ?4)').bind('old-item-9876543210', k.spaceId, blob(), old).run();
    expect((await call('GET', url(k, '/inbox'), k)).body.items).toHaveLength(1); // listed or not, never old ones
  });

  it('allows the app origin (CORS, with the preflight) and refuses others', async () => {
    const k = await newSpace();
    await push(k);
    const ok = await post(k, blob(), { origin: APP });
    expect(ok.status).toBe(201);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect((await call('OPTIONS', url(k, '/inbox'), k, { auth: false, origin: APP })).status).toBe(204);
    expect(await post(k, blob(), { origin: 'https://evil.example' })).toMatchObject({ status: 403, body: { error: 'origin_not_allowed' } });
  });

  it('is cleared by "delete everywhere"', async () => {
    const k = await newSpace();
    await push(k);
    await post(k);
    await call('DELETE', url(k), k);
    expect(await count(k.spaceId)).toBe(0);
  });
});
