// Today: the "Start here" card, the day's list and launch points, and the day navigator,
// which edits any day's plan, launch points and first step (brief §5, Days).
import { signal } from '@preact/signals';
import { today, settings, currentStay, places } from '../app/store';
import { T, planOf, dayDoc, candidates, yesterdayOpen, cardsOn, minutesOn, isOpen, fixedOn, decisionsToCheck, personal, planEst, type T as Tk } from '../app/model';
import { startTask, addLaunch, delLaunch, carryOver, addToday, createTask, newTaskDoc, reopen, removeToday, movePlan, setFirst } from '../app/actions';
import { openTask, openDone, openPause, openSwap, openPick, openStartedEarlier, flows } from '../app/sheets';
import { Title, Meta, GoLink } from '../app/ui';
import { Clock } from '../app/Clock';
import { openCheckin } from '../flows/checkin';
import { openClose } from '../flows/close';
import { openReview } from '../flows/review';
import { openDecisionPage } from '../flows/decision';
import { t, fmtMin, fmtDate } from '../i18n';
import { addDays, daysBetween } from '../domain/dates';
import { isoDow } from '../domain/repeat';
import { SUIT_ORDER } from '../data/settings';
import { suitName } from '../app/ui';
import type { Launch, Task } from '../data/schema';
import { CommandBox } from '../ai/ui';

export { openClose };

/** The day being looked at; null is today. Device-local. */
export const dayView = signal<string | null>(null);
const hmNow = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

function FirstCard({ tk }: { tk: Tk }) {
  const run = !!tk.started;
  const hasGo = !!tk.link || !!tk.prompt || !!tk.app;
  return (
    <section class={'first' + (run ? ' running' : ' focus')} data-testid="first" data-task={tk.id}>
      <div class="top">
        <p class="eyebrow">{run ? t('running') : t('startHere')}</p>
        {!run && <div class="edits"><button class="btn" type="button" onClick={() => openSwap()}>{t('swap')}</button><button class="btn" type="button" onClick={() => openTask(tk.id)}>{t('edit')}</button></div>}
      </div>
      <p class="t"><Title s={tk.title} /></p>
      {tk.starter && !run && <p class="starter">{t('starterIs', { s: tk.starter })}</p>}
      <p class="meta"><Meta tk={tk} /></p>
      {tk.resume && <p class="resume">{t('resume', { text: tk.resume })}</p>}
      <div class="go">
        {run ? (
          <>
            <Clock tk={tk} big />
            <button class="btn" type="button" onClick={() => openPause(tk.id)}>{t('pause')}</button>
            <button class="btn primary" type="button" onClick={() => openDone(tk.id)}>{t('done')}</button>
            <GoLink tk={tk} variant="small" />
          </>
        ) : (
          <>
            {hasGo && <GoLink tk={tk} variant="big" />}
            <button class={'btn' + (hasGo ? '' : ' primary')} type="button" onClick={() => startTask(tk.id)}>{hasGo ? t('justStartTimer') : t('startTimer')}</button>
            <button class="btn" type="button" onClick={() => openDone(tk.id)}>{t('alreadyDone')}</button>
          </>
        )}
      </div>
      <div class="go quiet">
        {!run && <button class="btn small ghost" type="button" onClick={() => openStartedEarlier(tk.id)}>{t('startedEarlier')}</button>}
        <button class="btn small ghost" type="button" onClick={() => flows.stuck(tk.id)} data-testid="stuck">{t('imStuck')}</button>
      </div>
      {!run && hasGo && <p class="hint">{t('openingStartsTimer')}</p>}
    </section>
  );
}

