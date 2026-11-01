// Moving a step between quadrants (brief §5, Matrix). A quadrant is the two ticks, so a move sets them and asks nothing.
import type { Quadrant } from './tasks';

export interface Move { patch: { important: boolean; urgent: boolean } }

export function moveTo(q: Quadrant): Move {
  return { patch: { important: q === 1 || q === 2, urgent: q === 1 || q === 3 } };
}
