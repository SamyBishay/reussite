import { describe, expect, it } from 'vitest';
import { b64uDecode } from './bytes';
import { DecryptError, NewerFormatError, decryptJson, encryptJson, openFromText, sealToText } from './crypto';
import { deriveKeys, generateKey } from './keys';

const setup = async () => deriveKeys(generateKey());
const sample = { v: 2, device: 'abc', docs: Array.from({ length: 40 }, (_, i) => ({ c: 'tasks', d: { id: 't' + i, title: 'A step number ' + i } })) };

describe('blobs', () => {
  it('round trips, compressed when big and plain when small', async () => {
    const k = await setup();
    const big = await encryptJson(k, sample);
    expect(big[0]).toBe(2);
    expect(await decryptJson(k, big)).toEqual(sample);
    const small = await encryptJson(k, { a: 1 });
    expect(small[0]).toBe(1);
    expect(await decryptJson(k, small)).toEqual({ a: 1 });
    expect(JSON.stringify(sample).length).toBeGreaterThan(big.length);
  });

  it('a format byte above the known ones says "newer app", not "broken"', async () => {
    const k = await setup();
    const blob = await encryptJson(k, { a: 1 });
    blob[0] = 9;
    await expect(decryptJson(k, blob)).rejects.toBeInstanceOf(NewerFormatError);
    blob[0] = 0;
    await expect(decryptJson(k, blob)).rejects.not.toBeInstanceOf(NewerFormatError);
  });

  it('generation 2 blobs carry format bytes 3 and 4, which every reader opens', async () => {
    const k = await setup();
    const big = await encryptJson(k, sample, { lean: true });
    expect(big[0]).toBe(4);
    expect(await decryptJson(k, big)).toEqual(sample);
    const small = await encryptJson(k, { a: 1 }, { lean: true });
    expect(small[0]).toBe(3);
    expect(await decryptJson(k, small)).toEqual({ a: 1 });
    const plain = await encryptJson(k, sample, { lean: true, plain: true });
    expect(plain[0]).toBe(3);
    expect(await decryptJson(k, plain)).toEqual(sample);
    // the format byte is authenticated: flipping a generation 2 blob to generation 1 fails
    const flipped = big.slice(); flipped[0] = 2;
    await expect(decryptJson(k, flipped)).rejects.toThrow(DecryptError);
  });

  it('uses a fresh IV every time', async () => {
    const k = await setup();
    const a = await encryptJson(k, sample), b = await encryptJson(k, sample);
    expect(a.slice(1, 13)).not.toEqual(b.slice(1, 13));
    expect(a).not.toEqual(b);
  });

  it('does not contain the plaintext', async () => {
    const k = await setup();
    const blob = await encryptJson(k, { secret: 'needle-in-the-haystack' });
    expect(new TextDecoder('latin1').decode(blob)).not.toContain('needle');
  });

  it('throws with the wrong key', async () => {
    const [a, b] = [await setup(), await setup()];
    await expect(decryptJson(b, await encryptJson(a, sample))).rejects.toThrow(DecryptError);
  });

  it('throws on tampered ciphertext, tag, IV and format byte', async () => {
    const k = await setup();
    const blob = await encryptJson(k, sample);
    for (const at of [0, 1, 20, blob.length - 1]) {
      const bad = blob.slice();
      bad[at] = bad[at]! ^ 1;
      await expect(decryptJson(k, bad)).rejects.toThrow(DecryptError);
    }
    await expect(decryptJson(k, blob.slice(0, 10))).rejects.toThrow(DecryptError);
  });

  it('throws when the blob is moved to another space', async () => {
    const k = await setup();
    const blob = await encryptJson(k, sample);
    await expect(decryptJson({ spaceId: 'another-space-id', encKey: k.encKey }, blob)).rejects.toThrow(DecryptError);
  });

  it('travels as base64url text', async () => {
    const k = await setup();
    const text = await sealToText(k, sample);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(b64uDecode(text)[0]).toBe(2);
    expect(await openFromText(k, text)).toEqual(sample);
  });
});
