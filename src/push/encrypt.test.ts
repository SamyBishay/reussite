import { describe, expect, it } from 'vitest';
import { b64uDecode, b64uEncode, fromUtf8, utf8 } from '../sync/bytes';
import { decryptPush, encryptPush, encryptPushBlob, type ReceiverKeys } from './encrypt';
import { MAX_PUSH_BLOB_CHARS, MAX_PUSH_PLAINTEXT, PAD_BLOCK } from './protocol';
import { newReceiver } from './testing';

// RFC 8291, Appendix A: "Push Message Encryption Example".
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

describe('RFC 8291 Appendix A', () => {
  it('encrypts the example to the exact bytes', async () => {
    const body = await encryptPush({ p256dh: RFC.uaPublic, auth: RFC.auth }, b64uDecode(RFC.plaintext), {
      salt: b64uDecode(RFC.salt), ephemeral: { publicKey: RFC.asPublic, privateKey: RFC.asPrivate }, block: 1,
    });
    expect(b64uEncode(body)).toBe(RFC.body);
    expect(fromUtf8(b64uDecode(RFC.plaintext))).toBe('When I grow up, I want to be a watermelon');
  });

  it('decrypts the example as the browser would', async () => {
    const me: ReceiverKeys = { p256dh: RFC.uaPublic, auth: RFC.auth, privateKey: RFC.uaPrivate };
    expect(b64uEncode(await decryptPush(b64uDecode(RFC.body), me))).toBe(RFC.plaintext);
  });
});

describe('our messages', () => {
  it('round trip', async () => {
    const me = await newReceiver();
    const text = JSON.stringify({ title: '▶ Start', body: 'Choir 19:00 · leave at 18:30', tag: 'fixed:x:2026-10-19' });
    const body = await encryptPush(me, utf8(text));
    expect(fromUtf8(await decryptPush(body, me))).toBe(text);
    expect(fromUtf8(await decryptPush(b64uDecode(await encryptPushBlob(me, { a: 1 })), me))).toBe('{"a":1}');
  });

  it('pads to a multiple of 256 bytes, so lengths of short texts look alike', async () => {
    const me = await newReceiver();
    const size = async (n: number) => (await encryptPush(me, utf8('x'.repeat(n)))).length;
    const header = 21 + 65, tag = 16;
    expect(await size(0)).toBe(header + PAD_BLOCK + tag);
    expect(await size(10)).toBe(header + PAD_BLOCK + tag);
    expect(await size(255)).toBe(header + PAD_BLOCK + tag);
    expect(await size(256)).toBe(header + 2 * PAD_BLOCK + tag);
    expect(await size(MAX_PUSH_PLAINTEXT)).toBe(header + 3 * PAD_BLOCK + tag);
    expect(await size(MAX_PUSH_PLAINTEXT)).toBeLessThan(1024);
    expect(b64uEncode(new Uint8Array(header + 3 * PAD_BLOCK + tag)).length).toBeLessThanOrEqual(MAX_PUSH_BLOB_CHARS);
    await expect(encryptPush(me, utf8('x'.repeat(MAX_PUSH_PLAINTEXT + 1)))).rejects.toThrow('too large');
  });

  it('uses a fresh salt and key each time, and only the owner can open it', async () => {
    const me = await newReceiver(), other = await newReceiver();
    const a = await encryptPush(me, utf8('same')), b = await encryptPush(me, utf8('same'));
    expect(b64uEncode(a)).not.toBe(b64uEncode(b));
    await expect(decryptPush(a, other)).rejects.toThrow();
    await expect(decryptPush(a, { ...me, auth: other.auth })).rejects.toThrow();
  });

  it('a changed byte fails to open', async () => {
    const me = await newReceiver();
    const body = await encryptPush(me, utf8('hello'));
    body[body.length - 20] = body[body.length - 20]! ^ 1;
    await expect(decryptPush(body, me)).rejects.toThrow();
  });

  it('rejects keys that are not P-256 points', async () => {
    await expect(encryptPush({ p256dh: b64uEncode(new Uint8Array(65)), auth: RFC.auth }, utf8('x'))).rejects.toThrow('uncompressed');
    await expect(encryptPush({ p256dh: 'AAAA', auth: RFC.auth }, utf8('x'))).rejects.toThrow();
  });
});
