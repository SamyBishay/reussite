// The Calendar tab (brief §5, §16): a real calendar with Day, Week, Month and Agenda views, on a library that is
// loaded when the tab is opened (CalendarGrid.tsx). Fixed-time items sit on the hour grid; the day's cards, due
// steps and the rest are in the all-day row. The Log (done steps by day) is a mode of this tab. On a phone the bar is two tight rows and the grid fills the
// rest of the screen; under the grid, a line to Settings → Calendar while this device's feed is off (the one-off .ics file is there too).
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { settings, today } from '../app/store';
import { calMode as mode, setCalMode as setMode, isPhone, PHONE_DAYS, go, type CalMode } from '../app/nav';
import { openFold } from '../app/More';
import { Log } from './Log';
import { t, fmtDate, lang } from '../i18n';
import { addDays } from '../domain/dates';
import { weekOf } from '../domain/calendar';
import { feedId } from '../app/feed';
import type { GridProps } from './CalendarGrid';

const anchor = signal<string | null>(null);

type Mounted = ComponentType<GridProps>;
/** The grid and its library arrive in a chunk of their own the first time the tab is opened. */
function useGrid(): Mounted | null {
  const [grid, setGrid] = useState<Mounted | null>(null);
  useEffect(() => { let live = true; void import('./CalendarGrid').then(m => { if (live) setGrid(() => m.CalendarGrid); }); return () => { live = false; }; }, []);
  return grid;
}

/** Settings, opened at its Calendar section (where the feed is switched on). */
function openCalendarSettings() {
  go('settings');
  let tries = 0;
  const open = () => {
    const el = document.querySelector<HTMLElement>('[data-testid="calendar-settings"]');
    if (!el) { if (++tries < 20) requestAnimationFrame(open); return; }
    openFold(el);
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  requestAnimationFrame(open);
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
  const title = m === 'day' ? fmtDate(a, phone ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'long', day: 'numeric', month: 'long' })
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
      {Grid ? <Grid mode={m as Exclude<CalMode, 'log'>} date={shown} /> : <p class="hint" data-testid="calendar-loading">{t('loading')}</p>}
      {!phone && <p class="hint calhint">{t('calHint')}</p>}
      {!feedId.value && <p class="hint calfeed" data-testid="cal-feed-line">{t('calFeedLine')} <button type="button" class="lnk linkbtn" onClick={openCalendarSettings} data-testid="cal-feed-link">{t('calFeedLink')}</button></p>}
    </div>
  );
}
