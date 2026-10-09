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

const LIGHT_GROUND = '#F2F1F6', LIGHT_CARD = '#FFFFFF', DARK_GROUND = '#14121C', DARK_CARD = '#211D2D';

/** Text on an accent-filled button: whichever of white or near-black reads better. */
export const inkOn = (bg: string) => (contrast(bg, '#FFFFFF') >= contrast(bg, '#1B1530') ? '#FFFFFF' : '#1B1530');

export interface Presets { [id: string]: { name: string; accent: string; suitColors: Record<SuitId, string> } }

/** v1's palette is the default; the others are alternatives that pass AA on the light card. */
export const PRESETS: Presets = {
  'lilac-sea': { name: 'Lilac & sea', accent: '#6B4BA6', suitColors: { S: '#1E7568', D: '#7A55B8', C: '#1E7568', H: '#7A55B8' } },
  'ink-coral': { name: 'Ink & coral', accent: '#2F4A8A', suitColors: { S: '#2F4A8A', D: '#B23A3A', C: '#2F4A8A', H: '#B23A3A' } },
  'forest-amber': { name: 'Forest & amber', accent: '#2E6B3F', suitColors: { S: '#2E6B3F', D: '#8A5A0B', C: '#2E6B3F', H: '#8A5A0B' } },
  'classic': { name: 'Classic cards', accent: '#3A3A44', suitColors: { S: '#1F1F27', D: '#B3261E', C: '#1F1F27', H: '#B3261E' } },
};

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
  const light = [
    `--accent:${s.accent}`, `--accent-ink:${inkOn(s.accent)}`, `--accent-soft:${mix(s.accent, LIGHT_CARD, 0.88)}`,
    ...suits.map(k => `--suit-${k}:${s.suitColors[k]}`),
  ].join(';');
  const darkAccent = readableOn(s.accent, DARK_CARD);
  const dark = [
    `--accent:${darkAccent}`, `--accent-ink:${inkOn(darkAccent)}`, `--accent-soft:${mix(s.accent, DARK_GROUND, 0.7)}`,
    ...suits.map(k => `--suit-${k}:${readableOn(s.suitColors[k], DARK_CARD)}`),
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
