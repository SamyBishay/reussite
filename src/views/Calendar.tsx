// The Calendar tab (brief §5, Calendar view): Réussite's own data on dates, never an hourly grid.
// Month: compact markers per day. Week: an agenda, stacked on phones, columns on wide screens.
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { tasks, projects, decisions, stays, places, settings, today } from '../app/store';
import { T, rawPlan, dayDoc, fixedOn, cardsOn, minutesOn, inPlace, isOpen, type T as Tk } from '../app/model';
import { planOn, dueOn, moveDone } from '../app/actions';
import { openTask, openMove } from '../app/sheets';
import { Title } from '../app/ui';
import { dayView } from './Today';
import { openReview } from '../flows/review';
import { openDecisionPage } from '../flows/decision';
import { t, fmtDate, fmtMin, lang } from '../i18n';
import { addDays, daysBetween } from '../domain/dates';
import { monthGrid, weekOf } from '../domain/calendar';
import { isoDow, occurrences } from '../domain/repeat';
import { stayOn } from '../domain/places';

const stored = (() => { try { return localStorage.getItem('reussite.cal') === 'month' ? 'month' : 'week'; } catch { return 'week'; } })();
const mode = signal<'week' | 'month'>(stored);
const anchor = signal<string | null>(null);
const setMode = (m: 'week' | 'month') => { mode.value = m; try { localStorage.setItem('reussite.cal', m); } catch { /* fine */ } };

function openDay(k: string) {
  dayView.value = k === today.value ? null : k;
  location.hash = '#today';
}

/** Everything the calendar shows on one day. */
function dayData(k: string, repeatsByDay: Map<string, Tk[]>) {
  const plan = rawPlan(k).map(id => T(id)).filter((x): x is Tk => !!x && x.status !== 'dropped' && !x.at);
  const inPlan = new Set(plan.map(x => x.id));
  const due = [...tasks.value.values()].filter(x => isOpen(x) && x.due === k && !inPlan.has(x.id) && !x.at && inPlace(x));
  return {
    plan, due, fixed: fixedOn(k), launches: dayDoc(k)?.launches ?? [],
    checks: [...decisions.value.values()].filter(d => d.status === 'decided' && d.reviewOn === k),
    projectDue: [...projects.value.values()].filter(p => p.due === k && p.status === 'active'),
    review: isoDow(k) === settings.value.reviewDay,
    later: repeatsByDay.get(k) ?? [],
    cards: k <= today.value ? cardsOn(k) : [],
    minutes: k <= today.value ? minutesOn(k) : 0,
    stay: stayOn(stays.value.values(), k),
  };
}

/** Later occurrences of repeating steps, as faint markers (only the next one exists). */
function repeatMarkers(from: string, to: string): Map<string, Tk[]> {
  const out = new Map<string, Tk[]>();
  for (const x of tasks.value.values()) {
    if (!isOpen(x) || !x.repeat || !x.due || !inPlace(x)) continue;
    for (const k of occurrences(x.repeat, x.due, to)) if (k >= from) out.set(k, [...(out.get(k) ?? []), x]);
  }
  return out;
}

const Pips = ({ cards }: { cards: Tk[] }) => (
  <span class="pips" aria-label={t('cardsPlayed2', { n: cards.length })}>{cards.slice(0, 6).map(c => <span class={'suit-' + c.suit}>{settings.value.suits[c.suit]?.glyph}</span>)}{cards.length > 6 && <small>+{cards.length - 6}</small>}</span>
);

