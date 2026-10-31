// The one order of a day (plan 2 Nov, "One order"): what comes first, now, given the clock. Fixed-time items sit at
// the time they ask you to leave; the planned steps fill the gaps between them, greedily and in planned order; a
// step that doesn't fit the gap waits for the next one and a later step that fits moves up; a step is never split.
// Start here (Home and Today), Today's list, the next-step bar and the Calendar's projected blocks all read this,
// so they agree. Pure: instants in epoch milliseconds, ids in, ids out. The app (src/app/model.ts) gathers the data.
const MIN = 60_000;

/** The minutes a step without an estimate takes up when the day is laid out. */
export const DEFAULT_EST = 15;
/** How long a fixed-time item with no length of its own takes up. */
export const DEFAULT_DURATION = 30;
/** The least margin, in minutes, before a fixed-time item takes over from the step in hand. */
export const MIN_MARGIN = 5;

export interface FixedItem {
  id: string;
  /** The time of the thing itself (epoch ms). */
  at: number;
  /** Its length in minutes; none or 0 reads as 30. */
  dur?: number | null;
  /** Minutes before `at` to leave: the item sits in the order from then. */
  lead?: number | null;
  /** A standing item not placed on the day (no card of its own): once over it is simply gone, not missed. */
  standing?: boolean;
}

export interface DayOrderInput {
  /** Epoch ms. */
  now: number;
  /** When the day starts and ends (epoch ms): nothing is placed before the start; minutes past the end are `over`. */
  floor: number;
  end: number;
  /** The day's open cards in planned order: no fixed-time items, none that wait for another, none that are events. */
  cards: readonly string[];
  /** A card's estimate in minutes (the app passes `planEst`); none reads as `DEFAULT_EST`. */
  est: (id: string) => number | null | undefined;
  fixed: readonly FixedItem[];
  /** The timer running: a card or a fixed-time item. `started` is an ISO timestamp. */
  running?: { id: string; started: string } | null;
  /** Cards marked "if there's room": they come after the others and never count as `over`. */
  optional?: ReadonlySet<string>;
}

export interface OrderItem {
  id: string;
  kind: 'fixed' | 'step';
  /** Epoch ms. A fixed item starts when to leave; a step is where it is projected to start (a running step: when it started). */
  start: number;
  end: number;
  /** Fixed items: the time of the thing itself. */
  at?: number;
}

export interface DayOrder {
  /** What is left of the day, in order; the first item is Start here. */
  order: OrderItem[];
  /** Fixed items over (their end passed) and not done. They are not in `order`. */
  missed: string[];
  /** Minutes of planned steps (not the optional ones) that don't fit before the day's end. */
  over: number;
}

/** A fixed item takes over from the step in hand this long before it is needed, in minutes. */
export const marginOf = (est: number): number => Math.max(MIN_MARGIN, Math.round(0.2 * est));

