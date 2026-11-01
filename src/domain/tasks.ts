// Urgency and the Eisenhower quadrants (METHOD rule 2).
//
// Both are the person's two ticks and nothing else: a due date never moves a step between quadrants
// (it orders the steps inside a box, see `byPriority`). Urgent means a deadline within about three weeks,
// or blocking something that has one, and the person ticks it.

export interface Urgency { urgent?: boolean | null; important?: boolean | null }

/** 1 Now (urgent, important) · 2 Protect (important) · 3 Quick (urgent) · 4 Later. */
export type Quadrant = 1 | 2 | 3 | 4;

/** Urgent means ticked urgent. */
export function isUrgent(t: Urgency): boolean {
  return !!t.urgent;
}

export function quadrant(t: Urgency): Quadrant {
  return isUrgent(t) ? (t.important ? 1 : 3) : t.important ? 2 : 4;
}
