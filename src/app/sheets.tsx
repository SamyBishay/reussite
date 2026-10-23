// Bottom sheets: the task sheet, done and "how long did it take?", sessions, timer fixes,
// moving a step, pause, swap, pick, suit piles.
import { useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { settings, projects, today, places, toast, stays, clockNow, update, hereZone, here } from './store';
import { T, addressesOn, addressesIn, peopleIn, addressById, personById, rawPlan, planOf, cardsOn, candidates, whereOf, urgent, minutesOnFor, spentOf, byOrder, inPlace, sessionsOf, personal, isOpen, quad, type T as Tk } from './model';
import { tasks } from './store';
import {
  patchTask, finishTask, stopTimer, addToday, addByHand, removeToday, movePlan, cloneTemplate, dropTask, reopen, setFirst, startTask, addSession, editSession,
  deleteSession, skipThisTime, stopRepeating, addPlace, planOn, dueOn, moveDone, syncDueRules, createTask, newTaskDoc, type Finished,
} from './actions';
import { closeSheet, openSheet, Title, Meta, Suit, suitName, GoLink, quadName, basisLine, learningLine } from './ui';
import { DayPick } from './due';
import { bigMoment, celebrate } from './celebrate';
import { t, fmtMin, fmtDate, lang, type Key } from '../i18n';
import { durationButtons, splitWheel, WHEEL_HOURS, WHEEL_MINUTES } from '../domain/duration';
import { addDays, daysBetween } from '../domain/dates';
import { isAllowedLink } from '../domain/links';
import { moveTo, firstCalmDay } from '../domain/moves';
import { stillOnDue, minutesBetween } from '../domain/calendar';
import { validZone } from '../domain/zone';
import { findTime } from '../domain/parse';
import { deriveLabel } from '../domain/label';
import { nextHeads } from '../domain/chains';
import { dueBeforeEnd, isArea } from '../domain/places';
import { placePath, placeRows } from '../domain/areas';
import { SUIT_ORDER } from '../data/settings';
import { OfferChips, offerFieldsFor, type OfferChoice } from './OfferChips';
import type { Project, Repeat, Session, Task } from '../data/schema';
import type { Quadrant } from '../domain/tasks';

const rankOf = (n: number) => (n <= 0 ? '' : n <= 13 ? ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][n]! : 'K+');
export { rankOf };

/** A place's name; an area's as "Cairo › Heliopolis". */
export const placeName = (id: string) => (id === 'any' ? t('anywhere') : placePath(places.value, id));
/** An area's own name, for a heading or a tag next to its place. */
export const areaName = (id: string) => places.value.get(id)?.name ?? id;
/** Every place and area, a place followed by its areas (the order of a select). */
export const placeIds = () => placeRows(places.value).map(r => r.id);
const hm = (d: Date) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

/** A short-lived banner for the biggest moments (a finished project, a decision made). */
export const moment = signal<{ kind: 'project' | 'decision'; name: string } | null>(null);
let momentTimer = 0;
export function showMoment(kind: 'project' | 'decision', name: string) {
  moment.value = { kind, name };
  clearTimeout(momentTimer);
  momentTimer = window.setTimeout(() => (moment.value = null), 2600);
}

// ---------- completing a step ----------
/** Done, with its feedback: proportional to the moment (a step, the day's last card, a project). */
export async function complete(tk: Tk, typed: number | null, day = today.value, minutes?: number): Promise<Finished> {
  const k = today.value;
  const isLast = day === k && rawPlan(k).includes(tk.id) && planOf(k).filter(id => id !== tk.id && T(id)?.status === 'open' && !T(id)?.fixed).length === 0
    && !nextHeads(tasks.value, tk.id).length; // a step it frees takes its place on the list, so the list is not played
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
    else if (then === 'pause') openPause(id, min);
    else { closeSheet(); void stopTimer(tk, 'later', null, min); toast(t('timeFixed', { t: fmtMin(min) })); }
  };
  const going = () => {
    if (then === 'done') { closeSheet(); void complete(tk, null); }
    else if (then === 'pause') openPause(id, undefined, true);
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
        onPick={d => d && openSheet(<DurationSheet key={'dur' + id + d} tk={tk} day={d > k ? k : d} />)} />
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

function Sessions({ tk }: { tk: Tk }) {
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
  const [armed, setArmed] = useState(false);
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
        {s && <button class="btn ghost" type="button" onClick={() => { if (!armed) return setArmed(true); void deleteSession(s.id).then(back); }}>{armed ? t('deleteAgain') : t('deleteSession')}</button>}
      </div>
    </div>
  );
}

/** The places for a select: each followed by its areas, indented ("Cairo › Heliopolis"), then Anywhere. */
export const placeOptions = () => [
  ...placeRows(places.value).map(r => <option value={r.id}>{(r.area ? '\u00a0\u00a0\u00a0' : '') + placeName(r.id)}</option>),
  <option value="any">{placeName('any')}</option>,
];

