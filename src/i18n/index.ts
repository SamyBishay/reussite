// UI strings (brief §7). Every string lives in en.ts / fr.ts; nothing is hard-coded in views.
// Placeholders: {name}. Plurals: a key whose value is an object of Intl.PluralRules categories.
import { signal, computed } from '@preact/signals';
import { en, type Strings } from './en';
import { fr } from './fr';

export type Lang = 'en' | 'fr';
export type Key = keyof Strings;
type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const DICTS: Record<Lang, Strings> = { en, fr };

export const lang = signal<Lang>('en');
const plurals = computed(() => new Intl.PluralRules(lang.value));

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

/** Translate in the current language. */
export function t(key: Key, params?: Record<string, string | number>): string {
  void plurals.value; // re-render when the language changes
  return translate(lang.value, key, params);
}

export const locale = () => (lang.value === 'fr' ? 'fr-FR' : 'en-GB');

export function fmtDate(k: string, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  const [y, m, d] = k.split('-').map(Number);
  try {
    return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString(locale(), { ...o, timeZone: 'UTC' });
  } catch {
    return k;
  }
}

export function fmtMin(m: number | null | undefined): string {
  const v = Math.round(m ?? 0);
  if (v < 60) return t('min', { n: v });
  const h = Math.floor(v / 60), r = v % 60;
  return r ? t('hmin', { h, m: String(r).padStart(2, '0') }) : t('hours', { h });
}
