// The one-tap link (docs/CHANGESET.md): `https://<app>/drop#<space>.<inbox public key>.<mode>.<data>`.
// The fragment is never sent to a server. `space` is the space id and the key is the inbox public
// key (both base64url, no dots). Mode `z`: the change-set JSON compressed with deflate-raw, then
// base64url (what an AI with a code tool can make). Mode `j`: the JSON itself, percent-encoded
// (what any AI can write by hand). Pure; no I/O beyond the platform's compression streams.
import { b64uDecode, b64uEncode, fromUtf8, isB64u, utf8 } from './bytes';
import { deflateRaw, inflateRaw, MAX_UNPACKED } from './inbox';
import { SPACE_ID } from './protocol';

/** Over this many characters of fragment the AI should give the fenced block instead. */
export const DROP_MAX_FRAGMENT = 8000;
/** The page reads up to this much (so a slightly long link still works) and no more. */
const PARSE_MAX = 64 * 1024;
const PUB = /^[A-Za-z0-9_-]{43}$/;

export type DropLinkErrorCode = 'format' | 'too_big' | 'data';
export class DropLinkError extends Error {
  constructor(public code: DropLinkErrorCode) { super('drop link: ' + code); }
}

export interface DropAddress { space: string; pub: string }
export interface DropLink extends DropAddress { json: unknown }

/** The start of every link for this person, up to and including the mode's dot. */
export const dropPrefix = (a: DropAddress): string => `${a.space}.${a.pub}.`;
/** The page's address for an app at `origin` (no trailing slash, and none after `drop`). */
export const dropUrl = (origin: string): string => origin.replace(/\/+$/, '') + '/drop';

/** Make a link; mode `z` when the platform can compress. Used by tests and docs; the AI makes the real ones. */
export async function buildDropLink(origin: string, a: DropAddress, json: unknown, mode: 'z' | 'j' = 'z'): Promise<string> {
  const text = JSON.stringify(json);
  const data = mode === 'z' ? b64uEncode(await deflateRaw(utf8(text))) : encodeURIComponent(text);
  return `${dropUrl(origin)}#${dropPrefix(a)}${mode}.${data}`;
}

/** The fragment of a link (with or without the leading #), read tolerantly. Throws DropLinkError. */
export async function parseDropFragment(fragment: string): Promise<DropLink> {
  const f = fragment.trim().replace(/^#/, '');
  if (f.length > PARSE_MAX) throw new DropLinkError('too_big');
  const parts = [] as string[];
  let rest = f;
  for (let i = 0; i < 3; i++) { const at = rest.indexOf('.'); if (at < 0) throw new DropLinkError('format'); parts.push(rest.slice(0, at)); rest = rest.slice(at + 1); }
  const [space, pub, mode] = parts as [string, string, string];
  if (!SPACE_ID.test(space) || !PUB.test(pub) || !rest) throw new DropLinkError('format');
  try {
    if (mode === 'z') {
      // Tolerate padding and the standard alphabet, which some AIs write.
      const clean = rest.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      if (!isB64u(clean)) throw new DropLinkError('data');
      return { space, pub, json: JSON.parse(fromUtf8(await inflateRaw(b64uDecode(clean), MAX_UNPACKED))) };
    }
    if (mode === 'j') return { space, pub, json: JSON.parse(decodeURIComponent(rest)) };
  } catch (e) {
    throw e instanceof DropLinkError ? e : new DropLinkError('data');
  }
  throw new DropLinkError('format');
}