// ---------- place field (a new name creates the place) ----------
export function PlaceSelect({ value, onChange, name }: { value: string; onChange: (v: string) => void; name?: string }) {
  const [adding, setAdding] = useState(false);
  const [txt, setTxt] = useState('');
  if (adding) {
    const add = async () => { if (!txt.trim()) return; const id = await addPlace(txt); onChange(id); setAdding(false); setTxt(''); };
    return (
      <div class="row-inline">
        <input type="text" value={txt} placeholder={t('newPlaceName')} aria-label={t('newPlaceName')} onInput={e => setTxt((e.target as HTMLInputElement).value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} autoFocus />
        <button class="btn small" type="button" onClick={() => void add()}>{t('add')}</button>
      </div>
    );
  }
  return (
    <select name={name} value={value} onChange={e => { const v = (e.target as HTMLSelectElement).value; if (v === '__new') setAdding(true); else onChange(v); }}>
      {placeOptions()}
      <option value="__new">{t('newPlaceOption')}</option>
    </select>
  );
}

// ---------- the task sheet ----------
/** `moveMode` 'calendar': from the Calendar, the sheet's Move to… offers "Plan it on…" and "Due on…" in place of the quadrants. */
export function openTask(id: string, moveMode: 'matrix' | 'calendar' = 'matrix') {
  openSheet(<TaskSheet key={id + Date.now()} id={id} moveMode={moveMode} />);
}
/** A new step in the task sheet, filled from `prefill`. Nothing is written until Save; then `onSaved` gets the new id. */
export function openNewTask(prefill: Partial<Task> = {}, onSaved?: (id: string) => void) {
  const { title = '', suit = null, project = null, ...extra } = prefill;
  openSheet(<TaskForm key={'new' + Date.now()} tk={{ ...newTaskDoc(title, suit, project, extra), id: '' }} draft onSaved={onSaved} />);
}

const REPEAT_KINDS = ['never', 'day', 'week', 'month', 'custom'] as const;
type RepeatKind = (typeof REPEAT_KINDS)[number];
const kindOf = (r: Repeat | null | undefined): RepeatKind => (!r ? 'never' : r.every === 1 ? r.unit : 'custom');

/** ISO weekdays 1–7 with their short names in the app's language. */
export const weekdayNames = (): [number, string][] => [1, 2, 3, 4, 5, 6, 7].map(d => [d, new Date(Date.UTC(2026, 9, 4 + d)).toLocaleDateString(lang.value === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'short', timeZone: 'UTC' })]);

function RepeatField({ value, onChange }: { value: Repeat | null; onChange: (r: Repeat | null) => void }) {
  const kind = kindOf(value);
  const r: Repeat = value ?? { every: 1, unit: 'week', from: 'due' };
  const set = (p: Partial<Repeat>) => onChange({ ...r, ...p });
  const DOW = weekdayNames();
  return (
    <div class="field" data-testid="repeat"><span>{t('repeats')}</span>
      <select value={kind} onChange={e => {
        const k = (e.target as HTMLSelectElement).value as RepeatKind;
        if (k === 'never') onChange(null);
        else if (k === 'custom') onChange({ ...r, every: Math.max(2, r.every) });
        else onChange({ ...r, every: 1, unit: k });
      }}>
        {REPEAT_KINDS.map(k => <option value={k}>{t(('rep_' + k) as Key)}</option>)}
      </select>
      {value && (
        <div class="repeat-box">
          {kind === 'custom' && (
            <div class="row2">
              <label class="field"><span>{t('repEvery')}</span><input type="number" min="2" max="99" value={r.every} onChange={e => set({ every: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })} /></label>
              <label class="field"><span>{t('repUnit')}</span>
                <select value={r.unit} onChange={e => set({ unit: (e.target as HTMLSelectElement).value as Repeat['unit'] })}>
                  <option value="day">{t('repDays')}</option><option value="week">{t('repWeeks')}</option><option value="month">{t('repMonths')}</option>
                </select>
              </label>
            </div>
          )}
          {r.unit === 'week' && (
            <div class="toggles" style="margin-top:var(--s3)" role="group" aria-label={t('repOnDays')}>
              {DOW.map(([d, name]) => <label class="tog small"><input type="checkbox" checked={!!r.weekdays?.includes(d)} onChange={e => set({ weekdays: (e.target as HTMLInputElement).checked ? [...(r.weekdays ?? []), d].sort() : (r.weekdays ?? []).filter(x => x !== d) })} /> {name}</label>)}
            </div>
          )}
          {r.unit === 'month' && <label class="field"><span>{t('repMonthDay')}</span><input type="number" min="1" max="31" value={r.monthDay ?? ''} onChange={e => set({ monthDay: Number((e.target as HTMLInputElement).value) || undefined })} /></label>}
          <div class="seg" role="group" aria-label={t('repFrom')} style="margin-top:var(--s3);flex-wrap:wrap">
            <button type="button" aria-pressed={r.from === 'due'} onClick={() => set({ from: 'due' })}>{t('repFromDue')}</button>
            <button type="button" aria-pressed={r.from === 'done'} onClick={() => set({ from: 'done' })}>{t('repFromDone')}</button>
          </div>
          <label class="field"><span>{t('repUntil')}</span><input type="date" value={r.until ?? ''} onChange={e => set({ until: (e.target as HTMLInputElement).value || null })} /></label>
        </div>
      )}
    </div>
  );
}