function Row({ tk, n, k, optional }: { tk: Tk; n: number; k: string; optional?: boolean }) {
  const done = tk.status === 'done', run = !!tk.started;
  const isToday = k === today.value;
  return (
    <li class={'row' + (done ? ' done' : '') + (run ? ' running' : '') + (optional ? ' optional' : '')} data-row={tk.id} data-task={tk.id}>
      <span class={'num' + (done ? ' suit-' + tk.suit : '')} aria-hidden="true">{done ? settings.value.suits[tk.suit]?.glyph : n}</span>
      <div class="body">
        <p class="t"><Title s={tk.title} />{optional && <> <span class="tag">{t('ifRoom')}</span></>}</p>
        <p class="meta"><Meta tk={tk} />{run && <><span aria-hidden="true">·</span><Clock tk={tk} /></>}{!done && (tk.link || tk.prompt || tk.app) && <><span aria-hidden="true">·</span><GoLink tk={tk} variant="inline" /></>}</p>
        {tk.resume && !done && <p class="resume">{t('resume', { text: tk.resume })}</p>}
      </div>
      <div class="ctrls">
        {done ? <button class="icon-btn" type="button" onClick={() => reopen(tk.id)} aria-label={t('reopen')}>↺</button>
          : !isToday ? <>
            <button class="icon-btn" type="button" onClick={() => movePlan(tk.id, -1, k)} aria-label={t('earlier')}>↑</button>
            <button class="icon-btn" type="button" onClick={() => removeToday(tk.id, k)} aria-label={t('takeOff')}>×</button>
          </>
          : run ? <><button class="icon-btn" type="button" onClick={() => openPause(tk.id)} aria-label={t('pause')}>❚❚</button><button class="icon-btn ok" type="button" onClick={() => openDone(tk.id)} aria-label={t('done')}>✓</button></>
            : <><button class="icon-btn" type="button" onClick={() => startTask(tk.id)} aria-label={t('startTimer')}>▶</button><button class="icon-btn ok" type="button" onClick={() => openDone(tk.id)} aria-label={t('done')} data-testid="row-done">✓</button></>}
        <button class="icon-btn" type="button" onClick={() => openTask(tk.id)} aria-label={t('details')} data-testid="details">⋯</button>
      </div>
    </li>
  );
}

function Launches({ k }: { k: string }) {
  const d = dayDoc(k);
  const L: Launch[] = d?.launches ?? [];
  const hm = k === today.value ? hmNow() : '';
  const nextIdx = hm ? L.findIndex(l => l.t >= hm) : -1;
  const submit = (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const time = (f.elements.namedItem('time') as HTMLInputElement).value;
    if (!time) return;
    void addLaunch(time, (f.elements.namedItem('kind') as HTMLSelectElement).value as Launch['k'], k);
    f.reset();
  };
  return (
    <>
      <h2 class="sec">{t('launchPoints')} <span class="hint-inline">{t('launchHint')}</span></h2>
      <div class="launches">
        {L.length ? L.map((l, i) => (
          <span class={'chip' + (i === nextIdx ? ' next' : '') + (hm && l.t < hm ? ' past' : '')}>
            <span aria-hidden="true">{l.k === 'restart' ? '↻' : '▶'}</span><time>{l.t}</time><span>{l.k === 'restart' ? t('restart') : t('start')}</span>
            <button type="button" onClick={() => delLaunch(i, k)} aria-label={t('remove', { what: l.t })}>×</button>
          </span>
        )) : <span class="hint">{t('noLaunches')}</span>}
        <form class="launch-add" onSubmit={submit}>
          <input type="time" name="time" aria-label={t('launchTime')} required />
          <select name="kind" aria-label={t('startOrRestart')}><option value="start">{t('start')}</option><option value="restart">{t('restart')}</option></select>
          <button class="btn small" type="submit">{t('add')}</button>
        </form>
      </div>
    </>
  );
}

function Fixed({ k }: { k: string }) {
  const fx = fixedOn(k);
  if (!fx.length) return null;
  return (
    <>
      <h2 class="sec">{t('fixedToday')}</h2>
      <ul class="fixed">{fx.map(x => (
        <li class={x.status === 'done' ? 'done' : ''}><time>{x.at}</time><button class="linklike" type="button" onClick={() => openTask(x.id)}><Title s={x.title} /></button>{x.dur ? <span class="due">{fmtMin(x.dur)}</span> : <span />}</li>
      ))}</ul>
    </>
  );
}

function QuickAdd({ k }: { k: string }) {
  const submit = async (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const title = (f.elements.namedItem('title') as HTMLInputElement).value.trim();
    if (!title) return;
    const est = Number((f.elements.namedItem('est') as HTMLInputElement).value) || null;
    const suit = (f.elements.namedItem('suit') as HTMLSelectElement).value as Task['suit'];
    f.reset();
    (document.activeElement as HTMLElement | null)?.blur();
    const id = await createTask(newTaskDoc(title, suit, 'inbox', { est, estBy: est ? 'me' : null }));
    await addToday(id, false, k);
  };
  return (
    <form class="quick" onSubmit={submit}>
      <label class="field" style="margin:0"><span>{t('newStep')}</span><input type="text" name="title" placeholder={t('newStepPlaceholder')} autocomplete="off" required /></label>
      <div class="row3">
        <select name="suit" aria-label={t('suit')}>{SUIT_ORDER.map(s => <option value={s}>{settings.value.suits[s].glyph} {suitName(s, true)}</option>)}</select>
        <input type="number" name="est" min="1" max="600" inputMode="numeric" placeholder={t('minShort')} aria-label={t('estimateMin')} />
        <button class="btn primary" type="submit">{t('add')}</button>
      </div>
      <p class="hint">{t('estimateHint')}</p>
    </form>
  );
}

