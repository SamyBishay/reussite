// Home's clock, drawn like the timer (src/app/Rings.tsx): colour fills, no hands, no marks. Two shapes in the painting's colours (The Dove, Hilma af Klint, 1915):
// the hour is a pie that fills clockwise from twelve on a 12-hour dial, and round it the minutes ring fills. In the channel between them one small dot goes round with
// the seconds. The colours are `--clk-*` (src/styles/tokens.css, both themes). It reads the time where the person is.
// The dot moves once a second, only while the page is visible, and not at all when the person (or their device) asks for less motion: then it is not
// drawn and the clock moves once a minute, when `clockNow` ticks (every 30 s).
import { useEffect, useState } from 'preact/hooks';
import { clockNow, hereZone, settings } from './store';
import { partsIn } from '../domain/dates';
import { validZone } from '../domain/zone';
import { ringFractions, piePath, turnPoint, secondOf, phraseOf } from '../domain/clockFace';
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

// The dial, in a 100 x 100 box: the hour pie inside r 26, the minutes ring (6 thick) at r 43, and the seconds dot (r 2.6) half-way between them, at r 33.
const R_PIE = 26, R_MIN = 43, R_SEC = 33;
const ring = (r: number, f: number, cls: string) => {
  const len = 2 * Math.PI * r;
  // Nothing at zero: a round cap on an empty dash would still leave a dot.
  return f > 0 && <circle class={'clk-fill ' + cls} cx="50" cy="50" r={r} stroke-dasharray={`${(len * f).toFixed(2)} ${len.toFixed(2)}`} transform="rotate(-90 50 50)" />;
};

const reducedQuery = () => (typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-reduced-motion: reduce)'));

/** Per-second motion is on unless the app's "reduce motion" or the device's asks for less. */
function useMotion(): boolean {
  const app = settings.value.reduceMotion;
  const [os, setOs] = useState(() => !!reducedQuery()?.matches);
  useEffect(() => {
    const q = reducedQuery();
    if (!q) return;
    const on = () => setOs(q.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, []);
  return !app && !os;
}

/** The moment, to the second while `live` and the page is visible; null otherwise (the caller then reads the 30-second `clockNow`). */
function useSeconds(live: boolean): number | null {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    if (!live) { setMs(null); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      setMs(Date.now());
      // The next whole second, a hair after it, so that the ring never reads the second before.
      timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 8);
    };
    const stop = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const sync = () => { stop(); if (document.visibilityState === 'visible') tick(); else setMs(null); };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { stop(); document.removeEventListener('visibilitychange', sync); };
  }, [live]);
  return ms;
}

export function DoveClock({ size = 40, at }: { size?: number; at?: { hh: number; mm: number; ss?: number } }) {
  const motion = useMotion();
  const live = useSeconds(motion && !at);
  const zone = validZone(hereZone.value);
  const moment = live ?? clockNow.value;
  const now = at ?? partsIn(new Date(moment), zone);
  const showSec = motion && (at ? at.ss !== undefined : true);
  const ss = at ? at.ss ?? 0 : secondOf(moment);
  const { hour, minute, second } = ringFractions(now.hh, now.mm, ss);
  const dot = turnPoint(50, 50, R_SEC, second);
  return (
    <svg class="dclock" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={t('clockLabel', { time: clockWords(now.hh, now.mm) })}
      data-testid="home-clock" data-time={String(now.hh).padStart(2, '0') + ':' + String(now.mm).padStart(2, '0')} data-hour={hour.toFixed(4)} data-minute={minute.toFixed(4)}
      data-second={showSec ? String(Math.floor(ss)) : ''}>
      <circle class="clk-disc" cx="50" cy="50" r={R_PIE} />
      {hour > 0 && <path class="clk-pie" d={piePath(50, 50, R_PIE, hour)} />}
      <circle class="clk-track clk-ring" cx="50" cy="50" r={R_MIN} />
      {ring(R_MIN, minute, 'clk-min')}
      {showSec && <circle class="clk-sec" cx={dot.x} cy={dot.y} r="2.6" />}
    </svg>
  );
}
