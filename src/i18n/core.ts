// Translation without state: the words in a given language. The app's `t` (index.ts) adds the current
// language; the relay uses this directly (the connector writes the calendar feed in the person's language).
import { en, type Strings } from './en';
import { fr } from './fr';

export type Lang = 'en' | 'fr';
export type Key = keyof Strings;
type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const DICTS: Record<Lang, Partial<Strings>> = { en, fr };

/**
 * French typography: a narrow no-break space (U+202F) before ; : ! ? and inside « ».
 * Applied to every French string, so translators can type ordinary spaces.
 */
export function frTypo(s: string): string {
  return s
    .replace(/[   ]*([;:!?])(?=\s|$|[»)\]])/g, ' $1')
    .replace(/«[   ]*/g, '« ')
    .replace(/[   ]*»/g, ' »');
}

function fill(s: string, params?: Record<string, string | number>): string {
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

export function translate(l: Lang, key: Key, params?: Record<string, string | number>): string {
  const raw = (DICTS[l][key] ?? en[key]) as string | Plural;
  let s: string;
  if (typeof raw === 'string') s = raw;
  else {
    const n = Number(params?.n ?? 0);
    s = raw[new Intl.PluralRules(l).select(n)] ?? raw.other;
  }
  s = fill(s, params);
  return l === 'fr' ? frTypo(s) : s;
}
