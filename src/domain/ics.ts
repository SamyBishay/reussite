// iCalendar (RFC 5545) for Add to calendar and the feed (brief §8, §16). Pure: events in, text out. A fixed-time
// item is an event at its time and for its duration, with its zone as a TZID and a generated VTIMEZONE, so the time
// stays right across daylight-saving changes and when a stay moves the day to another zone. A planned card or a
// step due is an all-day event (VALUE=DATE). Launch points, the check-in, the close and the review are not exported:
// the calendar is for things at a time and things on a day, and reminders are the notifications' job.
import type { AgendaEvent } from './agenda';
import { addDays, partsIn } from './dates';
import { offsetAt } from './zone';

const MIN = 60_000;
const DAY = 86_400_000;
/** How long an obligation lasts when it has no duration. */
export const DEFAULT_FIXED_MINUTES = 60;
/** The domain that makes event ids into globally unique UIDs. */
export const UID_DOMAIN = 'reussite.local';
/** Days either side of the exported events that a VTIMEZONE covers. */
const ZONE_MARGIN_DAYS = 14;

/** The words a title can use; the app passes its `t`. */
export type IcsKey = 'notifyLeaveBy' | 'icsFixed' | 'icsPlanned' | 'icsDue';
export type IcsTranslate = (key: IcsKey, vars?: Record<string, string | number>) => string;

/** What a fixed-time event says: its name, and optionally where, a longer text and the link that opens it. */
export interface IcsText { summary: string; description?: string; location?: string; url?: string }
export type IcsTitles = (e: AgendaEvent, zone: string) => IcsText;

/** An event on a whole day: a planned card or a step due. `day` is its date; the end is the next day (exclusive). */
export interface IcsAllDay extends IcsText { id: string; day: string }

