// Bottom sheets, ported from v1, plus the v2 "How long did it take?" sheet.
import { useState } from 'preact/hooks';
import { settings, projects, today, places, toast } from './store';
import { T, rawPlan, planOf, cardsOn, candidates, whereOf, urgent, minutesOnFor, spentOf, byOrder, inPlace, type T as Tk } from './model';
import { tasks } from './store';
import { patchTask, finishTask, stopTimer, addToday, removeToday, movePlan, cloneTemplate, dropTask, reopen, setFirst } from './actions';
import { closeSheet, openSheet, Title, Meta, Suit, suitName, GoLink } from './ui';
import { t, fmtMin, lang, type Key } from '../i18n';
import { durationButtons, splitWheel, WHEEL_HOURS, WHEEL_MINUTES } from '../domain/duration';
import { SUIT_ORDER } from '../data/settings';
import type { Task } from '../data/schema';

const rankOf = (n: number) => (n <= 0 ? '' : n <= 13 ? ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][n]! : 'K+');
export { rankOf };

export const placeName = (id: string) => (id === 'any' ? t('anywhere') : places.value.get(id)?.name ?? id);
export const placeIds = () => [...places.value.values()].sort(byOrder).map(p => p.id);

// ---------- task details ----------
export function openTask(id: string) {
  openSheet(<TaskSheet key={id + Date.now()} id={id} />);
}

