import { hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { b64uDecode, b64uEncode } from './bytes';
import { decodeRecoveryKey, deriveKeys, encodeRecoveryKey, generateKey, hashAuthSecret, RecoveryKeyError } from './keys';

const fixed = Uint8Array.from({ length: 32 }, (_, i) => i);

describe('recovery key', () => {
  it('has a fixed shape for a fixed key', () => {
    expect(encodeRecoveryKey(fixed)).toBe('000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFS-29KY');
  });

  it('round trips, in 14 groups of 4 from the safe alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const key = generateKey();
      const text = encodeRecoveryKey(key);
      expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(decodeRecoveryKey(text)).toEqual(key);
    }
  });

  it('accepts spaces, dashes, lower case and look-alike letters', () => {
    const key = generateKey();
    const text = encodeRecoveryKey(key);
    expect(decodeRecoveryKey(text.toLowerCase().replace(/-/g, ' '))).toEqual(key);
    expect(decodeRecoveryKey(text.replace(/-/g, ''))).toEqual(key);
    expect(decodeRecoveryKey('  ' + text + '\n')).toEqual(key);
    expect(decodeRecoveryKey(text.replace(/0/g, 'O').replace(/1/g, 'l'))).toEqual(key);
    expect(decodeRecoveryKey(text.replace(/1/g, 'I'))).toEqual(key);
  });

  it('catches a typo anywhere, a swap, a missing character and a wrong character', () => {
    const key = generateKey();
    const chars = encodeRecoveryKey(key).replace(/-/g, '');
    const code = (s: string) => { try { decodeRecoveryKey(s); return 'ok'; } catch (e) { return (e as RecoveryKeyError).code; } };
    for (let i = 0; i < chars.length; i++) {
      const other = chars[i] === 'A' ? 'B' : 'A';
      expect(code(chars.slice(0, i) + other + chars.slice(i + 1))).toBe('checksum');
    }
    expect(code(chars.slice(1))).toBe('length');
    expect(code(chars + 'A')).toBe('length');
    expect(code(chars.slice(0, 10) + 'U' + chars.slice(11))).toBe('char');
    expect(code(chars.slice(0, 10) + '!' + chars.slice(11))).toBe('char');
    const swapped = chars.slice(0, 4) + chars[5] + chars[4] + chars.slice(6);
    if (swapped !== chars) expect(code(swapped)).toBe('checksum');
  });
});

describe('derivation', () => {
  it('is stable for a fixed key (golden values)', async () => {
    const k = await deriveKeys(fixed);
    expect(k.spaceId).toBe('AaBudkPlGUsiDi-0V6lC4Q');
    expect(k.authSecret).toBe('PlgadyH_6FH82nIFVsyLshcyoivbnAsblKEIKAyJc4w');
    expect(b64uEncode(k.encKeyRaw)).toBe('4DSZsYkpw4djJwyqpdRYa2FrXj5fiFftR62ro4gbvgc');
    expect(await hashAuthSecret(k.authSecret)).toBe('2CziJUKoNM7j4NJKC3q8UenKelhVS9KWfFJz274W_fs');
  });

  it('matches an independent HKDF-SHA256', async () => {
    const k = await deriveKeys(fixed);
    const ref = (info: string, n: number) => new Uint8Array(hkdfSync('sha256', fixed, 'reussite/sync/v1', info, n));
    expect(b64uDecode(k.spaceId)).toEqual(ref('space-id', 16));
    expect(b64uDecode(k.authSecret)).toEqual(ref('auth-secret', 32));
    expect(k.encKeyRaw).toEqual(ref('encryption-key', 32));
  });

  it('gives three independent values, and different keys give different spaces', async () => {
    const a = await deriveKeys(generateKey()), b = await deriveKeys(generateKey());
    expect(new Set([a.spaceId, a.authSecret, b64uEncode(a.encKeyRaw)]).size).toBe(3);
    expect(a.spaceId).not.toBe(b.spaceId);
    expect(a.spaceId).toHaveLength(22);
    expect(b64uDecode(a.authSecret)).toHaveLength(32);
  });

  it('refuses a key of the wrong length', async () => {
    await expect(deriveKeys(new Uint8Array(16))).rejects.toThrow();
    expect(() => encodeRecoveryKey(new Uint8Array(16))).toThrow();
  });
});
