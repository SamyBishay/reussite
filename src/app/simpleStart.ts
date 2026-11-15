// The simple start (2026-11-15, src/domain/start.ts): which tabs show, the record that keeps an arrived tab, the one line behind Home's bell
// that announces it, Settings' Show every tab, and the check that gives a deck holding older cards (a backup restored, a deck joined by
// sync) everything on. An install from before has no `simpleSince`, so none of this changes anything for it.
import { effect, signal } from '@preact/signals';
import { ready, readOnly, settings, saveSettings, tasks, projects, db } from './store';
import { deckFacts } from './model';
import { onboarding } from './onboarding';
import { TABS, type View } from './nav';
import { getLocal, setLocal } from '../data/db';
import { EVERYTHING_ON } from '../data/settings';
import { ALL_TABS, GROW_TABS, fromBefore, tabShown, tabsToOpen, type GrowTab } from '../domain/start';

const grows = (v: View): v is GrowTab => (GROW_TABS as View[]).includes(v);

/** Is this tab in the tab bar? Home and Today always are; a hash or a link opens any tab, shown or not. */
export const tabOn = (v: View): boolean => !grows(v) || tabShown(v, settings.value.tabs, deckFacts.value);
/** The tab bar. Until the settings are read it shows what it showed last on this device, so a new install does not flash five tabs as it opens. */
const LAST = 'reussite.tabs';
const lastShown = (): View[] => { try { const v = JSON.parse(localStorage.getItem(LAST) ?? 'null'); return Array.isArray(v) ? TABS.filter(x => v.includes(x)) : TABS; } catch { return TABS; } };
export const shownTabs = (): View[] => (ready.value ? TABS.filter(tabOn) : lastShown());
export const everyTabShown = (): boolean => GROW_TABS.every(x => tabOn(x));

/** Show every tab (Settings): all of them at once, for good. */
export const showEveryTab = () => saveSettings({ tabs: ALL_TABS });

// ---------- the bell's line: tabs this device saw arrive, until the person has read it (device-local, like Next steps)
const NEWS = 'tabNews';
export const tabNews = signal<GrowTab[]>([]);
export async function loadTabNews(): Promise<void> {
  const v = await getLocal<unknown>(db, NEWS);
  tabNews.value = Array.isArray(v) ? v.filter((x): x is GrowTab => grows(x as View)) : [];
}
async function announce(arrived: GrowTab[]): Promise<void> {
  const next = [...tabNews.value, ...arrived.filter(x => !tabNews.value.includes(x))];
  tabNews.value = next;
  await setLocal(db, NEWS, next);
}
export async function dismissTabNews(): Promise<void> {
  tabNews.value = [];
  await setLocal(db, NEWS, []);
}

let busy = false;
/** Run once after start: records each tab the deck earns (it stays) and announces it once; a deck that holds older cards gets everything on. */
export function watchStart(): () => void {
  void loadTabNews();
  const keep = effect(() => { const v = shownTabs().join(','); try { localStorage.setItem(LAST, JSON.stringify(v.split(','))); } catch { /* the first paint shows every tab */ } });
  const grow = effect(() => {
    const s = settings.value, f = deckFacts.value;
    if (!ready.value || onboarding.value !== 'off' || readOnly.value || busy || !s.simpleSince) return;
    const created = [...[...tasks.value.values()].map(x => x.created), ...[...projects.value.values()].map(p => p.created)];
    if (fromBefore(s.simpleSince, created)) {
      busy = true;
      void saveSettings(EVERYTHING_ON).finally(() => { busy = false; });
      return;
    }
    const due = tabsToOpen(s.tabs, f);
    if (!due.length) return;
    busy = true;
    void (async () => {
      await saveSettings({ tabs: { ...s.tabs, ...Object.fromEntries(due.map(x => [x, true])) } });
      await announce(due);
    })().finally(() => { busy = false; });
  });
  return () => { keep(); grow(); };
}
