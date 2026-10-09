// Inline due dates (brief §5): today, tomorrow, +1 week, clear, or any date.
import { useState } from 'preact/hooks';
import { today } from './store';
import { openSheet, closeSheet } from './sheet';
import { dueOn } from './actions';
import { T } from './model';
import { t } from '../i18n';
import { addDays } from '../domain/dates';

export function openDue(id: string) {
  openSheet(<DueSheet key={'due' + id} id={id} />);
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
  if (!tk) return null;
  return (
    <div>
      <h3>{t('dueTitle')}</h3>
      <p class="hint">{tk.title}</p>
      <DayPick value={tk.due} clear onPick={d => { closeSheet(); void dueOn(id, d); }} />
    </div>
  );
}
