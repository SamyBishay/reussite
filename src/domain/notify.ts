// The notification schedule (brief §8): which pushes should exist, and when. A pure function of the
// list, so accepting a plan, changing a reminder time, starting a timer or flipping a switch only
// needs to run it again; whatever sends the pushes compares the result with what it sent before.
import type { Session } from '../data/schema';
import type { Settings, NotifyType } from '../data/settings';
import { agenda, type AgendaData, type AgendaEvent, type AgendaSettings } from './agenda';
import { withTime } from './calendar';
import { dayLoad } from './dayOrder';
import { addDays } from './dates';
import { whereNow, zoneOfPlace } from './places';
import { atOnDay, wallOf } from './zone';

/** The words a notification can use; the app passes its `t`. */
export type NotifyKey =
  | 'notifyLeaveNow' | 'notifyLeaveBy' | 'notifyCheckin' | 'notifyCheckinFree' | 'notifyCheckinOne' | 'notifyCheckinMany'
  | 'notifyCheckinTitle' | 'notifyCheckinTitles' | 'notifyClose' | 'notifyReview' | 'notifyDecision' | 'notifyDecisionTitle';
export type Translate = (key: NotifyKey, vars?: Record<string, string | number>) => string;

export interface ScheduleItem {
  /** Stable for the same thing: `fixed:<rootId>:<day>`, `checkin:<day>`, … */
  id: string;
  type: NotifyType;
  /** When to send, epoch milliseconds. */
  at: number;
  /** How long a push service may hold it if the phone is off, seconds. */
  ttl: number;
  /** What the notification says. */
  text: string;
}

/** The documents it reads (the sessions are for the personal estimate behind "Still on …?"). */
export type NotifyState = AgendaData & { sessions: ReadonlyMap<string, Session & { id: string }> };
export type NotifySettings = AgendaSettings & Pick<Settings, 'dayStart' | 'dayEnd' | 'notify' | 'notifyText'>;

export const WINDOW_DAYS = 14;
export const MAX_ITEMS = 150;
/** Seconds a push may wait, by type: a "leave now" is stale soon; a daily prompt keeps for an hour. */
export const TTL: Record<NotifyType, number> = { fixed: 1800, checkin: 3600, close: 3600, decision: 3600, review: 3600 };

const DAY_MS = 86_400_000;
const clip = (s: string, n = 100) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** "3 h", "3 h 30" or "45 min": the room left in a day, rounded (to 30 minutes from an hour up, else to 5), the same words in both languages. */
export function roomText(minutes: number): string {
  const m = minutes >= 60 ? Math.round(minutes / 30) * 30 : Math.round(minutes / 5) * 5;
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') : '');
}

/**
 * The morning push: what the day holds and the room it leaves ("Today has the 10:00 dentist and room for about 3 h. Plan it?"),
 * from the day's fixed-time items against the time from the push to the end of the day. A day with none is "A free day so far".
 * Generic text says how many fixed times and not what they are.
 */
function checkinText(e: AgendaEvent, fixed: readonly AgendaEvent[], s: NotifySettings, titles: boolean, tr: Translate): string {
  if (!fixed.length) return tr('notifyCheckinFree');
  const end = atOnDay(e.day, s.dayEnd, s.dayStart, e.zone);
  const free = dayLoad({
    now: e.at, floor: e.at, end, cards: [], est: () => null,
    fixed: fixed.map(f => ({ id: f.id, at: f.at, dur: f.dur, lead: f.lead })),
  }).free;
  if (free < 15) return tr('notifyCheckin');
  const room = roomText(free);
  const first = fixed[0]!;
  if (titles) return fixed.length === 1
    ? tr('notifyCheckinTitle', { at: first.time, title: clip(first.title ?? '', 40), room })
    : tr('notifyCheckinTitles', { at: first.time, title: clip(first.title ?? '', 40), n: fixed.length - 1, room });
  return fixed.length === 1 ? tr('notifyCheckinOne', { room }) : tr('notifyCheckinMany', { n: fixed.length, room });
}

function textOf(e: AgendaEvent, events: readonly AgendaEvent[], s: NotifySettings, titles: boolean, tr: Translate): string {
  switch (e.kind) {
    case 'fixed': {
      if (!titles) return tr('notifyLeaveNow', { at: e.time });
      const head = withTime(clip(e.title ?? ''), e.time);
      return e.lead ? head + ' · ' + tr('notifyLeaveBy', { t: wallOf(e.at - e.lead * 60_000, e.zone) }) : head;
    }
    case 'checkin': return checkinText(e, events.filter(x => x.kind === 'fixed' && x.day === e.day), s, titles, tr);
    case 'close': return tr('notifyClose');
    case 'review': return tr('notifyReview');
    case 'decision': return titles && e.title ? tr('notifyDecisionTitle', { title: clip(e.title) }) : tr('notifyDecision');
  }
}

/**
 * Every push that should be waiting at `now`: the next 14 days of agenda events (a fixed-time item
 * at its lead time before it starts); only the types switched
 * on in `settings.notify`; soonest first, at most 150. Text is generic or carries titles by
 * `settings.notifyText`; `tr` supplies the words.
 */
export function buildSchedule(data: NotifyState, now: number, s: NotifySettings, tr: Translate): ScheduleItem[] {
  const zoneOf = (id: string) => zoneOfPlace(data.places, id);
  const { today, here } = whereNow(new Date(now), s, zoneOf, data.stays.values());
  const titles = s.notifyText === 'titles';
  const events = agenda(data, s, addDays(today, -1), addDays(today, WINDOW_DAYS + 1));
  const items: ScheduleItem[] = [];
  for (const e of events) {
    if (!s.notify[e.kind]) continue;
    items.push({ id: e.id, type: e.kind, at: e.kind === 'fixed' ? e.at - (e.lead ?? 0) * 60_000 : e.at, ttl: TTL[e.kind], text: textOf(e, events, s, titles, tr) });
  }
  return items
    .filter(i => i.at > now && i.at <= now + WINDOW_DAYS * DAY_MS)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_ITEMS);
}
