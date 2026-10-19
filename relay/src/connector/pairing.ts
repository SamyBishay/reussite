// Pairing codes: how the person signs an AI app in without an account. Eight characters from an
// alphabet without look-alikes (no 0 O Q, 1 I L, 2 Z, 5 S, 8 B, U), single use, valid for ten
// minutes, stored only as a keyed hash.
import type { Env } from '../env';
import { hashCode } from './wrap';

export const CODE_ALPHABET = 'ACDEFGHJKMNPRTVWXY34679'; // 23 characters
export const CODE_LENGTH = 8;
export const CODE_TTL_MS = 10 * 60_000;
/** A space can have this many unused codes at once; the oldest go first. */
const MAX_LIVE_CODES = 3;

export function newCode(): string {
  let out = '';
  const limit = 256 - (256 % CODE_ALPHABET.length); // reject the top bytes: no modulo bias
  while (out.length < CODE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

/** `ABCD-EFGH`, as shown. */
export const formatCode = (code: string) => code.slice(0, 4) + '-' + code.slice(4);

/** What was typed, normalised: upper case, spaces and dashes dropped. Null when it can't be a code. */
export function normalizeCode(text: string): string | null {
  const c = text.toUpperCase().replace(/[\s-]+/g, '');
  return c.length === CODE_LENGTH && [...c].every(ch => CODE_ALPHABET.includes(ch)) ? c : null;
}

/** Make a code for a space and keep its hash. */
export async function issueCode(env: Env, space: string, now = Date.now()): Promise<{ code: string; expires: number }> {
  const code = newCode();
  const expires = now + CODE_TTL_MS;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM connector_codes WHERE expires <= ?1').bind(now),
    env.DB.prepare('INSERT INTO connector_codes (code_hash, space, expires) VALUES (?1, ?2, ?3)').bind(await hashCode(env, code), space, expires),
    // Keep at most a few unused codes per space: the oldest are dropped.
    env.DB.prepare('DELETE FROM connector_codes WHERE space = ?1 AND code_hash NOT IN (SELECT code_hash FROM connector_codes WHERE space = ?1 ORDER BY expires DESC LIMIT ?2)').bind(space, MAX_LIVE_CODES),
  ]);
  return { code, expires };
}

/** Does this code exist and is it still valid? Does not use it up. */
export async function codeSpace(env: Env, typed: string, now = Date.now()): Promise<{ space: string; hash: string } | null> {
  const code = normalizeCode(typed);
  if (!code) return null;
  const hash = await hashCode(env, code);
  const row = await env.DB.prepare('SELECT space FROM connector_codes WHERE code_hash = ?1 AND expires > ?2').bind(hash, now).first<{ space: string }>();
  return row ? { space: row.space, hash } : null;
}

/** Use a code up: true for exactly one caller, even if two race. */
export async function consumeCode(env: Env, hash: string, now = Date.now()): Promise<boolean> {
  const row = await env.DB.prepare('DELETE FROM connector_codes WHERE code_hash = ?1 AND expires > ?2 RETURNING space').bind(hash, now).first();
  return !!row;
}
