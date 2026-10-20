import { describe, expect, it } from 'vitest';
import { b64uDecode, b64uEncode } from './bytes';
import { deriveInbox, inboxSupported, InboxError, openFromInbox, sealToInbox } from './inbox';
import { deriveKeys, generateKey } from './keys';

const space = async (k: Uint8Array) => (await deriveKeys(k)).spaceId;

describe('inbox key pair', () => {
  it('is the same on every device that holds the recovery key, and differs between keys', async () => {
    const k = generateKey();
    const a = await deriveInbox(k), b = await deriveInbox(new Uint8Array(k));
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await deriveInbox(generateKey())).publicKey).not.toBe(a.publicKey);
    expect(await inboxSupported()).toBe(true);
  });

  it('is not the sync key or anything derived for sync', async () => {
    const k = generateKey();
    const keys = await deriveKeys(k);
    const pub = (await deriveInbox(k)).publicKey;
    expect(pub).not.toBe(b64uEncode(keys.encKeyRaw));
    expect(pub).not.toBe(keys.authSecret);
    expect(pub).not.toBe(b64uEncode(k));
  });

  it('cannot be read back from the private CryptoKey', async () => {
    const { privateKey } = await deriveInbox(generateKey());
    await expect(crypto.subtle.exportKey('pkcs8', privateKey)).rejects.toThrow();
  });
});

describe('sealed boxes', () => {
  it('round-trips, small and large, and fresh each time', async () => {
    const k = generateKey(), s = await space(k), inbox = await deriveInbox(k);
    const small = { v: 1, changes: [{ op: 'task.done', id: 't1' }] };
    const big = { v: 1, note: 'é'.repeat(5000), changes: Array.from({ length: 40 }, (_, i) => ({ op: 'task.create', set: { title: 'Open Mail and reply to ' + i } })) };
    for (const v of [small, big]) {
      const box = await sealToInbox(s, inbox.publicKey, v);
      expect(await openFromInbox(s, inbox, box)).toEqual(v);
      expect(await sealToInbox(s, inbox.publicKey, v)).not.toBe(box);
    }
    // compression makes repetitive text small
    expect(b64uDecode(await sealToInbox(s, inbox.publicKey, big)).length).toBeLessThan(JSON.stringify(big).length / 2);
  });

  it("another space's key cannot open it", async () => {
    const k = generateKey(), other = generateKey();
    const s = await space(k);
    const box = await sealToInbox(s, (await deriveInbox(k)).publicKey, { secret: 'Doctolib' });
    await expect(openFromInbox(s, await deriveInbox(other), box)).rejects.toBeInstanceOf(InboxError);
    // the right key under another space id is refused too (authenticated data)
    await expect(openFromInbox(await space(other), await deriveInbox(k), box)).rejects.toBeInstanceOf(InboxError);
    expect(box).not.toContain('Doctolib');
  });

  it('refuses altered, truncated and foreign data', async () => {
    const k = generateKey(), s = await space(k), inbox = await deriveInbox(k);
    const bytes = b64uDecode(await sealToInbox(s, inbox.publicKey, { a: 1 }));
    for (const at of [0, 1, 40, bytes.length - 1]) {
      const bad = new Uint8Array(bytes); bad[at] = bad[at]! ^ 1;
      await expect(openFromInbox(s, inbox, b64uEncode(bad))).rejects.toBeInstanceOf(InboxError);
    }
    await expect(openFromInbox(s, inbox, b64uEncode(bytes.slice(0, 50)))).rejects.toBeInstanceOf(InboxError);
    await expect(openFromInbox(s, inbox, 'not base64 !')).rejects.toBeInstanceOf(InboxError);
    await expect(sealToInbox(s, 'short', {})).rejects.toBeInstanceOf(InboxError);
  });
});
