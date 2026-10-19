// Wrapping the space key while the connector is on: AES-GCM under the CONNECTOR_WRAP_KEY secret,
// with the space id as authenticated data, so a wrapped key can't be moved to another space.
// Also the keyed hash for pairing codes. The secret is never logged or returned.
import { b64uDecode, b64uEncode, concat, fromUtf8, utf8 } from '../../../src/sync/bytes';
import type { Env } from '../env';

export interface Wrapped { k: string; a: string }

const cache = new Map<string, Promise<{ aes: CryptoKey; hmac: CryptoKey }>>();

/** Accepts standard or URL-safe base64 of exactly 32 bytes. */
function secretBytes(text: string): Uint8Array {
  const b = b64uDecode(text.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  if (b.length !== 32) throw new Error('CONNECTOR_WRAP_KEY must be 32 bytes, base64');
  return b;
}

function keys(env: Env) {
  let k = cache.get(env.CONNECTOR_WRAP_KEY);
  if (!k) {
    const raw = secretBytes(env.CONNECTOR_WRAP_KEY ?? '');
    k = Promise.all([
      crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt']),
      crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    ]).then(([aes, hmac]) => ({ aes, hmac }));
    cache.set(env.CONNECTOR_WRAP_KEY, k);
  }
  return k;
}

/** Is the secret set and well formed? Switching on refuses to store anything without it. */
export function wrapKeyReady(env: Env): boolean {
  try { secretBytes(env.CONNECTOR_WRAP_KEY ?? ''); return true; } catch { return false; }
}

const aad = (space: string) => utf8('reussite/connector/v1:' + space);

export async function wrap(env: Env, space: string, value: Wrapped): Promise<string> {
  const { aes } = await keys(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(space) }, aes, utf8(JSON.stringify(value))));
  return b64uEncode(concat(iv, ct));
}

export async function unwrap(env: Env, space: string, text: string): Promise<Wrapped> {
  const { aes } = await keys(env);
  const b = b64uDecode(text);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12), additionalData: aad(space) }, aes, b.slice(12));
  return JSON.parse(fromUtf8(new Uint8Array(plain))) as Wrapped;
}

/** Keyed hash of a pairing code: what the database stores. */
export async function hashCode(env: Env, code: string): Promise<string> {
  const { hmac } = await keys(env);
  return b64uEncode(new Uint8Array(await crypto.subtle.sign('HMAC', hmac, utf8('reussite/pair/v1:' + code))));
}
