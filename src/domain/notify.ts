// The notification schedule (brief §8): which pushes should exist, and when. A pure function of the
// list, so accepting a plan, changing a reminder time, starting a timer or flipping a switch only
// needs to run it again; whatever sends the pushes compares the result with what it sent before.
import type { Session } from '../data/schema';
import type { Settings, NotifyType } from '../data/settings';
import { agenda, type AgendaData, type AgendaEvent, type AgendaSettings } from './agenda';
import { stillOnDue, withTime } from './calendar';
import { addDays } from './dates';
import { fit, predict } from './estimates';
import { estPointsOf, isOpen } from './lists';
import { whereNow, zoneOfPlace } from './places';
import { atOnDay, validZone, wallOf } from './zone';

/** The words a notification can use; the app passes its `t`. */
export type NotifyKey =
  | 'notifyStart' | 'notifyRestart' | 'notifyStartTitle' | 'notifyRestartTitle' | 'notifyLeaveNow' | 'notifyLeaveBy'
  | 'notifyCheckin' | 'notifyClose' | 'notifyReview' | 'notifyDecision' | 'notifyDecisionTitle' | 'notifyStill' | 'stillOn';
export type Translate = (key: NotifyKey, vars?: Record<string, string | number>) => string;

export interface ScheduleItem {
  /** Stable for the same thing: `fixed:<rootId>:<day>`, `launch:<day>:<n>`, `still:<taskId>`, … */
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
export type NotifySettings = AgendaSettings & Pick<Settings, 'dayStart' | 'notify' | 'notifyText'>;

export const WINDOW_DAYS = 14;
export const MAX_ITEMS = 150;
/** Seconds a push may wait, by type: a launch point or a "leave now" is stale soon; a daily prompt keeps for an hour. */
export const TTL: Record<NotifyType, number> = { launch: 600, fixed: 1800, checkin: 3600, close: 3600, decision: 3600, review: 3600, still: 900 };
/** A timer is not asked about again after this long. */
export const STILL_GIVE_UP_H = 12;

const DAY_MS = 86_400_000;
const clip = (s: string, n = 100) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** The title a launch point carries: the first open work step on the day's list. */
function nextStep(data: AgendaData, day: string): string | null {
  const d = data.days.get(day);
  for (const id of Array.isArray(d?.plan) ? d!.plan : []) {
    const tk = data.tasks.get(id);
    if (tk && isOpen(tk) && !tk.at && tk.src !== 'plan') return tk.title;
  }
  return null;
}

function textOf(e: AgendaEvent, data: AgendaData, titles: boolean, tr: Translate): string {
  switch (e.kind) {
    case 'launch': {
      const restart = e.launch?.k === 'restart';
      const step = titles ? nextStep(data, e.day) : null;
      if (step) return tr(restart ? 'notifyRestartTitle' : 'notifyStartTitle', { title: clip(step) });
      return tr(restart ? 'notifyRestart' : 'notifyStart');
    }
    case 'fixed': {
      if (!titles) return tr('notifyLeaveNow', { at: e.time });
      const head = withTime(clip(e.title ?? ''), e.time);
      return e.lead ? head + ' · ' + tr('notifyLeaveBy', { t: wallOf(e.at - e.lead * 60_000, e.zone) }) : head;
    }
    case 'checkin': return tr('notifyCheckin');
    case 'close': return tr('notifyClose');
    case 'review': return tr('notifyReview');
    case 'decision': return titles && e.title ? tr('notifyDecisionTitle', { title: clip(e.title) }) : tr('notifyDecision');
  }
}

/**
 * The next "Still on …?" push for each running timer: after twice the personal estimate (at least
 * 45 minutes) from the start or from the last "still going", or at the next day start after the
 * start (if the timer is over four hours old by then), whichever is first. Only the next one; none
 * once the timer has run `STILL_GIVE_UP_H` hours.
 */
function stillItems(data: NotifyState, s: NotifySettings, today: string, zone: string | undefined, now: number, titles: boolean, tr: Translate): ScheduleItem[] {
  const running = [...data.tasks.values()].filter(t => t.started && t.status === 'open' && !Number.isNaN(Date.parse(t.started)));
  if (!running.length) return [];
  const model = fit(estPointsOf(data.tasks.values(), data.sessions.values()), today);
  const out: ScheduleItem[] = [];
  for (const t of running) {
    const started = Date.parse(t.started!);
    const est = predict(model, { est: t.est, app: t.app, project: t.project, suit: t.suit, estBy: t.estBy })?.value ?? t.est;
    const at = stillOnDue(started, Date.parse(t.stillAt ?? '') || 0, est, s.dayStart, zone);
    if (at <= now || at - started > STILL_GIVE_UP_H * 3_600_000) continue;
    out.push({ id: 'still:' + t.id, type: 'still', at, ttl: TTL.still, text: titles ? tr('stillOn', { title: clip(t.title) }) : tr('notifyStill') });
  }
  return out;
}

/**
 * Every push that should be waiting at `now`: the next 14 days of agenda events (a fixed-time item
 * at its lead time before it starts), the "Still on …?" of a running timer; only the types switched
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
    items.push({ id: e.id, type: e.kind, at: e.kind === 'fixed' ? e.at - (e.lead ?? 0) * 60_000 : e.at, ttl: TTL[e.kind], text: textOf(e, data, titles, tr) });
  }
  if (s.notify.still) items.push(...stillItems(data, s, today, validZone(zoneOf(here)), now, titles, tr));
  return items
    .filter(i => i.at > now && i.at <= now + WINDOW_DAYS * DAY_MS)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_ITEMS);
}