function TaskSheet({ id }: { id: string }) {
  const tk = T(id);
  const [armed, setArmed] = useState(false);
  if (!tk) return null;
  const inPlan = rawPlan(today.value).includes(id);
  const projs = [...projects.value.values()].sort((a, b) => SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) || byOrder(a, b));
  const hint: Key = tk.kind === 'decision' ? 'hintDecision' : tk.template ? 'hintStanding' : 'hintStep';
  const spent = spentOf(id);

  const submit = (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const v = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
    const c = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).checked;
    const p: Partial<Task> = {};
    const title = v('title').trim();
    if (title && title !== tk.title) p.title = title;
    if (c('urgent') !== !!tk.urgent) p.urgent = c('urgent');
    if (c('important') !== !!tk.important) p.important = c('important');
    const est = Number(v('est')) || null;
    if (est !== (tk.est || null)) { p.est = est; p.estBy = est ? 'me' : null; }
    const due = v('due') || null;
    if (due !== (tk.due || null)) p.due = due;
    if (v('suit') !== tk.suit) p.suit = v('suit') as Task['suit'];
    if (v('where') !== whereOf(tk)) p.where = v('where');
    if (v('project') && v('project') !== tk.project) p.project = v('project');
    if (v('note') !== (tk.note || '')) p.note = v('note');
    closeSheet();
    if (Object.keys(p).length) { void patchTask(id, p); toast(t('saved')); }
  };
  const copy = () => {
    try { navigator.clipboard.writeText(tk.prompt ?? '').then(() => toast(t('promptCopied')), () => toast(t('copyBlocked'))); } catch { toast(t('copyBlocked')); }
  };

  return (
    <form onSubmit={submit}>
      <h3><Title s={tk.title} /></h3>
      <p class="hint">{t(hint)}</p>
      {inPlan && tk.status === 'open' && (
        <div class="actions" style="margin-top:12px">
          <button class="btn small" type="button" onClick={() => { void movePlan(id, -1); closeSheet(); }}>{t('earlier')}</button>
          <button class="btn small" type="button" onClick={() => { void movePlan(id, 1); closeSheet(); }}>{t('later')}</button>
        </div>
      )}
      <label class="field"><span>{t('stepField')}</span><input type="text" name="title" defaultValue={tk.title} required /></label>
      <div class="field"><span>{t('urgImp')}</span>
        <div class="toggles">
          <label class="tog"><input type="checkbox" name="urgent" defaultChecked={!!tk.urgent} /> {t('urgentLabel')}</label>
          <label class="tog"><input type="checkbox" name="important" defaultChecked={!!tk.important} /> {t('importantLabel')}</label>
        </div>
        {tk.due && !tk.urgent && urgent(tk) && <p class="hint">{t('urgentAnyway')}</p>}
      </div>
      <div class="row2">
        <label class="field"><span>{t('estimateField')}</span><input type="number" name="est" min="1" max="600" inputMode="numeric" defaultValue={tk.est ? String(tk.est) : ''} /></label>
        <label class="field"><span>{t('dueField')}</span><input type="date" name="due" defaultValue={tk.due ?? ''} /></label>
      </div>
      <div class="row2">
        <label class="field"><span>{t('suit')}</span>
          <select name="suit" defaultValue={tk.suit}>{SUIT_ORDER.map(s => <option value={s}>{settings.value.suits[s].glyph} {suitName(s, true)}</option>)}</select>
        </label>
        <label class="field"><span>{t('where')}</span>
          <select name="where" defaultValue={whereOf(tk)}>{[...placeIds(), 'any'].map(p => <option value={p}>{placeName(p)}</option>)}</select>
        </label>
      </div>
      <label class="field"><span>{t('project')}</span>
        <select name="project" defaultValue={tk.project}>{projs.map(p => <option value={p.id}>{(settings.value.suits[p.suit]?.glyph ?? '') + ' ' + p.name}</option>)}</select>
      </label>
      {tk.prompt && (
        <>
          <label class="field"><span>{t('promptField')}</span><textarea readOnly>{tk.prompt}</textarea></label>
          <div class="actions" style="margin-top:8px"><button class="btn small" type="button" onClick={copy}>{t('copyPrompt')}</button><GoLink tk={tk} variant="small" /></div>
        </>
      )}
      {!tk.prompt && <div class="actions" style="margin-top:12px"><GoLink tk={tk} variant="small" /></div>}
      <label class="field"><span>{t('note')}</span><textarea name="note" defaultValue={tk.note || ''} /></label>
      {spent > 0 && <p class="hint" style="margin-top:10px">{tk.est ? t('timedAgainst', { t: fmtMin(spent), e: fmtMin(tk.est) }) : t('timedOnly', { t: fmtMin(spent) })}</p>}
      <div class="actions">
        <button class="btn primary" type="submit">{t('save')}</button>
        {tk.template ? (
          <button class="btn" type="button" onClick={() => { void cloneTemplate(id); closeSheet(); }}>{t('addToToday')}</button>
        ) : tk.status === 'open' ? (
          <>
            {inPlan
              ? <button class="btn" type="button" onClick={() => { void removeToday(id); closeSheet(); }}>{t('takeOffToday')}</button>
              : <button class="btn" type="button" onClick={() => { void addToday(id); closeSheet(); }}>{t('addToToday')}</button>}
            <button class="btn" type="button" onClick={() => openDone(id)}>{t('markDone')}</button>
          </>
        ) : (
          <button class="btn" type="button" onClick={() => { void reopen(id); closeSheet(); }}>{t('reopen')}</button>
        )}
        {tk.status !== 'dropped' && (
          <button class="btn ghost" type="button" onClick={() => { if (!armed) return setArmed(true); void dropTask(id); closeSheet(); toast(t('dropped')); }}>
            {armed ? t('dropAgain') : t('dropIt')}
          </button>
        )}
      </div>
    </form>
  );
}

// ---------- done, and how long it took ----------
/** Done with a running timer saves its time; without one, ask how long it took. */
export function openDone(id: string) {
  const tk = T(id);
  if (!tk) return;
  if (tk.started) { closeSheet(); void finishTask(tk, null); return; }
  openSheet(<DurationSheet key={id} tk={tk} />);
}

