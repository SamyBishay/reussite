// Small byte helpers shared by the app and the relay: UTF-8, base64url, concatenation.
// Only standard web APIs (TextEncoder, btoa/atob), so they run in browsers, Node and Workers.

export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8 = (s: string): Bytes => encoder.encode(s) as Bytes;
export const fromUtf8 = (b: Uint8Array): string => decoder.decode(b);

export function b64uEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const B64U = /^[A-Za-z0-9_-]*$/;
export const isB64u = (s: string): boolean => B64U.test(s);

export function b64uDecode(s: string): Bytes {
  if (!B64U.test(s) || s.length % 4 === 1) throw new Error('not base64url');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Equal-length strings compared without stopping at the first difference. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
