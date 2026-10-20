// The app frame: masthead and suit piles, running bar, the view, footer, and the tab bar at the bottom.
import { effect } from '@preact/signals';
import type { FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';
import { ready, readOnly, settings, today, toastMsg, start, here, pagePlace, viewPlace, viewingElsewhere, clockNow } from './store';
import { planOf, cardsOn, minutesOn, allCards, running, isOpen, T, dayDoc } from './model';
import { applyTheme } from './theme';
import { SheetHost, Title, suitName } from './ui';
import { OverlayHost } from './sheet';
import { openPile, openPause, placeName, rankOf, isLong, openStillOn, flows, moment } from './sheets';
import { startTask, patchTask } from './actions';
import { openPlaces } from './PlacesSheet';
import { view, go, fromHash, TABS, calMode, type View } from './nav';
import { startKeyboard } from './keyboard';
import { Clock } from './Clock';
import { startSync } from './sync';
import { startFeed } from './feed';
import { startPush } from './push';
import { UpdateBanner } from './UpdateBanner';
import { Today, openClose } from '../views/Today';
import { Matrix } from '../views/Matrix';
import { Projects } from '../views/Projects';
import { Calendar } from '../views/Calendar';
import { Settings } from '../views/Settings';
import { Home } from '../views/Home';
import { Memory } from '../views/Memory';
import { History } from '../views/History';
import { openBreakDown } from '../flows/breakdown';
import { openStuck } from '../flows/stuck';
import { openDecision } from '../flows/decision';
import { t, lang, fmtDate, fmtMin, frTypo, type Key } from '../i18n';
import { SUIT_ORDER } from '../data/settings';
import { PreviewHost } from '../ai/ui';
import { DropHost, InboxHost } from './Drop';

// Guided flows open from sheets; registering them here keeps imports one-way.
flows.breakDown = openBreakDown;
flows.stuck = openStuck;
flows.decide = (id, link) => void openDecision(id, link);

effect(() => { applyTheme(settings.value); });
// "By time of day" re-checks every minute.
setInterval(() => { if (settings.value.theme === 'time') applyTheme(settings.value); }, 60_000);

function Mast() {
  const d = dayDoc(today.value);
  return (
    <header class="mast">
      <div>
        <h1 class="word">{t('appName')}</h1>
        <p class="dateline">{fmtDate(today.value, { weekday: 'long', day: 'numeric', month: 'long' })}{d?.closed ? ' · ' + t('dayClosed') : ''}</p>
      </div>
      <button class="here" type="button" onClick={openPlaces} aria-label={t('inPlaceLabel', { place: placeName(here.value) })} data-testid="place-pill"
        dangerouslySetInnerHTML={{ __html: t('inPlace', { place: '<b>' + escapeHtml(placeName(here.value)) + '</b>' }) }} />
    </header>
  );
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function Side() {
  const cards = cardsOn(today.value);
  const by: Record<string, number> = { S: 0, D: 0, C: 0, H: 0 };
  cards.forEach(c => (by[c.suit] = (by[c.suit] ?? 0) + 1));
  return (
    <aside class="side" aria-label={t('todaysCards')}>
      <div class="found">{SUIT_ORDER.map(s => {
        const n = by[s] ?? 0, g = settings.value.suits[s].glyph;
        return (
          <button type="button" class="pile" data-suit={s} onClick={() => openPile(s)} aria-label={t('pileLabel', { suit: suitName(s), n })}>
            <div class={'pc suit-' + s + (n ? '' : ' empty') + (n > 1 ? ' stack' : '')} style={n ? { color: 'var(--suit-' + s + ')' } : undefined}>
              {n > 0 && <><span class="r">{rankOf(n)}</span><span class="s">{g}</span></>}<span class="big">{g}</span>
            </div>
            <small>{suitName(s, true)}</small>
          </button>
        );
      })}</div>
      <p class="daystat"><span>{t('cardsToday', { n: cards.length })}</span><span>{t('timed', { t: fmtMin(minutesOn(today.value)) })}</span><span>{t('allTime', { n: allCards() })}</span></p>
      <button class="btn primary wide" id="closeSide" type="button" onClick={openClose}>{t('closeTheDay')}</button>
    </aside>
  );
}

const TAB_KEY: Record<string, Key> = { home: 'tabHome', today: 'tabToday', matrix: 'tabMatrix', projects: 'tabProjects', calendar: 'tabCalendar' };
// Line icons, 24 px grid; the label is what names the tab.
const TAB_ICON: Record<string, string> = {
  home: 'M4 11 12 4l8 7M6 10v9h12v-9',
  today: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3',
  matrix: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  projects: 'M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
};
/** The five places, at the bottom (brief §5): no counts or badges. Settings, Memory and History belong to Home. */
function Tabs() {
  const v = view.value;
  const current = (x: View) => (x === 'home' ? v === 'home' || v === 'settings' || v === 'memory' || v === 'history' : v === x);
  return (
    <nav class="tabbar" aria-label={t('views')} data-testid="tabbar">
      <div class="tabbar-in">
        {TABS.map(x => (
          <button class="tab" type="button" aria-current={current(x) ? 'page' : undefined} onClick={() => go(x)} data-testid={'tab-' + x}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={TAB_ICON[x]} /></svg>
            <span>{t(TAB_KEY[x]!)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function Runbar() {
  const r = running();
  void clockNow.value;
  if (r && isLong(r)) {
    // "Still on …?" (brief §5): a forgotten timer is fixed in two taps.
    return (
      <div id="runbar"><div class="banner warn" data-testid="still-banner"><p>{t('stillOn', { title: r.title })}</p>
        <div class="go"><button class="btn small" type="button" onClick={() => openStillOn(r.id, 'ask')} data-testid="still-fix">{t('stoppedAt')}</button>
          <button class="btn small ghost" type="button" onClick={() => void patchTask(r.id, { stillAt: new Date().toISOString() })}>{t('stillGoing')}</button></div></div></div>
    );
  }
  if (r && view.value !== 'today') return (
    <div id="runbar"><div class="runbar"><Clock tk={r} /><span class="rt"><Title s={r.title} /></span><button class="btn small" type="button" onClick={() => openPause(r.id)}>{t('pause')}</button></div></div>
  );
  if (!r && view.value !== 'today' && view.value !== 'settings' && view.value !== 'home') {
    // Gentle insisting (brief §5): while a plan is open, the first step stays in sight, except on Home, which shows it. No counters.
    const first = planOf(today.value).map(id => T(id)).find(isOpen);
    if (first) return (
      <div id="runbar"><div class="insist" data-testid="insist"><span class="rt">{first.starter ? first.starter + ' → ' : ''}<Title s={first.title} /></span>
        <button class="btn small" type="button" onClick={() => void startTask(first.id)}>{t('start')}</button></div></div>
    );
  }
  return <div id="runbar" />;
}
function PlaceBanner() {
  if (!viewingElsewhere.value || view.value === 'settings' || view.value === 'memory' || view.value === 'history' || (view.value === 'calendar' && calMode.value === 'log')) return null;
  return (
    <div class="banner" data-testid="viewing-banner"><p>{t('viewingPage', { place: placeName(pagePlace.value) })}</p>
      <button class="btn small" type="button" onClick={() => viewPlace(null)}>{t('backTo', { place: placeName(here.value) })}</button></div>
  );
}
function Moment() {
  const m = moment.value;
  if (!m) return null;
  return (
    <div class={'moment ' + m.kind} role="status" aria-live="polite" data-testid="moment">
      <div class="moment-cards" aria-hidden="true"><i /><i /><i /></div>
      <p class="eyebrow">{m.kind === 'project' ? t('projectComplete') : t('decisionMade')}</p>
      <p class="moment-name">{m.name}</p>
    </div>
  );
}

function Footer() {
  const credit = settings.value.credit?.[lang.value];
  return (
    <footer class="foot">
      <span>{t('version', { v: __APP_VERSION__ })}</span>
      {credit && <span>{lang.value === 'fr' ? frTypo(credit) : credit}</span>}
      <span>{t('notTherapy')}</span>
    </footer>
  );
}

function Toast() {
  return toastMsg.value ? <div class="toast" role="status" aria-live="polite">{toastMsg.value}</div> : null;
}

/** Home and the screens behind its menu have no masthead, suit piles or footer; the others keep them. */
const BARE: View[] = ['home', 'memory', 'history'];
const SCREENS: Record<View, FunctionComponent> = { home: Home, today: Today, matrix: Matrix, projects: Projects, calendar: Calendar, settings: Settings, memory: Memory, history: History };

export function App() {
  useEffect(() => { void start().then(() => { void startFeed(); return Promise.all([startSync(), startPush()]); }); }, []);
  useEffect(() => { startKeyboard(); }, []);
  useEffect(() => {
    const onHash = () => { const v = fromHash(); if (v) view.value = v; };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  void lang.value;
  const V = SCREENS[view.value];
  const bare = BARE.includes(view.value);
  return (
    <>
      <div class={'app' + (bare ? ' bare' : '')}>
        {!bare && <Mast />}
        {!bare && <Side />}
        <Runbar />
        <main>
          <UpdateBanner />
          <PlaceBanner />
          {readOnly.value && <div class="banner warn"><p>{t('newerData')}</p><button class="btn small" type="button" onClick={() => location.reload()}>{t('reload')}</button></div>}
          {ready.value ? <V /> : <p class="hint" style="margin-top:24px">{t('loading')}</p>}
          {!bare && <Footer />}
        </main>
      </div>
      <Tabs />
      <SheetHost />
      <OverlayHost />
      <PreviewHost />
      <InboxHost />
      <DropHost />
      <Moment />
      <Toast />
    </>
  );
}
