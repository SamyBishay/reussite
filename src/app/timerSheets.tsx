// Sheets of the timer and of finishing a step: completing with its feedback, "Still on …?", done and how long it took, the duration picker, "I started earlier", sessions, pause.
import { useState } from 'preact/hooks';
import { settings, projects, today, toast, clockNow, hereZone } from './store';
import { T, addressesOn, rawPlan, planOf, cardsOn, spentOf, sessionsOf, personal, type T as Tk } from './model';
import { tasks } from './store';
import { patchTask, finishTask, stopTimer, startTask, addSession, editSession, deleteSession, type Finished } from './actions';
import { ConfirmButton } from './ConfirmButton';
import { closeSheet, openSheet } from './ui';
import { DayPick } from './due';
import { bigMoment, celebrate } from './celebrate';
import { t, fmtMin, fmtDate, type Key } from '../i18n';
import { durationButtons, splitWheel, WHEEL_HOURS, WHEEL_MINUTES } from '../domain/duration';
import { addDays } from '../domain/dates';
import { stillOnDue, minutesBetween } from '../domain/calendar';
import { validZone } from '../domain/zone';
import { openGoalDone } from './smart';
import { liveNextHeads } from '../domain/events';
import type { Session } from '../data/schema';
import { flows, hm, showMoment } from './sheetBase';
import { openTask } from './taskSheet';

// ---------- completing a step ----------
/** Done, with its feedback: proportional to the moment (a step, the day's last card, a project). */
export async function complete(tk: Tk, typed: number | null, day = today.value, minutes?: number): Promise<Finished> {
  const k = today.value;
  const isLast = day === k && rawPlan(k).includes(tk.id) && planOf(k).filter(id => id !== tk.id && T(id)?.status === 'open' && !T(id)?.fixed).length === 0
    && !liveNextHeads(tasks.value, tk.id).length; // a step it frees takes its place on the list, so the list is not played
  if (day === k) celebrate(isLast ? 'last' : 'step', tk.id, tk.suit, cardsOn(k).length + 1, isLast ? { title: t('listPlayed'), sub: t('allDone') } : undefined);
  const r = await finishTask(tk, typed, day, minutes);
  if (r.projectDone) {
    celebrate('project', null, tk.suit, 0);
    const name = projects.value.get(r.projectDone)?.name ?? '';
    // St George when celebrations are on (its words change if the last card's is already playing); else the banner.
    if (!bigMoment({ title: t('projectComplete'), sub: name })) showMoment('project', name);
  }
  if (r.nextId) { const nx = T(r.nextId); if (nx?.due) toast(t('repeatNext', { date: fmtDate(nx.due) })); }
  // A step that feeds an address asks how it was (skippable); nothing is written until the person answers.
  if (r.addressId && addressesOn()) flows.visit(r.addressId, { stepId: tk.id, day });
  // A step that moves its project's goal asks how much it added, or which milestone to tick (never over a finished project or an address's questions).
  else if (r.goal && !r.projectDone) openGoalDone(r.goal.projectId, tk.id, r.goal.kind);
  return r;
}

// ---------- the long timer ("Still on …?") ----------
/** A timer past twice the personal estimate (at least 45 min), or past the start of the next day (the push uses the same rule: `stillOnDue`). */
export function isLong(tk: Tk, now = clockNow.value): boolean {
  if (!tk.started) return false;
  return now >= stillOnDue(Date.parse(tk.started), Date.parse(tk.stillAt ?? '') || 0, personal(tk)?.value ?? tk.est, settings.value.dayStart, validZone(hereZone.value));
}