/** Waits for: pick other steps, with search. */
function AfterField({ id, value, onChange }: { id: string; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const found = open ? [...tasks.value.values()].filter(x => x.id !== id && x.status === 'open' && !x.template && !value.includes(x.id) && (!q || x.title.toLowerCase().includes(q.toLowerCase()))).sort(byOrder).slice(0, 8) : [];
  return (
    <div class="field"><span>{t('waitsForField')}</span>
      {value.length > 0 && <ul class="mini">{value.map(x => <li><span>{T(x)?.title ?? x}</span><button type="button" class="chip-x" onClick={() => onChange(value.filter(y => y !== x))} aria-label={t('remove', { what: T(x)?.title ?? x })}>×</button></li>)}</ul>}
      {open ? (
        <>
          <input type="text" value={q} placeholder={t('searchSteps')} aria-label={t('searchSteps')} onInput={e => setQ((e.target as HTMLInputElement).value)} />
          <ul class="mini pickable">{found.map(x => <li><button type="button" class="linklike" onClick={() => { onChange([...value, x.id]); setQ(''); }}><Title s={x.title} /></button></li>)}</ul>
        </>
      ) : <div><button class="btn small" type="button" onClick={() => setOpen(true)}>{t('addWaitsFor')}</button></div>}
    </div>
  );
}

/** "Goes to": the address or the person this step feeds, from the lists of its place (and Anywhere). A link to one that is gone stays selectable. */
function FeedsField({ where, value, onChange, onWhere }: { where: string; value: string; onChange: (v: string) => void; onWhere: (v: string) => void }) {
  // A step marked Anywhere takes the lists of where the person is now (and Anywhere's own).
  const place = where === 'any' ? here.value : where;
  const addrs = addressesIn(place), folks = peopleIn(place);
  const gone = value && !addrs.some(a => 'a:' + a.id === value) && !folks.some(p => 'p:' + p.id === value);
  const goneName = value.startsWith('a:') ? addressById(value.slice(2))?.name : personById(value.slice(2))?.name;
  if (!addrs.length && !folks.length && !value) return null;
  // A step that goes to a person in an area can take the area too, if the person says so: offered, never forced.
  const who = value.startsWith('p:') ? personById(value.slice(2)) : undefined;
  const theirs = who && who.placeId !== where && isArea(places.value, who.placeId) ? who : null;
  return (
    <>
    <label class="field"><span>{t('feedsField')}</span>
      <select value={value} onChange={e => onChange((e.target as HTMLSelectElement).value)} data-testid="feeds-select">
        <option value="">—</option>
        {gone && <option value={value}>{goneName ?? t('feedsGone')}</option>}
        {addrs.length > 0 && <optgroup label={t('addrSection')}>{addrs.map(a => <option value={'a:' + a.id}>{a.name}</option>)}</optgroup>}
        {folks.length > 0 && <optgroup label={t('peopleSection')}>{folks.map(p => <option value={'p:' + p.id}>{p.name}</option>)}</optgroup>}
      </select>
    </label>
    {theirs && <p class="hint"><button class="btn small" type="button" data-testid="use-person-area" onClick={() => onWhere(theirs.placeId)}>{t('useAreaOf', { place: placeName(theirs.placeId), name: theirs.name })}</button></p>}
    </>
  );
}

function TaskSheet({ id, moveMode }: { id: string; moveMode: 'matrix' | 'calendar' }) {
  const tk = T(id);
  return tk ? <TaskForm tk={tk} moveMode={moveMode} /> : null;
}

/** The sheet's body. A `draft` is a step not yet written: the same form, and Save creates it. */
function TaskForm({ tk, draft = false, onSaved, moveMode = 'matrix' }: { tk: Tk; draft?: boolean; onSaved?: (id: string) => void; moveMode?: 'matrix' | 'calendar' }) {
  const id = tk.id;
  const [armed, setArmed] = useState(false);
  const [estV, setEstV] = useState(tk.est ? String(tk.est) : '');
  const [where, setWhere] = useState(whereOf(tk));
  const [after, setAfter] = useState<string[]>(Array.isArray(tk.after) ? tk.after : tk.after ? [String(tk.after)] : []);
  const [repeat, setRepeat] = useState<Repeat | null>(tk.repeat ?? null);
  const [rule, setRule] = useState(tk.dueRule ?? null);
  const [weekdays, setWeekdays] = useState<number[]>(tk.weekdays ?? []);
  const [ask, setAsk] = useState<Partial<Task> | null>(null);
  const [err, setErr] = useState('');
  // What the step feeds (Addresses and people): one address or one person, picked from its place's lists.
  const [feed, setFeed] = useState(tk.addressId ? 'a:' + tk.addressId : tk.personId ? 'p:' + tk.personId : '');
  const feedOn = addressesOn();
  // A time written in the title or the note, with no fixed time set: offer to set it.
  const [titleV, setTitleV] = useState(tk.title);
  const [noteV, setNoteV] = useState(tk.note || '');
  const [atV, setAtV] = useState(tk.at ?? '');
  const [timeOpen, setTimeOpen] = useState(!!tk.at);
  const seen = atV ? null : findTime(titleV) ?? findTime(noteV);
  const inPlan = !draft && rawPlan(today.value).includes(id);
  const projs = [...projects.value.values()].filter(p => p.status !== 'dropped').sort((a, b) => SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) || byOrder(a, b));
  const hint: Key = tk.kind === 'decision' ? 'hintDecision' : tk.template ? 'hintStanding' : 'hintStep';
  const spent = spentOf(id);
  const open = tk.status === 'open';
  const typed = Number(estV) || null;
  const pe = typed ? personal({ ...tk, est: typed }) : null;
  const stayList = [...stays.value.values()].filter(s => s.to >= today.value).sort((a, b) => a.from.localeCompare(b.from));

  const write = (p: Partial<Task>) => {
    closeSheet();
    if (draft) {
      const { id: _none, ...fields } = { ...tk, ...p };
      void createTask(fields).then(nid => { if (fields.dueRule) void syncDueRules(fields.dueRule.beforeEndOf); onSaved?.(nid); });
      toast(t('saved'));
    } else if (Object.keys(p).length) {
      void patchTask(id, p).then(() => { if (p.dueRule) void syncDueRules(p.dueRule.beforeEndOf); });
      toast(t('saved'));
    }
  };
  const submit = (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const el = (n: string) => f.elements.namedItem(n) as HTMLInputElement | null;
    const v = (n: string) => el(n)?.value ?? '';
    const c = (n: string) => !!el(n)?.checked;
    const p: Partial<Task> = {};
    const setIf = <K extends keyof Task>(k: K, val: Task[K], cur: unknown) => { if (JSON.stringify(val ?? null) !== JSON.stringify(cur ?? null)) p[k] = val; };
    const title = v('title').trim();
    if (title) setIf('title', title, tk.title);
    setIf('starter', v('starter').trim() || null, tk.starter);
    // The short name calendars show; empty clears it (one is then derived from the title).
    if (v('label').trim() !== (tk.label ?? '').trim()) p.label = v('label').trim();
    setIf('urgent', c('urgent'), !!tk.urgent);
    setIf('important', c('important'), !!tk.important);
    if (!rule) setIf('due', v('due') || null, tk.due);
    setIf('suit', v('suit') as Task['suit'], tk.suit);
    if (where !== whereOf(tk)) p.where = where;
    if (v('project')) setIf('project', v('project'), tk.project);
    if (feedOn) {
      setIf('addressId', feed.startsWith('a:') ? feed.slice(2) : null, tk.addressId);
      setIf('personId', feed.startsWith('p:') ? feed.slice(2) : null, tk.personId);
    }
    if (el('offer')) setIf('offer', (v('offer') || null) as Task['offer'], tk.offer);
    setIf('note', v('note'), tk.note || '');
    if (el('kind')) setIf('kind', v('kind') as Task['kind'], tk.kind);
    if (el('template')) setIf('template', c('template'), !!tk.template);
    if (el('app')) setIf('app', v('app').trim() || null, tk.app);
    if (el('link')) {
      const link = v('link').trim() || null;
      if (link && !isAllowedLink(link)) { setErr(t('linkRefused')); return; }
      setIf('link', link, tk.link);
    }
    if (el('prompt')) setIf('prompt', v('prompt').trim() || null, tk.prompt);
    if (el('at')) {
      setIf('at', v('at') || null, tk.at);
      // Length and lead are only asked once there is a time; without one they are left as they were.
      if (el('dur')) setIf('dur', Number(v('dur')) || null, tk.dur);
      // Empty = the default from Settings; 0 = notified at the time itself.
      if (el('lead')) setIf('lead', v('lead').trim() === '' ? null : Math.max(0, Math.min(240, Math.round(Number(v('lead')) || 0))), tk.lead);
      setIf('weekdays', tk.template && weekdays.length ? [...weekdays].sort() : null, tk.weekdays);
    }
    setIf('repeat', repeat, tk.repeat);
    setIf('after', after.length ? after : null, Array.isArray(tk.after) ? tk.after : tk.after ? [tk.after] : null);
    setIf('dueRule', rule, tk.dueRule);
    if (rule) { const s = stays.value.get(rule.beforeEndOf); if (s) setIf('due', dueBeforeEnd(s, rule.daysBefore), tk.due); }
    const est = Number(v('est')) || null;
    if (est !== (tk.est || null)) {
      p.est = est;
      p.estBy = est ? 'me' : null;
      // Once a session exists the first estimate is frozen: was it a slip? (brief §5)
      if (est && tk.est0 != null && sessionsOf(id).length > 0) { setAsk(p); return; }
    }
    write(p);
  };
  const copy = () => {
    try { navigator.clipboard.writeText(tk.prompt ?? '').then(() => toast(t('promptCopied')), () => toast(t('copyBlocked'))); } catch { toast(t('copyBlocked')); }
  };

  if (ask) return (
    <div data-testid="slip">
      <h3>{t('slipTitle')}</h3>
      <p class="hint">{t('slipHint', { a: fmtMin(tk.est0 ?? 0), b: fmtMin(ask.est ?? 0) })}</p>
      <div class="actions">
        <button class="btn" type="button" onClick={() => write({ ...ask, est0: ask.est ?? null })}>{t('slipYes')}</button>
        <button class="btn primary" type="button" onClick={() => write(ask)}>{t('slipNo', { b: fmtMin(ask.est ?? 0) })}</button>
      </div>
    </div>
  );

  return (
    <form onSubmit={submit} data-testid="task-sheet">
      <h3><Title s={tk.title} /></h3>
      <p class="hint">{t(hint)}</p>
      <div class="actionbar" data-testid="task-actions">
        <button class="btn small primary" type="submit">{t('save')}</button>
        {draft ? null : tk.template ? (
          <button class="btn small" type="button" onClick={() => { void cloneTemplate(id); closeSheet(); }}>{t('addToToday')}</button>
        ) : open ? (
          <>
            {inPlan
              ? <button class="btn small" type="button" onClick={() => { void removeToday(id); closeSheet(); }}>{t('takeOffToday')}</button>
              : <button class="btn small" type="button" onClick={() => { void addByHand(id); closeSheet(); }}>{t('addToToday')}</button>}
            <button class="btn small" type="button" onClick={() => openDone(id)}>{t('markDone')}</button>
            <button class="btn small" type="button" onClick={() => openDoneOn(id)}>{t('doneOn')}</button>
          </>
        ) : (
          <button class="btn small" type="button" onClick={() => { void reopen(id); closeSheet(); }}>{t('reopen')}</button>
        )}
        {inPlan && open && (
          <>
            <button class="btn small" type="button" onClick={() => { void movePlan(id, -1); closeSheet(); }}>{t('earlier')}</button>
            <button class="btn small" type="button" onClick={() => { void movePlan(id, 1); closeSheet(); }}>{t('later')}</button>
          </>
        )}
        {open && !tk.template && !draft && (
          <>
            <button class="btn small" type="button" onClick={() => openMove(id, moveMode)}>{t('moveTo')}</button>
            <button class="btn small" type="button" onClick={() => flows.breakDown(id)}>{t('breakItDown')}</button>
            {tk.kind === 'decision' && <button class="btn small" type="button" onClick={() => flows.decide(null, { taskId: id })}>{t('openDecision')}</button>}
            {tk.repeat && <button class="btn small" type="button" onClick={() => { void skipThisTime(id); closeSheet(); toast(t('skipped')); }}>{t('skipThisTime')}</button>}
            {tk.repeat && <button class="btn small ghost" type="button" onClick={() => { void stopRepeating(id); closeSheet(); }}>{t('stopRepeating')}</button>}
          </>
        )}
        {tk.status !== 'dropped' && !draft && (
          <button class="btn ghost small" type="button" onClick={() => { if (!armed) return setArmed(true); void dropTask(id); closeSheet(); toast(t('dropped')); }}>
            {armed ? t('dropAgain') : tk.repeat ? t('dropSeries') : t('dropIt')}
          </button>
        )}
      </div>
      <div class="titlerow">
        <label class="field"><span>{t('stepField')}</span><input type="text" name="title" defaultValue={tk.title} required onInput={e => setTitleV((e.target as HTMLInputElement).value)} /></label>
        <button type="button" class={'btn small chip' + (atV ? ' on' : '')} aria-expanded={timeOpen} onClick={() => setTimeOpen(!timeOpen)} data-testid="time-chip">{atV || t('timeChip')}</button>
      </div>
      <label class="field"><span>{t('labelField')}</span><input type="text" name="label" defaultValue={tk.label ?? ''} placeholder={deriveLabel(titleV, tk.starter)} autocomplete="off" data-testid="label" /></label>
      <p class="hint">{t('labelHint')}</p>
      <div class="timebox" hidden={!timeOpen}>
        <label class="field"><span>{t('atField')}</span><input type="time" name="at" value={atV} onInput={e => setAtV((e.target as HTMLInputElement).value)} /></label>
        {atV && (
          <>
            <div class="row2">
              <label class="field"><span>{t('durField')}</span><input type="number" name="dur" min="5" max="720" inputMode="numeric" defaultValue={tk.dur ? String(tk.dur) : ''} /></label>
              <label class="field"><span>{t('leadField')}</span><input type="number" name="lead" min="0" max="240" inputMode="numeric" defaultValue={tk.lead != null ? String(tk.lead) : ''} placeholder={String(settings.value.notifyLead)} data-testid="lead" /></label>
            </div>
            <p class="hint">{t('leadHint', { n: settings.value.notifyLead })}</p>
          </>
        )}
      </div>
      {seen && <p class="hint"><button class="btn small" type="button" data-testid="set-time" onClick={() => { setAtV(seen.at); setTimeOpen(true); }}>{t('setTimeHint', { t: seen.at })}</button></p>}
      <label class="field"><span>{t('starterField')}</span><input type="text" name="starter" defaultValue={tk.starter ?? ''} placeholder={t('starterPh')} autocomplete="off" /></label>
      <div class="field"><span>{t('urgImp')}</span>
        <div class="toggles">
          <label class="tog"><input type="checkbox" name="urgent" defaultChecked={!!tk.urgent} /> {t('urgentLabel')}</label>
          <label class="tog"><input type="checkbox" name="important" defaultChecked={!!tk.important} /> {t('importantLabel')}</label>
        </div>
        {tk.due && !tk.urgent && urgent(tk) && <p class="hint">{t('urgentAnyway')}</p>}
      </div>
      <div class="row2">
        <label class="field"><span>{t('estimateField')}</span><input type="number" name="est" min="1" max="600" inputMode="numeric" value={estV} onInput={e => setEstV((e.target as HTMLInputElement).value)} /></label>
        <label class="field"><span>{t('dueField')}</span><input type="date" name="due" defaultValue={tk.due ?? ''} disabled={!!rule} /></label>
      </div>
      {typed && open && <p class="hint pe" data-testid="personal">{pe && pe.value !== typed ? t('estUsually', { a: fmtMin(typed), b: fmtMin(pe.value), lo: fmtMin(pe.lo), hi: fmtMin(pe.hi) }) + ' · ' + basisLine({ ...tk, est: typed }) : pe ? basisLine({ ...tk, est: typed }) : learningLine()}</p>}
      <div class="row2">
        <label class="field"><span>{t('suit')}</span>
          <select name="suit" defaultValue={tk.suit}>{SUIT_ORDER.map(s => <option value={s}>{settings.value.suits[s].glyph} {suitName(s, true)}</option>)}</select>
        </label>
        <label class="field"><span>{t('where')}</span><PlaceSelect value={where} onChange={setWhere} /></label>
      </div>
      <label class="field"><span>{t('project')}</span>
        <select name="project" defaultValue={tk.project}>{projs.map(p => <option value={p.id}>{(settings.value.suits[p.suit]?.glyph ?? '') + ' ' + p.name}</option>)}</select>
      </label>
      {feedOn && !tk.template && <FeedsField where={where} value={feed} onChange={setFeed} onWhere={setWhere} />}
      {tk.prompt && <div class="actions" style="margin-top:var(--s2)"><button class="btn small" type="button" onClick={copy}>{t('copyPrompt')}</button><GoLink tk={tk} variant="small" /></div>}
      {!tk.prompt && <div class="actions" style="margin-top:var(--s3)"><GoLink tk={tk} variant="small" /></div>}
      <label class="field"><span>{t('note')}</span><textarea name="note" defaultValue={tk.note || ''} onInput={e => setNoteV((e.target as HTMLTextAreaElement).value)} /></label>
      <details class="more" open={!!(tk.repeat || tk.at || tk.dueRule || tk.weekdays?.length || after.length)}>
        <summary>{t('moreFields')}</summary>
        <div class="row2">
          <label class="field"><span>{t('kindField')}</span>
            <select name="kind" defaultValue={tk.kind}><option value="task">{t('kindTask')}</option><option value="decision">{t('kindDecision')}</option></select>
          </label>
          <div class="field"><span>{t('standingField')}</span><label class="tog"><input type="checkbox" name="template" defaultChecked={!!tk.template} /> {t('standingLabel')}</label></div>
        </div>
        {feedOn && tk.template && (
          <label class="field"><span>{t('offerField')}</span>
            <select name="offer" defaultValue={tk.offer ?? ''} data-testid="offer">
              <option value="">{t('offerNone')}</option><option value="address">{t('offerAddress')}</option><option value="person">{t('offerPerson')}</option>
            </select>
            <small class="hint">{t('offerHint')}</small>
          </label>
        )}
        <AfterField id={id} value={after} onChange={setAfter} />
        <div class="row2">
          <label class="field"><span>{t('appField')}</span><input type="text" name="app" defaultValue={tk.app ?? ''} placeholder="Mail, WhatsApp…" autocomplete="off" /></label>
          <label class="field"><span>{t('linkField')}</span><input type="text" name="link" inputMode="url" defaultValue={tk.link ?? ''} placeholder="https://…" autocomplete="off" /></label>
        </div>
        {err && <p class="err">{err}</p>}
        <label class="field"><span>{t('promptField')}</span><textarea name="prompt" defaultValue={tk.prompt ?? ''} /></label>
        <RepeatField value={repeat} onChange={setRepeat} />
        {tk.template && (
          <div class="field" data-testid="weekdays"><span>{t('weekdaysField')}</span>
            <div class="toggles">{weekdayNames().map(([d, name]) => <label class="tog small"><input type="checkbox" checked={weekdays.includes(d)} onChange={e => setWeekdays((e.target as HTMLInputElement).checked ? [...weekdays, d].sort() : weekdays.filter(x => x !== d))} /> {name}</label>)}</div>
            <p class="hint">{t('weekdaysHint')}</p>
          </div>
        )}
        {stayList.length > 0 && (
          <div class="field"><span>{t('beforeLeave')}</span>
            <div class="row2">
              <select aria-label={t('beforeLeave')} value={rule?.beforeEndOf ?? ''} onChange={e => { const v = (e.target as HTMLSelectElement).value; setRule(v ? { beforeEndOf: v, daysBefore: rule?.daysBefore ?? 1 } : null); }}>
                <option value="">—</option>
                {stayList.map(s => <option value={s.id}>{placeName(s.placeId)} · {fmtDate(s.from)}–{fmtDate(s.to)}</option>)}
              </select>
              {rule && <label class="row-inline"><input type="number" min="0" max="30" value={rule.daysBefore} aria-label={t('daysBefore')} onChange={e => setRule({ ...rule, daysBefore: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })} /><span class="hint">{t('daysBefore')}</span></label>}
            </div>
          </div>
        )}
      </details>
      {tk.status === 'done' && tk.doneDay && (
        <label class="field"><span>{t('doneOnField')}</span>
          <input type="date" defaultValue={tk.doneDay} onChange={e => { const v = (e.target as HTMLInputElement).value; if (v) void moveDone(id, v); }} data-testid="done-day" />
        </label>
      )}
      {(spent > 0 || sessionsOf(id).length > 0 || tk.status === 'done') && <Sessions tk={tk} />}
      {spent > 0 && <p class="hint" style="margin-top:var(--s3)">{tk.est ? t('timedAgainst', { t: fmtMin(spent), e: fmtMin(tk.est0 ?? tk.est) }) : t('timedOnly', { t: fmtMin(spent) })}</p>}
    </form>
  );
}

