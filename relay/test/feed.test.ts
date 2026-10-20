import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { b64uEncode } from '../../src/sync/bytes';
import { feedPath, feedUrl, MAX_FEED_BYTES } from '../../src/feed/protocol';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import { APP, BASE } from './helpers';

beforeEach(async () => { await env.DB.batch([env.DB.prepare('DELETE FROM feeds'), env.DB.prepare('DELETE FROM rate')]); });

const random = (n: number) => b64uEncode(crypto.getRandomValues(new Uint8Array(n)));
const newFeed = () => ({ fid: random(24), secret: random(32) });
const ics = (s = 'one') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-NOTE:${s}\r\nEND:VCALENDAR\r\n`;

interface Opts { auth?: string | false; ip?: string; origin?: string; headers?: Record<string, string>; env?: Partial<Env> }
async function req(method: string, path: string, body: string | undefined, o: Opts = {}) {
  const headers: Record<string, string> = { 'CF-Connecting-IP': o.ip ?? 'ip-' + Math.random().toString(36).slice(2), ...o.headers };
  if (o.auth) headers.Authorization = 'Bearer ' + o.auth;
  if (o.origin) headers.Origin = o.origin;
  const res = await handle(new Request(BASE + path, { method, headers, body }), { ...(env as unknown as Env), ...o.env });
  return { status: res.status, text: await res.text(), headers: res.headers };
}
const put = (f: { fid: string; secret: string }, body = ics(), o: Opts = {}) => req('PUT', feedPath(f.fid), body, { auth: f.secret, ...o });
const get = (fid: string, o: Opts = {}) => req('GET', feedUrl('', fid), undefined, o);
const hashOf = async (fid: string) => (await env.DB.prepare('SELECT auth_hash FROM feeds WHERE fid = ?1').bind(fid).first<{ auth_hash: string }>())?.auth_hash;

describe('writing a feed', () => {
  it('the first write sets the secret (only its hash is kept); the same secret updates', async () => {
    const f = newFeed();
    expect((await put(f)).status).toBe(201);
    expect(await hashOf(f.fid)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await hashOf(f.fid)).not.toBe(f.secret);
    expect((await put(f, ics('two'))).status).toBe(200);
    expect((await get(f.fid)).text).toContain('X-NOTE:two');
  });

  it('refuses a wrong or missing secret and changes nothing', async () => {
    const f = newFeed();
    await put(f);
    expect((await put({ ...f, secret: random(32) }, ics('evil'))).status).toBe(403);
    expect((await req('PUT', feedPath(f.fid), ics('evil'), {})).status).toBe(401);
    expect((await req('PUT', feedPath(f.fid), ics('evil'), { auth: 'short' })).status).toBe(401);
    expect((await get(f.fid)).text).toContain('X-NOTE:one');
  });

  it('refuses a bad id, a body that is not a calendar, and a body over 256 KB', async () => {
    const f = newFeed();
    expect((await put({ fid: 'short', secret: f.secret })).status).toBe(400);
    expect((await put(f, 'hello')).status).toBe(400);
    expect((await put(f, '<html>BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')).status).toBe(400);
    expect((await put(f, ics('x'.repeat(MAX_FEED_BYTES)))).status).toBe(413);
    const fits = ics('x'.repeat(MAX_FEED_BYTES - 100));
    expect((await put(f, fits)).status).toBe(201);
    expect(await hashOf(f.fid)).toBeTruthy();
  });

  it('is limited to 20 writes a minute per feed', async () => {
    const f = newFeed();
    await put(f);
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await put(f, ics('n' + i))).status);
    expect(codes.slice(0, 19).every(c => c === 200)).toBe(true);
    expect(codes[20]).toBe(429);
  });

  it('limits new feeds per IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await put(newFeed(), ics(), { ip: 'same' })).status);
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('answers a browser preflight from the app, and not from other origins', async () => {
    const f = newFeed();
    const ok = await req('OPTIONS', feedPath(f.fid), undefined, { origin: APP });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect((await put(f, ics(), { origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('reading a feed', () => {
  it('serves the text without a secret, as a calendar, without CORS', async () => {
    const f = newFeed();
    await put(f);
    const r = await get(f.fid, { origin: undefined });
    expect(r.status).toBe(200);
    expect(r.text).toBe(ics());
    expect(r.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(r.headers.get('Cache-Control')).toBe('max-age=900');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('has an ETag that changes with the text and answers 304 to a match', async () => {
    const f = newFeed();
    await put(f);
    const a = await get(f.fid);
    const etag = a.headers.get('ETag')!;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    const same = await get(f.fid, { headers: { 'If-None-Match': etag } });
    expect(same.status).toBe(304);
    expect(same.text).toBe('');
    expect(same.headers.get('ETag')).toBe(etag);
    await put(f, ics('two'));
    const changed = await get(f.fid, { headers: { 'If-None-Match': etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('ETag')).not.toBe(etag);
  });

  it('counts misses per IP (30 a minute) and not hits', async () => {
    const f = newFeed();
    await put(f);
    for (let i = 0; i < 40; i++) expect((await get(f.fid, { ip: 'reader' })).status).toBe(200);
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await get(random(24), { ip: 'scanner' })).status);
    expect(codes.slice(0, 30).every(c => c === 404)).toBe(true);
    expect(codes.slice(30)).toEqual([429, 429]);
    // A malformed id is a miss too.
    expect((await get('nope', { ip: 'other' })).status).toBe(404);
  });
});

describe('deleting a feed', () => {
  it('needs the secret, then the address is a 404', async () => {
    const f = newFeed();
    await put(f);
    expect((await req('DELETE', feedPath(f.fid), undefined, { auth: random(32) })).status).toBe(403);
    expect((await get(f.fid)).status).toBe(200);
    expect((await req('DELETE', feedPath(f.fid), undefined, {})).status).toBe(401);
    expect((await req('DELETE', feedPath(f.fid), undefined, { auth: f.secret })).status).toBe(200);
    expect((await get(f.fid)).status).toBe(404);
    expect((await req('DELETE', feedPath(f.fid), undefined, { auth: f.secret })).status).toBe(200); // already gone is fine
  });
});
