// Add to calendar (brief §8, §16): the fixed-time items for a day or a week, and the open planned cards from today on
// at their projected times, and the due steps as all-day events, in full (short names, places, notes, links), as an .ics file handed to the
// share sheet or downloaded. Launch points stay in the app.
import { settings, toast, today } from './store';
import { agenda } from '../domain/agenda';
import { allDayEvents, allDayItems, fixedTitles, plannedEvents, plannedKeys } from '../domain/calItems';
import { clockIn, exported, icsFor } from '../domain/ics';
import { saveFile } from '../data/backup';
import { t } from '../i18n';
import { appAddress, calData } from './feed';

export const icsName = (from: string, to: string) => 'reussite-' + (from === to ? from : from + '-to-' + to) + '.ics';

/** The calendar text for days `from`..`to` at the `full` level with a reminder at each start. */
export function calendarText(from: string, to: string, now = Date.now()): { text: string; count: number } {
  const data = calData();
  const planned = plannedEvents(data, settings.value, today.value, from, to, now);
  const events = [...agenda(data, settings.value, from, to).filter(exported), ...planned];
  const items = allDayItems(data, from < today.value ? today.value : from, to, plannedKeys(planned));
  const ctx = { detail: 'full' as const, data, tr: t, appUrl: appAddress(), clockIn };
  return { text: icsFor(events, { now, titles: fixedTitles(ctx), allDay: allDayEvents(ctx, items), withAlarms: true, name: 'Réussite' }), count: events.length + items.length };
}

export async function addToCalendar(from: string, to: string) {
  const { text, count } = calendarText(from, to);
  if (!count) { toast(t('icsNothing')); return; }
  await saveFile(icsName(from, to), text, 'text/calendar');
  toast(t('icsDone', { n: count }));
}
