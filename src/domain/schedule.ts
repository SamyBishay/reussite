// Projected times for planned cards (brief §16): a day's list has an order and launch points, not times, but a
// calendar wants times. This lays the cards one after another from the day's launch points, around the fixed-time
// items, using the person's own pace (the personal estimate). Nothing is stored: the times are read each time, so
// they follow the list, the clock and the timer. Pure: data in, minutes out.
import type { Day, Project, Session, Task } from '../data/schema';
import { partsIn, type DayKey } from './dates';
import { chainIndex, isWaiting } from './chains';
import { fit, predict, round5 } from './estimates';
import { DEFAULT_FIXED_MINUTES } from './ics';
import { HALF_DAY_AT } from './areas';
import { estPointsOf, fixedOn, whereOf } from './lists';

type WithId<T> = T & { id: string };

/** A card with no estimate at all takes this long on the calendar. */
export const DEFAULT_CARD_MINUTES = 30;
/** The calendar day ends here (minutes from midnight): nothing is drawn past 23:59. */
export const DAY_END = 24 * 60 - 1;
/** The start of a day with no launch point and no default. */
export const FALLBACK_START = '09:00';

const toMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const HHMM = /^\d{1,2}:\d{2}$/;
const ceil5 = (m: number) => Math.ceil(m / 5) * 5;

export interface SchedCard {
  id: string;
  /** How long it is expected to take (already rounded). */
  minutes: number;
  /** In the afternoon half of a day spent in an area: placed from the first launch point at or after 13:00. */
  pm?: boolean;
  /** "If there's room": placed after the rest. */
  optional?: boolean;
  isDone?: boolean;
  /** Done: where it really was. */
  done?: { start: number; end: number } | null;
  /** The timer is running: when it started. */
  running?: { start: number } | null;
}

export interface SchedInput {
  cards: readonly SchedCard[];
  /** Launch points, minutes from midnight (empty = `startDefault`). */
  launches: readonly number[];
  fixed: readonly { start: number; end: number }[];
  startDefault: number;
  mode: 'past' | 'today' | 'future';
  /** Now, minutes from midnight (today only). */
  now?: number;
}

export interface Slot { id: string; start: number; end: number; state: 'done' | 'running' | 'todo'; optional?: boolean }
/** `unplaced`: cards with no time to draw (not done on a past day, a done card with no known time, or the day ran out). */
export interface Placement { slots: Slot[]; unplaced: string[] }

/**
 * Place the cards. Done cards keep their real times; the running one starts when its timer did and lasts at least
 * until now; the rest follow one another from the launch points (today: from now), in list order, optional ones last.
 * A fixed-time item keeps its time and a card that would overlap it goes after it. A card that does not fit before
 * the next launch point waits for it (a restart resumes the queue at its time); a block that runs past it carries
 * on from where it ends.
 */
export function placeCards(inp: SchedInput): Placement {
  const slots: Slot[] = [], unplaced: string[] = [];
  const launches = [...new Set(inp.launches)].sort((a, b) => a - b);
  if (!launches.length) launches.push(inp.startDefault);
  const fixed = [...inp.fixed].sort((a, b) => a.start - b.start);
  const now = inp.now ?? 0;
  let cursor = launches[0]!;
  const todo: SchedCard[] = [];
  for (const c of inp.cards) {
    if (c.isDone) {
      if (c.done) { slots.push({ id: c.id, start: c.done.start, end: Math.max(c.done.end, c.done.start + 5), state: 'done' }); if (inp.mode === 'today') cursor = Math.max(cursor, c.done.end); }
      else unplaced.push(c.id);
    } else if (inp.mode === 'past') unplaced.push(c.id);
    else if (inp.mode === 'today' && c.running) {
      const end = Math.min(DAY_END, Math.max(ceil5(now), c.running.start + c.minutes));
      slots.push({ id: c.id, start: c.running.start, end, state: 'running' });
      cursor = Math.max(cursor, end);
    } else todo.push(c);
  }
  if (inp.mode === 'today') cursor = Math.max(cursor, ceil5(now));
  const pmFrom = launches.find(l => l >= toMin(HALF_DAY_AT));
  const ordered = [...todo.filter(c => !c.optional), ...todo.filter(c => c.optional)];
  for (const c of ordered) {
    const m = Math.max(5, c.minutes);
    if (c.pm && pmFrom !== undefined && cursor < pmFrom) cursor = pmFrom;
    for (let guard = 0; guard < 100; guard++) {
      const f = fixed.find(x => cursor < x.end && cursor + m > x.start);
      if (f) { cursor = f.end; continue; }
      const next = launches.find(l => l > cursor);
      const blockStart = Math.max(...launches.filter(l => l <= cursor), -1);
      // Not the first of its block, and it would run into the next launch point: it waits for it.
      if (next !== undefined && blockStart >= 0 && cursor > blockStart && cursor + m > next) { cursor = next; continue; }
      break;
    }
    if (cursor >= DAY_END - 4) { unplaced.push(c.id); continue; }
    slots.push({ id: c.id, start: cursor, end: Math.min(cursor + m, DAY_END), state: 'todo', ...(c.optional ? { optional: true } : {}) });
    cursor += m;
  }
  return { slots, unplaced };
}

/**
 * The list order after a card is dropped at `dropMin` on its day: it goes before the first other waiting card whose
 * time is at or after the drop, else after the last waiting one.
 */
