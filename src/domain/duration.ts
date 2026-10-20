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

/**
 * A length typed or dictated as an answer to "how long did it take?": "20", "20 min", "1h", "1 h 30",
 * "1h30", "90 minutes", "une heure", "45 minutes". Null for anything else, so a new line is not mistaken for one.
 */
export function parseMinutes(text: string): number | null {
  const s = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/[.!]+$/, '');
  let m: RegExpExecArray | null;
  let v: number | null = null;
  if ((m = /^(\d{1,3})\s*(?:m|mn|min|mins|minute|minutes)?$/.exec(s))) v = Number(m[1]);
  else if ((m = /^(?:(\d{1,2})|an?|one|une?)\s*(?:h|hr|hrs|hour|hours|heure|heures)(?:\s*(?:and\s*)?(\d{1,2})\s*(?:m|mn|min|mins|minutes?)?)?$/.exec(s))) v = (m[1] ? Number(m[1]) : 1) * 60 + Number(m[2] ?? 0);
  else if (/^(?:half an hour|an? half[- ]hour|une demi[- ]heure|demi[- ]heure)$/.test(s)) v = 30;
  return v && v > 0 && v <= 16 * 60 ? v : null;
}
