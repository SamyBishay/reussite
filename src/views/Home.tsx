// Home (brief §5): where the person types. It holds a greeting, one card, the last receipt and the input,
// and never more. The greeting is only the next step; the card is what an open exchange has to say, else
// the one most pressing nudge; the receipt is the last thing applied, with Undo. The menu icon holds what
// has no tab: Settings, Places, Memory and History.
import { useEffect, useRef, useState } from 'preact/hooks';
import { today, clockNow, settings } from '../app/store';
import { T, dayDoc, greetingNow, decisionsToCheck, yesterdayOpen, planEst } from '../app/model';
import { startTask, carryOver } from '../app/actions';
import { openSheet, closeSheet, Title, Est } from '../app/ui';
import { openPause, openDone, DurationPicker } from '../app/sheets';
import { openPlaces } from '../app/PlacesSheet';
import { go, type View } from '../app/nav';
import { Clock } from '../app/Clock';
import { isTouch } from '../app/keyboard';
import { KeyCard } from '../app/SyncSettings';
import { syncOn, keySaved } from '../app/sync';
import { cardNow, choose, dismissCard, reviewAgain, saveDuration, submitHome, openExchange, receiptLine, undoExchange, canUndo, type HomeCard } from '../app/home';
import { openCheckin } from '../flows/checkin';
import { openClose } from '../flows/close';
import { openReview } from '../flows/review';
import { openDecisionPage } from '../flows/decision';
import { isoDow } from '../domain/repeat';
import { withTime } from '../domain/calendar';
import { t, fmtDate } from '../i18n';

function HomeMenu() {
  const to = (v: View) => { closeSheet(); go(v); };
  return (
    <div data-testid="home-menu-sheet">
      <h3>{t('menu')}</h3>
      <ul class="picklist menu">
        <li><button type="button" class="linklike" onClick={() => to('settings')} data-testid="menu-settings"><b>{t('tabSettings')}</b></button></li>
        <li><button type="button" class="linklike" onClick={() => { closeSheet(); openPlaces(); }} data-testid="menu-places"><b>{t('placesTitle')}</b></button></li>
        <li><button type="button" class="linklike" onClick={() => to('memory')} data-testid="menu-memory"><b>{t('memoryTitle')}</b></button></li>
        <li><button type="button" class="linklike" onClick={() => to('history')} data-testid="menu-history"><b>{t('historyTitle')}</b></button></li>
      </ul>
    </div>
  );
}

// ---------- the greeting ----------
/** The next step, as the Today screen's first card shows it: the starter, then the title, its estimate and Start. */
function Step({ id }: { id: string }) {
  const tk = T(id);
  if (!tk) return null;
  return (
    <>
      <p class="t" data-testid="greeting-step">{tk.starter ? tk.starter + ' → ' : ''}<Title s={tk.title} /></p>
      <p class="meta"><Est tk={tk} /></p>
      <div class="go"><button class="btn primary" type="button" onClick={() => void startTask(tk.id)} data-testid="home-start">{t('start')}</button></div>
    </>
  );
}

function GreetingBody() {
  const g = greetingNow.value;
  if (g.kind === 'fixed') {
    const e = g.event;
    return (
      <section class="first" data-testid="greeting-fixed">
        <p class="eyebrow">{t('homeUpNext')}</p>
        <p class="t" data-testid="greeting-line">{withTime(e.title ?? '', e.time)} · {t('leaveAtLine', { t: g.leave })}</p>
      </section>
    );
  }
  if (g.kind === 'running') {
    const tk = T(g.id);
    if (!tk) return null;
    return (
      <section class="first running" data-testid="greeting-running">
        <p class="eyebrow">{t('running')}</p>
        <p class="t"><Title s={tk.title} /></p>
        <div class="go">
          <Clock tk={tk} big />
          <button class="btn" type="button" onClick={() => openPause(tk.id)}>{t('pause')}</button>
          <button class="btn primary" type="button" onClick={() => openDone(tk.id)}>{t('done')}</button>
        </div>
      </section>
    );
  }
  if (g.kind === 'tomorrow') {
    return (
      <section class="first" data-testid="greeting-tomorrow">
        <p class="eyebrow">{t('tomorrowFirst')}</p>
        {g.step ? <p class="t" data-testid="greeting-step">{T(g.step.id)?.starter ? T(g.step.id)!.starter + ' → ' : ''}<Title s={g.step.title} /></p> : <p class="t">{t('homeTomorrowNone')}</p>}
      </section>
    );
  }
  if (g.kind === 'next') {
    return <section class="first focus" data-testid="greeting-next"><p class="eyebrow">{t('startHere')}</p><Step id={g.id} /></section>;
  }
  if (g.kind === 'plan') {
    return (
      <section class="first" data-testid="greeting-plan">
        <p class="eyebrow">{t('noListYet')}</p>
        <p class="t">{t('planTheDayQ')}</p>
        <div class="go"><button class="btn primary" type="button" onClick={openCheckin} data-testid="home-plan">{t('planTheDay')}</button></div>
      </section>
    );
  }
  return (
    <section class="first" data-testid="greeting-done">
      <p class="eyebrow">{t('listPlayed')}</p>
      <p class="t">{t('allDone')}</p>
      <p class="hint">{t('addOneOrClose')}</p>
      <div class="go"><button class="btn" type="button" onClick={openClose}>{t('closeTheDay')}</button></div>
    </section>
  );
}

