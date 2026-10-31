// Where the person is: the current view, the hash that names it, and the Calendar's mode.
// The five tabs are the main places; Settings, Addresses & people, Memory, History and Waiting for sit behind the menu on Home.
import { signal } from '@preact/signals';

export type View = 'home' | 'today' | 'matrix' | 'projects' | 'calendar' | 'settings' | 'memory' | 'history' | 'addresses' | 'notifications' | 'waiting';
export const TABS: View[] = ['home', 'today', 'matrix', 'projects', 'calendar'];
const VIEWS: View[] = [...TABS, 'settings', 'memory', 'history', 'addresses', 'notifications', 'waiting'];

/** Day, Week, Month and the Agenda list are remembered; the Log is a mode of the Calendar that you open on purpose. */
export type CalMode = 'day' | 'week' | 'month' | 'agenda' | 'log';
export const CAL_MODES: CalMode[] = ['day', 'week', 'month', 'agenda', 'log'];
/** Below this width (px) the Calendar is a phone's: Day and the Agenda by default, and a week is three days. */
export const PHONE_WIDTH = 768;
/** Days a phone's "week" shows, starting on the date shown. */
export const PHONE_DAYS = 3;
export const isPhone = (): boolean => typeof window !== 'undefined' && window.innerWidth < PHONE_WIDTH;
/** What the Calendar opens on when the person never chose: Day on a phone, Week on a tablet or a computer. */
const storedMode = (): Exclude<CalMode, 'log'> => {
  try {
    const m = localStorage.getItem('reussite.cal');
    if (m === 'day' || m === 'week' || m === 'month' || m === 'agenda') return m;
  } catch { /* fine */ }
  return isPhone() ? 'day' : 'week';
};
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
/** `#task/<id>`: a link (from a calendar event) that opens a step. The hash is put back to the current view once it is read. */
export const taskFromHash = (): string | null => {
  const m = /^#task\/(.+)$/.exec(location.hash);
  if (!m) return null;
  try { return decodeURIComponent(m[1]!); } catch { return null; }
};
const stored = (): View => { try { return named(localStorage.getItem('reussite.view')) ?? 'home'; } catch { return 'home'; } };
export const view = signal<View>(fromHash() ?? stored());

/** Forget a `#task/<id>` in the address bar, so a reload does not open the step again. */
export function clearTaskHash() {
  try { history.replaceState(null, '', '#' + view.value); } catch { /* fine */ }
}

export function go(v: View) {
  view.value = v;
  try { localStorage.setItem('reussite.view', v); history.replaceState(null, '', '#' + v); } catch { /* fine */ }
  window.scrollTo({ top: 0 });
}
