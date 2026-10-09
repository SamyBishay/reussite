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
  /** Footer credit, per language. Empty = not shown. */
  credit: { en: string; fr: string };
  /** Default time for the day's standing obligation. */
  obligationAt: string;
  /** Sunday review: ISO weekday (7 = Sunday) and time. */
  reviewDay: number;
  reviewTime: string;
  /** Morning check-in and evening close reminders (notifications arrive in phase 3). */
  morningAt: string;
  eveningAt: string;
  /** Sound on completed steps and at the close of the day. */
  sound: boolean;
  volume: number;
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
  credit: {
    en: 'Designed by Samy Bishay and built with Claude Code. Special thanks to Nelly Darmon, psychologist.',
    fr: 'Conçu par Samy Bishay et développé avec Claude Code. Remerciements particuliers à Nelly Darmon, psychologue.',
  },
  obligationAt: '18:00',
  reviewDay: 7,
  reviewTime: '18:00',
  morningAt: '08:30',
  eveningAt: '21:00',
  sound: true,
  volume: 0.6,
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
