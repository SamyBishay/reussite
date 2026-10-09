// The app frame, ported from v1: masthead, suit piles, tabs, running bar, the view, footer.
import { signal, effect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { ready, readOnly, settings, today, toastMsg, saveSettings, start, here, pagePlace, viewPlace, viewingElsewhere, clockNow } from './store';
import { planOf, cardsOn, minutesOn, allCards, running, isOpen, inPlace, quad, T, dayDoc } from './model';
import { tasks } from './store';
import { applyTheme } from './theme';
import { SheetHost, openSheet, closeSheet, Title, suitName } from './ui';
import { OverlayHost } from './sheet';
import { openPile, openPause, placeIds, placeName, rankOf, isLong, openStillOn, flows, moment } from './sheets';
import { addPlace, startTask, patchTask } from './actions';
import { Clock } from './Clock';
import { UpdateBanner } from './UpdateBanner';
import { Today, openClose } from '../views/Today';
import { Matrix } from '../views/Matrix';
import { Projects } from '../views/Projects';
import { Calendar } from '../views/Calendar';
import { Log } from '../views/Log';
import { Settings } from '../views/Settings';
import { openBreakDown } from '../flows/breakdown';
import { openStuck } from '../flows/stuck';
import { openDecision } from '../flows/decision';
import { t, lang, fmtDate, fmtMin, frTypo, type Key } from '../i18n';
import { SUIT_ORDER } from '../data/settings';
import { PreviewHost } from '../ai/ui';

type View = 'today' | 'matrix' | 'projects' | 'calendar' | 'log' | 'settings';
const VIEWS: View[] = ['today', 'matrix', 'projects', 'calendar', 'log', 'settings'];

// Guided flows open from sheets; registering them here keeps imports one-way.
flows.breakDown = openBreakDown;
flows.stuck = openStuck;
flows.decide = (id, link) => void openDecision(id, link);
const fromHash = (): View | null => { const h = location.hash.slice(1) as View; return VIEWS.includes(h) ? h : null; };
const stored = (): View => { try { const v = localStorage.getItem('reussite.view') as View; return VIEWS.includes(v) ? v : 'today'; } catch { return 'today'; } };
export const view = signal<View>(fromHash() ?? stored());
function go(v: View) {
  view.value = v;
  try { localStorage.setItem('reussite.view', v); history.replaceState(null, '', '#' + v); } catch { /* fine */ }
  window.scrollTo({ top: 0 });
}

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

function openPlaces() {
  openSheet(<PlacesSheet key={'places' + Date.now()} />);
}
/** The place switcher (brief §5): look at another place's page without moving there, or say you're there. */
function PlacesSheet() {
  const add = async (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const name = (f.elements.namedItem('name') as HTMLInputElement).value.trim();
    if (!name) return;
    f.reset();
    await addPlace(name);
  };
  return (
    <div data-testid="places-sheet">
      <h3>{t('placesTitle')}</h3>
      <p class="hint">{t('placesSheetHint', { place: placeName(here.value) })}</p>
      <ul class="picklist">{[...placeIds(), 'any'].map(id => (
        <li><div><p>{placeName(id)}{id === here.value && <> <span class="tag today">{t('youAreHere')}</span></>}{id === pagePlace.value && id !== here.value && <> <span class="tag">{t('viewing')}</span></>}</p></div>
          <div class="go">
            <button class="btn small" type="button" disabled={pagePlace.value === id} onClick={() => { viewPlace(id); closeSheet(); }}>{t('viewPage')}</button>
            <button class="btn small" type="button" disabled={settings.value.here === id && here.value === id} onClick={() => { void saveSettings({ here: id }); viewPlace(null); closeSheet(); }}>{t('imHere')}</button>
          </div></li>
      ))}</ul>
      <form class="addplace" onSubmit={add}>
        <input type="text" name="name" placeholder={t('newPlaceName')} aria-label={t('newPlaceName')} autocomplete="off" required />
        <button class="btn" type="submit" data-testid="add-place">{t('addPlaceBtn')}</button>
      </form>
      <p class="hint" style="margin-top:10px">{t('staysInSettings')}</p>
    </div>
  );
}
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

const TAB_KEY: Record<View, Key> = { today: 'tabToday', matrix: 'tabMatrix', projects: 'tabProjects', calendar: 'tabCalendar', log: 'tabLog', settings: 'tabSettings' };
function Tabs() {
  const open = planOf(today.value).filter(id => T(id)!.status === 'open').length;
  let now = 0;
  for (const x of tasks.value.values()) if (isOpen(x) && inPlace(x) && quad(x) === 1) now++;
  void pagePlace.value;
  const n: Partial<Record<View, number>> = { today: open, matrix: now };
  return (
    <nav class="tabs" role="tablist" aria-label={t('views')}>
      {VIEWS.map(v => (
        <button class="tab" role="tab" type="button" aria-selected={view.value === v} onClick={() => go(v)} data-testid={'tab-' + v}>
          {t(TAB_KEY[v])}{n[v] ? <span class="n">{n[v]}</span> : null}
        </button>
      ))}
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
  if (!r && view.value !== 'today' && view.value !== 'settings') {
    // Gentle insisting (brief §5): while a plan is open, the first step stays in sight. No counters.
    const first = planOf(today.value).map(id => T(id)).find(isOpen);
    if (first) return (
      <div id="runbar"><div class="insist" data-testid="insist"><span class="rt">{first.starter ? first.starter + ' → ' : ''}<Title s={first.title} /></span>
        <button class="btn small" type="button" onClick={() => void startTask(first.id)}>{t('start')}</button></div></div>
    );
  }
  return <div id="runbar" />;
}
function PlaceBanner() {
  if (!viewingElsewhere.value || view.value === 'log' || view.value === 'settings') return null;
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

export function App() {
  useEffect(() => { void start(); }, []);
  useEffect(() => {
    const onHash = () => { const v = fromHash(); if (v) view.value = v; };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  void lang.value;
  const V = { today: Today, matrix: Matrix, projects: Projects, calendar: Calendar, log: Log, settings: Settings }[view.value];
  return (
    <>
      <div class="app">
        <Mast />
        <Side />
        <Tabs />
        <Runbar />
        <main>
          <UpdateBanner />
          <PlaceBanner />
          {readOnly.value && <div class="banner warn"><p>{t('newerData')}</p><button class="btn small" type="button" onClick={() => location.reload()}>{t('reload')}</button></div>}
          {ready.value ? <V /> : <p class="hint" style="margin-top:24px">{t('loading')}</p>}
          <Footer />
        </main>
      </div>
      <SheetHost />
      <OverlayHost />
      <PreviewHost />
      <Moment />
      <Toast />
    </>
  );
}
