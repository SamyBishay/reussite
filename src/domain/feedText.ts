// The calendar feed's text (docs/dev/feed.md): the fixed-time items from a week back to 45 days ahead, said at
// the person's level of detail, without reminders. Pure, so the app and the connector (which writes the feed
// after its own changes) build the same calendar from the same list.
import { addDays } from './dates';
import { agenda, type AgendaSettings } from './agenda';
import { fixedTitles, type CalData, type FeedDetail } from './calItems';
import { clockIn, exported, icsFor, type IcsTranslate } from './ics';

export const FEED_PAST_DAYS = 7;
export const FEED_AHEAD_DAYS = 45;
/** How often the feed asks a calendar app to fetch it again (apps that honour it: Outlook, Thunderbird, macOS; iOS follows its own Fetch setting). */
export const FEED_REFRESH_HINT = 'PT15M';

/**
 * The calendar text for the feed window around `day`: the fixed-time items, said at the level of `detail`.
 * `appUrl` makes the link to each step (`full` only); `zone` is the zone of events whose place has none (default: this runtime's).
 */
export function feedText(data: CalData, s: AgendaSettings, day: string, detail: FeedDetail, tr: IcsTranslate, now: number, appUrl = '', zone?: string): string {
  const events = agenda(data, s, addDays(day, -FEED_PAST_DAYS), addDays(day, FEED_AHEAD_DAYS)).filter(exported);
  return icsFor(events, { now, titles: fixedTitles({ detail, data, tr, appUrl, clockIn }), withAlarms: false, name: 'Réussite', refresh: FEED_REFRESH_HINT, ...(zone ? { deviceZone: zone } : {}) });
}