export function DurationSheet({ tk }: { tk: Tk }) {
  const base = tk.est ?? null;
  const w = splitWheel(base ?? 30);
  const [h, setH] = useState(w.h);
  const [m, setM] = useState(w.m);
  const done = (min: number | null) => { closeSheet(); void finishTask(tk, min); };
  return (
    <div>
      <h3>{t('howLong')}</h3>
      <p class="hint">{base ? t('howLongHintEst', { t: fmtMin(base) }) : t('howLongHint')}</p>
      <div class="chips-pick" style="margin-top:14px">
        {durationButtons(base).map(v => <button type="button" data-testid="dur" onClick={() => done(v)}>{fmtMin(v)}</button>)}
      </div>
      <div class="field"><span>{t('orPick')}</span>
        <div class="wheel">
          <label class="field" style="margin:0"><span>{t('hoursLabel')}</span>
            <select value={String(h)} onChange={e => setH(Number((e.target as HTMLSelectElement).value))}>{WHEEL_HOURS.map(x => <option value={x}>{x}</option>)}</select>
          </label>
          <label class="field" style="margin:0"><span>{t('minutesLabel')}</span>
            <select value={String(m)} onChange={e => setM(Number((e.target as HTMLSelectElement).value))}>{WHEEL_MINUTES.map(x => <option value={x}>{String(x).padStart(2, '0')}</option>)}</select>
          </label>
          <button class="btn primary" type="button" disabled={h * 60 + m <= 0} onClick={() => done(h * 60 + m)}>{t('saveTime')}</button>
        </div>
      </div>
      <div class="actions"><button class="btn ghost" type="button" onClick={() => done(null)}>{t('didntTime')}</button></div>
    </div>
  );
}

// ---------- pause ----------
const WHY: [string, Key][] = [['later', 'whyLater'], ['focus', 'whyFocus'], ['blocked', 'whyBlocked'], ['interrupted', 'whyInterrupted'], ['tired', 'whyTired']];
export function openPause(id: string) {
  const tk = T(id);
  if (!tk) return;
  const submit = (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const why = (f.querySelector('input[name=why]:checked') as HTMLInputElement | null)?.value || 'later';
    const res = (f.elements.namedItem('resume') as HTMLInputElement).value.trim();
    closeSheet();
    const cur = T(id);
    if (cur?.started) void stopTimer(cur, why, res);
    else void patchTask(id, { resume: res || null });
  };
  openSheet(
    <form onSubmit={submit} key={'p' + id}>
      <h3>{t('pauseTitle')}</h3>
      <p class="hint">{t('pauseHint')}</p>
      <label class="field"><span>{t('whereStopped')}</span><input type="text" name="resume" defaultValue={tk.resume ?? ''} placeholder={t('whereStoppedPh')} autocomplete="off" /></label>
      <div class="field"><span>{t('whyStop')}</span>
        <div class="chips-pick">{WHY.map(([v, k], i) => <label class="pickchip"><input type="radio" name="why" value={v} defaultChecked={i === 0} /> {t(k)}</label>)}</div>
      </div>
      <div class="actions"><button class="btn primary" type="submit">{t('pauseTimer')}</button><button class="btn ghost" type="button" onClick={closeSheet}>{t('keepGoing')}</button></div>
    </form>,
  );
}

// ---------- swap the first step ----------
export function openSwap() {
  openSheet(<SwapSheet key={'swap' + Date.now()} />);
}
function SwapSheet() {
  const cur = planOf(today.value).filter(id => T(id)!.status === 'open');
  const onList = cur.slice(1).map(id => T(id)!);
  const more = candidates().slice(0, 10);
  const li = (tk: Tk) => (
    <li><div><p><Title s={tk.title} /></p><p class="meta"><Meta tk={tk} withQuad /></p></div>
      <button class="btn small" type="button" onClick={() => { closeSheet(); void setFirst(tk.id); }}>{t('startHere')}</button></li>
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
export function openPick(kind: 'list' | 'standing') {
  openSheet(<PickSheet key={kind + Date.now()} kind={kind} />);
}
function PickSheet({ kind }: { kind: 'list' | 'standing' }) {
  const [added, setAdded] = useState<string[]>([]);
  const items = kind === 'standing'
    ? [...tasks.value.values()].filter(x => x.template && x.status !== 'dropped' && inPlace(x)).sort(byOrder)
    : candidates().slice(0, 14);
  const add = (id: string) => { setAdded([...added, id]); void (kind === 'standing' ? cloneTemplate(id) : addToday(id)); };
  return (
    <div>
      <h3>{kind === 'standing' ? t('leisurePeopleTitle') : t('fromList')}</h3>
      <p class="hint">{kind === 'standing' ? t('pickStandingHint') : t('pickListHint')}</p>
      <ul class="picklist">
        {items.length ? items.map(x => (
          <li><div><p><Title s={x.title} /></p><p class="meta"><Meta tk={x} withQuad={kind !== 'standing'} /></p></div>
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