export interface IcsOptions {
  /** DTSTAMP and the calendar's "now", epoch milliseconds (passed in so the output is reproducible). */
  now: number;
  titles: IcsTitles;
  /** All-day events (VALUE=DATE), after the timed ones. */
  allDay?: readonly IcsAllDay[];
  /** A VALARM at the start of each timed event: on for the export, off for the feed. */
  withAlarms: boolean;
  /** The zone name for events whose zone is the device's (`zone` undefined). */
  deviceZone?: string;
  /** X-WR-CALNAME. */
  name?: string;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** `19:00`: the clock reading in a zone. */
export const clockIn = (at: number, zone: string) => { const p = partsIn(new Date(at), zone); return pad(p.hh) + ':' + pad(p.mm); };
/** `20261025T030000`: the clock reading in a zone. */
function local(at: number, zone: string): string {
  const p = partsIn(new Date(at), zone);
  return pad(p.y, 4) + pad(p.m) + pad(p.d) + 'T' + pad(p.hh) + pad(p.mm) + '00';
}
/** `20261025T030000Z`. */
const utc = (at: number) => new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function offsetText(ms: number): string {
  const m = Math.round(Math.abs(ms) / MIN);
  return (ms < 0 ? '-' : '+') + pad(Math.floor(m / 60)) + pad(m % 60);
}

/** Escape a TEXT value: backslash, semicolon, comma, newline. */
export const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

const enc = new TextEncoder();
/** Fold a line at 75 octets (RFC 5545 §3.1), continuation lines start with a space; never inside a UTF-8 sequence. */
export function fold(line: string): string[] {
  if (enc.encode(line).length <= 75) return [line];
  const out: string[] = [];
  let cur = '', size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // A continuation line has a leading space, which takes one octet of its 75.
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.map((l, i) => (i ? ' ' + l : l));
}

interface Transition { at: number; from: number; to: number }

/** The offset changes of a zone in [from, to], found by probing daily and narrowing to the minute. */
function transitions(zone: string, from: number, to: number): Transition[] {
  const out: Transition[] = [];
  let a = from, oa = offsetAt(a, zone);
  while (a < to) {
    const b = Math.min(a + DAY, to), ob = offsetAt(b, zone);
    if (ob !== oa) {
      let lo = a, hi = b;
      while (hi - lo > MIN) { const mid = lo + Math.floor((hi - lo) / MIN / 2) * MIN; if (offsetAt(mid, zone) === oa) lo = mid; else hi = mid; }
      out.push({ at: hi, from: oa, to: offsetAt(hi, zone) });
    }
    a = b; oa = ob;
  }
  return out;
}

/** A VTIMEZONE for the zone covering [from, to]: STANDARD/DAYLIGHT components at each change; a zone without change gets one STANDARD. */
function vtimezone(zone: string, from: number, to: number): string[] {
  const start = from - ZONE_MARGIN_DAYS * DAY, end = to + ZONE_MARGIN_DAYS * DAY;
  const base = offsetAt(start, zone);
  const name = (o: number) => 'GMT' + (o < 0 ? '-' : '+') + Math.floor(Math.abs(o) / 3_600_000) + (Math.abs(o) % 3_600_000 ? ':' + pad((Math.abs(o) % 3_600_000) / MIN) : '');
  const comp = (type: 'STANDARD' | 'DAYLIGHT', dtstart: string, f: number, t: number) =>
    ['BEGIN:' + type, 'DTSTART:' + dtstart, 'TZOFFSETFROM:' + offsetText(f), 'TZOFFSETTO:' + offsetText(t), 'TZNAME:' + name(t), 'END:' + type];
  const lines = ['BEGIN:VTIMEZONE', 'TZID:' + zone];
  // The base reading from the dawn of the calendar; the changes in the window override it.
  lines.push(...comp('STANDARD', '19700101T000000', base, base));
  for (const tr of transitions(zone, start, end)) {
    // The local start is the wall time just before the change, read with the old offset.
    const wall = new Date(tr.at + tr.from);
    const dt = pad(wall.getUTCFullYear(), 4) + pad(wall.getUTCMonth() + 1) + pad(wall.getUTCDate()) + 'T' + pad(wall.getUTCHours()) + pad(wall.getUTCMinutes()) + '00';
    lines.push(...comp(tr.to > tr.from ? 'DAYLIGHT' : 'STANDARD', dt, tr.from, tr.to));
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

/** Whether an agenda event is exported at all: only fixed-time items (launch points stay in the app). */
export const exported = (e: AgendaEvent) => e.kind === 'fixed';

const dateOnly = (k: string) => k.replace(/-/g, '');
const textLines = (x: IcsText) => [
  'SUMMARY:' + escapeText(x.summary),
  ...(x.location ? ['LOCATION:' + escapeText(x.location)] : []),
  ...(x.description ? ['DESCRIPTION:' + escapeText(x.description)] : []),
  ...(x.url ? ['URL:' + x.url] : []),
];

/** The calendar text for these events (others are skipped) and the all-day events: CRLF line endings, folded lines. */
export function icsFor(events: readonly AgendaEvent[], opts: IcsOptions): string {
  const device = opts.deviceZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const evs = events.filter(exported);
  const zoneOf = (e: AgendaEvent) => e.zone ?? device;
  const span = new Map<string, [number, number]>();
  const body: string[] = [];
  for (const e of evs) {
    const zone = zoneOf(e);
    const minutes = e.dur && e.dur > 0 ? Math.round(e.dur) : DEFAULT_FIXED_MINUTES;
    const end = e.at + minutes * MIN;
    const s = span.get(zone);
    span.set(zone, s ? [Math.min(s[0], e.at), Math.max(s[1], end)] : [e.at, end]);
    const text = opts.titles(e, zone);
    body.push(
      'BEGIN:VEVENT',
      'UID:' + e.id + '@' + UID_DOMAIN,
      'DTSTAMP:' + utc(opts.now),
      `DTSTART;TZID=${zone}:${local(e.at, zone)}`,
      `DTEND;TZID=${zone}:${local(end, zone)}`,
      ...textLines(text),
      ...(opts.withAlarms ? ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + escapeText(text.summary), 'TRIGGER:-PT0M', 'END:VALARM'] : []),
      'END:VEVENT',
    );
  }
  for (const a of opts.allDay ?? []) {
    body.push(
      'BEGIN:VEVENT',
      'UID:' + a.id + '@' + UID_DOMAIN,
      'DTSTAMP:' + utc(opts.now),
      'DTSTART;VALUE=DATE:' + dateOnly(a.day),
      'DTEND;VALUE=DATE:' + dateOnly(addDays(a.day, 1)),
      ...textLines(a),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  const zones = [...span.keys()].sort().flatMap(z => vtimezone(z, span.get(z)![0], span.get(z)![1]));
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Reussite//Calendar//EN', 'CALSCALE:GREGORIAN',
    ...(opts.name ? ['X-WR-CALNAME:' + escapeText(opts.name)] : []),
    ...zones, ...body, 'END:VCALENDAR',
  ];
  return lines.flatMap(fold).join('\r\n') + '\r\n';
}
