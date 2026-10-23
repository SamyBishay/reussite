// What the calendar exports say about a step (brief §16): the all-day events of a day (its planned cards and
// the steps due that day), and, for each level of detail, the words, the place and the link of every event.
// Pure: data in, descriptions out. ics.ts only formats them.
import type { Address, Day, Place, Project, Task } from '../data/schema';
import type { DayKey } from './dates';
import type { AgendaData, AgendaEvent } from './agenda';
import { shortLabel } from './label';
import { whereOf } from './lists';
import type { IcsAllDay, IcsKey, IcsTitles, IcsTranslate } from './ics';

type WithId<T> = T & { id: string };

/** How much a calendar export says: only times and generic words, the steps' short names, or short names with places and notes. */
export type FeedDetail = 'times' | 'labels' | 'full';
export const FEED_DETAILS: readonly FeedDetail[] = ['times', 'labels', 'full'];
export const isFeedDetail = (v: unknown): v is FeedDetail => FEED_DETAILS.includes(v as FeedDetail);

/** The documents the exports read: the agenda's, and the addresses and projects (a step's place can come from its project). */
export interface CalData extends AgendaData {
  addresses?: ReadonlyMap<string, WithId<Address>>;
  projects?: ReadonlyMap<string, WithId<Project>>;
}

/** A step on a day with no time: on that day's list (`plan`) or due that day and not on it (`due`). */
export interface AllDayItem { id: string; kind: 'plan' | 'due'; day: DayKey; taskId: string }

/** The link that opens a step in the app. `base` is the app's address, with or without a trailing `#`. */
export const taskLink = (base: string, id: string) => base.replace(/#.*$/, '') + '#task/' + encodeURIComponent(id);

const withTime = (t: Task) => !!t.at;
/** A work step that belongs on a day with no clock time. */
const openCard = (t: WithId<Task> | undefined): t is WithId<Task> => !!t && t.status === 'open' && !t.template && !t.fixed && !withTime(t);

/**
 * The all-day events on days `from`..`to`: the open steps on each day's list, then the open ones due that day
 * that are not on its list. A step with a time is a fixed-time event of the agenda, not here; a standing item is
 * not a step. One step is on at most one day's list in the app, but if it is on several each day gets one.
 */
export function allDayItems(data: Pick<AgendaData, 'tasks' | 'days'>, from: DayKey, to: DayKey): AllDayItem[] {
  const out: AllDayItem[] = [];
  const planned = new Set<string>();
  const days = [...data.days.values()].filter((d: WithId<Day>) => d.date >= from && d.date <= to && Array.isArray(d.plan)).sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const d of days) {
    for (const id of d.plan) {
      const t = data.tasks.get(id);
      if (!openCard(t) || planned.has(id + ':' + d.date)) continue;
      planned.add(id + ':' + d.date);
      out.push({ id: `plan:${id}:${d.date}`, kind: 'plan', day: d.date, taskId: id });
    }
  }
  const due = [...data.tasks.values()].filter(t => openCard(t) && t.due && t.due >= from && t.due <= to && !planned.has(t.id + ':' + t.due));
  due.sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : a.order - b.order || (a.id < b.id ? -1 : 1)));
  for (const t of due) out.push({ id: `due:${t.id}:${t.due}`, kind: 'due', day: t.due!, taskId: t.id });
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

const nonEmpty = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

/**
 * Where a step is, in words: the address it goes to (its street address when it has one, else its name), else the
 * place or area it is set to ("Anywhere" says nothing). `short` prefers the address's name, which is what an event
 * has room for.
 */
export function locationOf(
  t: Pick<Task, 'addressId' | 'where' | 'project'>,
  ctx: { addresses?: ReadonlyMap<string, Pick<Address, 'name' | 'street'>>; places: ReadonlyMap<string, Pick<Place, 'name'>>; projects?: ReadonlyMap<string, Pick<Project, 'where'>> },
  short = false,
): string {
  const a = t.addressId ? ctx.addresses?.get(t.addressId) : undefined;
  if (a) {
    const name = nonEmpty(a.name), street = nonEmpty(a.street);
    const text = short ? name || street : street || name;
    if (text) return text;
  }
  const w = whereOf(t, ctx.projects ?? new Map());
  return w && w !== 'any' ? nonEmpty(ctx.places.get(w)?.name) : '';
}

export interface DescribeContext {
  detail: FeedDetail;
  data: CalData;
  tr: IcsTranslate;
  /** The app's address, for the link that opens a step. Empty = no links. */
  appUrl: string;
  /** Minutes-before text for a leave-by line: `(at, zone) => 'HH:MM'`. */
  clockIn: (at: number, zone: string) => string;
}

const MIN = 60_000;

/** The pieces an event can say, at a level. `times` says nothing of the step; `labels` its short name; `full` also its place, title, note and link. */
function describe(ctx: DescribeContext, t: WithId<Task> | undefined, generic: IcsKey, extra: string[] = []): Pick<IcsAllDay, 'summary' | 'description' | 'location' | 'url'> {
  if (!t || ctx.detail === 'times') return { summary: ctx.tr(generic) };
  const summary = shortLabel(t);
  if (ctx.detail === 'labels') return { summary };
  const location = locationOf(t, { addresses: ctx.data.addresses, places: ctx.data.places, projects: ctx.data.projects }, false);
  const description = [t.title, ...extra, nonEmpty(t.note), nonEmpty(t.link)].filter(Boolean).join('\n');
  return { summary, ...(location ? { location } : {}), ...(description ? { description } : {}), ...(ctx.appUrl ? { url: taskLink(ctx.appUrl, t.id) } : {}) };
}

/** The words of a fixed-time event. */
export const fixedTitles = (ctx: DescribeContext): IcsTitles => (e: AgendaEvent, zone: string) => {
  const t = e.taskId ? ctx.data.tasks.get(e.taskId) : undefined;
  const lead = e.lead ?? 0;
  const leave = lead > 0 ? [ctx.tr('notifyLeaveBy', { t: ctx.clockIn(e.at - lead * MIN, zone) })] : [];
  return describe(ctx, t, 'icsFixed', leave);
};

/** The all-day events for these items, in order. */
export function allDayEvents(ctx: DescribeContext, items: readonly AllDayItem[]): IcsAllDay[] {
  const out: IcsAllDay[] = [];
  for (const it of items) {
    const t = ctx.data.tasks.get(it.taskId);
    out.push({ id: it.id, day: it.day, ...describe(ctx, t, it.kind === 'plan' ? 'icsPlanned' : 'icsDue') });
  }
  return out;
}
