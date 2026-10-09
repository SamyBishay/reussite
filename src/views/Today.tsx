// Today, ported from v1: the "Start here" card, launch points, the list, carry-over, quick add.
import { useState } from 'preact/hooks';
import { today, settings } from '../app/store';
import { T, planOf, dayDoc, candidates, yesterdayOpen, ratio, cardsOn, minutesOn, isOpen, type T as Tk } from '../app/model';
import { startTask, addLaunch, delLaunch, carryOver, addToday, createTask, newTaskDoc, reopen, closeDay } from '../app/actions';
import { openTask, openDone, openPause, openSwap, openPick, rankOf } from '../app/sheets';
import { Title, Meta, GoLink, Suit, openSheet, closeSheet, suitName } from '../app/ui';
import { Clock } from '../app/Clock';
import { t, fmtMin, fmtDate } from '../i18n';
import { addDays } from '../domain/dates';
import { SUIT_ORDER } from '../data/settings';
import type { Launch, Task } from '../data/schema';

const hmNow = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

function FirstCard({ tk }: { tk: Tk }) {
  const run = !!tk.started;
  const hasGo = !!tk.link || !!tk.prompt || !!tk.app;
  return (
    <section class={'first' + (run ? ' running' : ' focus')} data-testid="first">
      <div class="top">
        <p class="eyebrow">{run ? t('running') : t('startHere')}</p>
        {!run && <div class="edits"><button class="btn" type="button" onClick={openSwap}>{t('swap')}</button><button class="btn" type="button" onClick={() => openTask(tk.id)}>{t('edit')}</button></div>}
      </div>
      <p class="t"><Title s={tk.title} /></p>
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
      {!run && hasGo && <p class="hint">{t('openingStartsTimer')}</p>}
    </section>
  );
}

function Row({ tk, n }: { tk: Tk; n: number }) {
  const done = tk.status === 'done', run = !!tk.started;
  return (
    <li class={'row' + (done ? ' done' : '') + (run ? ' running' : '')} data-row={tk.id}>
      <span class={'num' + (done ? ' suit-' + tk.suit : '')} aria-hidden="true">{done ? settings.value.suits[tk.suit]?.glyph : n}</span>
      <div class="body">
        <p class="t"><Title s={tk.title} /></p>
        <p class="meta"><Meta tk={tk} />{run && <><span aria-hidden="true">·</span><Clock tk={tk} /></>}{!done && (tk.link || tk.prompt || tk.app) && <><span aria-hidden="true">·</span><GoLink tk={tk} variant="inline" /></>}</p>
        {tk.resume && !done && <p class="resume">{t('resume', { text: tk.resume })}</p>}
      </div>
      <div class="ctrls">
        {done ? <button class="icon-btn" type="button" onClick={() => reopen(tk.id)} aria-label={t('reopen')}>↺</button>
          : run ? <><button class="icon-btn" type="button" onClick={() => openPause(tk.id)} aria-label={t('pause')}>❚❚</button><button class="icon-btn ok" type="button" onClick={() => openDone(tk.id)} aria-label={t('done')}>✓</button></>
            : <><button class="icon-btn" type="button" onClick={() => startTask(tk.id)} aria-label={t('startTimer')}>▶</button><button class="icon-btn ok" type="button" onClick={() => openDone(tk.id)} aria-label={t('done')}>✓</button></>}
        <button class="icon-btn" type="button" onClick={() => openTask(tk.id)} aria-label={t('details')} data-testid="details">⋯</button>
      </div>
    </li>
  );
}

