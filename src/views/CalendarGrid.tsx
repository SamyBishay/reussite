// The Calendar tab's grid (brief §16), drawn by Schedule-X (MIT) and loaded on its own, so the library stays out of
// the main bundle. It only draws: what is on each day comes from src/domain/calView.ts, a tap opens the step's
// sheet, and a drag writes through the same actions as the Move menu. The library's own header is hidden; the tab
// has its own bar (Calendar.tsx) and drives this through the `mode` and `date` it is given.
import 'temporal-polyfill/global';
import { createCalendar, createViewDay, createViewList, createViewMonthGrid, createViewWeek, type CalendarEventExternal } from '@schedule-x/calendar';
import { createCalendarControlsPlugin } from '@schedule-x/calendar-controls';
import { createCurrentTimePlugin } from '@schedule-x/current-time';
import { createDragAndDropPlugin } from '@schedule-x/drag-and-drop';
import { createScrollControllerPlugin } from '@schedule-x/scroll-controller';
import '@schedule-x/theme-default/dist/index.css';
import '../styles/calendar.css';
import { effect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { addresses, days, decisions, hereZone, places, projects, settings, stays, tasks, today } from '../app/store';
import { inPlace } from '../app/model';
import { moveFixed, moveDone, planOn } from '../app/actions';
import { openTask } from '../app/sheets';
import { openReview } from '../flows/review';
import { openDecisionPage } from '../flows/decision';
import { dayView } from './Today';
import { isPhone, PHONE_DAYS, type CalMode } from '../app/nav';
import { t, lang } from '../i18n';
import { addDays } from '../domain/dates';
import { appSlot, calViewEvents, type CalViewEvent } from '../domain/calView';
import { isoDow } from '../domain/repeat';
import { areaFilter } from '../app/areas';

export type GridMode = Exclude<CalMode, 'log'>;

function openDay(k: string) {
  dayView.value = k === today.value ? null : k;
  location.hash = '#today';
}

/** The days the events are computed for: the month around the date, with a week either side. */
export function windowAround(date: string): [string, string] {
  const first = date.slice(0, 8) + '01';
  const last = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return [addDays(first, -8), addDays(last, 8)];
}

const plain = (k: string) => Temporal.PlainDate.from(k);

function labelOf(e: CalViewEvent): string {
  switch (e.kind) {
    case 'check': return t('checkShort', { title: e.title });
    case 'project': return t('projectDue', { name: e.title });
    case 'review': return t('sundayReview');
    case 'repeat': return '↻ ' + e.title;
    case 'half': return t('halfIn', { half: t(e.half === 'am' ? 'halfAm' : 'halfPm'), area: e.title });
    default: return e.title;
  }
}

/** A library event from ours. A fixed-time item is on the grid at its clock reading; the rest are all-day. */
function toLibrary(e: CalViewEvent, zone: string, phone: boolean): CalendarEventExternal {
  const base = {
    id: e.id, title: labelOf(e), ...(e.where ? { location: e.where } : {}),
    calendarId: e.kind === 'stay' ? 'stay' : e.suit && ['plan', 'due', 'done', 'fixed', 'repeat'].includes(e.kind) ? e.suit : 'neutral',
    _options: { disableDND: phone || !e.movable, disableResize: true, additionalClasses: ['k-' + e.kind, ...(e.done ? ['is-done'] : [])] },
  };
  if (e.kind === 'fixed' && e.time && e.endTime) {
    const at = (time: string) => Temporal.PlainDateTime.from(`${e.date}T${time}:00`).toZonedDateTime(zone);
    return { ...base, start: at(e.time), end: at(e.endTime) };
  }
  return { ...base, start: plain(e.date), end: plain(e.endDate ?? e.date) };
}

export interface GridProps {
  mode: GridMode;
  /** The date shown (the Monday-first week or the month around it), YYYY-MM-DD. */
  date: string;
}

export function CalendarGrid({ mode, date }: GridProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ controls: ReturnType<typeof createCalendarControlsPlugin>; sync: () => void } | null>(null);
  const latest = useRef({ mode, date });
  latest.current = { mode, date };
  const zone = hereZone.value || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const language = lang.value;
  const phone = isPhone();

  // The calendar itself: made once per language, zone and phone/tablet size; the date and the view are moved below.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const controls = createCalendarControlsPlugin();
    const byId = new Map<string, CalViewEvent>();
    const locale = language === 'fr' ? 'fr-FR' : 'en-GB';
    const text = {
      '+ {{n}} events': t('calMore', { n: '{{n}}' }), '+ 1 event': t('calMoreOne'), 'No events': t('calNoEvents'),
      'Full day- and multiple day events': t('calAllDay'), 'Link to {{n}} more events on {{date}}': t('calMoreLink', { n: '{{n}}', date: '{{date}}' }),
      'Link to 1 more event on {{date}}': t('calMoreLinkOne', { date: '{{date}}' }), Today: t('pickToday'), Day: t('calDay'), Week: t('calWeek'), Month: t('calMonth'), List: t('calAgenda'),
    };
    const colors = (v: string) => ({ main: `var(--suit-${v})`, container: 'var(--card)', onContainer: 'var(--ink)' });
    const neutral = { main: 'var(--ink-3)', container: 'var(--card)', onContainer: 'var(--ink)' };
    const calendar = createCalendar({
      views: [createViewDay(), createViewWeek(), createViewMonthGrid(), createViewList()],
      defaultView: 'week',
      selectedDate: plain(latest.current.date),
      locale, firstDayOfWeek: 1, timezone: zone as never, isDark: false, isResponsive: false,
      translations: { [locale]: text },
      weekOptions: { gridHeight: 1152, nDays: 7, eventWidth: 96, gridStep: 60 },
      monthGridOptions: { nEventsPerDay: 4 },
      calendars: {
        S: { colorName: 'S', lightColors: colors('S'), darkColors: colors('S') }, D: { colorName: 'D', lightColors: colors('D'), darkColors: colors('D') },
        C: { colorName: 'C', lightColors: colors('C'), darkColors: colors('C') }, H: { colorName: 'H', lightColors: colors('H'), darkColors: colors('H') },
        neutral: { colorName: 'neutral', lightColors: neutral, darkColors: neutral },
        stay: { colorName: 'stay', lightColors: { main: 'var(--sea-deep)', container: 'var(--sea-soft)', onContainer: 'var(--sea-deep)' }, darkColors: { main: 'var(--sea-deep)', container: 'var(--sea-soft)', onContainer: 'var(--sea-deep)' } },
      },
      callbacks: {
        onEventClick: ev => {
          const e = byId.get(String(ev.id));
          if (!e) return;
          if (e.taskId) openTask(e.taskId, 'calendar');
          else if (e.decisionId) openDecisionPage(e.decisionId, e.day <= today.value);
          else if (e.kind === 'review') openReview();
        },
        onClickDate: d => openDay(d.toString()),
        onClickPlusEvents: d => openDay(d.toString()),
        onEventUpdate: ev => {
          const e = byId.get(String(ev.id));
          if (!e?.taskId) return;
          const start = ev.start;
          const k = (start instanceof Temporal.ZonedDateTime ? start.toPlainDate() : start).toString();
          if (e.kind === 'fixed' && start instanceof Temporal.ZonedDateTime) {
            const time = start.toPlainTime().toString().slice(0, 5);
            const slot = appSlot(k, time, settings.value.dayStart);
            if (slot.day !== e.day || slot.at !== e.time) void moveFixed(e.taskId, slot.day, slot.at).finally(sync);
          } else if (k !== e.date) {
            void (e.kind === 'done' ? moveDone(e.taskId, k > today.value ? today.value : k) : planOn(e.taskId, k)).finally(sync);
          } else sync();
        },
      },
    }, [controls, createDragAndDropPlugin(15), createScrollControllerPlugin({ initialScroll: '07:00' }), createCurrentTimePlugin()]);

    // The events follow the data: any change to what a day is made of puts the library back in line.
    function sync() {
      const [from, to] = windowAround(latest.current.date);
      const evs = calViewEvents(
        { tasks: tasks.value, days: days.value, decisions: decisions.value, projects: projects.value, places: places.value, stays: stays.value, addresses: addresses.value },
        { today: today.value, dayStart: settings.value.dayStart, reviewDay: settings.value.reviewDay, onPage: x => inPlace(x), area: areaFilter('calendar') },
        from, to,
      );
      byId.clear();
      for (const e of evs) byId.set(e.id, e);
      calendar.events.set(evs.map(e => toLibrary(e, zone, phone)));
    }
    api.current = { controls, sync };
    calendar.render(el);
    const stop = effect(() => { void [tasks.value, days.value, decisions.value, projects.value, places.value, stays.value, addresses.value, settings.value, today.value, lang.value]; sync(); });
    move(controls, latest.current.mode, latest.current.date, phone);
    return () => { stop(); calendar.destroy(); api.current = null; };
  }, [language, zone, phone]);

  // A new view or date from the bar.
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    move(a.controls, mode, date, phone);
    a.sync();
  }, [mode, date]);

  return <div ref={host} class="sxhost" data-testid="calendar-grid" data-mode={mode} />;
}

const VIEW: Record<GridMode, string> = { day: 'day', week: 'week', month: 'month-grid', agenda: 'list' };

/** Show `mode` on `date`. A phone's week is three days starting on the date, so the week starts on that weekday. */
function move(controls: ReturnType<typeof createCalendarControlsPlugin>, mode: GridMode, date: string, phone: boolean) {
  const threeDays = mode === 'week' && phone;
  controls.setFirstDayOfWeek((threeDays ? isoDow(date) : 1) as never);
  controls.setWeekOptions({ gridHeight: 1152, nDays: threeDays ? PHONE_DAYS : 7, eventWidth: 96, gridStep: 60, timeAxisFormatOptions: { hour: '2-digit', minute: '2-digit' }, eventOverlap: true });
  controls.setView(VIEW[mode]);
  controls.setDate(plain(date));
}
