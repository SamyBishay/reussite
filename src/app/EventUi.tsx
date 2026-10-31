// Event steps (schema 6): what the person does with something they wait for. "It happened" asks which day (today by
// default, a past day allowed) and finishes it like a step done, with no card, no timer and no celebration; "Still waiting"
// moves the nudge; the nudge row asks on the day; the calm "Waiting for" line is how an event shows inside a chain and a
// project. This file does not import sheets.tsx (which imports it): the card sheet is opened through `onOpen`.
import { useState } from 'preact/hooks';
import { today, toast } from './store';
import { T, type T as Tk } from './model';
import { finishTask, dropTask, snoozeEvent } from './actions';
import { closeSheet, openSheet, Title } from './ui';
import { nudgeAfter, snoozeNudge } from '../domain/events';
import { t, fmtDate } from '../i18n';

/** "It happened": a date (today to begin with, any past day), then Save. One line says what it unlocked. */
export function openHappened(id: string) {
  openSheet(<HappenedSheet key={'happened' + id + Date.now()} id={id} />);
}
function HappenedSheet({ id }: { id: string }) {
  const tk = T(id);
  const [day, setDay] = useState(today.value);
  if (!tk || tk.status !== 'open') return null;
  const ok = !!day && day <= today.value;
  const save = async () => {
    if (!ok) return;
    closeSheet();
    const r = await finishTask(tk, null, day);
    const names = r.unlocked.map(x => T(x)?.title).filter((x): x is string => !!x);
    toast(names.length ? t('unlocked', { what: names.join(', ') }) : t('happenedNone'));
  };
  return (
    <div data-testid="happened-sheet">
      <h3>{t('happenedTitle')}</h3>
      <p class="quote"><Title s={tk.title} /></p>
      <label class="field"><span>{t('happenedOn')}</span>
        <input type="date" value={day} max={today.value} data-testid="happened-day" onInput={e => setDay((e.target as HTMLInputElement).value)} />
      </label>
      <div class="actions"><button class="btn primary" type="button" disabled={!ok} onClick={() => void save()} data-testid="happened-save">{t('save')}</button></div>
    </div>
  );
}

/** "Still waiting": ask again in three days or a week, or on a day of the person's choice. */
export function openStillWaiting(id: string) {
  openSheet(<StillWaitingSheet key={'still-waiting' + id + Date.now()} id={id} />);
}
function StillWaitingSheet({ id }: { id: string }) {
  const tk = T(id);
  const [day, setDay] = useState('');
  if (!tk || tk.status !== 'open') return null;
  const to = (d: string) => {
    closeSheet();
    void snoozeEvent(id, d);
    toast(t('nudgeMoved', { date: fmtDate(nudgeAfter(today.value, d)) }));
  };
  return (
    <div data-testid="still-waiting-sheet">
      <h3>{t('stillWaiting')}</h3>
      <p class="quote"><Title s={tk.title} /></p>
      <p class="hint">{t('stillWaitingHint')}</p>
      <div class="actions">
        <button class="btn" type="button" onClick={() => to(snoozeNudge(today.value, '3d'))} data-testid="snooze-3d">{t('in3Days')}</button>
        <button class="btn" type="button" onClick={() => to(snoozeNudge(today.value, '1w'))} data-testid="snooze-1w">{t('inAWeek')}</button>
      </div>
      <label class="field"><span>{t('pickDay')}</span>
        <input type="date" value={day} min={nudgeAfter(today.value, today.value)} onInput={e => setDay((e.target as HTMLInputElement).value)} data-testid="snooze-day" />
      </label>
      <div class="actions"><button class="btn primary" type="button" disabled={!day} onClick={() => to(day)} data-testid="snooze-save">{t('save')}</button></div>
    </div>
  );
}

/** Drop in two taps, as everywhere: the first arms it, the second drops. Freed steps are placed as for any step dropped. */
function DropEvent({ tk }: { tk: Tk }) {
  const [armed, setArmed] = useState(false);
  return (
    <button class="btn ghost small" type="button" data-testid="event-drop" onClick={() => { if (!armed) return setArmed(true); void dropTask(tk.id); toast(t('dropped')); }}>
      {armed ? t('dropAgain') : t('dropIt')}
    </button>
  );
}

/** The three answers to "did it happen?". */
export function EventActions({ tk }: { tk: Tk }) {
  return (
    <div class="go">
      <button class="btn small" type="button" onClick={() => openHappened(tk.id)} data-testid="event-happened">{t('happenedBtn')}</button>
      <button class="btn small" type="button" onClick={() => openStillWaiting(tk.id)} data-testid="event-still">{t('stillWaiting')}</button>
      <DropEvent tk={tk} />
    </div>
  );
}

/** Today, from the nudge day on: the event is asked about once, here, never as a step on the list and never as Start here. */
export function NudgeRow({ tk }: { tk: Tk }) {
  return (
    <div class="banner nudge" data-testid="nudge-row">
      <p>{t('nudgeCheck', { what: tk.title })}</p>
      <EventActions tk={tk} />
    </div>
  );
}
