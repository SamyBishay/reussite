// Appearance from Settings (brief §7): theme mode, accent and suit colours with derived
// soft/deep variants, a WCAG contrast check, text size and reduced motion.
import type { Settings, ThemeMode } from '../data/settings';
import type { SuitId } from '../data/schema';

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function rgbToHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** WCAG 2.x relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: string, b: string): number {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  if (!ra || !rb) return 1;
  const la = luminance(ra), lb = luminance(rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
export const AA = 4.5;

export function mix(a: string, b: string, t: number): string {
  const ra = hexToRgb(a)!, rb = hexToRgb(b)!;
  return rgbToHex([0, 1, 2].map(i => ra[i]! + (rb[i]! - ra[i]!) * t) as Rgb);
}

/** Lighten (towards white) until the colour reaches AA contrast on `bg`, for dark mode. */
export function readableOn(color: string, bg: string): string {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = mix(color, '#FFFFFF', t);
    if (contrast(c, bg) >= AA) return c;
  }
  return '#FFFFFF';
}

/** The grounds a preset is drawn on: St George (tokens.css) or the first palette's lilac ones. */
export type Grounds = 'st-george' | 'lilac';
const CARDS: Record<Grounds, { light: string; dark: string; darkGround: string }> = {
  'st-george': { light: '#F7F7F3', dark: '#16161F', darkGround: '#0B0C10' },
  'lilac': { light: '#FFFFFF', dark: '#211D2D', darkGround: '#14121C' },
};
/** The lilac grounds, as they were before St George, in both modes. */
const LILAC_LIGHT = '--ground:#F2F1F6;--panel:#F8F7FB;--card:#FFFFFF;--card-2:#EEE8F8;--ink:#201C2B;--ink-2:#4E4860;--ink-3:#645D75;--line:#D6D1E3;--line-2:#E7E3EF;--lilac:#B8A2E6;--sea:#8ED8C8;--sea-deep:#1E7568;--sea-soft:#E0F4EF;--suit-a:#7A55B8;--suit-b:#1E7568;--pc:#FBF8F1;--pc-edge:#D2C8B8;--pc-text:#201C2B;--pc-ink:#1E7568;--pc-red:#7A55B8;--accent-deep:#1D1830;--ring-1:#8ED8C8;--ring-2:#B8A2E6;--ring-3:#E7E3EF';
const LILAC_DARK = '--ground:#14121C;--panel:#1A1724;--card:#211D2D;--card-2:#2F2747;--ink:#ECE8F4;--ink-2:#B7B0C8;--ink-3:#9C95AE;--line:#383249;--line-2:#29243A;--lilac:#C6B3F0;--sea:#8EDCCB;--sea-deep:#8EDCCB;--sea-soft:#1A3432;--suit-a:#C6B3F0;--suit-b:#8EDCCB;--pc:#F4F0F8;--pc-edge:#C9C0DA;--pc-text:#201C2B;--pc-ink:#1E7568;--pc-red:#7A55B8;--accent-deep:#0F0D18;--ring-1:#8EDCCB;--ring-2:#C6B3F0;--ring-3:#383249';

/** Text on an accent-filled button: whichever of white or near-black reads better. */
export const inkOn = (bg: string) => (contrast(bg, '#FFFFFF') >= contrast(bg, '#1B1530') ? '#FFFFFF' : '#1B1530');

export interface Preset {
  name: string;
  accent: string;
  suitColors: Record<SuitId, string>;
  /** Colours chosen for dark mode; without them, dark mode lightens the light ones until they read. */
  dark?: { accent: string; accentSoft: string; suitColors: Record<SuitId, string> };
  /** The light accent's soft tint, when chosen rather than mixed. */
  accentSoft?: string;
  /** Default palette, shown as "af Klint" (after Hilma af Klint, whose painting The Dove, 1915, inspired it). Its stored id stays `st-george`: people's synced settings hold it. */
  grounds?: Grounds;
}
export interface Presets { [id: string]: Preset }

/** The default palette is af Klint (id `st-george`, kept so nobody's settings break); the others are alternatives that pass AA on the light card. */
export const PRESETS: Presets = {
  'st-george': {
    name: 'af Klint', accent: '#2D6A67', accentSoft: '#D5E5E2', suitColors: { S: '#2F4C8E', D: '#735C1F', C: '#2B6964', H: '#9C4560' },
    dark: { accent: '#8DB0E6', accentSoft: '#1A2440', suitColors: { S: '#93B4EA', D: '#D4C08F', C: '#86C2BC', H: '#EC9DB8' } },
  },
  'lilac-sea': { name: 'Lilac & sea', accent: '#6B4BA6', suitColors: { S: '#1E7568', D: '#7A55B8', C: '#1E7568', H: '#7A55B8' }, grounds: 'lilac' },
  'ink-coral': { name: 'Ink & coral', accent: '#2F4A8A', suitColors: { S: '#2F4A8A', D: '#B23A3A', C: '#2F4A8A', H: '#B23A3A' } },
  'forest-amber': { name: 'Forest & amber', accent: '#2E6B3F', suitColors: { S: '#2E6B3F', D: '#8A5A0B', C: '#2E6B3F', H: '#8A5A0B' } },
  'classic': { name: 'Classic cards', accent: '#3A3A44', suitColors: { S: '#1F1F27', D: '#B3261E', C: '#1F1F27', H: '#B3261E' } },
};

/** The grounds the person's colours sit on. A custom palette keeps St George's. */
export const groundsOf = (s: Pick<Settings, 'preset'>): Grounds => PRESETS[s.preset]?.grounds ?? 'st-george';
/** The light card the contrast check in Settings measures against. */
export const lightCard = (s: Pick<Settings, 'preset'>): string => CARDS[groundsOf(s)].light;

/** The preset, when the person's colours are still exactly its own (then its chosen dark colours apply). */
function exactPreset(s: Pick<Settings, 'preset' | 'accent' | 'suitColors'>): Preset | null {
  const p = PRESETS[s.preset];
  if (!p || p.accent.toUpperCase() !== s.accent.toUpperCase()) return null;
  return (Object.keys(p.suitColors) as SuitId[]).every(k => p.suitColors[k].toUpperCase() === s.suitColors[k]?.toUpperCase()) ? p : null;
}

export function resolveMode(mode: ThemeMode, s: Pick<Settings, 'lightAt' | 'darkAt'>, now = new Date()): 'light' | 'dark' | 'system' {
  if (mode !== 'time') return mode;
  const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const { lightAt, darkAt } = s;
  const light = lightAt <= darkAt ? hm >= lightAt && hm < darkAt : !(hm >= darkAt && hm < lightAt);
  return light ? 'light' : 'dark';
}

/** The CSS for the person's colours, in both modes. */
export function themeCss(s: Settings): string {
  const suits = (Object.keys(s.suitColors) as SuitId[]);
  const g = groundsOf(s), card = CARDS[g], p = exactPreset(s);
  const light = [
    ...(g === 'lilac' ? [LILAC_LIGHT] : []),
    `--accent:${s.accent}`, `--accent-ink:${inkOn(s.accent)}`, `--accent-soft:${p?.accentSoft ?? mix(s.accent, card.light, 0.88)}`,
    ...suits.map(k => `--suit-${k}:${s.suitColors[k]}`),
  ].join(';');
  const darkAccent = p?.dark?.accent ?? readableOn(s.accent, card.dark);
  const dark = [
    ...(g === 'lilac' ? [LILAC_DARK] : []),
    `--accent:${darkAccent}`, `--accent-ink:${inkOn(darkAccent)}`, `--accent-soft:${p?.dark?.accentSoft ?? mix(s.accent, card.darkGround, 0.7)}`,
    ...suits.map(k => `--suit-${k}:${p?.dark?.suitColors[k] ?? readableOn(s.suitColors[k], card.dark)}`),
  ].join(';');
  return `:root{${light}}` +
    `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}` +
    `:root[data-theme="dark"]{${dark}}`;
}

const SIZES = { S: '15px', M: '16px', L: '18px' } as const;

/** Apply Settings to the document. Called on load and whenever Settings change. */
export function applyTheme(s: Settings): void {
  const root = document.documentElement;
  const mode = resolveMode(s.theme, s);
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  root.style.setProperty('--base-size', SIZES[s.textSize] ?? SIZES.M);
  root.toggleAttribute('data-reduce-motion', !!s.reduceMotion);
  root.lang = s.language;
  let el = document.getElementById('theme-vars');
  if (!el) {
    el = document.createElement('style');
    el.id = 'theme-vars';
    document.head.appendChild(el);
  }
  el.textContent = themeCss(s);
}
