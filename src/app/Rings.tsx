// The dragon's concentric rings (brief §16), used sparingly: an empty state's quiet mark, and a running
// timer's progress (the outer ring fills over the step's estimate; with none, the rings stay still).
import { useEffect, useState } from 'preact/hooks';
import { elapsedSec, planEst, type T } from './model';

/** Three still rings, for a list with nothing in it. Decorative. */
export function Rings({ size = 56 }: { size?: number }) {
  return (
    <svg class="rings" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="29" fill="none" style="stroke:var(--ring-1)" stroke-width="3" />
      <circle cx="32" cy="32" r="20" fill="none" style="stroke:var(--ring-2)" stroke-width="3" />
      <circle cx="32" cy="32" r="11" fill="none" style="stroke:var(--ring-3)" stroke-width="3" />
    </svg>
  );
}

/** How far through its estimate a running step is, 0–1; null without an estimate. */
export function progressOf(elapsed: number, estMin: number | null): number | null {
  if (!estMin || estMin <= 0) return null;
  return Math.max(0, Math.min(1, elapsed / (estMin * 60)));
}

const R = 42, LEN = 2 * Math.PI * R;

/** The running timer's rings: the outer one fills as the minutes pass. Beside the clock, which says the time. */
export function TimerRings({ tk, size = 72 }: { tk: T; size?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const p = progressOf(elapsedSec(tk, now), planEst(tk));
  return (
    <svg class="rings timer" width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" focusable="false" data-testid="timer-rings" data-progress={p == null ? '' : p.toFixed(3)}>
      <circle cx="48" cy="48" r={R} fill="none" style="stroke:var(--card-2)" stroke-width="6" />
      {p != null && <circle cx="48" cy="48" r={R} fill="none" style="stroke:var(--accent)" stroke-width="6" stroke-linecap="round"
        stroke-dasharray={`${(LEN * p).toFixed(2)} ${LEN.toFixed(2)}`} transform="rotate(-90 48 48)" />}
      <circle cx="48" cy="48" r="28" fill="none" style="stroke:var(--card-2)" stroke-width="5" />
      <circle cx="48" cy="48" r="15" style="fill:var(--accent-soft)" />
    </svg>
  );
}
