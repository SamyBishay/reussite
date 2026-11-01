// Where the Calendar's hour grid (Day and 3-day views) scrolls to when it opens or moves to another day. Pure: CalendarGrid.tsx measures the
// grid and applies the number. The time now lands in the vertical middle of the visible hours when today is in view; on other days the first
// timed event sits near the top (an hour of context above it), and with none the grid opens at 07:30, so 08:00 is near the top.

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Minutes since midnight of an HH:MM reading. */
export const minutesOf = toMin;

export interface ScrollIn {
  /** Pixels one minute takes in the grid. */
  pxPerMin: number;
  /** Height of the visible hours: the scroll viewport less the sticky date header. */
  visible: number;
  /** The clock reading now (HH:MM) when today is among the shown days, else null. */
  now: string | null;
  /** The timed events (HH:MM) on the shown days. */
  times: readonly string[];
}

/** The grid's scrollTop, not clamped to the scrollable height (the browser does that). */
export function gridScrollTop({ pxPerMin, visible, now, times }: ScrollIn): number {
  if (now != null) return Math.max(0, toMin(now) * pxPerMin - visible / 2);
  const first = times.length ? Math.min(...times.map(toMin)) : null;
  const top = first != null ? Math.max(0, first - 60) : 7 * 60 + 30;
  return top * pxPerMin;
}
