// Settings are data (brief §7): one synced document, `meta/settings`. An update adds
// defaults for new keys and never overwrites what the person chose.
import type { SuitId } from './schema';

export type ThemeMode = 'system' | 'light' | 'dark' | 'time';
export type Celebrations = 'off' | 'calm' | 'lively';
export type TextSize = 'S' | 'M' | 'L';
export type Lang = 'en' | 'fr';

export interface SuitSetting {
  name: { en: string; fr: string };
  short: { en: string; fr: string };
  glyph: string;
}

export interface Settings {
  language: Lang;
  // Appearance
  theme: ThemeMode;
  /** For theme 'time': light from `lightAt`, dark from `darkAt`. */
  lightAt: string;
  darkAt: string;
  preset: string;
  accent: string;
  suitColors: Record<SuitId, string>;
  textSize: TextSize;
  reduceMotion: boolean;
  celebrations: Celebrations;
  // Method
  urgencyDays: number;
  dayStart: string;
  maxWorkSteps: number;
  planningMin: number;
  launchDefaults: { start: string; restarts: string[] };
  suits: Record<SuitId, SuitSetting>;
  /** Current place outside any stay: a place id. */
  here: string;
  /** Open websites inside Réussite instead of the browser. */
  linksInApp: boolean;
  /** Footer credit for the method's author, per language. Empty = not shown. */
  credit: { en: string; fr: string };
  [extra: string]: unknown;
}

export const SUIT_ORDER: SuitId[] = ['S', 'D', 'C', 'H'];

export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  theme: 'system',
  lightAt: '07:00',
  darkAt: '20:00',
  preset: 'lilac-sea',
  accent: '#6B4BA6',
  suitColors: { S: '#1E7568', D: '#7A55B8', C: '#1E7568', H: '#7A55B8' },
  textSize: 'M',
  reduceMotion: false,
  celebrations: 'lively',
  urgencyDays: 21,
  dayStart: '05:00',
  maxWorkSteps: 3,
  planningMin: 15,
  launchDefaults: { start: '09:30', restarts: ['14:00'] },
  suits: {
    S: { name: { en: 'Work & studies', fr: 'Travail et études' }, short: { en: 'Work', fr: 'Travail' }, glyph: '♠' },
    D: { name: { en: 'Money & papers', fr: 'Argent et papiers' }, short: { en: 'Papers', fr: 'Papiers' }, glyph: '♦' },
    C: { name: { en: 'Family & home', fr: 'Famille et maison' }, short: { en: 'Family', fr: 'Famille' }, glyph: '♣' },
    H: { name: { en: 'Life: people, leisure, health', fr: 'Vie : proches, loisirs, santé' }, short: { en: 'Life', fr: 'Vie' }, glyph: '♥' },
  },
  here: 'any',
  linksInApp: false,
  credit: { en: '', fr: '' },
};

/** Fill in defaults for missing keys, one level deep for nested objects. Never overwrites a set value. */
export function withDefaults(saved: Partial<Settings> | undefined): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(saved ?? {})) {
    const d = (DEFAULT_SETTINGS as Record<string, unknown>)[k];
    out[k] = isPlainObject(d) && isPlainObject(v) ? { ...d, ...v } : v;
  }
  return out as Settings;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
