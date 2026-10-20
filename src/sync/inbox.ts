// The inbox key pair and sealed boxes (docs/CHANGESET.md, "The one-tap link"). Every device that
// holds the recovery key derives the same X25519 key pair from it (HKDF, info `inbox-x25519`), so
// nothing new is stored or synced. The public half is not a secret: it goes in the drop address,
// and anyone with it can leave a change-set that only the person's devices can open. The relay
// stores the box without opening it.
//
// Box: [1][ephemeral public key, 32][IV, 12][AES-GCM ciphertext + tag]. The AES key is HKDF-SHA256
// over the X25519 shared secret, salted with both public keys. Authenticated data is the version
// byte plus the space id, so a box cannot be moved to another space. The plaintext is
// [1 plain | 2 deflate-raw][JSON].
//
// WebCrypto only: X25519 private keys can be imported from PKCS8 with a fixed prefix, and the
// public key read back from the JWK.
import { type Bytes, b64uDecode, b64uEncode, concat, fromUtf8, utf8 } from './bytes';
import { deriveSecret } from './keys';

const VERSION = 1;
const IV_BYTES = 12;
const PUB_BYTES = 32;
const PLAIN = 1, DEFLATE = 2;
const COMPRESS_FROM = 128;
/** What a box may unpack to; a bigger one is refused rather than inflated. */
export const MAX_UNPACKED = 256 * 1024;
const PKCS8_X25519 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);
const INFO = utf8('reussite/inbox/v1');

export class InboxError extends Error {
  constructor(why: string) { super('inbox: ' + why); }
}

export interface InboxKeys {
  /** 32 bytes, base64url: goes in the drop address. */
  publicKey: string;
  privateKey: CryptoKey;
}

/** The inbox key pair for a recovery key. Throws when the browser has no X25519. */
export async function deriveInbox(recovery: Uint8Array): Promise<InboxKeys> {
  const seed = await deriveSecret(recovery, 'inbox-x25519', 32);
  const pkcs8 = concat(PKCS8_X25519, seed);
  const probe = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, ['deriveBits']);
  const jwk = (await crypto.subtle.exportKey('jwk', probe)) as JsonWebKey;
  if (!jwk.x) throw new InboxError('no public key');
  return { publicKey: jwk.x, privateKey: await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']) };
}

/** Can this browser do it? (X25519 in WebCrypto: Chrome 133, Firefox 130, Safari 17.) */
export async function inboxSupported(): Promise<boolean> {
  try { await deriveInbox(new Uint8Array(32)); return true; } catch { return false; }
}

async function boxKey(shared: ArrayBuffer, ephPub: Uint8Array, recipientPub: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const master = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: concat(ephPub, recipientPub) as Bytes, info: INFO }, master, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
// The peer's key goes in a property called `public`; the Workers typings spell it `$public`.
const x25519 = (peer: CryptoKey) => ({ name: 'X25519', public: peer }) as never;
const aad = (space: string): Bytes => concat(new Uint8Array([VERSION]), utf8(space));

const canDeflate = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
export async function deflateRaw(data: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await new Response(new Blob([data as Bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
}
/** Inflate, refusing anything that grows past `max` bytes. */
export async function inflateRaw(data: Uint8Array, max = MAX_UNPACKED): Promise<Bytes> {
  const reader = new Blob([data as Bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    n += r.value.length;
    if (n > max) { await reader.cancel(); throw new InboxError('too big'); }
    parts.push(r.value);
  }
  return concat(...parts);
}

/** Seal a JSON value to an inbox public key (base64url) for a space; the box as base64url text. */
export async function sealToInbox(space: string, publicKey: string, value: unknown): Promise<string> {
  let pub: Bytes;
  try { pub = b64uDecode(publicKey); } catch { throw new InboxError('bad public key'); }
  if (pub.length !== PUB_BYTES) throw new InboxError('bad public key');
  const eph = (await crypto.subtle.generateKey({ name: 'X25519' } as never, true, ['deriveBits'])) as CryptoKeyPair;
  const ephPub = new Uint8Array((await crypto.subtle.exportKey('raw', eph.publicKey)) as ArrayBuffer);
  const recipient = await crypto.subtle.importKey('raw', pub, { name: 'X25519' }, false, []);
  const shared = await crypto.subtle.deriveBits(x25519(recipient), eph.privateKey, 256);
  let body = utf8(JSON.stringify(value));
  let fmt = PLAIN;
  if (body.length >= COMPRESS_FROM && canDeflate()) { body = await deflateRaw(body); fmt = DEFLATE; }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(space) }, await boxKey(shared, ephPub, pub, 'encrypt'), concat(new Uint8Array([fmt]), body));
  return b64uEncode(concat(new Uint8Array([VERSION]), ephPub, iv, new Uint8Array(sealed)));
}

/** Open a box with the inbox private key. Throws InboxError when it isn't for this key and space. */
export async function openFromInbox<T = unknown>(space: string, keys: InboxKeys, text: string): Promise<T> {
  let box: Bytes;
  try { box = b64uDecode(text); } catch { throw new InboxError('not base64url'); }
  if (box[0] !== VERSION || box.length < 1 + PUB_BYTES + IV_BYTES + 16 + 1) throw new InboxError('unknown format');
  const ephPub = box.slice(1, 1 + PUB_BYTES);
  const iv = box.slice(1 + PUB_BYTES, 1 + PUB_BYTES + IV_BYTES);
  let plain: Bytes;
  try {
    const sender = await crypto.subtle.importKey('raw', ephPub, { name: 'X25519' }, false, []);
    const shared = await crypto.subtle.deriveBits(x25519(sender), keys.privateKey, 256);
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(space) }, await boxKey(shared, ephPub, b64uDecode(keys.publicKey), 'decrypt'), box.slice(1 + PUB_BYTES + IV_BYTES)));
  } catch { throw new InboxError('wrong key, wrong space or altered data'); }
  const fmt = plain[0];
  let body = plain.slice(1);
  if (fmt === DEFLATE) body = await inflateRaw(body);
  else if (fmt !== PLAIN) throw new InboxError('unknown format');
  try { return JSON.parse(fromUtf8(body)) as T; } catch { throw new InboxError('not JSON'); }
}