function Navigator({ k }: { k: string }) {
  const td = today.value;
  const go = (d: string | null) => { dayView.value = d === td ? null : d; };
  const n = daysBetween(td, k);
  const label = n === 0 ? t('pickToday') : n === -1 ? t('pickYesterday') : n === 1 ? t('pickTomorrow') : fmtDate(k, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <nav class="daynav" aria-label={t('dayNav')}>
      <button class="icon-btn" type="button" onClick={() => go(addDays(k, -1))} aria-label={t('prevDay')} data-testid="prev-day">‹</button>
      <label class="daynav-date"><span>{label}</span><input type="date" value={k} onChange={e => { const v = (e.target as HTMLInputElement).value; if (v) go(v); }} aria-label={t('pickADay')} /></label>
      <button class="icon-btn" type="button" onClick={() => go(addDays(k, 1))} aria-label={t('nextDay')} data-testid="next-day">›</button>
      {n !== 0 && <button class="btn small ghost" type="button" onClick={() => go(null)}>{t('backToToday')}</button>}
    </nav>
  );
}

function StayNotice() {
  const s = currentStay.value;
  if (!s || s.from !== today.value) return null;
  let seen = false;
  try { seen = localStorage.getItem('reussite.stay.' + s.id) === '1'; } catch { /* fine */ }
  if (seen) return null;
  return (
    <div class="banner" role="status" data-testid="stay-notice">
      <p>{t('stayStarts', { place: places.value.get(s.placeId)?.name ?? s.placeId, date: fmtDate(s.to) })}</p>
      <button class="btn small ghost" type="button" onClick={e => { try { localStorage.setItem('reussite.stay.' + s.id, '1'); } catch { /* fine */ } (e.currentTarget as HTMLElement).parentElement!.remove(); }}>{t('ok')}</button>
    </div>
  );
}

/** Another day's plan: its list, first step and launch points, editable. Past days show their cards. */
function OtherDay({ k }: { k: string }) {
  const past = k < today.value;
  const plan = planOf(k);
  const d = dayDoc(k);
  const cards = cardsOn(k);
  const open = plan.filter(id => isOpen(T(id)));
  const optional = new Set(d?.optional ?? []);
  let n = 0;
  return (
    <div data-testid="other-day">
      {past && (
        <section class="first">
          <p class="eyebrow">{t('cardsThatDay')}</p>
          <p class="t">{t('cardsPlayed2', { n: cards.length })} · {fmtMin(minutesOn(k))}</p>
          {cards.length > 0 && <p class="meta">{cards.map(c => <span class={'suit-' + c.suit}>{settings.value.suits[c.suit]?.glyph}</span>)}</p>}
        </section>
      )}
      {!past && (
        <section class="first">
          <p class="eyebrow">{t('firstStepOf', { date: fmtDate(k, { weekday: 'long', day: 'numeric', month: 'long' }) })}</p>
          <label class="field" style="margin:0">
            <select value={d?.first?.id ?? ''} onChange={e => { const v = (e.target as HTMLSelectElement).value; if (v) void setFirst(v, k); }} aria-label={t('firstStep')}>
              <option value="">{t('chooseOne')}</option>
              {[...open.map(id => T(id)!), ...candidates(k).slice(0, 12)].map(x => <option value={x.id}>{x.title}</option>)}
            </select>
          </label>
        </section>
      )}
      <Fixed k={k} />
      <Launches k={k} />
      <h2 class="sec">{t('dayList')}</h2>
      {plan.length ? <ol class="tableau">{plan.map(id => { const tk = T(id)!; if (tk.status === 'open') n++; return <Row key={id} tk={tk} n={n} k={k} optional={optional.has(id)} />; })}</ol> : <p class="hint">{t('emptyDay')}</p>}
      {!past && (
        <>
          <div class="adders">
            <button class="btn" type="button" onClick={() => openPick('list', k)}>{t('fromYourList')}</button>
            <button class="btn" type="button" onClick={() => openPick('standing', k)}>{t('leisurePeople')}</button>
          </div>
          <QuickAdd k={k} />
        </>
      )}
    </div>
  );
}

