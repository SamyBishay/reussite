// The task sheet: the form for a step (place, repeat, waits for, goes to, dates, slots), a new step, and the places for a select.
import { useEffect, useRef, useState } from 'preact/hooks';
import { settings, projects, today, places, toast, stays, here } from './store';
import { T, addressesOn, addressesIn, peopleIn, addressById, personById, rawPlan, whereOf, spentOf, byOrder, sessionsOf, personal, isOpen, isEvent, slotStateOf, type T as Tk } from './model';
import { tasks } from './store';
import { patchTask, stopTimer, addByHand, removeToday, movePlan, cloneTemplate, reopen, skipThisTime, stopRepeating, addPlace, moveDone, syncDueRules, createTask, newTaskDoc, leaveLists } from './actions';
import { openHappened } from './EventUi';
import { DropButton } from './ConfirmButton';
import { Clock } from './Clock';
import { closeSheet, openSheet, Title, suitName, GoLink, basisLine, learningLine } from './ui';
import { SlotFields, SlotLog, slotFromForm } from './SlotUi';
import { readSlot, writeSlot } from '../domain/slots';
import { More, countSet } from './More';
import { t, fmtMin, fmtDate, lang, type Key } from '../i18n';
import { isAllowedLink } from '../domain/links';
import { minutesBetween, shiftTime } from '../domain/calendar';
import { findTime } from '../domain/parse';
import { deriveLabel } from '../domain/label';
import { measureOf } from '../domain/goal';
import { toEventFields } from '../domain/events';
import { dueBeforeEnd, isArea } from '../domain/places';
import { placeRows } from '../domain/areas';
import { SUIT_ORDER } from '../data/settings';
import type { Repeat, Task } from '../data/schema';
import { openMove } from './moveSheets';
import { flows, placeName } from './sheetBase';
import { Sessions, openDone, openDoneOn, pauseTimer } from './timerSheets';

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
export { DropButton };

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
      {value.length > 0 && <ul class="mini">{value.filter(x => T(x)?.status !== 'dropped').map(x => <li><span>{isEvent(T(x)) && t('waitingForCard', { what: '' })}{T(x)?.title ?? x}</span><button type="button" class="chip-x" onClick={() => onChange(value.filter(y => y !== x))} aria-label={t('remove', { what: T(x)?.title ?? x })}>×</button></li>)}</ul>}
      {open ? (
        <>
          <input type="text" value={q} placeholder={t('searchSteps')} aria-label={t('searchSteps')} onInput={e => setQ((e.target as HTMLInputElement).value)} />
          <ul class="mini pickable">{found.map(x => <li><button type="button" class="linklike" onClick={() => { onChange([...value, x.id]); setQ(''); }}>{isEvent(x) && t('waitingForCard', { what: '' })}<Title s={x.title} /></button></li>)}</ul>
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
  const [estV, setEstV] = useState(tk.est ? String(tk.est) : '');
  const [where, setWhere] = useState(whereOf(tk));
  const [after, setAfter] = useState<string[]>(Array.isArray(tk.after) ? tk.after : tk.after ? [String(tk.after)] : []);
  const [repeat, setRepeat] = useState<Repeat | null>(tk.repeat ?? null);
  const [rule, setRule] = useState(tk.dueRule ?? null);
  const [weekdays, setWeekdays] = useState<number[]>(tk.weekdays ?? []);
  const [untilV, setUntilV] = useState(tk.until ?? '');
  // WebKit keeps a date input that was emptied by script in a bad-input state, which stops the form from being sent: once it is emptied the input is made again.
  const [untilGen, setUntilGen] = useState(0);
  const [ask, setAsk] = useState<Partial<Task> | null>(null);
  const [err, setErr] = useState('');
  // Something the person waits for (an event) hides what a step has: time, estimate, quadrant, due date.
  const [kindV, setKindV] = useState<Task['kind']>(tk.kind ?? 'task');
  const ev = kindV === 'event';
  const wasEvent = isEvent(tk);
  // What the step feeds (Addresses and people): one address or one person, picked from its place's lists.
  const [feed, setFeed] = useState(tk.addressId ? 'a:' + tk.addressId : tk.personId ? 'p:' + tk.personId : '');
  const feedOn = addressesOn();
  // A time written in the title or the note, with no fixed time set: offer to set it.
  const [titleV, setTitleV] = useState(tk.title);
  const [noteV, setNoteV] = useState(tk.note || '');
  // The note is shown in full when the sheet opens: the box grows to its text.
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const fitNote = () => { const el = noteRef.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; } };
  useEffect(() => { fitNote(); requestAnimationFrame(fitNote); }, []);
  const [atV, setAtV] = useState(tk.at ?? '');
  // The end is picked on the clock like the start; the length (`dur`) is worked out from the two.
  const [endV, setEndV] = useState(tk.at && tk.dur ? shiftTime(tk.at, tk.dur) : '');
  const setStart = (v: string) => { if (atV && endV && v) setEndV(shiftTime(v, minutesBetween(atV, endV))); setAtV(v); };
  const seen = atV ? null : findTime(titleV) ?? findTime(noteV);
  const inPlan = !draft && rawPlan(today.value).includes(id);
  const projs = [...projects.value.values()].filter(p => p.status !== 'dropped').sort((a, b) => SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) || byOrder(a, b));
  const hint: Key = ev ? 'hintEvent' : tk.kind === 'decision' ? 'hintDecision' : tk.template ? 'hintStanding' : 'hintStep';
  const spent = spentOf(id);
  const open = tk.status === 'open';
  const typed = Number(estV) || null;
  const pe = typed ? personal({ ...tk, est: typed }) : null;
  const proj = projects.value.get(tk.project);
  // "Moves the goal?": asked when the step's project has a bar (or the step already answered).
  const [advV, setAdvV] = useState<boolean | null>(tk.advances ?? null);
  const measure = measureOf(proj);
  const asksGoal = !tk.template && !ev && !!proj && tk.project !== 'inbox' && (measure.kind !== 'none' || tk.advances != null);
  // Optional fields live under More; the summary counts the ones that have a value.
  const hiddenSet = countSet(tk.label, tk.starter, tk.project !== 'inbox' ? tk.project : '', proj && proj.suit !== tk.suit, feed, kindV !== 'task', tk.template, tk.template ? tk.offer : '', after, tk.app, tk.link, tk.prompt, repeat, tk.template ? weekdays : [], tk.template ? untilV : '', rule);
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
    if (!rule) {
      setIf('due', v('due') || null, tk.due);
      // The deadline's time goes with its date: none without one.
      setIf('dueAt', v('due') && v('dueAt') ? v('dueAt') : null, tk.dueAt ?? null);
    }
    // The one slot, with its log: the sheet's Save is the person's confirm, so a new slot after the old one passed is a re-slot.
    if (!ev && el('slotAt')) {
      const was = readSlot(tk.slot), to = slotFromForm(v);
      const why = was && !draft && isOpen(tk) && slotStateOf(was) === 'passed' ? 'reslotted' : was ? 'moved' : 'set';
      Object.assign(p, writeSlot(tk, to, 'me', why, new Date().toISOString()));
    }
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
      if (atV) setIf('dur', endV && endV !== atV ? minutesBetween(atV, endV) : null, tk.dur);
      // Empty = the default from Settings; 0 = notified at the time itself.
      if (el('lead')) setIf('lead', v('lead').trim() === '' ? null : Math.max(0, Math.min(240, Math.round(Number(v('lead')) || 0))), tk.lead);
      setIf('weekdays', tk.template && weekdays.length ? [...weekdays].sort() : null, tk.weekdays);
      if (tk.template) setIf('until', /^\d{4}-\d{2}-\d{2}$/.test(untilV) ? untilV : null, tk.until ?? null);
    }
    if (asksGoal) {
      setIf('advances', advV, tk.advances);
      if (el('advanceBy')) { const n = Number(v('advanceBy').replace(',', '.')); setIf('advanceBy', n > 0 ? n : null, tk.advanceBy); }
    }
    setIf('repeat', repeat, tk.repeat);
    setIf('after', after.length ? after : null, Array.isArray(tk.after) ? tk.after : tk.after ? [tk.after] : null);
    setIf('dueRule', rule, tk.dueRule);
    if (rule) { const s = stays.value.get(rule.beforeEndOf); if (s) setIf('due', dueBeforeEnd(s, rule.daysBefore), tk.due); }
    if (ev) {
      // Something waited for has no estimate, starter, time, due date, quadrant or repeat: set to nothing (kept values are entered again if it turns back into a step).
      const nothing = toEventFields() as Record<string, unknown>;
      for (const k of Object.keys(nothing)) {
        const was = (tk as unknown as Record<string, unknown>)[k], now = nothing[k];
        // Nothing, false and missing are the same here, so a saved event is not rewritten each time.
        if ((was ?? false) !== (now ?? false) && !(now === false && was == null) && !(now == null && was === false)) (p as Record<string, unknown>)[k] = now;
        else delete (p as Record<string, unknown>)[k];
      }
      setIf('nudge', v('nudge') || null, tk.nudge);
      if (!wasEvent && !draft) { if (tk.started) void stopTimer(tk, 'later'); void leaveLists(id); }
    }
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
      {tk.started && !draft && !wasEvent && (
        <div class="runstrip" data-testid="run-strip" role="group" aria-label={t('running')}>
          <Clock tk={tk} big />
          <button class="btn small" type="button" data-testid="run-pause" onClick={() => pauseTimer(id)}>{t('pause')}</button>
          <button class="btn small primary" type="button" data-testid="run-done" onClick={() => openDone(id)}>{t('done')}</button>
        </div>
      )}
      <p class="hint">{t(hint)}</p>
      <div class="actionbar" data-testid="task-actions">
        <button class="btn small primary" type="submit">{t('save')}</button>
        {draft ? null : tk.template ? (
          <button class="btn small" type="button" onClick={() => { void cloneTemplate(id); closeSheet(); }}>{t('addToToday')}</button>
        ) : open && wasEvent ? (
          <button class="btn small primary" type="button" onClick={() => openHappened(id)} data-testid="task-happened">{t('happenedBtn')}</button>
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
        {open && !tk.template && !draft && !wasEvent && (
          <>
            <button class="btn small" type="button" onClick={() => openMove(id, moveMode)}>{t('moveTo')}</button>
            <button class="btn small" type="button" onClick={() => flows.breakDown(id)}>{t('breakItDown')}</button>
            {tk.kind === 'decision' && <button class="btn small" type="button" onClick={() => flows.decide(null, { taskId: id })}>{t('openDecision')}</button>}
            {tk.repeat && <button class="btn small" type="button" onClick={() => { void skipThisTime(id); closeSheet(); toast(t('skipped')); }}>{t('skipThisTime')}</button>}
            {tk.repeat && <button class="btn small ghost" type="button" onClick={() => { void stopRepeating(id); closeSheet(); }}>{t('stopRepeating')}</button>}
          </>
        )}
        {tk.status !== 'dropped' && !draft && (
          <DropButton tk={tk} onDrop={closeSheet} />
        )}
      </div>
      <label class="field"><span>{t('stepField')}</span><input type="text" name="title" defaultValue={tk.title} required onInput={e => setTitleV((e.target as HTMLInputElement).value)} /></label>
      {ev && (
        <>
          <label class="field" data-testid="nudge-field"><span>{t('nudgeField')}</span><input type="date" name="nudge" defaultValue={tk.nudge ?? ''} data-testid="nudge" /></label>
          <p class="hint">{t('nudgeHint')}</p>
        </>
      )}
      {!ev && (
        <>
      <fieldset class="fieldgroup" data-testid="group-due"><legend>{t('fieldDue')}</legend>
        <div class="row2">
          <label class="field"><span>{t('dueField')}</span><input type="date" name="due" defaultValue={tk.due ?? ''} disabled={!!rule} /></label>
          <label class="field"><span>{t('dueTimeField')}</span><input type="time" name="dueAt" defaultValue={tk.dueAt ?? ''} disabled={!!rule} data-testid="due-at" /></label>
        </div>
        <p class="hint">{t('dueFieldHint')}</p>
      </fieldset>
      <fieldset class="fieldgroup" data-testid="group-at"><legend>{t('fieldAt')}</legend>
      <div class="row2 timebox" data-testid="timebox">
        <label class="field"><span>{t('startField')}</span>
          <span class="clockpick"><input type="time" name="at" value={atV} onInput={e => setStart((e.target as HTMLInputElement).value)} data-testid="at" />
            {atV && <button class="chip-x" type="button" onClick={() => { setAtV(''); setEndV(''); }} aria-label={t('remove', { what: atV })}>×</button>}</span>
        </label>
        <label class="field"><span>{t('endField')}</span>
          <input type="time" name="end" value={endV} disabled={!atV} onInput={e => setEndV((e.target as HTMLInputElement).value)} data-testid="end" />
        </label>
      </div>
      {atV && endV && endV !== atV && <p class="hint" data-testid="length">{t('lengthIs', { t: fmtMin(minutesBetween(atV, endV)) })}{endV < atV ? ' · ' + t('endsNextDay') : ''}</p>}
      {atV && (
        <>
          <label class="field"><span>{t('leadField')}</span><input type="number" name="lead" min="0" max="240" inputMode="numeric" defaultValue={tk.lead != null ? String(tk.lead) : ''} placeholder={String(settings.value.notifyLead)} data-testid="lead" /></label>
          <p class="hint">{t('leadHint', { n: settings.value.notifyLead })}</p>
        </>
      )}
      {seen && <p class="hint"><button class="btn small" type="button" data-testid="set-time" onClick={() => setStart(seen.at)}>{t('setTimeHint', { t: seen.at })}</button></p>}
      <p class="hint">{t('atFieldHint')}</p>
      </fieldset>
      <fieldset class="fieldgroup" data-testid="group-slot"><legend>{t('fieldSlot')}</legend>
        <SlotFields value={readSlot(tk.slot)} />
        <p class="hint">{t('slotHint')}</p>
        <SlotLog tk={tk} />
      </fieldset>
      <div class="field"><span>{t('urgImp')}</span>
        <div class="toggles">
          <label class="tog"><input type="checkbox" name="urgent" defaultChecked={!!tk.urgent} /> {t('urgentLabel')}</label>
          <label class="tog"><input type="checkbox" name="important" defaultChecked={!!tk.important} /> {t('importantLabel')}</label>
        </div>
      </div>
      <label class="field"><span>{t('estimateField')}</span><input type="number" name="est" min="1" max="600" inputMode="numeric" value={estV} onInput={e => setEstV((e.target as HTMLInputElement).value)} /></label>
      <label class="field" data-testid="where-field"><span>{t('where')}</span><PlaceSelect value={where} onChange={setWhere} /></label>
      {asksGoal && (
        <div class="field" data-testid="moves-goal"><span>{t('movesGoal')}</span>
          <div class="seg small" role="group" aria-label={t('movesGoal')}>
            <button type="button" aria-pressed={advV === true} data-testid="moves-yes" onClick={() => setAdvV(advV === true ? null : true)}>{t('movesYes')}</button>
            <button type="button" aria-pressed={advV === false} data-testid="moves-no" onClick={() => setAdvV(advV === false ? null : false)}>{t('movesNo')}</button>
          </div>
          {advV === true && measure.kind === 'count' && (
            <label class="row-inline"><span class="hint">{t('movesAdds')}</span>
              <input type="number" name="advanceBy" min="0" step="any" inputMode="decimal" defaultValue={tk.advanceBy != null ? String(tk.advanceBy) : ''} placeholder="1" data-testid="advance-by" />
              {measure.unit && <span class="hint">{measure.unit}</span>}
            </label>
          )}
          <small class="hint">{t('movesGoalHint')}</small>
        </div>
      )}
      {typed && open && <p class="hint pe" data-testid="personal">{pe && pe.value !== typed ? t('estUsually', { a: fmtMin(typed), b: fmtMin(pe.value), lo: fmtMin(pe.lo), hi: fmtMin(pe.hi) }) + ' · ' + basisLine({ ...tk, est: typed }) : pe ? basisLine({ ...tk, est: typed }) : learningLine()}</p>}
      {tk.prompt && <div class="actions" style="margin-top:var(--s2)"><button class="btn small" type="button" onClick={copy}>{t('copyPrompt')}</button><GoLink tk={tk} variant="small" /></div>}
      {!tk.prompt && <div class="actions" style="margin-top:var(--s3)"><GoLink tk={tk} variant="small" /></div>}
        </>
      )}
      {err && <p class="err">{err}</p>}
      <label class="field note-field"><span>{t('note')}</span><textarea ref={noteRef} name="note" data-testid="note" defaultValue={tk.note || ''} onInput={e => { setNoteV((e.target as HTMLTextAreaElement).value); fitNote(); }} /></label>
      <More n={hiddenSet} testid="task-more">
      {!ev && (
        <>
          <label class="field"><span>{t('labelField')}</span><input type="text" name="label" defaultValue={tk.label ?? ''} placeholder={deriveLabel(titleV, tk.starter)} autocomplete="off" data-testid="label" /></label>
          <p class="hint">{t('labelHint')}</p>
          <label class="field"><span>{t('starterField')}</span><input type="text" name="starter" defaultValue={tk.starter ?? ''} placeholder={t('starterPh')} autocomplete="off" /></label>
        </>
      )}
      <label class="field"><span>{t('suit')}</span>
        <select name="suit">{SUIT_ORDER.map(s => <option value={s} selected={s === tk.suit}>{settings.value.suits[s].glyph} {suitName(s, true)}</option>)}</select>
      </label>
      <label class="field"><span>{t('project')}</span>
        <select name="project">{projs.map(p => <option value={p.id} selected={p.id === tk.project}>{(settings.value.suits[p.suit]?.glyph ?? '') + ' ' + p.name}</option>)}</select>
      </label>
      {feedOn && !tk.template && !ev && <FeedsField where={where} value={feed} onChange={setFeed} onWhere={setWhere} />}
        <div class="row2">
          <label class="field"><span>{t('kindField')}</span>
            <select name="kind" data-testid="kind" onChange={e => setKindV((e.target as HTMLSelectElement).value as Task['kind'])}>
              <option value="task" selected={kindV === 'task'}>{t('kindTask')}</option><option value="decision" selected={kindV === 'decision'}>{t('kindDecision')}</option><option value="event" selected={kindV === 'event'}>{t('kindEvent')}</option>
            </select>
          </label>
          {!ev && <div class="field"><span>{t('standingField')}</span><label class="tog"><input type="checkbox" name="template" defaultChecked={!!tk.template} /> {t('standingLabel')}</label></div>}
        </div>
        {feedOn && tk.template && !ev && (
          <label class="field"><span>{t('offerField')}</span>
            <select name="offer" data-testid="offer">
              <option value="" selected={!tk.offer}>{t('offerNone')}</option><option value="address" selected={tk.offer === 'address'}>{t('offerAddress')}</option><option value="person" selected={tk.offer === 'person'}>{t('offerPerson')}</option>
            </select>
            <small class="hint">{t('offerHint')}</small>
          </label>
        )}
        <AfterField id={id} value={after} onChange={setAfter} />
        {!ev && <>
        <div class="row2">
          <label class="field"><span>{t('appField')}</span><input type="text" name="app" defaultValue={tk.app ?? ''} placeholder="Mail, WhatsApp…" autocomplete="off" /></label>
          <label class="field"><span>{t('linkField')}</span><input type="text" name="link" inputMode="url" defaultValue={tk.link ?? ''} placeholder="https://…" autocomplete="off" /></label>
        </div>
        <label class="field"><span>{t('promptField')}</span><textarea name="prompt" defaultValue={tk.prompt ?? ''} /></label>
        <RepeatField value={repeat} onChange={setRepeat} />
        </>}
        {tk.template && !ev && (
          <div class="field" data-testid="weekdays"><span>{t('weekdaysField')}</span>
            <div class="toggles">{weekdayNames().map(([d, name]) => <label class="tog small"><input type="checkbox" checked={weekdays.includes(d)} onChange={e => setWeekdays((e.target as HTMLInputElement).checked ? [...weekdays, d].sort() : weekdays.filter(x => x !== d))} /> {name}</label>)}</div>
            <p class="hint">{t('weekdaysHint')}</p>
            <label class="field"><span>{t('untilField')}</span><input key={untilGen} type="date" name="until" data-testid="until" defaultValue={untilV} onChange={e => { const v = (e.target as HTMLInputElement).value; setUntilV(v); if (!v) setUntilGen(g => g + 1); }} /></label>
            <p class="hint">{t('untilHint')}</p>
          </div>
        )}
        {stayList.length > 0 && !ev && (
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
      </More>
      {tk.status === 'done' && tk.doneDay && (
        <label class="field"><span>{t('doneOnField')}</span>
          <input type="date" defaultValue={tk.doneDay} onChange={e => { const v = (e.target as HTMLInputElement).value; if (v) void moveDone(id, v); }} data-testid="done-day" />
        </label>
      )}
      {!ev && (spent > 0 || sessionsOf(id).length > 0 || tk.status === 'done') && <Sessions tk={tk} />}
      {!ev && spent > 0 && <p class="hint" style="margin-top:var(--s3)">{tk.est ? t('timedAgainst', { t: fmtMin(spent), e: fmtMin(tk.est0 ?? tk.est) }) : t('timedOnly', { t: fmtMin(spent) })}</p>}
    </form>
  );
}