/** Flows open from sheets; they register here to keep imports one-way. */
export const flows = {
  breakDown: (_id: string) => {},
  decide: (_decisionId: string | null, _link?: { taskId?: string; projectId?: string }) => {},
  stuck: (_id?: string) => {},
  /** The after-visit screen (Addresses and people). */
  visit: (_addressId: string, _o: { stepId: string; day: string }) => {},
};

// ---------- moving a step ----------
/** Matrix: to another quadrant. Calendar: plan it on a day, or make a day its due date. */
export function openMove(id: string, mode: 'matrix' | 'calendar' = 'matrix') {
  openSheet(<MoveSheet key={'move' + id + mode} id={id} mode={mode} />);
}
/** Drop on a quadrant: move at once, or ask the one question the move needs. */
export function moveToQuadrant(id: string, q: Quadrant) {
  const tk = T(id);
  if (!tk || (isOpen(tk) && quad(tk) === q)) return;
  const m = moveTo(tk, q, today.value, settings.value.urgencyDays);
  if (!m.ask) { void patchTask(id, m.patch); toast(t('movedTo', { q: quadName(q) })); return; }
  openSheet(<MoveSheet key={'move' + id + q} id={id} mode="matrix" initial={{ q, ask: m.ask, patch: m.patch }} />);
}
type Pending = { q: Quadrant; ask: 'dueOrBlocker' | 'newDue'; patch: Partial<Task> };
function MoveSheet({ id, mode, initial }: { id: string; mode: 'matrix' | 'calendar'; initial?: Pending }) {
  const tk = T(id);
  const [askQ, setAskQ] = useState<Pending | null>(initial ?? null);
  const [cal, setCal] = useState<'plan' | 'due' | 'done' | null>(null);
  if (!tk) return null;
  const k = today.value, w = settings.value.urgencyDays;
  const go = (q: Quadrant) => {
    const m = moveTo(tk, q, k, w);
    if (!m.ask) { closeSheet(); void patchTask(id, m.patch); toast(t('movedTo', { q: quadName(q) })); return; }
    setAskQ({ q, ask: m.ask, patch: m.patch });
  };
  if (askQ) {
    const finish = (p: Partial<Task>) => { closeSheet(); void patchTask(id, { ...askQ.patch, ...p, dueRule: null }); toast(t('movedTo', { q: quadName(askQ.q) })); };
    return askQ.ask === 'dueOrBlocker' ? (
      <div data-testid="ask-due">
        <h3>{t('askDueTitle', { q: quadName(askQ.q) })}</h3>
        <p class="hint">{t('askDueHint', { n: w })}</p>
        <DayPick value={null} extra={[[t('pickToday'), k], [t('pickTomorrow'), addDays(k, 1)], [t('pickWeek'), addDays(k, 7)]]} onPick={d => d && finish({ due: d })} />
        <div class="actions"><button class="btn" type="button" onClick={() => finish({ urgent: true })}>{t('itBlocks')}</button></div>
      </div>
    ) : (
      <div data-testid="ask-newdue">
        <h3>{t('askNewDueTitle')}</h3>
        <p class="hint">{t('askNewDueHint', { n: w })}</p>
        <DayPick value={null} clear extra={[[t('pickCalm'), firstCalmDay(k, w)]]} onPick={d => finish({ due: d })} />
      </div>
    );
  }
  if (mode === 'calendar' && cal) {
    return (
      <div>
        <h3>{cal === 'plan' ? t('planItOn') : cal === 'due' ? t('dueOnTitle') : t('doneOnTitle')}</h3>
        <p class="hint">{tk.title}</p>
        <DayPick value={null} onPick={d => {
          if (!d) return;
          closeSheet();
          if (cal === 'plan') { void planOn(id, d); toast(t('plannedOn', { date: fmtDate(d) })); }
          else if (cal === 'due') { void dueOn(id, d); toast(t('dueSet', { date: fmtDate(d) })); }
          else void moveDone(id, d > k ? k : d);
        }} />
      </div>
    );
  }
  const cur = isOpen(tk) ? quad(tk) : null;
  return (
    <div data-testid="move">
      <h3>{t('moveTo')}</h3>
      <p class="hint">{tk.title}</p>
      {mode === 'calendar' ? (
        <div class="actions">
          {tk.status === 'done' ? <button class="btn" type="button" onClick={() => setCal('done')}>{t('doneOn')}</button> : <>
            <button class="btn" type="button" onClick={() => setCal('plan')}>{t('planItOn')}</button>
            <button class="btn" type="button" onClick={() => setCal('due')}>{t('dueOnTitle')}</button>
          </>}
        </div>
      ) : (
        <div class="quadpick">
          {([1, 2, 3, 4] as Quadrant[]).map(q => <button type="button" class="btn" disabled={cur === q} onClick={() => go(q)} data-testid={'to-q' + q}>{quadName(q)}</button>)}
        </div>
      )}
    </div>
  );
}

