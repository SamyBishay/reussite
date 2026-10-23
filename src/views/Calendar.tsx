// The Calendar tab (brief §5, §16): a real calendar with Day, Week, Month and Agenda views, on a library that is
// loaded when the tab is opened (CalendarGrid.tsx). Fixed-time items sit on the hour grid; the day's cards, due
// steps and the rest are in the all-day row. The Log (done steps by day) is a mode of this tab.
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { settings, today } from '../app/store';
import { calMode as mode, setCalMode as setMode, isPhone, PHONE_DAYS, type CalMode } from '../app/nav';
import { Log } from './Log';
import { t, fmtDate, lang } from '../i18n';
import { addDays } from '../domain/dates';
import { weekOf } from '../domain/calendar';
import { addToCalendar } from '../app/addToCalendar';
import type { GridProps } from './CalendarGrid';

const anchor = signal<string | null>(null);

type Mounted = ComponentType<GridProps>;
/** The grid and its library arrive in a chunk of their own the first time the tab is opened. */
function useGrid(): Mounted | null {
  const [grid, setGrid] = useState<Mounted | null>(null);
  useEffect(() => { let live = true; void import('./CalendarGrid').then(m => { if (live) setGrid(() => m.CalendarGrid); }); return () => { live = false; }; }, []);
  return grid;
}

const monthStart = (k: string, n: number) => new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 10);

export function Calendar() {
  const td = today.value;
  const a = anchor.value ?? td;
  void lang.value;
  void settings.value.language;
  const Grid = useGrid();
  const phone = isPhone();
  const m = mode.value;
  const seg = (
    <div class="seg" role="group" aria-label={t('calView')}>
      <button type="button" aria-pressed={m === 'day'} onClick={() => setMode('day')} data-testid="cal-day">{t('calDay')}</button>
      <button type="button" aria-pressed={m === 'week'} onClick={() => setMode('week')} data-testid="cal-week">{phone ? t('calThreeDays') : t('calWeek')}</button>
      <button type="button" aria-pressed={m === 'month'} onClick={() => setMode('month')} data-testid="cal-month">{t('calMonth')}</button>
      <button type="button" aria-pressed={m === 'agenda'} onClick={() => setMode('agenda')} data-testid="cal-agenda">{t('calAgenda')}</button>
      <button type="button" aria-pressed={m === 'log'} onClick={() => setMode('log')} data-testid="cal-log">{t('tabLog')}</button>
    </div>
  );
  if (m === 'log') return <div data-testid="calendar"><div class="calbar">{seg}</div><div data-testid="log"><Log /></div></div>;
  const days = m === 'week' && phone ? PHONE_DAYS : 7;
  const week = weekOf(a);
  const step = (n: number) => {
    anchor.value = m === 'day' ? addDays(a, n) : m === 'week' ? addDays(a, days * n) : monthStart(a, n);
  };
  const title = m === 'day' ? fmtDate(a, { weekday: 'long', day: 'numeric', month: 'long' })
    : m === 'week' ? (phone ? fmtDate(a, { day: 'numeric', month: 'short' }) + ' – ' + fmtDate(addDays(a, PHONE_DAYS - 1), { day: 'numeric', month: 'short' }) : fmtDate(week[0]!, { day: 'numeric', month: 'short' }) + ' – ' + fmtDate(week[6]!, { day: 'numeric', month: 'short' }))
    : fmtDate(a.slice(0, 8) + '01', { month: 'long', year: 'numeric' });
  // A week starts on Monday, except on a phone, where the three days start on the date shown.
  const shown = m === 'week' && !phone ? week[0]! : a;
  return (
    <div data-testid="calendar">
      <div class="calbar">
        {seg}
        <div class="calnav">
          <button class="icon-btn" type="button" onClick={() => step(-1)} aria-label={t('calPrev')} data-testid="cal-prev">‹</button>
          <b data-testid="cal-title">{title}</b>
          <button class="icon-btn" type="button" onClick={() => step(1)} aria-label={t('calNext')} data-testid="cal-next">›</button>
          {a !== td && <button class="btn small ghost" type="button" onClick={() => (anchor.value = null)}>{t('pickToday')}</button>}
        </div>
      </div>
      <div class="actions" style="margin-top:8px" data-testid="add-to-calendar" role="group" aria-label={t('addToCalendar')}>
        <button class="btn small ghost" type="button" data-testid="ics-today" onClick={() => void addToCalendar(td, td)}>{t('addToCalendarToday')}</button>
        <button class="btn small ghost" type="button" data-testid="ics-week" onClick={() => void addToCalendar(week[0]!, week[6]!)}>{t('addToCalendarWeek')}</button>
      </div>
      <p class="hint">{t(phone ? 'calHintPhone' : 'calHint')}</p>
      {Grid ? <Grid mode={m as Exclude<CalMode, 'log'>} date={shown} /> : <p class="hint" data-testid="calendar-loading">{t('loading')}</p>}
    </div>
  );
}
