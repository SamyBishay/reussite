// The app installed on an iPhone's home screen. On a phone with a Dynamic Island the page runs under the status bar, but
// `env(safe-area-inset-top)` has been seen to read 0 there (WebKit bug 301994; and the title sat under the island on the owner's phone),
// so the top of every screen is padded by `--sat` (src/styles/tokens.css): the inset, or at least 62px (an iPhone 16 Pro's or 17's island; 59px on a 14 Pro to 15)
// when this class says the page is that app. A fixed band of that height in the page's ground (`html::before`, tokens.css) keeps scrolled content from showing under the status bar. The class goes on <html> at start-up (`markIosApp`, called from main.tsx).

/** What the detection reads; the browser's own objects fill it in `markIosApp`, a test fills it by hand. */
export interface IosEnv {
  /** `navigator.standalone`: true only for a web app launched from the iOS home screen. */
  standalone?: boolean;
  /** `matchMedia('(display-mode: standalone)').matches` */
  displayStandalone?: boolean;
  userAgent?: string;
  /** `CSS.supports('-webkit-touch-callout', 'none')`: WebKit on iOS only. */
  touchCallout?: boolean;
  /** `screen.height - innerHeight` in portrait, in px: a system bar that takes room above the page shows here. */
  chromeGap?: number;
}

/** An iPhone's home-screen app: `navigator.standalone`, or the standalone display mode together with an iPhone user agent and iOS-only WebKit. iPads have no island and report their inset. */
export function isIosApp(e: IosEnv): boolean {
  const phone = /iPhone|iPod/.test(e.userAgent ?? '');
  if (!phone) return false;
  return e.standalone === true || (!!e.displayStandalone && !!e.touchCallout);
}

/** The class on <html>: yes for an iPhone's home-screen app whose page runs under the status bar. When the system draws an opaque bar above the page (a gap of more than 30px between the screen and the page) the page already starts below it and needs no more room. */
export function wantsIosClass(e: IosEnv): boolean {
  return isIosApp(e) && !((e.chromeGap ?? 0) > 30);
}

export const IOS_CLASS = 'ios-app';

export function markIosApp(): boolean {
  if (typeof document === 'undefined') return false;
  const w = window as unknown as { navigator: Navigator & { standalone?: boolean } };
  let touchCallout = false, displayStandalone = false;
  try { touchCallout = !!(window.CSS && CSS.supports('-webkit-touch-callout', 'none')); } catch { /* none */ }
  try { displayStandalone = window.matchMedia('(display-mode: standalone)').matches; } catch { /* none */ }
  const portrait = window.innerHeight >= window.innerWidth;
  const env: IosEnv = {
    standalone: w.navigator.standalone, displayStandalone, touchCallout, userAgent: navigator.userAgent,
    chromeGap: portrait ? Math.max(screen.width, screen.height) - Math.max(innerWidth, innerHeight) : 0,
  };
  const on = wantsIosClass(env);
  document.documentElement.classList.toggle(IOS_CLASS, on);
  return on;
}
