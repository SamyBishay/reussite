// Home's clock, after Hilma af Klint's The Dove (1915): a face of concentric rings in the painting's colours (the light painting's teals and gold in the
// light theme, the dark one's blues in the dark), its rim in two halves, one light and one dark, twelve dots for the hours and two tapered hands, the
// hour hand short and rose, the minute hand long. Drawn in SVG, no picture. The colours are `--clk-*` (src/styles/tokens.css, both themes); nothing moves
// but the hands, once a minute, when `clockNow` ticks (every 30 s), so there is no animation to hold back. It reads the time where the person is.
import { clockNow, hereZone } from './store';
import { partsIn } from '../domain/dates';
import { validZone } from '../domain/zone';
import { handAngles, phraseOf } from '../domain/clockFace';
import { t, type Key } from '../i18n';

/** The time in words, in the language of the app ("ten past three", "trois heures et quart"). */
export function clockWords(hh: number, mm: number): string {
  const p = phraseOf(hh, mm);
  const hour = (h: number) => t(('clockH' + (h === 0 || h === 12 ? h : h % 12)) as Key);
  const mins = (m: number) => ([5, 10, 20, 25].includes(m) ? t(('clockM' + m) as Key) : String(m));
  switch (p.kind) {
    case 'oclock': return p.h === 0 || p.h === 12 ? hour(p.h) : t('clockOclock', { h: hour(p.h) });
    case 'past': return t('clockPast', { h: hour(p.h), m: mins(p.m) });
    case 'quarterPast': return t('clockQuarterPast', { h: hour(p.h) });
    case 'half': return t('clockHalf', { h: hour(p.h) });
    case 'quarterTo': return t('clockQuarterTo', { h: hour(p.h) });
    case 'to': return t('clockTo', { h: hour(p.h), m: mins(p.m) });
  }
}

const DOTS = Array.from({ length: 12 }, (_, i) => i);
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: +(50 + r * Math.sin(a)).toFixed(2), y: +(50 - r * Math.cos(a)).toFixed(2) };
};

export function DoveClock({ size = 96, at }: { size?: number; at?: { hh: number; mm: number } }) {
  const now = at ?? partsIn(new Date(clockNow.value), validZone(hereZone.value));
  const { hour, minute } = handAngles(now.hh, now.mm);
  return (
    <svg class="dclock" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={t('clockLabel', { time: clockWords(now.hh, now.mm) })}
      data-testid="home-clock" data-time={String(now.hh).padStart(2, '0') + ':' + String(now.mm).padStart(2, '0')}>
      <path class="clk-l" d="M50 2A48 48 0 0 0 50 98Z" />
      <path class="clk-r" d="M50 2A48 48 0 0 1 50 98Z" />
      <circle class="clk-edge" cx="50" cy="50" r="47.6" />
      <circle class="clk-pale" cx="50" cy="50" r="36.5" />
      <circle class="clk-1" cx="50" cy="50" r="34" />
      <circle class="clk-2" cx="50" cy="50" r="28" />
      <circle class="clk-3" cx="50" cy="50" r="22" />
      <circle class="clk-gold" cx="50" cy="50" r="16.5" />
      <circle class="clk-4" cx="50" cy="50" r="14.5" />
      <circle class="clk-core" cx="50" cy="50" r="8" />
      {DOTS.map(i => { const p = polar(i * 30, 42.4); return <circle class="clk-dot" cx={p.x} cy={p.y} r={i % 3 === 0 ? 2.5 : 1.5} />; })}
      <path class="clk-hand clk-hour" transform={`rotate(${hour} 50 50)`} d="M50 27 L53 44 L50 54.5 L47 44Z" />
      <path class="clk-hand clk-min" transform={`rotate(${minute} 50 50)`} d="M50 7 L51.7 43 L50 58 L48.3 43Z" />
      <circle class="clk-cap" cx="50" cy="50" r="3.3" />
    </svg>
  );
}