export function reorderForDrop(plan: readonly string[], slots: readonly Slot[], id: string, dropMin: number): string[] {
  const rest = plan.filter(x => x !== id);
  const start = new Map(slots.filter(s => s.state === 'todo' && !s.optional && s.id !== id).map(s => [s.id, s.start]));
  const before = rest.find(x => (start.get(x) ?? -1) >= dropMin);
  if (before !== undefined) { const i = rest.indexOf(before); return [...rest.slice(0, i), id, ...rest.slice(i)]; }
  let last = -1;
  rest.forEach((x, i) => { if (start.has(x)) last = i; });
  return last < 0 ? [...rest, id] : [...rest.slice(0, last + 1), id, ...rest.slice(last + 1)];
}

// ---------- from the app's data ----------

export interface ScheduleData {
  tasks: ReadonlyMap<string, WithId<Task>>;
  days: ReadonlyMap<string, WithId<Day>>;
  sessions?: ReadonlyMap<string, WithId<Session>>;
  projects?: ReadonlyMap<string, WithId<Project>>;
}
export interface ScheduleOptions {
  today: DayKey;
  dayStart: string;
  /** The default start launch point of the settings. */
  launchStart?: string;
  /** Epoch milliseconds. */
  now: number;
}

const dateOf = (p: { y: number; m: number; d: number }) => `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;

/** A function from a day (and the zone its clock reads in) to the placement of its cards. */
export function makeScheduler(data: ScheduleData, o: ScheduleOptions): (day: DayKey, zone?: string) => Placement {
  const sessions = data.sessions ?? new Map<string, WithId<Session>>();
  const model = fit(estPointsOf(data.tasks.values(), sessions.values()), o.today);
  const minutesOf = (t: Task): number => {
    const p = predict(model, { est: t.est, app: t.app, project: t.project, suit: t.suit, estBy: t.estBy });
    return round5(p?.value ?? (t.est && t.est > 0 ? t.est : DEFAULT_CARD_MINUTES));
  };
  const ix = chainIndex(data.tasks);
  const lists = { days: data.days, tasks: data.tasks };
  const byTask = new Map<string, WithId<Session>[]>();
  for (const s of sessions.values()) { const l = byTask.get(s.taskId); if (l) l.push(s); else byTask.set(s.taskId, [s]); }
  const projects = data.projects ?? new Map<string, WithId<Project>>();

  return (k, zone) => {
    const day = data.days.get(k);
    const mode = k < o.today ? 'past' : k === o.today ? 'today' : 'future';
    /** Minutes from midnight of an instant, if it is on calendar date k. */
    const clock = (instant: number): number | null => { const p = partsIn(new Date(instant), zone); return dateOf(p) === k ? p.hh * 60 + p.mm : null; };
    const eligible = (t: WithId<Task> | undefined): t is WithId<Task> => !!t && t.status !== 'dropped' && !t.template && !t.at && (!!t.fixed || !isWaiting(ix, t.id));
    const seen = new Set<string>();
    const cards: SchedCard[] = [];
    const real = (t: WithId<Task>): { start: number; end: number } | null => {
      const ss = (byTask.get(t.id) ?? []).filter(s => s.d === k && s.at);
      const dur = ss.reduce((a, s) => a + (Number(s.m) || 0), 0) || minutesOf(t);
      const endAt = ss.length ? Math.max(...ss.map(s => Date.parse(s.at))) : t.doneAt ? Date.parse(t.doneAt) : NaN;
      const end = Number.isFinite(endAt) ? clock(endAt) : null;
      return end === null ? null : { start: Math.max(0, end - Math.round(dur)), end };
    };
    const add = (t: WithId<Task>, optional = false) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      const pm = (day?.areas ?? []).find(a => a.half === 'pm');
      const c: SchedCard = { id: t.id, minutes: minutesOf(t), ...(optional ? { optional: true } : {}), ...(pm && whereOf(t, projects) === pm.placeId ? { pm: true } : {}) };
      if (t.status === 'done') { c.isDone = true; c.done = real(t); }
      else if (t.started && mode === 'today') { const s = clock(Date.parse(t.started)); if (s !== null) c.running = { start: s }; }
      cards.push(c);
    };
    for (const id of Array.isArray(day?.plan) ? day!.plan : []) { const t = data.tasks.get(id); if (eligible(t)) add(t); }
    if (k <= o.today) for (const t of data.tasks.values()) if (t.status === 'done' && t.doneDay === k && eligible(t)) add(t);
    if (mode !== 'past') for (const id of Array.isArray(day?.optional) ? day!.optional! : []) { const t = data.tasks.get(id); if (eligible(t) && t.status === 'open') add(t, true); }

    const launches = (Array.isArray(day?.launches) ? day!.launches : []).map(l => l.t).filter(t => HHMM.test(t ?? '') && t >= o.dayStart).map(toMin);
    const fixed = fixedOn(lists, k).filter(t => HHMM.test(t.at ?? '') && t.at! >= o.dayStart && t.status !== 'dropped')
      .map(t => ({ start: toMin(t.at!), end: Math.min(DAY_END, toMin(t.at!) + (t.dur && t.dur > 0 ? t.dur : t.est && t.est > 0 ? t.est : DEFAULT_FIXED_MINUTES)) }));
    const start = HHMM.test(o.launchStart ?? '') ? o.launchStart! : FALLBACK_START;
    const p = partsIn(new Date(o.now), zone);
    const nowDate = dateOf(p);
    const now = nowDate > k ? DAY_END : nowDate < k ? 0 : p.hh * 60 + p.mm;
    return placeCards({ cards, launches, fixed, startDefault: toMin(start), mode, now });
  };
}