export function Today() {
  const td = today.value;
  const k = dayView.value && dayView.value !== td ? dayView.value : td;
  if (k !== td) return <div><Navigator k={k} /><OtherDay k={k} /></div>;
  const d = dayDoc(k);
  const plan = planOf(k);
  const open = plan.filter(id => isOpen(T(id)));
  const fid = open[0];
  const yOpen = yesterdayOpen(k);
  const rest = plan.filter(id => id !== fid);
  const optional = new Set(d?.optional ?? []);
  const work = open.filter(id => !optional.has(id));
  const est = work.reduce((a, id) => a + (planEst(T(id)!) ?? 0), 0);
  const lo = work.reduce((a, id) => { const x = T(id)!; return a + (personal(x)?.lo ?? x.est ?? 0); }, 0);
  const hi = work.reduce((a, id) => { const x = T(id)!; return a + (personal(x)?.hi ?? x.est ?? 0); }, 0);
  const more = open.length - (fid ? 1 : 0);
  const s = !plan.length ? candidates()[0] : undefined;
  const checks = decisionsToCheck(k);
  const reviewDay = isoDow(k) === settings.value.reviewDay && !d?.review;
  let n = fid ? 1 : 0;

  return (
    <div>
      <Navigator k={k} />
      <StayNotice />
      {checks.map(dc => (
        <div class="banner" data-testid="decision-check"><p>{t('checkDecision', { title: dc.title })}</p><button class="btn small" type="button" onClick={() => openDecisionPage(dc.id, true)}>{t('checkNow')}</button></div>
      ))}
      {reviewDay && <div class="banner" data-testid="review-card"><p>{t('reviewToday')}</p><button class="btn small" type="button" onClick={openReview}>{t('startReview')}</button></div>}
      {fid ? <FirstCard tk={T(fid)!} /> : !plan.length ? (
        <section class="first" data-testid="first">
          <p class="eyebrow">{t('noListYet')}</p>
          <p class="t">{t('planTheDayQ')}</p>
          <div class="go"><button class="btn primary" type="button" onClick={openCheckin} data-testid="checkin">{t('planTheDay')}</button></div>
          {s && <>
            <p class="hint">{t('orStartWith')}</p>
            <p class="meta"><Title s={s.title} /></p>
            <div class="go"><button class="btn" type="button" onClick={() => addToday(s.id)}>{t('putFirst')}</button><button class="btn" type="button" onClick={() => openPick('list')}>{t('chooseFromList')}</button></div>
          </>}
        </section>
      ) : (
        <section class="first"><p class="eyebrow">{t('listPlayed')}</p><p class="t">{t('allDone')}</p><p class="hint">{t('addOneOrClose')}</p></section>
      )}
      {yOpen.length > 0 && (
        <div class="carry"><p>{t('carryText', { n: yOpen.length })}</p><button class="btn small" type="button" onClick={carryOver}>{t('carryButton', { n: yOpen.length })}</button></div>
      )}
      <div class="after-first">
        <Fixed k={k} />
        <Launches k={k} />
        {rest.length > 0 && (
          <>
            <h2 class="sec">{fid ? t('then') : t('todaysList')} <span class="hint-inline">
              {more ? t('more', { n: more }) : t('allPlayed')}
              {est > 0 && ' · ' + (lo !== hi ? t('estimatedRange', { t: fmtMin(est), lo: fmtMin(lo), hi: fmtMin(hi) }) : t('estimatedToday', { t: fmtMin(est) }))}
            </span></h2>
            <ol class="tableau">{rest.map(id => { const tk = T(id)!; if (tk.status === 'open') n++; return <Row key={id} tk={tk} n={n} k={k} optional={optional.has(id)} />; })}</ol>
          </>
        )}
        <div class="adders">
          {plan.length > 0 && !d?.checkin && <button class="btn" type="button" onClick={openCheckin}>{t('planTheDay')}</button>}
          <button class="btn" type="button" onClick={() => openPick('list')}>{t('fromYourList')}</button>
          <button class="btn" type="button" onClick={() => openPick('standing')}>{t('leisurePeople')}</button>
          {open.length > 0 && <button class="btn" type="button" onClick={() => flows.stuck()}>{t('imStuck')}</button>}
        </div>
        <QuickAdd k={k} />
        <CommandBox scope={{ kind: 'today' }} />
        <button class="btn primary close-day" type="button" onClick={openClose}>{d?.closed ? t('closeAgain') : t('closeTheDay')}</button>
      </div>
    </div>
  );
}
