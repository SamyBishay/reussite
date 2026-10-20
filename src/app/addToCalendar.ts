// Add to calendar (brief §8): the agenda's launch points and fixed-time items for a day or a week,
// as an .ics file handed to the share sheet or downloaded.
import { tasks, days, decisions, places, stays, settings, toast } from './store';
import { agenda } from '../domain/agenda';
import { exported, icsFor, realTitles } from '../domain/ics';
import { saveFile } from '../data/backup';
import { t } from '../i18n';

export const icsName = (from: string, to: string) => 'reussite-' + (from === to ? from : from + '-to-' + to) + '.ics';

/** The calendar text for days `from`..`to` with real titles and a reminder at each start. */
export function calendarText(from: string, to: string, now = Date.now()): { text: string; count: number } {
  const events = agenda({ tasks: tasks.value, days: days.value, decisions: decisions.value, places: places.value, stays: stays.value }, settings.value, from, to).filter(exported);
  return { text: icsFor(events, { now, titles: realTitles(t), withAlarms: true, name: 'Réussite' }), count: events.length };
}

export async function addToCalendar(from: string, to: string) {
  const { text, count } = calendarText(from, to);
  if (!count) { toast(t('icsNothing')); return; }
  await saveFile(icsName(from, to), text, 'text/calendar');
  toast(t('icsDone', { n: count }));
}
