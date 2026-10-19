// Encrypted blobs: JSON, gzip-compressed when the platform can, sealed with AES-GCM.
// Layout: [format byte][12-byte IV][ciphertext + 16-byte tag]. The format byte says whether
// the JSON is compressed (1 plain, 2 gzip). Authenticated data = format byte + space id, so a
// blob can't be moved to another space or have its format flipped.
import { type Bytes, b64uDecode, b64uEncode, concat, fromUtf8, utf8 } from './bytes';
import type { SpaceKeys } from './keys';

export const FORMAT_PLAIN = 1;
export const FORMAT_GZIP = 2;
const IV_BYTES = 12;
const COMPRESS_FROM = 128;

export type Sealer = Pick<SpaceKeys, 'spaceId' | 'encKey'>;

export class DecryptError extends Error {
  constructor(why: string) { super('cannot decrypt: ' + why); }
}

const canGzip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function run(data: Bytes, stream: CompressionStream | DecompressionStream): Promise<Bytes> {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(await out);
}

const aad = (format: number, spaceId: string): Bytes => concat(new Uint8Array([format]), utf8(spaceId));

export async function encryptJson(keys: Sealer, value: unknown): Promise<Bytes> {
  let body = utf8(JSON.stringify(value));
  let format = FORMAT_PLAIN;
  if (body.length >= COMPRESS_FROM && canGzip()) { body = await run(body, new CompressionStream('gzip')); format = FORMAT_GZIP; }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(format, keys.spaceId) }, keys.encKey, body);
  return concat(new Uint8Array([format]), iv, new Uint8Array(sealed));
}

export async function decryptJson<T = unknown>(keys: Sealer, blob: Uint8Array): Promise<T> {
  const format = blob[0];
  if (format !== FORMAT_PLAIN && format !== FORMAT_GZIP) throw new DecryptError('unknown format');
  if (blob.length < 1 + IV_BYTES + 16) throw new DecryptError('too short');
  let body: Bytes;
  try {
    const iv = blob.slice(1, 1 + IV_BYTES);
    body = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(format, keys.spaceId) }, keys.encKey, blob.slice(1 + IV_BYTES)));
  } catch {
    throw new DecryptError('wrong key, wrong space or altered data');
  }
  if (format === FORMAT_GZIP) {
    if (!canGzip()) throw new DecryptError('no gzip support here');
    body = await run(body, new DecompressionStream('gzip'));
  }
  return JSON.parse(fromUtf8(body)) as T;
}

/** Does the blob decrypt under these keys? No decompression, no parsing: a cheap "right key, right space?" check. */
export async function authenticates(keys: Sealer, blob: Uint8Array): Promise<boolean> {
  const format = blob[0];
  if ((format !== FORMAT_PLAIN && format !== FORMAT_GZIP) || blob.length < 1 + IV_BYTES + 16) return false;
  try {
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(1, 1 + IV_BYTES), additionalData: aad(format, keys.spaceId) }, keys.encKey, blob.slice(1 + IV_BYTES));
    return true;
  } catch {
    return false;
  }
}

/** The same, as base64url text: how blobs travel in the relay's JSON. */
export const sealToText = async (keys: Sealer, value: unknown): Promise<string> => b64uEncode(await encryptJson(keys, value));
export const openFromText = <T = unknown>(keys: Sealer, text: string): Promise<T> => decryptJson<T>(keys, b64uDecode(text));
