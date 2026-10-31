// Carried and missed, one at a time (plan 2 Nov, S3). A step left open yesterday is decided on its own card: Today / Another day /
// Drop it / Make it a decision (and "Already done", for what was done and not ticked). A fixed-time item whose time has passed gets
// one small card: Move / Remove. Nothing moves until the person answers; there is no bulk carry, no count, nothing red.
// The ritual (src/flows/checkin.tsx) and the stand-alone sheet ("Decide them one at a time", from Today and the bell) share these.
import { useEffect, useState } from 'preact/hooks';
import { today, clockNow, toast } from './store';
import { T, isOpen, carriedOn, missedOn, dayZone, timeOnDay, type T as Tk } from './model';
import { carry, planOn, dropTask, droppedLine, skipThisTime, finishTask, moveFixed, patchTask } from './actions';
import { openSheet, closeSheet } from './sheet';
import { Title, Meta } from './ui';
import { flows } from './sheets';
import { addDays } from '../domain/dates';
import { wallOf } from '../domain/zone';
import { t, fmtDate } from '../i18n';

/** The next days a step can be put on: tomorrow, then up to five more. */
const DAYS_AHEAD = 6;
const dayLabel = (k: string) => fmtDate(k, { weekday: 'short', day: 'numeric' });
const DONE_MINUTES = [5, 15, 30, 60];

/** One open step from yesterday and what to do with it. `release` false keeps it on yesterday's list too (the check-in writes the day's list itself). */
export function CarriedCard({ tk, k, release, onNext }: { tk: Tk; k: string; release: boolean; onNext: () => void }) {
  const [mode, setMode] = useState<'ask' | 'day' | 'done'>('ask');
  const [armed, setArmed] = useState(false);
  const heavy = (tk.carried || 0) >= 2;
  const answer = async (f: () => Promise<unknown> | void) => { await f(); onNext(); };
  return (
    <div class="carrycard" data-testid="carried-card">
      <p class="t"><Title s={tk.title} /></p>
      <p class="meta"><Meta tk={tk} /></p>
      {heavy && <p class="hint" data-testid="carried-heavy">{t('ciHeavyHint')}</p>}
      {mode === 'ask' && (
        <>
          <div class="go">
            <button class="btn primary" type="button" data-testid="carried-today" onClick={() => void answer(() => carry([tk.id], k, release))}>{t('pickToday')}</button>
            <button class="btn" type="button" data-testid="carried-other" onClick={() => setMode('day')}>{t('carryAnotherDay')}</button>
            <button class="btn" type="button" data-testid="carried-decision" onClick={() => void (async () => { await planOn(tk.id, k); await patchTask(tk.id, { kind: 'decision' }); flows.decide(null, { taskId: tk.id }); })()}>{t('carryDecision')}</button>
          </div>
          <div class="go quiet">
            <button class="btn ghost small" type="button" data-testid="carried-drop"
              onClick={() => { if (!armed) return setArmed(true); void answer(async () => { toast(droppedLine(await dropTask(tk.id))); }); }}>{armed ? t('dropAgain') : t('dropIt')}</button>
            <button class="btn ghost small" type="button" data-testid="carried-done" onClick={() => setMode('done')}>{t('alreadyDone')}</button>
            {heavy && <button class="btn ghost small" type="button" onClick={() => flows.breakDown(tk.id)}>{t('shrinkIt')}</button>}
          </div>
        </>
      )}
      {mode === 'day' && (
        <>
          <p class="hint">{t('carryWhichDay')}</p>
          <div class="chips-pick small" data-testid="carried-days">
            {Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(k, i + 1)).map((d, i) => (
              <button type="button" data-day={d} onClick={() => void answer(async () => { await planOn(tk.id, d); toast(t('plannedOn', { date: fmtDate(d) })); })}>{i === 0 ? t('pickTomorrow') : dayLabel(d)}</button>
            ))}
          </div>
          <div class="go quiet"><button class="btn ghost small" type="button" onClick={() => setMode('ask')}>{t('cancel')}</button></div>
        </>
      )}
      {mode === 'done' && (
        <>
          <p class="hint">{t('carryDoneHint')}</p>
          <div class="chips-pick small">
            {DONE_MINUTES.map(m => <button type="button" onClick={() => void answer(() => finishTask(tk, m, addDays(k, -1)))}>{m === 60 ? '60+' : m}</button>)}
            <button type="button" onClick={() => void answer(() => finishTask(tk, null, addDays(k, -1)))}>{t('didntTimeShort')}</button>
          </div>
          <div class="go quiet"><button class="btn ghost small" type="button" onClick={() => setMode('ask')}>{t('cancel')}</button></div>
        </>
      )}
    </div>
  );
}

