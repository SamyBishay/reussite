// VAPID (RFC 8292): the relay proves to the push service that it is the application server the
// subscription was made for. An ES256 JWT, signed with WebCrypto only (browsers, Node, Workers).
// Keys travel as base64url: the public key is the 65-byte uncompressed point, the private key
// is the 32-byte scalar `d` (`scripts/vapid-keygen.mjs` makes a pair).
import { b64uDecode, b64uEncode, fromUtf8, utf8 } from '../sync/bytes';

export interface VapidKeys { publicKey: string; privateKey: string }

/** Lifetime of a token (the limit is 24 h); a tick reuses one per audience. */
export const VAPID_TTL_S = 12 * 3600;

/** A fresh key pair. Only the key generator and tests use this. */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await (crypto.subtle.exportKey('jwk', pair.privateKey) as Promise<JsonWebKey>);
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return { publicKey: b64uEncode(raw), privateKey: jwk.d! };
}

/** The point's coordinates, as JWK wants them; throws unless it is a 65-byte uncompressed point. */
function coordinates(publicKey: string): { x: string; y: string } {
  const raw = b64uDecode(publicKey);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('VAPID public key must be an uncompressed P-256 point');
  return { x: b64uEncode(raw.subarray(1, 33)), y: b64uEncode(raw.subarray(33, 65)) };
}

export const importVapidPrivate = async (keys: VapidKeys): Promise<CryptoKey> =>
  crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', ...coordinates(keys.publicKey), d: keys.privateKey }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

export const importVapidPublic = async (publicKey: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', ...coordinates(publicKey) }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);

/** The push service the endpoint belongs to: `scheme://host[:port]` (the JWT's `aud`). */
export const audienceOf = (endpoint: string): string => new URL(endpoint).origin;

/**
 * A signed token for one audience. `now` is in ms. `subject` is a `mailto:` or https URL the push
 * service can contact; ours is the relay's address, nothing personal.
 */
export async function signVapid(key: CryptoKey, audience: string, subject: string, now: number): Promise<string> {
  const head = b64uEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64uEncode(utf8(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + VAPID_TTL_S, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${head}.${body}`));
  return `${head}.${body}.${b64uEncode(new Uint8Array(sig))}`; // WebCrypto's signature is r||s, 64 bytes, as JWS wants
}

/** The `Authorization` header value. */
export const vapidHeader = (jwt: string, publicKey: string): string => `vapid t=${jwt}, k=${publicKey}`;

/** Check a token against the public key (the push services do this; tests do too). Returns its claims, or null. */
export async function verifyVapid(jwt: string, publicKey: string, now: number): Promise<{ aud: string; exp: number; sub: string } | null> {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const [head, body, sig] = parts as [string, string, string];
    if (JSON.parse(fromUtf8(b64uDecode(head))).alg !== 'ES256') return null;
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await importVapidPublic(publicKey), b64uDecode(sig), utf8(`${head}.${body}`));
    if (!ok) return null;
    const claims = JSON.parse(fromUtf8(b64uDecode(body)));
    return typeof claims.exp === 'number' && claims.exp * 1000 > now ? claims : null;
  } catch {
    return null;
  }
}
