// Moving a step (to a quadrant, or onto a day), swapping the first step, picking from the list or a standing item, and a suit pile.
import { useState } from 'preact/hooks';
import { today, toast } from './store';
import { T, planOf, cardsOn, candidates, minutesOnFor, byOrder, inPlace, isOpen, quad, type T as Tk } from './model';
import { tasks } from './store';
import { patchTask, addByHand, cloneTemplate, setFirst, planOn, dueOn, moveDone } from './actions';
import { closeSheet, openSheet, Title, Meta, Suit, suitName, quadName } from './ui';
import { DayPick } from './due';
import { t, fmtMin, fmtDate, lang } from '../i18n';
import { ended } from '../domain/standing';
import { moveTo } from '../domain/moves';
import { OfferChips, offerFieldsFor, type OfferChoice } from './OfferChips';
import type { Task } from '../data/schema';
import type { Quadrant } from '../domain/tasks';
import { rankOf } from './sheetBase';
import { openTask } from './taskSheet';

// ---------- moving a step ----------
/** Matrix: to another quadrant. Calendar: plan it on a day, or make a day its due date. */
export function openMove(id: string, mode: 'matrix' | 'calendar' = 'matrix') {
  openSheet(<MoveSheet key={'move' + id + mode} id={id} mode={mode} />);
}
/** Drop on a quadrant: the move sets the two ticks, at once. */
export function moveToQuadrant(id: string, q: Quadrant) {
  const tk = T(id);
  if (!tk || (isOpen(tk) && quad(tk) === q)) return;
  void patchTask(id, moveTo(q).patch);
  toast(t('movedTo', { q: quadName(q) }));
}
function MoveSheet({ id, mode }: { id: string; mode: 'matrix' | 'calendar' }) {
  const tk = T(id);
  const [cal, setCal] = useState<'plan' | 'due' | 'done' | null>(null);
  if (!tk) return null;
  const k = today.value;
  const go = (q: Quadrant) => { closeSheet(); void patchTask(id, moveTo(q).patch); toast(t('movedTo', { q: quadName(q) })); };
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
    ? [...tasks.value.values()].filter(x => x.template && x.status !== 'dropped' && !ended(x, today.value) && inPlace(x)).sort(byOrder)
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
