import { describe, expect, it } from 'vitest';
import { b64uDecode, b64uEncode, fromUtf8 } from '../sync/bytes';
import { audienceOf, generateVapidKeys, importVapidPrivate, signVapid, vapidHeader, verifyVapid } from './vapid';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const SUB = 'https://d1-reussite.rudolphem.workers.dev';

describe('VAPID', () => {
  it('signs a token the public key verifies, with the claims the push services read', async () => {
    const keys = await generateVapidKeys();
    expect(b64uDecode(keys.publicKey)).toHaveLength(65);
    expect(b64uDecode(keys.privateKey)).toHaveLength(32);
    const jwt = await signVapid(await importVapidPrivate(keys), 'https://fcm.googleapis.com', SUB, NOW);
    const [head, body, sig] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(fromUtf8(b64uDecode(head)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(fromUtf8(b64uDecode(body)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: NOW / 1000 + 12 * 3600, sub: SUB });
    expect(b64uDecode(sig)).toHaveLength(64);
    expect(await verifyVapid(jwt, keys.publicKey, NOW)).toMatchObject({ aud: 'https://fcm.googleapis.com' });
  });

  it('is refused for another key, a changed claim or an expired token', async () => {
    const keys = await generateVapidKeys(), other = await generateVapidKeys();
    const jwt = await signVapid(await importVapidPrivate(keys), 'https://fcm.googleapis.com', SUB, NOW);
    expect(await verifyVapid(jwt, other.publicKey, NOW)).toBeNull();
    const [head, , sig] = jwt.split('.') as [string, string, string];
    const forged = b64uEncode(new TextEncoder().encode(JSON.stringify({ aud: 'https://evil.example', exp: NOW / 1000 + 100, sub: SUB })));
    expect(await verifyVapid(`${head}.${forged}.${sig}`, keys.publicKey, NOW)).toBeNull();
    expect(await verifyVapid(jwt, keys.publicKey, NOW + 13 * 3600_000)).toBeNull();
    expect(await verifyVapid('not.a.jwt', keys.publicKey, NOW)).toBeNull();
  });

  it('builds the header and the audience', async () => {
    const keys = await generateVapidKeys();
    expect(vapidHeader('T', keys.publicKey)).toBe(`vapid t=T, k=${keys.publicKey}`);
    expect(audienceOf('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe('https://updates.push.services.mozilla.com');
    expect(audienceOf('http://localhost:9999/x')).toBe('http://localhost:9999');
  });

  it('refuses a public key that is not an uncompressed point', async () => {
    await expect(importVapidPrivate({ publicKey: 'AAAA', privateKey: 'AAAA' })).rejects.toThrow('uncompressed');
  });
});
