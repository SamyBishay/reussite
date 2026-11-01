// The Dove clock's arithmetic (src/app/DoveClock.tsx): how far round each part is filled, where its hour ticks and its pie go, and how the time is said. Pure.

/**
 * How far round each part is, 0 to 1, clockwise from twelve. Inside, the hour is a pie on a 12-hour dial (it creeps with the minutes and is empty at twelve); round it, the minutes
 * ring (empty on the hour); outermost, the seconds ring (empty on the minute). Each moves in whole steps: the hour and the minutes with the minute, the seconds with the second.
 */
export function ringFractions(hh: number, mm: number, ss = 0): { hour: number; minute: number; second: number } {
  const h = ((hh % 12) + 12) % 12, m = ((mm % 60) + 60) % 60, s = ((Math.floor(ss) % 60) + 60) % 60;
  return { hour: (h + m / 60) / 12, minute: m / 60, second: s / 60 };
}

/** The second of the minute at a moment (zones differ by whole minutes, so the second is the same everywhere). */
export const secondOf = (ms: number): number => Math.floor((((ms % 60_000) + 60_000) % 60_000) / 1000);

const pt = (cx: number, cy: number, r: number, turn: number) => ({ x: cx + r * Math.sin(2 * Math.PI * turn), y: cy - r * Math.cos(2 * Math.PI * turn) });
const n2 = (x: number) => Number(x.toFixed(2));

/** The path of a pie of radius `r` about (cx, cy), from twelve clockwise through `f` of a turn: empty ("") at zero, a whole disc at one or more. */
export function piePath(cx: number, cy: number, r: number, f: number): string {
  if (!(f > 0)) return '';
  const top = pt(cx, cy, r, 0);
  if (f >= 1) { const bot = pt(cx, cy, r, 0.5); return `M${n2(top.x)} ${n2(top.y)}A${r} ${r} 0 1 1 ${n2(bot.x)} ${n2(bot.y)}A${r} ${r} 0 1 1 ${n2(top.x)} ${n2(top.y)}Z`; }
  const e = pt(cx, cy, r, f);
  return `M${cx} ${cy}L${n2(top.x)} ${n2(top.y)}A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${n2(e.x)} ${n2(e.y)}Z`;
}

/** The twelve hour ticks, ending at `r2` about (cx, cy) and starting at `r1`; the quarters (twelve, three, six, nine) start further in, at `rq`. */
export function hourTicks(cx: number, cy: number, r1: number, r2: number, rq: number): { x1: number; y1: number; x2: number; y2: number; quarter: boolean }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const quarter = i % 3 === 0, a = pt(cx, cy, quarter ? rq : r1, i / 12), b = pt(cx, cy, r2, i / 12);
    return { x1: n2(a.x), y1: n2(a.y), x2: n2(b.x), y2: n2(b.y), quarter };
  });
}

/**
 * How the time is said, as a recipe the translations fill in: the hour word (0 to 23; 0 and 12 are midnight and noon, the others are said on the 12-hour clock),
 * the pattern, and the minutes when the pattern shows them. Five-minute marks are words in the pattern or in `m`; others are given as numbers.
 *   o'clock: exact hour · past: 1 to 29 minutes after (quarter at 15) · half: 30 · to: 1 to 29 minutes before the next hour (quarter at 45).
 */
export type Phrase =
  | { kind: 'oclock'; h: number }
  | { kind: 'past'; h: number; m: number }
  | { kind: 'quarterPast'; h: number }
  | { kind: 'half'; h: number }
  | { kind: 'quarterTo'; h: number }
  | { kind: 'to'; h: number; m: number };

export function phraseOf(hh: number, mm: number): Phrase {
  const h = ((hh % 24) + 24) % 24, m = ((mm % 60) + 60) % 60;
  if (m === 0) return { kind: 'oclock', h };
  if (m === 15) return { kind: 'quarterPast', h };
  if (m === 30) return { kind: 'half', h };
  if (m === 45) return { kind: 'quarterTo', h: (h + 1) % 24 };
  if (m < 30) return { kind: 'past', h, m };
  return { kind: 'to', h: (h + 1) % 24, m: 60 - m };
}