/** Steps decided one after the other; `onDone` when the last is answered (or none is left open). */
export function CarriedFlow({ ids, k, release, onDone }: { ids: string[]; k: string; release: boolean; onDone: () => void }) {
  const [i, setI] = useState(0);
  const left = ids.slice(i).map(id => T(id)).filter(isOpen);
  const tk = left[0];
  useEffect(() => { if (!tk) onDone(); }, [!tk]);
  if (!tk) return null;
  return <CarriedCard key={tk.id} tk={tk} k={k} release={release} onNext={() => setI(ids.indexOf(tk.id) + 1)} />;
}

/** A fixed-time item whose time has passed: Move it to another time or day, or Remove it. */
export function MissedCard({ id, onNext, on = today.value }: { id: string; onNext: () => void; on?: string }) {
  const tk = T(id);
  const [moving, setMoving] = useState(false);
  const [armed, setArmed] = useState(false);
  const [day, setDay] = useState(today.value);
  const [at, setAt] = useState(tk?.at ?? '');
  if (!tk) return null;
  const later = (d: string, hhmm: string) => (d === today.value && timeOnDay(d, hhmm) <= clockNow.value ? nextQuarter() : hhmm);
  const nextQuarter = () => {
    const w = wallOf(clockNow.value, dayZone(today.value));
    const m = Math.ceil((Number(w.slice(0, 2)) * 60 + Number(w.slice(3, 5)) + 1) / 15) * 15;
    return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  };
  const pick = (d: string) => { setDay(d); setAt(later(d, tk.at ?? '')); };
  // A repeating one is skipped this time (the next is made); any other is dropped, and what it freed is said.
  const remove = async () => {
    if (tk.repeat) { await skipThisTime(id); toast(t('dropped')); } else toast(droppedLine(await dropTask(id)));
    onNext();
  };
  return (
    <div class="banner missed" data-testid="missed-card">
      <p>{t('missedLine', { title: tk.title, time: tk.at ?? '' })}</p>
      {!moving ? (
        <div class="go">
          <button class="btn small" type="button" data-testid="missed-move" onClick={() => { setMoving(true); pick(today.value); }}>{t('missedMove')}</button>
          <button class="btn small" type="button" data-testid="missed-remove" onClick={() => { if (!armed) return setArmed(true); void remove(); }}>{armed ? t('dropAgain') : t('missedRemove')}</button>
          <button class="btn small ghost" type="button" data-testid="missed-done" onClick={() => void finishTask(tk, null, on).then(onNext)}>{t('alreadyDone')}</button>
        </div>
      ) : (
        <div class="missed-move" data-testid="missed-move-form">
          <div class="chips-pick small">
            {Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today.value, i)).map((d, i) => (
              <button type="button" aria-pressed={day === d} data-day={d} onClick={() => pick(d)}>{i === 0 ? t('pickToday') : i === 1 ? t('pickTomorrow') : dayLabel(d)}</button>
            ))}
          </div>
          <label class="field"><span>{t('atField')}</span><input type="time" value={at} data-testid="missed-at" onInput={e => setAt((e.target as HTMLInputElement).value)} /></label>
          <div class="go">
            <button class="btn small primary" type="button" disabled={!at} data-testid="missed-move-go" onClick={() => void moveFixed(id, day, at).then(onNext)}>{t('missedMoveGo')}</button>
            <button class="btn small ghost" type="button" onClick={() => setMoving(false)}>{t('cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Items one after the other; `onDone` when the last is answered. */
export function MissedFlow({ ids, on, onDone }: { ids: string[]; on?: string; onDone: () => void }) {
  const [i, setI] = useState(0);
  const left = ids.slice(i).filter(id => T(id)?.status === 'open');
  const id = left[0];
  useEffect(() => { if (!id) onDone(); }, [!id]);
  if (!id) return null;
  return <MissedCard key={id} id={id} on={on} onNext={() => setI(ids.indexOf(id) + 1)} />;
}

/** Today's first fixed-time item that has passed, as one small card on Home and Today. Nothing when none has. */
export function MissedNow() {
  const id = missedOn(today.value)[0];
  return id ? <MissedCard key={id} id={id} onNext={() => {}} /> : null;
}

/** Yesterday's open steps, decided one at a time in a sheet of their own (Today's card and the bell open it). */
function CarriedSheet({ ids }: { ids: string[] }) {
  return (
    <div class="flow" data-testid="carried-sheet">
      <h3>{t('ciCarriedTitle')}</h3>
      <CarriedFlow ids={ids} k={today.value} release onDone={closeSheet} />
    </div>
  );
}
export function openCarried() {
  const ids = carriedOn(today.value);
  if (ids.length) openSheet(<CarriedSheet key={'cs' + Date.now()} ids={ids} />);
}