// ---------- pause ----------
const WHY: [string, Key][] = [['later', 'whyLater'], ['focus', 'whyFocus'], ['blocked', 'whyBlocked'], ['interrupted', 'whyInterrupted'], ['tired', 'whyTired']];
/** Pause: a resume note and a reason. A long-running timer first asks "Still on…?". */
export function openPause(id: string, minutes?: number, checked = false) {
  const tk = T(id);
  if (!tk) return;
  if (tk.started && minutes == null && !checked && isLong(tk)) return openStillOn(id, 'pause');
  const submit = (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const why = (f.querySelector('input[name=why]:checked') as HTMLInputElement | null)?.value || 'later';
    const res = (f.elements.namedItem('resume') as HTMLInputElement).value.trim();
    closeSheet();
    const cur = T(id);
    if (cur?.started) void stopTimer(cur, why, res, minutes);
    else void patchTask(id, { resume: res || null });
  };
  openSheet(
    <form onSubmit={submit} key={'p' + id}>
      <h3>{t('pauseTitle')}</h3>
      <p class="hint">{t('pauseHint')}{minutes != null ? ' ' + t('pauseWith', { t: fmtMin(minutes) }) : ''}</p>
      <label class="field"><span>{t('whereStopped')}</span><input type="text" name="resume" defaultValue={tk.resume ?? ''} placeholder={t('whereStoppedPh')} autocomplete="off" /></label>
      <div class="field"><span>{t('whyStop')}</span>
        <div class="chips-pick">{WHY.map(([v, k], i) => <label class="pickchip"><input type="radio" name="why" value={v} defaultChecked={i === 0} /> {t(k)}</label>)}</div>
      </div>
      <div class="actions"><button class="btn primary" type="submit">{t('pauseTimer')}</button><button class="btn ghost" type="button" onClick={closeSheet}>{t('keepGoing')}</button></div>
    </form>,
  );
}