// ---------- the card ----------
/** The one nudge, the most pressing of: the recovery key, a decision to check, yesterday's carry-over, the review day. */
function Nudge() {
  const k = today.value;
  if (syncOn.value && !keySaved.value) return <KeyCard />;
  const dc = decisionsToCheck(k)[0];
  if (dc) return <div class="banner" data-testid="decision-check"><p>{t('checkDecision', { title: dc.title })}</p><button class="btn small" type="button" onClick={() => openDecisionPage(dc.id, true)}>{t('checkNow')}</button></div>;
  const y = yesterdayOpen(k);
  if (y.length) return <div class="banner" data-testid="carry-nudge"><p>{t('carryText', { n: y.length })}</p><button class="btn small" type="button" onClick={carryOver}>{t('carryButton', { n: y.length })}</button></div>;
  if (isoDow(k) === settings.value.reviewDay && !dayDoc(k)?.review) return <div class="banner" data-testid="review-card"><p>{t('reviewToday')}</p><button class="btn small" type="button" onClick={openReview}>{t('startReview')}</button></div>;
  return null;
}

function CardBody({ c }: { c: HomeCard }) {
  if (c.kind === 'pick') {
    return (
      <div class="homecard" data-testid="card-pick">
        <p class="eyebrow">{t('homePick')}</p>
        <div class="picks">{c.candidates.map(x => <button class="btn pickbtn" type="button" onClick={() => void choose(c, x)} data-testid="pick">{x.name}</button>)}</div>
        <div class="actions"><button class="btn small ghost" type="button" onClick={dismissCard}>{t('cancel')}</button></div>
      </div>
    );
  }
  if (c.kind === 'duration') {
    const tk = T(c.task);
    if (!tk) return null;
    return (
      <div class="homecard" data-testid="card-duration">
        <p class="eyebrow">{t('howLong')}</p>
        <p class="t2">{t('homeHowLong', { title: tk.title })}</p>
        <DurationPicker base={planEst(tk)} onPick={m => void saveDuration(c, m)} />
        <div class="actions"><button class="btn small ghost" type="button" onClick={dismissCard} data-testid="not-timed">{t('didntTime')}</button></div>
        <p class="hint">{t('homeHowLongHint')}</p>
      </div>
    );
  }
  if (c.kind === 'review') {
    return (
      <div class="homecard row" data-testid="card-review">
        <p><b>{t('receiptChanges', { n: c.cs.changes.length })}</b></p>
        <div class="actions"><button class="btn small primary" type="button" onClick={() => reviewAgain(c)} data-testid="card-review-open">{t('homeReviewBtn')}</button><button class="btn small ghost" type="button" onClick={dismissCard}>{t('cancel')}</button></div>
      </div>
    );
  }
  return (
    <div class="homecard" data-testid="card-answer">
      <p class="ai-note">{c.text}</p>
      <div class="actions">{c.action && <button class="btn small" type="button" onClick={c.action.run}>{c.action.label}</button>}<button class="btn small ghost" type="button" onClick={dismissCard}>{t('ok')}</button></div>
    </div>
  );
}

function Card() {
  const c = cardNow.value;
  if (c) return <div data-testid="home-card" data-kind={c.kind}><CardBody c={c} /></div>;
  const n = Nudge();
  return n ? <div data-testid="home-card" data-kind="nudge">{n}</div> : null;
}

// ---------- the receipt ----------
function Receipt() {
  const ex = openExchange(clockNow.value);
  if (!ex || !canUndo(ex)) return null;
  return (
    <p class="receipt" data-testid="receipt" role="status">
      <span>{receiptLine(ex)}</span>
      <button class="linklike undo" type="button" onClick={() => void undoExchange(ex.id)} data-testid="undo">{t('undo')}</button>
    </p>
  );
}

// ---------- the input ----------
/** Fixed above the tab bar; dictation works in it. Enter sends, Shift+Enter starts a new line; on a phone sending closes the keyboard. */
function HomeInput() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const bar = useRef<HTMLFormElement>(null);
  // The bar's height is published for the page's bottom padding and the toast, which sit above it.
  useEffect(() => {
    const el = bar.current!, root = document.documentElement.style;
    const set = () => root.setProperty('--inputh', el.offsetHeight + 'px');
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); root.removeProperty('--inputh'); };
  }, []);
  useEffect(() => {
    const el = ta.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 128) + 'px'; }
  }, [text]);
  const send = async (e?: Event) => {
    e?.preventDefault();
    if (busy || !text.trim()) return;
    // On a phone the keyboard closes on send: the receipt and the tab bar come back, and a sheet that opens
    // does not give the focus (and the keyboard) back to the input when it closes.
    if (isTouch()) ta.current?.blur();
    setBusy(true);
    const taken = await submitHome(text);
    setBusy(false);
    if (taken) setText('');
  };
  return (
    <form class="homein" ref={bar} onSubmit={send} data-testid="home-input-bar">
      <div class="homein-in">
        <textarea ref={ta} rows={1} value={text} placeholder={t('homeInputPh')} aria-label={t('homeInputLabel')} enterkeyhint="send" autocomplete="off" autocapitalize="sentences"
          onInput={e => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) void send(e); }} data-testid="home-input" />
        <button class="btn primary send" type="submit" disabled={busy || !text.trim()} aria-label={t('homeSend')} data-testid="home-send">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </div>
    </form>
  );
}

export function Home() {
  const d = dayDoc(today.value);
  return (
    <div class="home" data-testid="home">
      <section class="greeting" data-testid="greeting">
        <div class="homebar">
          <p class="dateline">{fmtDate(today.value, { weekday: 'long', day: 'numeric', month: 'long' })}{d?.closed ? ' · ' + t('dayClosed') : ''}</p>
          <button type="button" class="icon-btn" onClick={() => openSheet(<HomeMenu />)} aria-label={t('menu')} data-testid="home-menu">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
        <GreetingBody />
      </section>
      <Card />
      <Receipt />
      <HomeInput />
    </div>
  );
}
