// Home's clock, drawn like the timer (src/app/Rings.tsx): no hands, no dots. Two concentric rings on a faint track, in the painting's colours (The Dove,
// Hilma af Klint, 1915): the outer fills clockwise from twelve with the hour on a 12-hour dial, the inner with the minutes. The colours are `--clk-*`
// (src/styles/tokens.css, both themes). Nothing is animated: the rings move once a minute, when `clockNow` ticks (every 30 s), so there is nothing to hold back.
// It reads the time where the person is.
import { clockNow, hereZone } from './store';
import { partsIn } from '../domain/dates';
import { validZone } from '../domain/zone';
import { ringFractions, phraseOf } from '../domain/clockFace';
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

const R_HOUR = 43, R_MIN = 26;
const ring = (r: number, f: number, cls: string) => {
  const len = 2 * Math.PI * r;
  // Nothing at zero: a round cap on an empty dash would still leave a dot.
  return f > 0 && <circle class={'clk-fill ' + cls} cx="50" cy="50" r={r} stroke-dasharray={`${(len * f).toFixed(2)} ${len.toFixed(2)}`} transform="rotate(-90 50 50)" />;
};

export function DoveClock({ size = 32, at }: { size?: number; at?: { hh: number; mm: number } }) {
  const now = at ?? partsIn(new Date(clockNow.value), validZone(hereZone.value));
  const { hour, minute } = ringFractions(now.hh, now.mm);
  return (
    <svg class="dclock" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={t('clockLabel', { time: clockWords(now.hh, now.mm) })}
      data-testid="home-clock" data-time={String(now.hh).padStart(2, '0') + ':' + String(now.mm).padStart(2, '0')} data-hour={hour.toFixed(4)} data-minute={minute.toFixed(4)}>
      <circle class="clk-track" cx="50" cy="50" r={R_HOUR} />
      <circle class="clk-track" cx="50" cy="50" r={R_MIN} />
      {ring(R_HOUR, hour, 'clk-hour')}
      {ring(R_MIN, minute, 'clk-min')}
    </svg>
  );
}
