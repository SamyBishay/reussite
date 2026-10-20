// Test helper: a receiver that stands in for a browser's push subscription (p256dh, auth) and
// can decrypt what was encrypted for it. Used by the unit tests and the relay's tests.
import { b64uEncode } from '../sync/bytes';
import type { ReceiverKeys } from './encrypt';

export async function newReceiver(): Promise<ReceiverKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const jwk = await (crypto.subtle.exportKey('jwk', pair.privateKey) as Promise<JsonWebKey>);
  return {
    p256dh: b64uEncode(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)),
    auth: b64uEncode(crypto.getRandomValues(new Uint8Array(16))),
    privateKey: jwk.d!,
  };
}
