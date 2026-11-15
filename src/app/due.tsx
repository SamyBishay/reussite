// Inline due dates (brief §5): today, tomorrow, +1 week, clear, or any date.
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { today } from './store';
import { openSheet, closeSheet } from './sheet';
import { dueOn } from './actions';
import { T } from './model';
import { t, fmtDate } from '../i18n';
import { addDays } from '../domain/dates';

export function openDue(id: string) {
  openSheet(<DueSheet key={'due' + id} id={id} />);
}

/** How many days after `from` a card can be put on with one tap: tomorrow, then five more. */
const DAYS_AHEAD = 6;
/** The next days as chips, "Tomorrow" then "Thu 12": a carried card's Another day and the move sheet's day row. `children` are more chips after them. */
export function DayChips({ from, onPick, testid, children }: { from: string; onPick: (d: string) => void; testid?: string; children?: ComponentChildren }) {
  return (
    <div class="chips-pick small" data-testid={testid}>
      {Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(from, i + 1)).map((d, i) => (
        <button type="button" data-day={d} onClick={() => onPick(d)}>{i === 0 ? t('pickTomorrow') : fmtDate(d, { weekday: 'short', day: 'numeric' })}</button>
      ))}
      {children}
    </div>
  );
}

/** Quick picks plus a date input. Shared by the due sheet and every "which day?" question. */
export function DayPick({ value, onPick, clear, extra }: { value: string | null; onPick: (k: string | null) => void; clear?: boolean; extra?: [string, string][] }) {
  const [v, setV] = useState(value ?? '');
  const k = today.value;
  const picks: [string, string][] = extra ?? [[t('pickToday'), k], [t('pickTomorrow'), addDays(k, 1)], [t('pickWeek'), addDays(k, 7)]];
  return (
    <div class="daypick">
      <div class="chips-pick">
        {picks.map(([label, d]) => <button type="button" class="chip-btn" aria-pressed={value === d} onClick={() => onPick(d)}>{label}</button>)}
        {clear && <button type="button" class="chip-btn" onClick={() => onPick(null)}>{t('pickClear')}</button>}
      </div>
      <div class="row-inline">
        <input type="date" value={v} onInput={e => setV((e.target as HTMLInputElement).value)} aria-label={t('orADate')} />
        <button class="btn small" type="button" disabled={!v} onClick={() => onPick(v)}>{t('setDate')}</button>
      </div>
    </div>
  );
}

function DueSheet({ id }: { id: string }) {
  const tk = T(id);
  const [at, setAt] = useState(tk?.dueAt ?? '');
  if (!tk) return null;
  return (
    <div>
      <h3>{t('dueTitle')}</h3>
      <p class="hint">{tk.title}</p>
      <label class="field"><span>{t('dueTimeField')}</span><input type="time" value={at} data-testid="due-time" onInput={e => setAt((e.target as HTMLInputElement).value)} /></label>
      <DayPick value={tk.due} clear onPick={d => { closeSheet(); void dueOn(id, d, at || null); }} />
    </div>
  );
}
