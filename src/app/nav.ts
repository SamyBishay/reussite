// Where the person is: the current view, the hash that names it, and the Calendar's mode.
// The five tabs are the main places; Settings, Addresses & people, Memory and History sit behind the menu on Home.
import { signal } from '@preact/signals';

export type View = 'home' | 'today' | 'matrix' | 'projects' | 'calendar' | 'settings' | 'memory' | 'history' | 'addresses' | 'notifications';
export const TABS: View[] = ['home', 'today', 'matrix', 'projects', 'calendar'];
const VIEWS: View[] = [...TABS, 'settings', 'memory', 'history', 'addresses', 'notifications'];

/** Week and month are remembered; the Log is a mode of the Calendar that you open on purpose. */
export type CalMode = 'week' | 'month' | 'log';
const storedMode = (): 'week' | 'month' => { try { return localStorage.getItem('reussite.cal') === 'month' ? 'month' : 'week'; } catch { return 'week'; } };
export const calMode = signal<CalMode>(storedMode());
export function setCalMode(m: CalMode) {
  calMode.value = m;
  if (m !== 'log') try { localStorage.setItem('reussite.cal', m); } catch { /* fine */ }
}

/** A view from a hash or a stored name. The Log used to be a tab of its own: `log` opens the Calendar's Log. */
function named(h: string | null): View | null {
  if (h === 'log') { calMode.value = 'log'; return 'calendar'; }
  return VIEWS.includes(h as View) ? (h as View) : null;
}
export const fromHash = (): View | null => named(location.hash.slice(1));
const stored = (): View => { try { return named(localStorage.getItem('reussite.view')) ?? 'home'; } catch { return 'home'; } };
export const view = signal<View>(fromHash() ?? stored());

export function go(v: View) {
  view.value = v;
  try { localStorage.setItem('reussite.view', v); history.replaceState(null, '', '#' + v); } catch { /* fine */ }
  window.scrollTo({ top: 0 });
}
