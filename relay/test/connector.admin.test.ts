// Switching the connector on and off from the app, and what the relay keeps while it is on.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { b64uEncode } from '../../src/sync/bytes';
import { openFromText } from '../../src/sync/crypto';
import { generateKey } from '../../src/sync/keys';
import { initialize, newApp, rpc, signIn, switchOn, tool } from './connector';
import { call, newSpace, push, url } from './helpers';

const count = async (table: string, space: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE space = ?`).bind(space).first<{ n: number }>())!.n;

describe('switching on', () => {
  it('needs the secret, a well-formed key, and the right key', async () => {
    const app = await newApp();
    app.device.add('tasks', 't0', { title: 'first' });
    await app.sync();
    const k = app.keys;
    const body = { key: b64uEncode(k.encKeyRaw) };
    expect((await call('POST', url(k, '/connector'), k, { auth: false, body })).status).toBe(401);
    const other = await newSpace();
    expect((await call('POST', url(k, '/connector'), k, { auth: other.authSecret, body })).status).toBe(403);
    expect((await call('POST', url(k, '/connector'), k, { body: { key: 'short' } })).status).toBe(400);
    expect((await call('POST', url(k, '/connector'), k, { body: {} })).status).toBe(400);
    // The right shape but not this space's key: refused, nothing stored.
    app.device.add('tasks', 't1', { title: 'x' });
    await app.sync();
    const wrong = await call('POST', url(k, '/connector'), k, { body: { key: b64uEncode(generateKey()) } });
    expect(wrong.status).toBe(409);
    expect(wrong.body).toEqual({ error: 'wrong_key' });
    expect(await count('connector', k.spaceId)).toBe(0);
  });

  it('stores the key wrapped, lists itself as a device, and returns a code and the address', async () => {
    const app = await newApp();
    app.device.add('tasks', 't1', { title: 'x' });
    await app.sync();
    const on = await switchOn(app);
    expect(on.status).toBe(201);
    expect(on.body).toMatchObject({ on: true, url: 'https://relay.test/mcp' });
    expect(on.body.expires).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(on.body.expires).toBeLessThanOrEqual(Date.now() + 10 * 60_000);

    const row = await env.DB.prepare('SELECT wrapped FROM connector WHERE space = ?').bind(app.keys.spaceId).first<{ wrapped: string }>();
    expect(row!.wrapped).not.toContain(b64uEncode(app.keys.encKeyRaw));
    expect(row!.wrapped).not.toContain(app.keys.authSecret);
    const codes = await env.DB.prepare('SELECT code_hash FROM connector_codes WHERE space = ?').bind(app.keys.spaceId).all<{ code_hash: string }>();
    expect(codes.results).toHaveLength(1);
    expect(JSON.stringify(codes.results)).not.toContain(on.body.code.replace('-', ''));

    const devices = await app.client.devices();
    expect(devices.find(d => d.device === 'connector')?.name).toBe('Connector');
    expect((await call('GET', url(app.keys, '/connector'), app.keys)).body).toEqual({ on: true, lastUsed: null, url: 'https://relay.test/mcp' });
  });

  it('works for a space with nothing in it yet, and again (a fresh code each time)', async () => {
    const app = await newApp();
    const a = await switchOn(app), b = await switchOn(app);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.code).not.toBe(b.body.code);
    expect(await count('connector', app.keys.spaceId)).toBe(1);
  });

  it('refuses to store anything when the wrap secret is missing', async () => {
    const app = await newApp();
    const r = await switchOn(app, { CONNECTOR_WRAP_KEY: '' });
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: 'connector_unavailable' });
    expect(await count('connector', app.keys.spaceId)).toBe(0);
  });

  it('gives a fresh code on request, only while on', async () => {
    const app = await newApp();
    app.device.add('tasks', 't0', { title: 'first' });
    await app.sync();
    expect((await call('POST', url(app.keys, '/connector/code'), app.keys, { body: {} })).status).toBe(409);
    await switchOn(app);
    const r = await call('POST', url(app.keys, '/connector/code'), app.keys, { body: {} });
    expect(r.status).toBe(200);
    expect(r.body.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('records when it was last used', async () => {
    const app = await newApp();
    app.device.add('tasks', 't1', { title: 'x' });
    await app.sync();
    const on = await switchOn(app);
    const { access } = await signIn(on.body.code);
    expect((await call('GET', url(app.keys, '/connector'), app.keys)).body.lastUsed).toBeNull();
    await initialize(access);
    const st = await call('GET', url(app.keys, '/connector'), app.keys);
    expect(st.body.lastUsed).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe('switching off', () => {
  it('deletes the key and what the connector kept, and revokes every sign-in at once', async () => {
    const app = await newApp();
    app.device.add('tasks', 't1', { title: 'x' });
    await app.sync();
    const on = await switchOn(app);
    const a = await signIn(on.body.code);
    const second = await call('POST', url(app.keys, '/connector/code'), app.keys, { body: {} });
    const b = await signIn(second.body.code);
    expect((await tool(a.access, 'today')).isError).toBe(false);
    expect((await tool(b.access, 'today')).isError).toBe(false);

    const off = await call('DELETE', url(app.keys, '/connector'), app.keys);
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ ok: true, revoked: 2 });
    for (const t of ['connector', 'connector_codes', 'connector_pending', 'connector_undo']) expect(await count(t, app.keys.spaceId)).toBe(0);
    expect((await app.client.devices()).some(d => d.device === 'connector')).toBe(false);
    expect((await call('GET', url(app.keys, '/connector'), app.keys)).body.on).toBe(false);

    // Both tokens are dead, and so are the refresh tokens.
    for (const t of [a, b]) {
      expect((await rpc(t.access, 'tools/list')).status).toBe(401);
    }
  });

  it('needs the secret', async () => {
    const app = await newApp();
    await switchOn(app);
    expect((await call('DELETE', url(app.keys, '/connector'), app.keys, { auth: (await newSpace()).authSecret })).status).toBe(403);
    expect(await count('connector', app.keys.spaceId)).toBe(1);
  });

  it('a call fails with a clear error if the key is gone but a token somehow still works', async () => {
    const app = await newApp();
    app.device.add('tasks', 't1', { title: 'x' });
    await app.sync();
    const { access } = await signIn((await switchOn(app)).body.code);
    await env.DB.prepare('DELETE FROM connector WHERE space = ?').bind(app.keys.spaceId).run();
    const r = await rpc(access, 'tools/call', { name: 'today', arguments: {} });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('switched off');
  });

  it('is part of "delete everywhere"', async () => {
    const app = await newApp();
    await app.sync();
    const { access } = await signIn((await switchOn(app)).body.code);
    await app.client.deleteSpace();
    for (const t of ['connector', 'connector_codes', 'connector_pending', 'connector_undo']) expect(await count(t, app.keys.spaceId)).toBe(0);
    expect((await rpc(access, 'tools/list')).status).toBe(401);
  });
});

describe('what the relay can read while it is on', () => {
  it('the label it registered is encrypted like any other', async () => {
    const app = await newApp();
    await push(app.keys);
    await switchOn(app);
    const row = await env.DB.prepare('SELECT label_blob FROM devices WHERE space = ? AND device = ?').bind(app.keys.spaceId, 'connector').first<{ label_blob: string }>();
    expect(row!.label_blob).not.toContain('Connector');
    expect(await openFromText(app.keys, row!.label_blob)).toEqual({ name: 'Connector' });
  });
});
