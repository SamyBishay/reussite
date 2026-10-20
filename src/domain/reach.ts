// How to reach a person (brief §5, People): one link that opens WhatsApp, Messages, Mail or the phone. The
// person types a link, a phone number or an email; a number or an address becomes the right link. Pure; only
// schemes in ALLOWED_SCHEMES come out (a Maps-style `https:` link for wa.me included).
import { isAllowedLink } from './links';

export type ReachKind = 'whatsapp' | 'sms' | 'tel' | 'mail';

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** The digits of a phone number written by hand ("+33 6 12 34 56 78", "00 44 20…", "(06) 12-34"), with a leading `+` kept; null when it isn't one. */
export function phoneDigits(text: string): string | null {
  const s = text.trim();
  if (!/^\+?[\d\s().-]{6,}$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 15) return null;
  const plus = s.startsWith('+');
  // "00" is the international prefix in most of the world.
  if (!plus && digits.startsWith('00')) return '+' + digits.slice(2);
  return (plus ? '+' : '') + digits;
}

export const isEmail = (text: string): boolean => EMAIL.test(text.trim());

/** The links a typed number or email can become. WhatsApp needs the country code (a leading `+` or `00`). */
export function reachOptions(text: string): { kind: ReachKind; link: string }[] {
  const s = text.trim();
  if (isEmail(s)) return [{ kind: 'mail', link: 'mailto:' + s }];
  const p = phoneDigits(s);
  if (!p) return [];
  const out: { kind: ReachKind; link: string }[] = [];
  if (p.startsWith('+')) out.push({ kind: 'whatsapp', link: 'https://wa.me/' + p.slice(1) });
  out.push({ kind: 'sms', link: 'sms:' + p }, { kind: 'tel', link: 'tel:' + p });
  return out;
}

/** What to store for what was typed: an allowed link as it is, an email as `mailto:`, else null (a bare number needs a choice, see `reachOptions`). */
export function reachLink(text: string): string | null {
  const s = text.trim();
  if (!s) return null;
  if (isAllowedLink(s)) return s;
  return isEmail(s) ? 'mailto:' + s : null;
}

/** Which app a stored link opens, for its label. */
export function reachKind(link: string): ReachKind | 'other' {
  const s = link.trim().toLowerCase();
  if (s.startsWith('https://wa.me/') || s.startsWith('whatsapp:')) return 'whatsapp';
  if (s.startsWith('sms:')) return 'sms';
  if (s.startsWith('tel:')) return 'tel';
  if (s.startsWith('mailto:')) return 'mail';
  return 'other';
}
