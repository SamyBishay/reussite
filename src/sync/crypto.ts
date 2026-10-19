// Encrypted blobs: JSON, gzip-compressed when the platform can, sealed with AES-GCM.
// Layout: [format byte][12-byte IV][ciphertext + 16-byte tag]. The format byte says whether
// the JSON is compressed (1 plain, 2 gzip) and which wire generation it is (src/sync/wire.ts: 1 and 2
// are generation 1, 3 and 4 generation 2, which an older app doesn't know and refuses). Authenticated data = format byte + space id, so a
// blob can't be moved to another space or have its format flipped.
import { type Bytes, b64uDecode, b64uEncode, concat, fromUtf8, utf8 } from './bytes';
import type { SpaceKeys } from './keys';

export const FORMAT_PLAIN = 1;
export const FORMAT_GZIP = 2;
/** Wire generation 2: the same, with the documents inside written by wire.ts. */
export const FORMAT_LEAN = 3;
export const FORMAT_LEAN_GZIP = 4;
const IV_BYTES = 12;
const COMPRESS_FROM = 128;
/** Generation 2 compresses only from here: a small batch costs more CPU to gunzip (stream set-up) than it saves, and the connector reads many. */
const COMPRESS_FROM_LEAN = 1024;
const known = (f: number | undefined): f is number => f === FORMAT_PLAIN || f === FORMAT_GZIP || f === FORMAT_LEAN || f === FORMAT_LEAN_GZIP;
const gzipped = (f: number) => f === FORMAT_GZIP || f === FORMAT_LEAN_GZIP;

export type Sealer = Pick<SpaceKeys, 'spaceId' | 'encKey'>;

export class DecryptError extends Error {
  constructor(why: string) { super('cannot decrypt: ' + why); }
}
/** A format byte above any this build knows: written by a newer app. Sync goes read-only and asks to reload. */
export class NewerFormatError extends DecryptError {
  constructor() { super('newer format'); }
}

const canGzip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function run(data: Bytes, stream: CompressionStream | DecompressionStream): Promise<Bytes> {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(await out);
}

const aad = (format: number, spaceId: string): Bytes => concat(new Uint8Array([format]), utf8(spaceId));

export interface SealOptions {
  /** The value was written by wire.ts (generation 2): the format byte says so. */
  lean?: boolean;
  /** Never compress (the connector's compaction, which can't afford it). */
  plain?: boolean;
}

export async function encryptJson(keys: Sealer, value: unknown, o: SealOptions = {}): Promise<Bytes> {
  let body = utf8(JSON.stringify(value));
  let format = o.lean ? FORMAT_LEAN : FORMAT_PLAIN;
  if (body.length >= (o.lean ? COMPRESS_FROM_LEAN : COMPRESS_FROM) && !o.plain && canGzip()) { body = await run(body, new CompressionStream('gzip')); format = o.lean ? FORMAT_LEAN_GZIP : FORMAT_GZIP; }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(format, keys.spaceId) }, keys.encKey, body);
  return concat(new Uint8Array([format]), iv, new Uint8Array(sealed));
}

export async function decryptJson<T = unknown>(keys: Sealer, blob: Uint8Array): Promise<T> {
  const format = blob[0];
  if (format !== undefined && format > FORMAT_LEAN_GZIP) throw new NewerFormatError();
  if (!known(format)) throw new DecryptError('unknown format');
  if (blob.length < 1 + IV_BYTES + 16) throw new DecryptError('too short');
  let body: Bytes;
  try {
    const iv = blob.slice(1, 1 + IV_BYTES);
    body = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(format, keys.spaceId) }, keys.encKey, blob.slice(1 + IV_BYTES)));
  } catch {
    throw new DecryptError('wrong key, wrong space or altered data');
  }
  if (gzipped(format)) {
    if (!canGzip()) throw new DecryptError('no gzip support here');
    body = await run(body, new DecompressionStream('gzip'));
  }
  return JSON.parse(fromUtf8(body)) as T;
}

/** Does the blob decrypt under these keys? No decompression, no parsing: a cheap "right key, right space?" check. */
export async function authenticates(keys: Sealer, blob: Uint8Array): Promise<boolean> {
  const format = blob[0];
  if (!known(format) || blob.length < 1 + IV_BYTES + 16) return false;
  try {
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(1, 1 + IV_BYTES), additionalData: aad(format, keys.spaceId) }, keys.encKey, blob.slice(1 + IV_BYTES));
    return true;
  } catch {
    return false;
  }
}

/** The same, as base64url text: how blobs travel in the relay's JSON. */
export const sealToText = async (keys: Sealer, value: unknown, o?: SealOptions): Promise<string> => b64uEncode(await encryptJson(keys, value, o));
export const openFromText = <T = unknown>(keys: Sealer, text: string): Promise<T> => decryptJson<T>(keys, b64uDecode(text));
