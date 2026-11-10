// The app frame: masthead and suit piles, "Still on…?" banner, the view, footer, and the tab bar at the bottom.
import { effect } from '@preact/signals';
import type { FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';
import { ready, readOnly, settings, today, toastMsg, start, here, pagePlace, pageView, places, setView, viewingElsewhere, clockNow } from './store';
import { cardsOn, minutesOn, running, T, dayDoc } from './model';
import { regionOf, viewsElsewhere } from '../domain/view';
import { applyTheme } from './theme';
import { SheetHost, suitName } from './ui';
import { OverlayHost } from './sheet';
import { openPile, openTask, placeName, areaName, rankOf, isLong, openStillOn, flows, moment } from './sheets';
import { patchTask } from './actions';
import { openPlaceMenu } from './PlacesSheet';
import { view, go, fromHash, taskFromHash, planFromHash, clearTaskHash, TABS, calMode, type View } from './nav';
import { startKeyboard } from './keyboard';
import { lastSyncAt, startSync, syncNow, syncStale } from './sync';
import { startFeed } from './feed';
import { watchStanding } from './standing';
import { watchBigMoments } from './celebrate';
import { startPush } from './push';
import { UpdateBanner } from './UpdateBanner';
import { reloadNewest } from './reload';
import { Today, openClose } from '../views/Today';
import { Matrix } from '../views/Matrix';
import { Projects } from '../views/Projects';
import { Calendar } from '../views/Calendar';
import { Notifications } from '../views/Notifications';
import { Settings } from '../views/Settings';
import { Home } from '../views/Home';
import { Memory } from '../views/Memory';
import { History } from '../views/History';
import { Waiting } from '../views/Waiting';
import { Addresses } from '../views/Addresses';
import { openVisit } from './AddressSheets';
import { openBreakDown } from '../flows/breakdown';
import { openStuck } from '../flows/stuck';
import { openDecision } from '../flows/decision';
import { t, lang, locale, fmtDate, fmtMin, type Key } from '../i18n';
import { SUIT_ORDER } from '../data/settings';
import { PreviewHost } from '../ai/ui';
import { aiReady } from '../ai/ask';
import { openMorning } from '../flows/morning';
import { DropHost, InboxHost } from './Drop';
import { pruneExchanges } from './home';
import { decideOnboarding, onboarding } from './onboarding';
import { Onboarding } from '../flows/onboarding';
import { AddCard } from './AddCard';
import { Footer } from './Footer';

// Guided flows open from sheets; registering them here keeps imports one-way.
flows.breakDown = openBreakDown;
flows.stuck = openStuck;
flows.decide = (id, link) => void openDecision(id, link);
flows.visit = openVisit;

effect(() => { applyTheme(settings.value); });
// "By time of day" re-checks every minute.
setInterval(() => { if (settings.value.theme === 'time') applyTheme(settings.value); }, 60_000);

/** The pill: where the person is, or, when the lists show something else, what they show. */
function PlacePill() {
  const v = pageView.value, elsewhere = viewsElsewhere(places.value, here.value, v);
  const shown = v.all ? t('viewEverywhere') : v.id === 'any' ? placeName('any') : areaName(v.id);
  const label = elsewhere ? (v.all ? '<b>' + escapeHtml(shown) + '</b>' : t('viewingPill', { place: '<b>' + escapeHtml(shown) + '</b>' })) : t('inPlace', { place: '<b>' + escapeHtml(placeName(here.value)) + '</b>' });
  return (
    <button class="here" type="button" onClick={openPlaceMenu} aria-label={t('placePillLabel', { here: placeName(here.value), view: shown })} aria-haspopup="dialog" data-testid="place-pill" data-viewing={elsewhere ? '' : undefined}
      dangerouslySetInnerHTML={{ __html: label }} />
  );
}
function Mast() {
  const d = dayDoc(today.value);
  // On Today the minutes timed so far sit between the date and the pill, small and quiet; the cell takes only the room left and its text drops out of sight when it does not fit.
  const timed = view.value === 'today' ? minutesOn(today.value) : 0;
  return (
    <header class="mast">
      <h1 class="vh">{t(TAB_KEY[view.value] ?? 'appName')}</h1>
      <p class="dateline">{fmtDate(today.value, { weekday: 'long', day: 'numeric', month: 'long' })}{d?.closed ? ' · ' + t('dayClosed') : ''}</p>
      {timed > 0 && <p class="mast-timed" data-testid="mast-timed" title={t('timed', { t: fmtMin(timed) })}><wbr /><span>{t('timedMast', { t: fmtMin(timed) })}</span></p>}
      <PlacePill />
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
  const current = (x: View) => (x === 'home' ? v === 'home' || v === 'settings' || v === 'memory' || v === 'history' || v === 'addresses' || v === 'notifications' || v === 'waiting' : v === x);
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

/** Only the "Still on …?" banner lives here: a forgotten timer is data to fix, so it shows on every tab. Start here, the clock and Pause are Today's alone. */
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
  return <div id="runbar" />;
}
/** This device's copy is old and sync is not bringing it up to date: say what that means here and offer the fixes. */
function SyncStaleBanner() {
  if (!syncStale(clockNow.value)) return null;
  const at = lastSyncAt.value;
  const msg = at ? t('syncStale', { when: new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) }) : t('syncStaleNever');
  return (
    <div class="banner warn" role="status" data-testid="sync-stale">
      <p>{msg}</p>
      <div class="actions">
        <button class="btn small" type="button" data-testid="sync-stale-now" onClick={() => void syncNow()}>{t('syncNow')}</button>
        <button class="btn small" type="button" onClick={() => go('settings')}>{t('syncStaleSettings')}</button>
      </div>
    </div>
  );
}

function PlaceBanner() {
  if (!viewingElsewhere.value || view.value === 'settings' || view.value === 'memory' || view.value === 'history' || view.value === 'addresses' || view.value === 'notifications' || view.value === 'waiting' || (view.value === 'calendar' && calMode.value === 'log')) return null;
  return (
    <div class="banner" data-testid="viewing-banner"><p>{t('viewingPage', { place: placeName(pagePlace.value) })}</p>
      <button class="btn small" type="button" onClick={() => setView(null)}>{t('backTo', { place: placeName(regionOf(places.value, here.value)) })}</button></div>
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

function Toast() {
  return toastMsg.value ? <div class="toast" role="status" aria-live="polite">{toastMsg.value}</div> : null;
}

/** Home, Settings and the screens behind Home's bell and menu have no masthead or footer; the others keep them. The suit piles are Today's alone. */
const BARE: View[] = ['home', 'notifications', 'settings', 'memory', 'history', 'addresses', 'waiting'];
/** Views that get a wider column above 1024 px (brief §16). */
const WIDE: View[] = ['matrix', 'calendar'];
const SCREENS: Record<View, FunctionComponent> = { home: Home, today: Today, matrix: Matrix, projects: Projects, calendar: Calendar, settings: Settings, memory: Memory, history: History, addresses: Addresses, notifications: Notifications, waiting: Waiting };

/** A link with `#task/<id>` (an event in a calendar app) opens that step's sheet, if it still exists. */
function openLinkedTask() {
  const id = taskFromHash();
  if (!id) return;
  clearTaskHash();
  if (T(id)) openTask(id);
}

/** A tap on the morning's notification (`#plan`): the planning conversation with an AI set up, else Today, as the notification always did. */
async function openLinkedPlan() {
  if (!planFromHash()) return;
  clearTaskHash();
  if (await aiReady()) { go('home'); openMorning(); } else go('today');
}

export function App() {
  useEffect(() => { void start().then(async () => { await decideOnboarding(); openLinkedTask(); void openLinkedPlan(); void pruneExchanges(); void startFeed(); watchStanding(); watchBigMoments(); return Promise.all([startSync(), startPush()]); }); }, []);
  useEffect(() => { startKeyboard(); }, []);
  // Home and the Calendar never scroll (the page is one screen tall, what is inside scrolls), and the phone's rubber band is off while they are shown (html.home-lock, src/styles/app.css).
  // First-run set-up is none of them: it is a stack of pages that scroll, though the view behind it is Home (so the lock was on and the pages could not move).
  const setup = onboarding.value === 'show';
  useEffect(() => { const on = (view.value === 'home' || view.value === 'calendar') && !setup; document.documentElement.classList.toggle('home-lock', on); return () => document.documentElement.classList.remove('home-lock'); }, [view.value, setup]);
  useEffect(() => {
    const onHash = () => { const v = fromHash(); if (v) view.value = v; else if (ready.value) { openLinkedTask(); void openLinkedPlan(); } };
    window.addEventListener('hashchange', onHash);
    // The worker passes a tap on a notification to the open window.
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { type?: unknown; url?: unknown } | null;
      if (m?.type === 'OPEN_URL') try { location.hash = new URL(String(m.url), location.href).hash; } catch { /* fine */ }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => { window.removeEventListener('hashchange', onHash); navigator.serviceWorker?.removeEventListener('message', onMessage); };
  }, []);
  void lang.value;
  const V = SCREENS[view.value];
  const bare = BARE.includes(view.value);
  // The suit piles belong to Today alone; the other tabs use the whole width (no second column).
  const withSide = !bare && view.value === 'today', noSide = !bare && !withSide;
  // A new device starts here, with no tabs and no masthead, until the person finishes or skips.
  if (ready.value && onboarding.value === 'show') return (
    <>
      <div class="app bare onboard"><main><Onboarding /></main></div>
      <SheetHost />
      <OverlayHost />
      <PreviewHost />
      <Toast />
    </>
  );
  return (
    <>
      <div class={'app' + (bare ? ' bare' : '') + (noSide ? ' noside' : '') + (WIDE.includes(view.value) ? ' wide' : '')} data-view={view.value}>
        {!bare && <Mast />}
        {withSide && <Side />}
        <Runbar />
        <main>
          <UpdateBanner />
          <PlaceBanner />
          {readOnly.value && <div class="banner warn"><p>{t('newerData')}</p><button class="btn small" type="button" onClick={() => void reloadNewest()}>{t('reload')}</button></div>}
          <SyncStaleBanner />
          {ready.value && onboarding.value !== 'pending' ? <V /> : <p class="hint" style="margin-top:var(--s5)">{t('loading')}</p>}
          {!bare && view.value !== 'calendar' && <Footer />}
        </main>
      </div>
      <Tabs />
      <AddCard />
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