function Launches() {
  const d = dayDoc(today.value);
  const L: Launch[] = d?.launches ?? [];
  const hm = hmNow();
  const nextIdx = L.findIndex(l => l.t >= hm);
  const submit = (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const time = (f.elements.namedItem('time') as HTMLInputElement).value;
    if (!time) return;
    void addLaunch(time, (f.elements.namedItem('kind') as HTMLSelectElement).value as Launch['k']);
    f.reset();
  };
  return (
    <>
      <h2 class="sec">{t('launchPoints')} <span class="hint-inline">{t('launchHint')}</span></h2>
      <div class="launches">
        {L.length ? L.map((l, i) => (
          <span class={'chip' + (i === nextIdx ? ' next' : '') + (l.t < hm ? ' past' : '')}>
            <span aria-hidden="true">{l.k === 'restart' ? '↻' : '▶'}</span><time>{l.t}</time><span>{l.k === 'restart' ? t('restart') : t('start')}</span>
            <button type="button" onClick={() => delLaunch(i)} aria-label={t('remove', { what: l.t })}>×</button>
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

function QuickAdd() {
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
    await addToday(id);
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

export function Today() {
  const k = today.value;
  const d = dayDoc(k);
  const plan = planOf(k);
  const open = plan.filter(id => T(id)!.status === 'open');
  const fid = open[0];
  const yOpen = yesterdayOpen(k);
  const rest = plan.filter(id => id !== fid);
  const est = open.reduce((a, id) => a + (T(id)!.est || 0), 0);
  const r = ratio.value;
  const more = open.length - (fid ? 1 : 0);
  const s = !plan.length ? candidates()[0] : undefined;
  let n = fid ? 1 : 0;

  return (
    <div>
      {fid ? <FirstCard tk={T(fid)!} /> : !plan.length ? (
        <section class="first" data-testid="first">
          <p class="eyebrow">{t('noListYet')}</p>
          {s && <>
            <p class="t"><Title s={s.title} /></p>
            <p class="meta"><Meta tk={s} withQuad /></p>
            <div class="go"><button class="btn primary" type="button" onClick={() => addToday(s.id)}>{t('putFirst')}</button><button class="btn" type="button" onClick={() => openPick('list')}>{t('chooseFromList')}</button></div>
          </>}
          <p class="hint">{t('noListHint')}</p>
        </section>
      ) : (
        <section class="first"><p class="eyebrow">{t('listPlayed')}</p><p class="t">{t('allDone')}</p><p class="hint">{t('addOneOrClose')}</p></section>
      )}
      {yOpen.length > 0 && (
        <div class="carry"><p>{t('carryText', { n: yOpen.length })}</p><button class="btn small" type="button" onClick={carryOver}>{t('carryButton', { n: yOpen.length })}</button></div>
      )}
      <div class="after-first">
        <Launches />
        {rest.length > 0 && (
          <>
            <h2 class="sec">{fid ? t('then') : t('todaysList')} <span class="hint-inline">
              {more ? t('more', { n: more }) : t('allPlayed')}
              {est > 0 && ' · ' + t('estimatedToday', { t: fmtMin(est) }) + (r.v ? ' · ' + t('atYourRatio', { t: fmtMin(est * r.v), r: r.v.toFixed(1) }) : '')}
            </span></h2>
            <ol class="tableau">{rest.map(id => { const tk = T(id)!; if (tk.status === 'open') n++; return <Row key={id} tk={tk} n={n} />; })}</ol>
          </>
        )}
        <div class="adders">
          <button class="btn" type="button" onClick={() => openPick('list')}>{t('fromYourList')}</button>
          <button class="btn" type="button" onClick={() => openPick('standing')}>{t('leisurePeople')}</button>
        </div>
        <QuickAdd />
        <button class="btn primary close-day" type="button" onClick={openClose}>{d?.closed ? t('closeAgain') : t('closeTheDay')}</button>
      </div>
    </div>
  );
}

// ---------- close the day (v1's summary; the card show is rebuilt in phase 1) ----------
export function openClose() {
  openSheet(<CloseSheet key={'close' + Date.now()} />);
}
function CloseSheet() {
  const k = today.value;
  const deck = cardsOn(k);
  const by: Record<string, number> = { S: 0, D: 0, C: 0, H: 0 };
  deck.forEach(c => (by[c.suit] = (by[c.suit] ?? 0) + 1));
  const r = ratio.value;
  const td = dayDoc(addDays(k, 1));
  const sugg: Tk[] = planOf(k).map(id => T(id)!).filter(isOpen);
  candidates().forEach(c => { if (sugg.length < 8 && !sugg.includes(c)) sugg.push(c); });
  const startL = td?.launches?.find(l => l.first);
  const [sel, setSel] = useState(td?.first?.id ?? '');
  const submit = (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const v = (n: string) => ((f.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '');
    closeSheet();
    void closeDay(sel && sel !== '__new' ? sel : null, sel === '__new' ? v('newTitle') : '', v('time'));
  };
  return (
    <form onSubmit={submit}>
      <p class="eyebrow">{fmtDate(k, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h3 style="font-size:56px;line-height:1;margin-top:8px">{deck.length}</h3>
      <p class="bigsub">{t('cardsPlayed', { n: deck.length })}</p>
      <div class="minifound">{SUIT_ORDER.map(s => <span><Suit s={s} /> {by[s]}</span>)}</div>
      <p class="meta" style="margin-top:6px">{t('timed', { t: fmtMin(minutesOn(k)) })}{r.v ? ' · ' + t('estimatesRun', { r: r.v.toFixed(1) }) : ''}</p>
      {deck.length > 0 && <ul class="pilelist">{deck.map((c, i) => <li><span class={'rk suit-' + c.suit}>{rankOf(deck.slice(0, i + 1).filter(x => x.suit === c.suit).length)}</span><span><Title s={c.title} /></span><span class="tm" /></li>)}</ul>}
      <label class="field"><span>{t('tomorrowFirst')}</span>
        <select value={sel} onChange={e => setSel((e.target as HTMLSelectElement).value)}>
          <option value="">{t('chooseOne')}</option>
          {sugg.map(x => <option value={x.id}>{x.title}</option>)}
          <option value="__new">{t('writeNew')}</option>
        </select>
      </label>
      {sel === '__new' && <label class="field"><span>{t('newVerbFirst')}</span><input type="text" name="newTitle" autocomplete="off" /></label>}
      <label class="field"><span>{t('startAt')}</span><input type="time" name="time" defaultValue={startL?.t ?? ''} /></label>
      <div class="actions"><button class="btn primary" type="submit">{t('closeTitle')}</button><button class="btn ghost" type="button" onClick={closeSheet}>{t('notYet')}</button></div>
    </form>
  );
}
