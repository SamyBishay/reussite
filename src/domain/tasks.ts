// Urgency and the Eisenhower quadrants (METHOD rule 1).
import { daysBetween, type DayKey } from './dates';

export interface Urgency { urgent?: boolean | null; important?: boolean | null; due?: DayKey | null }

/** 1 Now (urgent, important) · 2 Protect (important) · 3 Quick (urgent) · 4 Later. */
export type Quadrant = 1 | 2 | 3 | 4;

/** Urgent means marked as a blocker, or due within the urgency window (overdue included). */
export function isUrgent(t: Urgency, today: DayKey, windowDays = 21): boolean {
  return !!t.urgent || daysBetween(today, t.due) <= windowDays;
}

export function quadrant(t: Urgency, today: DayKey, windowDays = 21): Quadrant {
  return isUrgent(t, today, windowDays) ? (t.important ? 1 : 3) : t.important ? 2 : 4;
}