export function openStillOn(id: string, then: 'ask' | 'pause' | 'done') {
  openSheet(<StillOnSheet key={'still' + id} id={id} then={then} />);
}
function StillOnSheet({ id, then }: { id: string; then: 'ask' | 'pause' | 'done' }) {
  const tk = T(id);
  const [stopAt, setStopAt] = useState(false);
  const [clock, setClock] = useState('');
  if (!tk?.started) return null;
  const started = new Date(tk.started);
  const elapsed = Math.round((Date.now() - started.getTime()) / 60000);
  const save = (m: number) => {
    const min = Math.max(1, Math.min(elapsed, Math.round(m)));
    if (then === 'done') { closeSheet(); void complete(tk, null, today.value, min); }
    else if (then === 'pause') pauseTimer(id, min);
    else { closeSheet(); void stopTimer(tk, 'later', min); toast(t('timeFixed', { t: fmtMin(min) })); }
  };
  const going = () => {
    if (then === 'done') { closeSheet(); void complete(tk, null); }
    else if (then === 'pause') pauseTimer(id, undefined, true);
    else { closeSheet(); void patchTask(id, { stillAt: new Date().toISOString() }); }
  };
  const est = personal(tk)?.value ?? tk.est;
  return (
    <div data-testid="still-on">
      <h3>{t('stillOn', { title: tk.title })}</h3>
      <p class="hint">{t('stillOnHint', { at: hm(started), t: fmtMin(elapsed) })}</p>
      {!stopAt ? (
        <div class="actions">
          <button class="btn primary" type="button" onClick={going}>{then === 'ask' ? t('stillGoing') : t('workedAllAlong')}</button>
          <button class="btn" type="button" onClick={() => setStopAt(true)} data-testid="stopped-at">{t('stoppedAt')}</button>
        </div>
      ) : (
        <>
          <p class="field-label">{t('howLongReally')}</p>
          <div class="chips-pick">{durationButtons(est).filter(v => v < elapsed).map(v => <button type="button" data-testid="dur" onClick={() => save(v)}>{fmtMin(v)}</button>)}</div>
          <div class="field"><span>{t('orStoppedClock')}</span>
            <div class="row-inline">
              <input type="time" value={clock} onInput={e => setClock((e.target as HTMLInputElement).value)} aria-label={t('stoppedClock')} />
              <button class="btn small" type="button" disabled={!clock} onClick={() => save(minutesBetween(hm(started), clock))}>{t('saveTime')}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- done, and how long it took ----------
/** Done with a running timer saves its time (asking first if it ran long); without one, ask how long it took. */
export function openDone(id: string) {
  const tk = T(id);
  if (!tk) return;
  if (tk.started) {
    if (isLong(tk)) return openStillOn(id, 'done');
    closeSheet();
    void complete(tk, null);
    return;
  }
  // Time already logged is the card's time: finishing never asks for a duration (10 Nov).
  if (spentOf(id) > 0) { closeSheet(); void complete(tk, null); return; }
  openSheet(<DurationSheet key={id} tk={tk} />);
}

/** Quick buttons scaled to the personal estimate, and a wheel that starts there. */
export function DurationPicker({ base, onPick, saveLabel }: { base: number | null; onPick: (m: number) => void; saveLabel?: string }) {
  const w = splitWheel(base ?? 30);
  const [h, setH] = useState(w.h);
  const [m, setM] = useState(w.m);
  return (
    <>
      <div class="chips-pick" style="margin-top:var(--s4)">
        {durationButtons(base).map(v => <button type="button" data-testid="dur" onClick={() => onPick(v)}>{fmtMin(v)}</button>)}
      </div>
      <div class="field"><span>{t('orPick')}</span>
        <div class="wheel">
          <label class="field" style="margin:0"><span>{t('hoursLabel')}</span>
            <select value={String(h)} onChange={e => setH(Number((e.target as HTMLSelectElement).value))}>{WHEEL_HOURS.map(x => <option value={x}>{x}</option>)}</select>
          </label>
          <label class="field" style="margin:0"><span>{t('minutesLabel')}</span>
            <select value={String(m)} onChange={e => setM(Number((e.target as HTMLSelectElement).value))}>{WHEEL_MINUTES.map(x => <option value={x}>{String(x).padStart(2, '0')}</option>)}</select>
          </label>
          <button class="btn primary" type="button" disabled={h * 60 + m <= 0} onClick={() => onPick(h * 60 + m)}>{saveLabel ?? t('saveTime')}</button>
        </div>
      </div>
    </>
  );
}

export function DurationSheet({ tk, day }: { tk: Tk; day?: string }) {
  const p = personal(tk);
  const base = p?.value ?? tk.est ?? null;
  const done = (min: number | null) => { closeSheet(); void complete(tk, min, day ?? today.value); };
  return (
    <div>
      <h3>{t('howLong')}</h3>
      <p class="hint">{tk.est ? t('howLongHintEst', { t: fmtMin(tk.est) }) : t('howLongHint')}{day && day !== today.value ? ' ' + t('doneOnDay', { date: fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' }) }) : ''}</p>
      <DurationPicker base={base} onPick={done} />
      <div class="actions"><button class="btn ghost" type="button" onClick={() => done(null)}>{t('didntTime')}</button></div>
    </div>
  );
}

/** "Done on…": another day (quick pick: yesterday), then how long it took. */
export function openDoneOn(id: string) {
  const tk = T(id);
  if (!tk) return;
  const k = today.value;
  openSheet(
    <div key={'doneon' + id}>
      <h3>{t('doneOnTitle')}</h3>
      <p class="hint">{tk.title}</p>
      <DayPick value={null} extra={[[t('pickYesterday'), addDays(k, -1)], [t('pickDaysAgo', { n: 2 }), addDays(k, -2)], [t('pickToday'), k]]}
        onPick={d => { if (!d) return; if (spentOf(id) > 0) { closeSheet(); void complete(tk, null, d > k ? k : d); } else openSheet(<DurationSheet key={'dur' + id + d} tk={tk} day={d > k ? k : d} />); }} />
    </div>,
  );
}

// ---------- the timer: "I started earlier" ----------
export function openStartedEarlier(id: string) {
  const start = (m: number) => { closeSheet(); void startTask(id, new Date(Date.now() - m * 60000)); toast(t('startedAgo', { t: fmtMin(m) })); };
  openSheet(
    <div key={'early' + id}>
      <h3>{t('startedEarlier')}</h3>
      <p class="hint">{t('startedEarlierHint')}</p>
      <div class="chips-pick" style="margin-top:var(--s4)">{[5, 10, 15, 30].map(m => <button type="button" onClick={() => start(m)}>{t('minAgo', { n: m })}</button>)}</div>
      <DurationPicker base={45} onPick={start} saveLabel={t('startedThen')} />
    </div>,
  );
}

// ---------- sessions ----------
const WHY_ALL: [string, Key][] = [['done', 'whyDone'], ['later', 'whyLater'], ['focus', 'whyFocus'], ['blocked', 'whyBlocked'], ['interrupted', 'whyInterrupted'], ['tired', 'whyTired'], ['switched', 'whySwitched'], ['close', 'whyClose']];
const SOURCE_KEY: Record<string, Key> = { timer: 'srcTimer', corrected: 'srcCorrected', typed: 'srcTyped' };

export function Sessions({ tk }: { tk: Tk }) {
  const ss = sessionsOf(tk.id);
  return (
    <div class="field" data-testid="sessions"><span>{t('sessionsTitle')}</span>
      {ss.length ? (
        <ul class="sesslist">{ss.map(s => (
          <li>
            <span class="n">{fmtDate(s.d)}</span><span class="n">{fmtMin(s.m)}</span>
            <span class="why">{WHY_ALL.find(w => w[0] === s.why)?.[1] ? t(WHY_ALL.find(w => w[0] === s.why)![1]) : ''} <small class="muted">{t(SOURCE_KEY[s.source] ?? 'srcTyped')}</small></span>
            <button class="btn small ghost" type="button" onClick={() => openSession(tk.id, s.id)}>{t('edit')}</button>
          </li>
        ))}</ul>
      ) : <p class="hint">{t('noSessions')}</p>}
      <div><button class="btn small" type="button" onClick={() => openSession(tk.id, null)}>{t('addTime')}</button></div>
    </div>
  );
}

export function openSession(taskId: string, sessionId: string | null) {
  openSheet(<SessionSheet key={'sess' + taskId + sessionId} taskId={taskId} sessionId={sessionId} />);
}
function SessionSheet({ taskId, sessionId }: { taskId: string; sessionId: string | null }) {
  const tk = T(taskId);
  const s = sessionId ? sessionsOf(taskId).find(x => x.id === sessionId) : undefined;
  const [d, setD] = useState(s?.d ?? today.value);
  const [why, setWhy] = useState(s?.why ?? 'done');
  if (!tk) return null;
  const back = () => openTask(taskId);
  const save = async (m: number) => {
    if (s) await editSession(s.id, { d, m, why } as Partial<Session>);
    else await addSession(taskId, m, why, 'typed', d);
    back();
  };
  return (
    <div>
      <h3>{s ? t('editSession') : t('addTime')}</h3>
      <p class="hint">{tk.title}</p>
      <div class="row2">
        <label class="field"><span>{t('day')}</span><input type="date" value={d} onInput={e => setD((e.target as HTMLInputElement).value || today.value)} /></label>
        <label class="field"><span>{t('stoppedBecause')}</span>
          <select value={why ?? 'done'} onChange={e => setWhy((e.target as HTMLSelectElement).value)}>{WHY_ALL.map(([v, k]) => <option value={v}>{t(k)}</option>)}</select>
        </label>
      </div>
      {s && <p class="hint" style="margin-top:var(--s2)">{t('nowRecorded', { t: fmtMin(s.m) })}</p>}
      <DurationPicker base={s?.m ?? personal(tk)?.value ?? tk.est ?? null} onPick={m => void save(m)} />
      <div class="actions">
        <button class="btn ghost" type="button" onClick={back}>{t('back')}</button>
        {s && <ConfirmButton cls="btn ghost" label={t('deleteSession')} confirmLabel={t('deleteAgain')} onConfirm={() => deleteSession(s.id).then(back)} />}
      </div>
    </div>
  );
}

// ---------- pause ----------
/** Pause is one tap (10 Nov): the timer stops at once, the session is logged with no reason and the card keeps its resume note. A long-running timer first asks "Still on…?". */
export function pauseTimer(id: string, minutes?: number, checked = false) {
  const tk = T(id);
  if (!tk) return;
  if (tk.started && minutes == null && !checked && isLong(tk)) return openStillOn(id, 'pause');
  closeSheet();
  if (tk.started) { void stopTimer(tk, null, minutes); toast(minutes != null ? t('pausedWith', { t: fmtMin(minutes) }) : t('paused')); }
}
