// The top edge of the page (2026-11-11). One element, `#topbar`, sits in index.html before the script runs: sticky at the top of the viewport, full width, fully opaque
// (the page's ground, no alpha, no filter), with the status bar's room (`--sat`) as its top padding. Safari 26 web apps fill the status bar with the colour of a fixed or sticky
// element at the top edge and show a soft blur when there is none, so this is a real element at y = 0, not a pseudo-element, and it is never re-created: this component
// renders into it once (main.tsx) and only its content changes with the screen. Content starts below it by layout, because it is in the flow (see docs/dev/topbar.md).
import { dayDoc, minutesOn, placesOn } from './model';
import { here, pageView, places, ready, today } from './store';
import { viewsElsewhere } from '../domain/view';
import { placeName, areaName } from './sheets';
import { openPlaceMenu } from './PlacesSheet';
import { view, type View } from './nav';
import { onboarding } from './onboarding';
import { HomeBar } from '../views/Home';
import { t, lang, fmtDate, fmtMin, type Key } from '../i18n';

/** Home, Settings and the screens behind Home's bell and menu have no masthead; they have Home's bar or their title. */
export const BARE: View[] = ['home', 'notifications', 'settings', 'memory', 'history', 'addresses', 'waiting'];
/** Views that get a wider column above 1024 px (brief §16). */
export const WIDE: View[] = ['matrix', 'calendar'];
export const TAB_KEY: Record<string, Key> = { home: 'tabHome', today: 'tabToday', matrix: 'tabMatrix', projects: 'tabProjects', calendar: 'tabCalendar' };
/** The title of each screen behind Home. */
const TITLE_KEY: Partial<Record<View, Key>> = { notifications: 'notifTitle', settings: 'tabSettings', memory: 'memoryTitle', history: 'historyTitle', addresses: 'addrTitle', waiting: 'waitingTitle' };

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
      {placesOn() && <PlacePill />}
    </header>
  );
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);


/** What the top edge holds: Home's bar, a tab's date and place pill, or the title of a screen behind Home. Nothing while the app loads or first-run set-up shows (the element itself stays). */
export function Topbar() {
  void lang.value;
  const v = view.value;
  if (!ready.value || onboarding.value === 'show') return null;
  const side = v === 'today';
  return (
    <div class={'topbar-in' + (WIDE.includes(v) ? ' wide' : '') + (side ? ' has-side' : '')} data-testid="topbar-in">
      {v === 'home' ? <HomeBar /> : BARE.includes(v) ? <h2 class="sec topbar-title">{t(TITLE_KEY[v]!)}</h2> : <Mast />}
    </div>
  );
}