// ---------- swap the first step ----------
export function openSwap(k = today.value) {
  openSheet(<SwapSheet key={'swap' + Date.now()} k={k} />);
}
function SwapSheet({ k }: { k: string }) {
  const cur = planOf(k).filter(id => isOpen(T(id)));
  const onList = cur.slice(1).map(id => T(id)!);
  const more = candidates(k).slice(0, 10);
  const li = (tk: Tk) => (
    <li><div><p><Title s={tk.title} /></p><p class="meta"><Meta tk={tk} withQuad /></p></div>
      <button class="btn small" type="button" onClick={() => { closeSheet(); void setFirst(tk.id, k); }}>{t('startHere')}</button></li>
  );
  return (
    <div>
      <h3>{t('swapTitle')}</h3>
      <p class="hint">{t('swapHint')}</p>
      {onList.length > 0 && <><h2 class="sec">{t('onTodaysList')}</h2><ul class="picklist">{onList.map(li)}</ul></>}
      {more.length > 0 && <><h2 class="sec">{t('fromList')}</h2><ul class="picklist">{more.map(li)}</ul></>}
      <div class="actions"><button class="btn" type="button" onClick={closeSheet}>{t('keepIt')}</button></div>
    </div>
  );
}

// ---------- pick from the list, or a standing item ----------
export function openPick(kind: 'list' | 'standing', k = today.value) {
  openSheet(<PickSheet key={kind + Date.now()} kind={kind} k={k} />);
}
function PickSheet({ kind, k }: { kind: 'list' | 'standing'; k: string }) {
  const [added, setAdded] = useState<string[]>([]);
  const [offers, setOffers] = useState<Record<string, OfferChoice>>({});
  const items = kind === 'standing'
    ? [...tasks.value.values()].filter(x => x.template && x.status !== 'dropped' && inPlace(x)).sort(byOrder)
    : candidates(k).slice(0, 14);
  const add = (id: string) => { setAdded([...added, id]); void (kind === 'standing' ? cloneTemplate(id, k, undefined, offerFieldsFor(offers[id])) : addByHand(id, false, k)); };
  return (
    <div>
      <h3>{kind === 'standing' ? t('leisurePeopleTitle') : t('fromList')}</h3>
      <p class="hint">{kind === 'standing' ? t('pickStandingHint') : t('pickListHint')}</p>
      <ul class="picklist">
        {items.length ? items.map(x => (
          <li><div><p><Title s={x.title} /></p><p class="meta"><Meta tk={x} withQuad={kind !== 'standing'} /></p>
            {kind === 'standing' && !added.includes(x.id) && <OfferChips offer={x.offer} value={offers[x.id]} onChange={c => setOffers({ ...offers, [x.id]: c })} />}</div>
            <button class="btn small" type="button" disabled={added.includes(x.id)} onClick={() => add(x.id)}>{added.includes(x.id) ? t('added') : t('add')}</button></li>
        )) : <li><p class="hint">{t('nothingToAdd')}</p></li>}
      </ul>
      <div class="actions"><button class="btn" type="button" onClick={closeSheet}>{t('doneButton')}</button></div>
    </div>
  );
}

