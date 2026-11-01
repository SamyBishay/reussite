// The Dove clock's arithmetic (src/app/DoveClock.tsx): how far round each ring is filled, and how the time is said. Pure.

/**
 * How far round each ring is, 0 to 1, clockwise from twelve: the outer ring is the hour on a 12-hour dial (it creeps with the minutes and is empty at twelve),
 * the inner one the minutes (empty on the hour).
 */
export function ringFractions(hh: number, mm: number): { hour: number; minute: number } {
  const h = ((hh % 12) + 12) % 12, m = ((mm % 60) + 60) % 60;
  return { hour: (h + m / 60) / 12, minute: m / 60 };
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