function drag(e: DragEvent, id: string) { e.dataTransfer?.setData('text/plain', id); }
function dropTo(e: DragEvent, k: string, as: 'plan' | 'due') {
  e.preventDefault();
  (e.currentTarget as HTMLElement).classList.remove('over');
  const id = e.dataTransfer?.getData('text/plain');
  const x = id ? T(id) : undefined;
  if (!x) return;
  if (x.status === 'done') void moveDone(x.id, k > today.value ? today.value : k);
  else if (as === 'plan') void planOn(x.id, k);
  else void dueOn(x.id, k);
}
const over = (e: DragEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('over'); };
const leave = (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('over');

function Entry({ x, kind }: { x: Tk; kind: 'plan' | 'due' | 'fixed' }) {
  return (
    <li class={'cal-item k-' + kind + (x.status === 'done' ? ' done' : '')} draggable={kind !== 'fixed'} onDragStart={e => drag(e, x.id)} data-task={x.id}>
      {kind === 'fixed' && <time>{x.at}</time>}
      <span class={'g suit-' + x.suit} aria-hidden="true">{x.status === 'done' ? '✓' : kind === 'due' ? '!' : settings.value.suits[x.suit]?.glyph}</span>
      <button type="button" class="linklike" onClick={() => openTask(x.id)}><Title s={x.title} /></button>
      {kind !== 'fixed' && <button type="button" class="icon-btn sm" onClick={() => openMove(x.id, 'calendar')} aria-label={t('moveTo')} data-testid="cal-move">⋯</button>}
    </li>
  );
}

function WeekDay({ k, rep }: { k: string; rep: Map<string, Tk[]> }) {
  const d = dayData(k, rep);
  const td = today.value;
  const inWindow = k >= td && daysBetween(td, k) <= settings.value.urgencyDays;
  const showStay = d.stay && (d.stay.from === k || isoDow(k) === 1);
  return (
    <section class={'wday' + (k === td ? ' today' : '') + (inWindow ? ' urgent-window' : '') + (k < td ? ' past' : '')} data-day={k} data-testid={'wday-' + k}>
      {d.stay && <div class="stayband" title={places.value.get(d.stay.placeId)?.name}>{showStay ? places.value.get(d.stay.placeId)?.name ?? '' : ' '}</div>}
      <header onDragOver={over} onDragLeave={leave} onDrop={e => dropTo(e, k, 'due')}>
        <button type="button" class="linklike" onClick={() => openDay(k)}><b>{fmtDate(k, { weekday: 'short' })}</b> {fmtDate(k, { day: 'numeric', month: 'short' })}</button>
        {k <= td && d.cards.length > 0 && <Pips cards={d.cards} />}
        {d.minutes > 0 && <small class="muted">{fmtMin(d.minutes)}</small>}
        <small class="droplabel">{t('dropDue')}</small>
      </header>
      {d.fixed.length > 0 && <ul class="cal-list">{d.fixed.map(x => <Entry x={x} kind="fixed" />)}</ul>}
      {d.launches.length > 0 && <p class="cal-launch">{d.launches.map(l => (l.k === 'start' ? '▶ ' : '↻ ') + l.t).join('  ')}</p>}
      <ul class="cal-list plan" onDragOver={over} onDragLeave={leave} onDrop={e => dropTo(e, k, 'plan')} aria-label={t('dayList')}>
        {d.plan.map(x => <Entry x={x} kind="plan" />)}
        {!d.plan.length && <li class="droplabel">{t('dropPlan')}</li>}
      </ul>
      {d.due.length > 0 && <ul class="cal-list">{d.due.map(x => <Entry x={x} kind="due" />)}</ul>}
      {(d.checks.length > 0 || d.projectDue.length > 0 || d.review || d.later.length > 0) && (
        <ul class="cal-list marks">
          {d.checks.map(dc => <li><button type="button" class="linklike" onClick={() => openDecisionPage(dc.id, k <= td)}>⚖ {t('checkShort', { title: dc.title })}</button></li>)}
          {d.projectDue.map(p => <li>◆ {t('projectDue', { name: p.name })}</li>)}
          {d.review && <li><button type="button" class="linklike" onClick={openReview}>☀ {t('sundayReview')}</button></li>}
          {d.later.map(x => <li class="faint">↻ {x.title}</li>)}
        </ul>
      )}
    </section>
  );
}

function Month({ a }: { a: string }) {
  const [y, m] = a.split('-').map(Number);
  const rows = monthGrid(y!, m!);
  const rep = repeatMarkers(rows[0]![0]!, rows.at(-1)!.at(-1)!);
  const td = today.value;
  const names = weekOf(td).map(k => fmtDate(k, { weekday: 'narrow' }));
  return (
    <div class="month" data-testid="month">
      <div class="mhead">{names.map(n => <span>{n}</span>)}</div>
      {rows.map(r => (
        <div class="mrow">{r.map(k => {
          const d = dayData(k, rep);
          const inWindow = k >= td && daysBetween(td, k) <= settings.value.urgencyDays;
          const other = Number(k.slice(5, 7)) !== m;
          return (
            <button type="button" class={'mcell' + (k === td ? ' today' : '') + (inWindow ? ' urgent-window' : '') + (other ? ' other' : '') + (d.stay ? ' instay' : '')}
              onClick={() => openDay(k)} aria-label={fmtDate(k, { weekday: 'long', day: 'numeric', month: 'long' })}>
              <span class="dn">{Number(k.slice(8))}</span>
              {d.stay && (d.stay.from === k || isoDow(k) === 1) && <span class="stl">{places.value.get(d.stay.placeId)?.name}</span>}
              <span class="marks">
                {d.due.length > 0 && <span class="mk due">!{d.due.length}</span>}
                {d.plan.filter(x => x.status === 'open').length > 0 && <span class="mk">▢{d.plan.filter(x => x.status === 'open').length}</span>}
                {d.fixed.length > 0 && <span class="mk">◷{d.fixed.length}</span>}
                {(d.checks.length > 0 || d.projectDue.length > 0) && <span class="mk">◆</span>}
                {d.later.length > 0 && <span class="mk faint">↻</span>}
              </span>
              {d.cards.length > 0 && <Pips cards={d.cards} />}
            </button>
          );
        })}</div>
      ))}
    </div>
  );
}

export function Calendar() {
  const td = today.value;
  const a = anchor.value ?? td;
  const [, force] = useState(0);
  void lang.value;
  const week = weekOf(a);
  const rep = mode.value === 'week' ? repeatMarkers(week[0]!, week[6]!) : new Map();
  const step = (n: number) => {
    if (mode.value === 'week') anchor.value = addDays(a, 7 * n);
    else { const [y, m] = a.split('-').map(Number); const d = new Date(Date.UTC(y!, m! - 1 + n, 1)); anchor.value = d.toISOString().slice(0, 10); }
    force(x => x + 1);
  };
  const title = mode.value === 'week'
    ? fmtDate(week[0]!, { day: 'numeric', month: 'short' }) + ' – ' + fmtDate(week[6]!, { day: 'numeric', month: 'short' })
    : fmtDate(a.slice(0, 8) + '01', { month: 'long', year: 'numeric' });
  return (
    <div data-testid="calendar">
      <div class="calbar">
        <div class="seg" role="group" aria-label={t('calView')}>
          <button type="button" aria-pressed={mode.value === 'week'} onClick={() => setMode('week')}>{t('calWeek')}</button>
          <button type="button" aria-pressed={mode.value === 'month'} onClick={() => setMode('month')}>{t('calMonth')}</button>
        </div>
        <div class="calnav">
          <button class="icon-btn" type="button" onClick={() => step(-1)} aria-label={t('calPrev')}>‹</button>
          <b>{title}</b>
          <button class="icon-btn" type="button" onClick={() => step(1)} aria-label={t('calNext')}>›</button>
          {a !== td && <button class="btn small ghost" type="button" onClick={() => (anchor.value = null)}>{t('pickToday')}</button>}
        </div>
      </div>
      <p class="hint">{t('calHint', { n: settings.value.urgencyDays })}</p>
      {mode.value === 'week' ? <div class="weekview">{week.map(k => <WeekDay key={k} k={k} rep={rep} />)}</div> : <Month a={a} />}
    </div>
  );
}
