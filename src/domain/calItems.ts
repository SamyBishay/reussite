// What the calendar exports say about a fixed-time step (brief §16): for each level of detail, the words, the
// place and the link of the event. Only fixed-time items are exported; planned cards and due steps are not.
// Pure: data in, descriptions out. ics.ts only formats them.
import type { Address, Place, Project, Task } from '../data/schema';
import type { AgendaData, AgendaEvent } from './agenda';
import { shortLabel } from './label';
import { whereOf } from './lists';
import type { IcsKey, IcsText, IcsTitles, IcsTranslate } from './ics';

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

/** The link that opens a step in the app. `base` is the app's address, with or without a trailing `#`. */
export const taskLink = (base: string, id: string) => base.replace(/#.*$/, '') + '#task/' + encodeURIComponent(id);

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
function describe(ctx: DescribeContext, t: WithId<Task> | undefined, generic: IcsKey, extra: string[] = []): IcsText {
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
