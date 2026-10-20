// Prints a VAPID key pair for Web Push (docs/dev/push.md) to stdout, and nothing else anywhere:
// it never writes a file. Public key: the 65-byte uncompressed point, base64url (the relay var
// VAPID_PUBLIC_KEY and the app's VITE_VAPID_PUBLIC_KEY). Private key: the 32-byte scalar, base64url
// (the relay secret VAPID_PRIVATE_KEY: `cd relay && npx wrangler secret put VAPID_PRIVATE_KEY`).
// Run it once; keep the private line out of the repo, chat logs and screenshots.
import { webcrypto as crypto } from 'node:crypto';

const b64u = bytes => Buffer.from(bytes).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
