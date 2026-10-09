// "How long did it take?" quick buttons (brief §5): scaled to the step's estimate.

export const NO_ESTIMATE_BUTTONS = [5, 15, 30, 45, 60, 90];
const MULTIPLIERS = [0.25, 0.5, 1, 1.5, 2];

/** Clean values: 5-minute steps under an hour, 15-minute steps from an hour up, never under 5. */
export function roundDuration(m: number): number {
  const r = m < 60 ? Math.round(m / 5) * 5 : Math.round(m / 15) * 15;
  return Math.max(5, r);
}

export function durationButtons(estimate: number | null | undefined): number[] {
  if (!estimate || estimate <= 0) return NO_ESTIMATE_BUTTONS.slice();
  const out: number[] = [];
  for (const k of MULTIPLIERS) {
    const v = roundDuration(estimate * k);
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** The hour/minute wheel: hours 0–8, minutes in 5-minute steps. */
export const WHEEL_HOURS = Array.from({ length: 9 }, (_, i) => i);
export const WHEEL_MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

export function splitWheel(m: number): { h: number; m: number } {
  const v = Math.min(8 * 60 + 55, roundTo5(m));
  return { h: Math.floor(v / 60), m: v % 60 };
}
const roundTo5 = (m: number) => Math.max(0, Math.round(m / 5) * 5);
