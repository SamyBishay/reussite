// Moving a step between quadrants (brief §5, Matrix). Urgency follows dates, so a move
// sometimes needs one answer: a due date, or whether it blocks something.
import { daysBetween, addDays, type DayKey } from './dates';
import { isUrgent, type Quadrant, type Urgency } from './tasks';

export type Ask = 'dueOrBlocker' | 'newDue' | null;
export interface Move { patch: { important?: boolean; urgent?: boolean }; ask: Ask }

export function moveTo(t: Urgency, q: Quadrant, today: DayKey, windowDays = 21): Move {
  const important = q === 1 || q === 2;
  const wantUrgent = q === 1 || q === 3;
  const patch: Move['patch'] = { important };
  const nowUrgent = isUrgent(t, today, windowDays);
  if (wantUrgent && !nowUrgent) return { patch, ask: 'dueOrBlocker' };
  if (!wantUrgent && nowUrgent) {
    if (t.urgent) patch.urgent = false;
    // A due date inside the window keeps it urgent: ask for a new one.
    if (daysBetween(today, t.due) <= windowDays) return { patch, ask: 'newDue' };
  }
  return { patch, ask: null };
}

/** The first day outside the urgency window, offered as the default new due date. */
export const firstCalmDay = (today: DayKey, windowDays = 21) => addDays(today, windowDays + 1);