// ---------- a suit pile ----------
export function openPile(suit: Task['suit']) {
  openSheet(<PileSheet key={'pile' + suit} suit={suit} />);
}
function PileSheet({ suit }: { suit: Task['suit'] }) {
  const k = today.value;
  const done = cardsOn(k).filter(x => x.suit === suit);
  const todo = planOf(k).map(id => T(id)!).filter(x => x.status === 'open' && x.suit === suit);
  void lang.value;
  return (
    <div>
      <h3><Suit s={suit} /> {suitName(suit)}</h3>
      <p class="hint">{done.length ? t('cardsPlayedToday', { n: done.length }) : t('noCardsSuit')}</p>
      {done.length > 0 && (
        <ul class="pilelist">{done.map((x, i) => {
          const m = minutesOnFor(k, x.id);
          return <li><span class={'rk suit-' + suit}>{rankOf(i + 1)}</span><button class="linklike" type="button" onClick={() => openTask(x.id)}><Title s={x.title} /></button><span class="tm">{m ? fmtMin(m) : ''}</span></li>;
        })}</ul>
      )}
      {todo.length > 0 && (
        <><h2 class="sec">{t('stillOnList')}</h2>
          <ul class="pilelist">{todo.map(x => <li class="todo"><span class="rk g" aria-hidden="true">·</span><button class="linklike" type="button" onClick={() => openTask(x.id)}><Title s={x.title} /></button><span class="tm">{x.est ? (x.estBy === 'ai' ? '~' : '') + fmtMin(x.est) : ''}</span></li>)}</ul></>
      )}
      <div class="actions"><button class="btn" type="button" onClick={closeSheet}>{t('close')}</button></div>
    </div>
  );
}

/** A project's linked steps left, for "2 steps left" (goal gradient, brief §5). */
export const stepsLeft = (p: Project & { id: string }) => [...tasks.value.values()].filter(x => x.project === p.id && x.status === 'open' && !x.template).length;

