// "Plan this trip" (brief §5, Addresses and people): the text of the pack that goes to an AI with web search.
// Pure: the app reads its signals and hands plain data in. Addresses go in because the trip is the one place they
// are meant to; people go in only when the person ticked them for this request, and never with a way to reach them.
import { oneLine as one, STEP_HEADER } from './lists';
import { addDays, type DayKey } from './dates';
import { lastVisit } from './offers';
import type { Address, Person } from '../data/schema';

/** Days listed for one trip; a stay longer than this is planned in pieces. */
export const MAX_TRIP_DAYS = 21;
/** Addresses and people listed; the rest are left out and the pack says how many. */
export const MAX_TRIP_ADDRESSES = 60;
export const MAX_TRIP_PEOPLE = 30;

const weekday = (k: DayKey) => new Date(k + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });

/** The days of the stay, first to last, at most MAX_TRIP_DAYS. */
export function tripDays(from: DayKey, to: DayKey): DayKey[] {
  const out: DayKey[] = [];
  for (let k = from; k <= to && out.length < MAX_TRIP_DAYS; k = addDays(k, 1)) out.push(k);
  return out;
}

type AddressIn = Pick<Address, 'name' | 'category' | 'street' | 'state' | 'visits' | 'note'>;
type PersonIn = Pick<Person, 'name' | 'note' | 'lastSeen'>;

/** `name | category | status | street | last visit: day verdict, "note" | note`: what the person wrote, in one line. */
export function addressLine(a: AddressIn, categoryName: string): string {
  const v = lastVisit(a);
  const last = v ? `${v.day} ${v.verdict}${v.note.trim() ? `, "${one(v.note).slice(0, 200)}"` : ''}` : '-';
  return [one(a.name), one(categoryName), a.state === 'been' ? 'been' : 'want to go', a.street ? one(a.street) : '-', last, a.note.trim() ? one(a.note).slice(0, 200) : '-'].join(' | ');
}
export const ADDRESS_HEADER = 'Addresses I already have here (name | category | status | street | last visit and verdict | note):';

/** `name | last seen | note`. No way to reach them, ever: the plan does not need it. */
export const personLine = (p: PersonIn): string => [one(p.name), p.lastSeen ?? 'never', p.note.trim() ? one(p.note).slice(0, 200) : '-'].join(' | ');
export const PEOPLE_HEADER = 'People I know here, shared for this trip only (name | last seen | note):';

export interface TripInput {
  place: { id: string; name: string };
  from: DayKey;
  to: DayKey;
  note: string;
  categories: { id: string; name: string }[];
  /** The stay's place's addresses, in the order to show. */
  addresses: AddressIn[];
  /** Lines of the open steps for the trip (id | title | …), already built. */
  steps: string[];
  /** Lines of what already has a time on the trip, already built. */
  fixed: string[];
  /** Lines of what is already on each day's list: `day: id title; …`, for days that have something. */
  planned: string[];
  /** Only when the person ticked them for this request; undefined sends none. */
  people?: PersonIn[];
}

const capped = <T>(xs: T[], max: number): { shown: T[]; more: number } => ({ shown: xs.slice(0, max), more: Math.max(0, xs.length - max) });

/** The trip's part of "My data". */
export function tripData(i: TripInput): string {
  const days = tripDays(i.from, i.to);
  const ads = capped(i.addresses, MAX_TRIP_ADDRESSES);
  const cats = i.categories.map(c => `${c.id} (${one(c.name)})`).join(', ');
  const parts = [
    `The trip: ${one(i.place.name)} (place id ${i.place.id}), from ${weekday(i.from)} ${i.from} to ${weekday(i.to)} ${i.to}${i.note.trim() ? `. My note: ${one(i.note)}` : ''}.`,
    `Days to plan${i.to > days[days.length - 1]! ? ` (the first ${days.length} of the stay)` : ''}: ${days.map(k => `${weekday(k).slice(0, 3)} ${k}`).join(', ')}.`,
    `Address categories (id): ${cats || 'other'}.`,
    ads.shown.length ? `${ADDRESS_HEADER}\n${ads.shown.map(a => addressLine(a, i.categories.find(c => c.id === a.category)?.name ?? a.category)).join('\n')}${ads.more ? `\n(and ${ads.more} more not shown)` : ''}` : 'I have no addresses saved for this place yet.',
    i.steps.length ? `Open steps for this trip ${STEP_HEADER.replace(/^Steps /, '')}\n${i.steps.join('\n')}` : 'I have no open steps for this trip.',
    i.fixed.length ? `Already fixed in time on these days (day | time | minutes | title):\n${i.fixed.join('\n')}` : '',
    i.planned.length ? `Already on a day's list:\n${i.planned.join('\n')}` : '',
  ];
  if (i.people) {
    const ps = capped(i.people, MAX_TRIP_PEOPLE);
    parts.push(ps.shown.length ? `${PEOPLE_HEADER}\n${ps.shown.map(personLine).join('\n')}${ps.more ? `\n(and ${ps.more} more not shown)` : ''}` : 'I shared the people I know here for this trip, and there are none saved.');
  }
  return parts.filter(Boolean).join('\n\n');
}

/** What to ask of the AI, and how to answer. `placeId` is the id to put in `where` and in an address's `place`. */
export function tripInstructions(placeId: string, categoryIds: string[]): string {
  return [
    'This is a trip to plan. Use my lists above and, if you can browse the web, check opening hours, closing days, booking requirements and how to get from one place to the next before you put anything on a day; say in "note" what you could not check.',
    'Answer with one change-set that does these things:',
    `- Day lists: for each day of the trip, one \`day.update\` whose \`add\` lists that day's steps, as ids of my existing steps or as steps you make with \`task.create\` (give each a \`ref\`, and \`"where": "${placeId}"\`). A day is a short list, three or four things with room to rest, never an hourly grid: no times on ordinary steps. Start each new step's title with the first action ("Open Maps and walk to…").`,
    `- Things that happen at a set time (a train, a booking, a ticket): \`task.create\` with \`at\` (HH:MM), \`dur\` (minutes), \`due\` (the day) and \`"where": "${placeId}"\`. They are the only things with a time.`,
    `- Places you suggest that I do not have yet: \`address.create\` with \`name\`, \`category\` (one of: ${categoryIds.join(', ') || 'other'}), \`"place": "${placeId}"\`, \`mapsUrl\` only if you are sure of a real Google or Apple Maps link, \`street\` if you know it, and \`note\`: one line on why, and what you checked (hours, closing day). They are saved as places I want to go, marked as yours, for me to untick. Do not suggest one I already have, and put a suggested place on a day only by making a step for it ("Go to…").`,
    'Do not change anything else on my list. Do not give weights.',
  ].join('\n');
}
