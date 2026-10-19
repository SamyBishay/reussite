// The sync key: a random 256-bit secret, shown to the person as a recovery key, and the
// three things derived from it (HKDF-SHA256): a space id, an auth secret and an AES-GCM key.
// The relay sees the space id and a hash of the auth secret, never the encryption key.
import { type Bytes, b64uEncode, concat, utf8 } from './bytes';

export const KEY_BYTES = 32;

export function generateKey(): Bytes {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

// ---- Recovery key: Crockford base32 (no I, L, O, U), 32 key bytes + 3 checksum bytes = 56 characters, in 14 groups of 4.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHECK_BYTES = 3;

export type RecoveryKeyErrorCode = 'length' | 'char' | 'checksum';
export class RecoveryKeyError extends Error {
  constructor(public code: RecoveryKeyErrorCode) { super('recovery key: ' + code); }
}

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const checksum = (key: Uint8Array): Uint8Array => {
  const c = crc32(key);
  return new Uint8Array([(c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff]);
};

/** The key as 14 groups of 4 characters joined by dashes. */
export function encodeRecoveryKey(key: Uint8Array): string {
  if (key.length !== KEY_BYTES) throw new Error('key must be 32 bytes');
  const data = concat(key, checksum(key));
  let bits = 0, acc = 0, out = '';
  for (const b of data) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(acc >>> (bits - 5)) & 31]; bits -= 5; }
    acc &= (1 << bits) - 1;
  }
  return out.match(/.{4}/g)!.join('-');
}

/** Tolerant of spaces, dashes, lower case, and O/0, I/L/1 mix-ups. Throws RecoveryKeyError. */
export function decodeRecoveryKey(text: string): Bytes {
  const s = text.toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== ((KEY_BYTES + CHECK_BYTES) * 8) / 5) throw new RecoveryKeyError('length');
  const data = new Uint8Array(KEY_BYTES + CHECK_BYTES);
  let bits = 0, acc = 0, at = 0;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new RecoveryKeyError('char');
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) { data[at++] = (acc >>> (bits - 8)) & 0xff; bits -= 8; acc &= (1 << bits) - 1; }
  }
  const key = data.slice(0, KEY_BYTES);
  const want = checksum(key);
  for (let i = 0; i < CHECK_BYTES; i++) if (data[KEY_BYTES + i] !== want[i]) throw new RecoveryKeyError('checksum');
  return key;
}

// ---- Derivation

const SALT = utf8('reussite/sync/v1');
const INFO = { space: utf8('space-id'), auth: utf8('auth-secret'), enc: utf8('encryption-key') };

export interface SpaceKeys {
  /** 16 bytes, base64url. Names the space on the relay. */
  spaceId: string;
  /** 32 bytes, base64url. Sent as the Bearer token; the relay keeps only its hash. */
  authSecret: string;
  /** AES-GCM-256, not extractable. */
  encKey: CryptoKey;
  /** The same key as raw bytes, for the connector, which hands it to the relay when switched on. */
  encKeyRaw: Bytes;
}

async function hkdf(master: CryptoKey, info: Uint8Array, bytes: number): Promise<Bytes> {
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: info as Bytes }, master, bytes * 8);
  return new Uint8Array(bits);
}

export async function deriveKeys(key: Uint8Array): Promise<SpaceKeys> {
  if (key.length !== KEY_BYTES) throw new Error('key must be 32 bytes');
  const master = await crypto.subtle.importKey('raw', key as Bytes, 'HKDF', false, ['deriveBits']);
  const [space, auth, enc] = await Promise.all([hkdf(master, INFO.space, 16), hkdf(master, INFO.auth, 32), hkdf(master, INFO.enc, 32)]);
  return { spaceId: b64uEncode(space), authSecret: b64uEncode(auth), encKey: await importEncKey(enc), encKeyRaw: enc };
}

export const importEncKey = (raw: Bytes): Promise<CryptoKey> => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

/** SHA-256 of the auth secret's text, base64url: what the relay stores and compares. */
export async function hashAuthSecret(authSecret: string): Promise<string> {
  return b64uEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(authSecret))));
}
