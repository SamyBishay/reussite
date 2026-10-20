// Web Push payload encryption: RFC 8291 with the aes128gcm content coding of RFC 8188, in
// WebCrypto only (so it runs in the app, in tests and in Node). The device encrypts each
// notification for its own subscription, so the relay and the push service only carry
// ciphertext; the browser decrypts it before the service worker sees it.
//
// One record: header (salt 16 | record size 4 | key id length 1 | sender public key 65), then
// AES-128-GCM of plaintext || 0x02 || zero padding. The padding rounds the plaintext up to a
// multiple of PAD_BLOCK (256) bytes, so a short and a long title look alike on the wire.
import { b64uDecode, b64uEncode, concat, utf8, type Bytes } from '../sync/bytes';
import { MAX_PUSH_PLAINTEXT, PAD_BLOCK } from './protocol';

/** What `PushSubscription.toJSON().keys` holds: the browser's public key (65-byte point) and its 16-byte auth secret. */
export interface SubscriptionKeys { p256dh: string; auth: string }
/** The receiver's side, for decrypting in tests. */
export interface ReceiverKeys extends SubscriptionKeys { privateKey: string }

/** A sender key pair (public: 65-byte point; private: 32-byte scalar), base64url. Tests inject one for the RFC's vector. */
export interface EphemeralKeys { publicKey: string; privateKey: string }
export interface EncryptOptions {
  salt?: Bytes;
  ephemeral?: EphemeralKeys;
  /** Pad the plaintext to a multiple of this many bytes (default PAD_BLOCK; the RFC's vector uses 1). */
  block?: number;
}

const RECORD_SIZE = 4096; // announced in the header; our records are far smaller
const HEADER_FIXED = 21; // salt 16 + record size 4 + key id length 1
const TAG = 16;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

const jwk = (point: Bytes, d?: string): JsonWebKey => ({
  kty: 'EC', crv: 'P-256', x: b64uEncode(point.subarray(1, 33)), y: b64uEncode(point.subarray(33, 65)), ...(d ? { d } : {}),
});

function point(b64: string, what: string): Bytes {
  const raw = b64uDecode(b64);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error(`${what} must be an uncompressed P-256 point`);
  return raw;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8)) as Bytes;
}

/** The content encryption key and nonce for one message (RFC 8291, section 3.4). */
async function keys(ecdh: Bytes, auth: Bytes, salt: Bytes, uaPublic: Bytes, asPublic: Bytes): Promise<{ cek: CryptoKey; nonce: Bytes }> {
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(auth, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  return { cek: await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt', 'decrypt']), nonce };
}

/** Encrypt `plaintext` (at most MAX_PUSH_PLAINTEXT bytes) for a subscription. Returns the whole body to POST to the push endpoint. */
export async function encryptPush(sub: SubscriptionKeys, plaintext: Uint8Array, opts: EncryptOptions = {}): Promise<Bytes> {
  if (plaintext.length > MAX_PUSH_PLAINTEXT) throw new Error('push payload too large');
  const block = opts.block ?? PAD_BLOCK;
  const uaPublic = point(sub.p256dh, 'p256dh');
  const auth = b64uDecode(sub.auth);
  const salt = opts.salt ?? (crypto.getRandomValues(new Uint8Array(16)) as Bytes);
  if (salt.length !== 16) throw new Error('salt must be 16 bytes');

  let asPublic: Bytes;
  let asPrivate: CryptoKey;
  if (opts.ephemeral) {
    asPublic = point(opts.ephemeral.publicKey, 'ephemeral public key');
    asPrivate = await crypto.subtle.importKey('jwk', jwk(asPublic, opts.ephemeral.privateKey), ECDH, false, ['deriveBits']);
  } else {
    const pair = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
    asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer) as Bytes;
    asPrivate = pair.privateKey;
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, ECDH, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as never, asPrivate, 256)) as Bytes;
  const { cek, nonce } = await keys(ecdh, auth, salt, uaPublic, asPublic);

  // plaintext || 0x02 (last record) || zeros, to a multiple of `block`
  const padded = new Uint8Array(Math.ceil((plaintext.length + 1) / block) * block);
  padded.set(plaintext);
  padded[plaintext.length] = 2;
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cek, padded));

  const header = new Uint8Array(HEADER_FIXED);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

/** Encrypt text (or JSON, which is stringified) and return base64url: the `blob` of the push endpoints. */
export async function encryptPushBlob(sub: SubscriptionKeys, payload: unknown, opts?: EncryptOptions): Promise<string> {
  return b64uEncode(await encryptPush(sub, utf8(typeof payload === 'string' ? payload : JSON.stringify(payload)), opts));
}

/** Decrypt one message the way the browser does. For tests (and the e2e push stub); the app never decrypts. */
export async function decryptPush(body: Uint8Array, me: ReceiverKeys): Promise<Bytes> {
  if (body.length < HEADER_FIXED + 65 + TAG + 1) throw new Error('message too short');
  const salt = body.slice(0, 16) as Bytes;
  const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idLen = body[20]!;
  if (idLen !== 65) throw new Error('unexpected key id');
  const asPublic = body.slice(HEADER_FIXED, HEADER_FIXED + idLen) as Bytes;
  const sealed = body.slice(HEADER_FIXED + idLen) as Bytes;
  if (sealed.length > recordSize) throw new Error('more than one record');

  const uaPublic = point(me.p256dh, 'p256dh');
  const uaPrivate = await crypto.subtle.importKey('jwk', jwk(uaPublic, me.privateKey), ECDH, false, ['deriveBits']);
  const asKey = await crypto.subtle.importKey('raw', asPublic, ECDH, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as never, uaPrivate, 256)) as Bytes;
  const { cek, nonce } = await keys(ecdh, b64uDecode(me.auth), salt, uaPublic, asPublic);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, cek, sealed));

  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end--;
  if (end === 0 || padded[end - 1] !== 2) throw new Error('bad padding');
  return padded.slice(0, end - 1) as Bytes;
}