export function dayOrder(i: DayOrderInput): DayOrder {
  const estOf = (id: string): number => { const e = i.est(id); return typeof e === 'number' && e > 0 ? e : DEFAULT_EST; };
  const runningId = i.running?.id ?? null;
  const startedAt = i.running ? Date.parse(i.running.started) : NaN;
  const startedMs = Number.isFinite(startedAt) ? Math.min(startedAt, i.now) : i.now;

  // Fixed-time items: windows that are busy, or running, or missed.
  const missed: string[] = [];
  const blocks: OrderItem[] = [];
  const standing = new Set(i.fixed.filter(f => f.standing).map(f => f.id));
  let busyUntil = Math.max(i.now, i.floor);
  const runItems: OrderItem[] = [];
  for (const f of [...i.fixed].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
    const lead = f.lead && f.lead > 0 ? f.lead : 0, dur = f.dur && f.dur > 0 ? f.dur : DEFAULT_DURATION;
    const item: OrderItem = { id: f.id, kind: 'fixed', start: f.at - lead * MIN, end: f.at + dur * MIN, at: f.at };
    if (f.id === runningId) {
      // Being done right now: it holds the order until it is over, however long it takes.
      runItems.push({ ...item, start: Math.min(item.start, startedMs), end: Math.max(item.end, i.now) });
      busyUntil = Math.max(busyUntil, Math.max(item.end, i.now));
    } else if (item.end <= i.now) { if (!f.standing) missed.push(f.id); }
    else blocks.push(item);
  }

  blocks.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));

  // The step in hand starts when it started and has what is left of its estimate.
  const run = runningId && i.cards.includes(runningId) ? runningId : null;
  const runStep: OrderItem | null = run ? { id: run, kind: 'step', start: startedMs, end: Math.max(i.now, startedMs + estOf(run) * MIN) } : null;
  if (runStep) busyUntil = Math.max(busyUntil, runStep.end);

  // The rest fill the gaps in planned order, the optional ones after the others.
  const rest = i.cards.filter(id => id !== run);
  const optional = i.optional ?? new Set<string>();
  const pending = [...rest.filter(id => !optional.has(id)), ...rest.filter(id => optional.has(id))];
  const placed: OrderItem[] = [];
  let cursor = busyUntil;
  while (pending.length) {
    const next = blocks.find(b => b.end > cursor);
    if (next && next.start <= cursor) { cursor = next.end; continue; }
    const room = next ? (next.start - cursor) / MIN : Infinity;
    const k = pending.findIndex(id => estOf(id) <= room);
    if (k < 0) { cursor = next!.end; continue; } // none fits before the next fixed item: wait for the gap after it
    const id = pending.splice(k, 1)[0]!;
    placed.push({ id, kind: 'step', start: cursor, end: cursor + estOf(id) * MIN });
    cursor += estOf(id) * MIN;
  }

  const order = [...runItems, ...(runStep ? [runStep] : []), ...blocks, ...placed]
    .sort((a, b) => a.start - b.start || (a.kind === b.kind ? 0 : a.kind === 'fixed' ? -1 : 1));

  // A fixed item takes over when the step in hand, and its margin, would run into the time to leave.
  const upcoming = blocks[0];
  const first = order[0];
  if (upcoming && first && first.kind === 'step') {
    const e = estOf(first.id);
    const remaining = first.id === run ? Math.max(0, e - (i.now - startedMs) / MIN) : e;
    if (i.now + (remaining + marginOf(e)) * MIN > upcoming.start) {
      order.splice(order.indexOf(upcoming), 1);
      order.unshift(upcoming);
    }
  }

  // A standing item not placed on the day is not a card of the day: alone, it is Start here only once it is time to leave.
  if (order.length === 1 && standing.has(order[0]!.id) && i.now + MIN_MARGIN * MIN < order[0]!.start) order.pop();

  let over = 0;
  for (const p of placed) if (!optional.has(p.id) && p.end > i.end) over += (p.end - Math.max(p.start, i.end)) / MIN;
  return { order, missed, over: Math.round(over) };
}

/** The projected start of each step in an order, by id (fixed items keep their own time). */
export const startsOf = (o: DayOrder): Map<string, number> => new Map(o.order.filter(x => x.kind === 'step').map(x => [x.id, x.start]));

/**
 * The day's load against the time it has (the morning ritual's "3 h 10 of 4 h 30 free"): `planned` is the minutes of the cards
 * that are not "if there's room"; `free` is the time between `max(now, floor)` and `end` that no fixed-time item takes (from the
 * time to leave to its end); `over` is what `dayOrder` says does not fit before `end`.
 */
export function dayLoad(i: DayOrderInput): { planned: number; free: number; over: number } {
  const optional = i.optional ?? new Set<string>();
  const estOf = (id: string): number => { const e = i.est(id); return typeof e === 'number' && e > 0 ? e : DEFAULT_EST; };
  const planned = i.cards.filter(id => !optional.has(id)).reduce((a, id) => a + estOf(id), 0);
  const from = Math.max(i.now, i.floor);
  const busy = i.fixed
    .map(f => [Math.max(from, f.at - (f.lead && f.lead > 0 ? f.lead : 0) * MIN), Math.min(i.end, f.at + (f.dur && f.dur > 0 ? f.dur : DEFAULT_DURATION) * MIN)] as const)
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let free = Math.max(0, i.end - from), cursor = from;
  for (const [a, b] of busy) {
    const s = Math.max(a, cursor);
    if (b > s) { free -= b - s; cursor = b; }
  }
  return { planned, free: Math.round(Math.max(0, free) / MIN), over: dayOrder(i).over };
}
