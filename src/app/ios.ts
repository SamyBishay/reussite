// The app installed on an iPhone's home screen. On a phone with a Dynamic Island the page runs under the status bar, and `env(safe-area-inset-top)` has been seen to read 0 there
// (WebKit bug 301994; the title sat under the island on the owner's phone). The top edge (`#topbar`, src/app/Topbar.tsx) is padded by `--sat` (src/styles/tokens.css): the inset the
// browser reports, and only when it reports 0 in this app, in portrait, 86px (an island is 59 to 62px tall; the status bar's blur fades out about 83px down). The classes go on <html>:
// `ios-app` at start-up (`markIosApp`, called from main.tsx), and `ios-noinset` while the inset reads 0 in portrait.

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

/** The floor applies only to an iPhone's home-screen app, in portrait, whose inset reads 0 (less than half a pixel). */
export function wantsNoInsetClass(on: boolean, insetPx: number, portrait: boolean): boolean {
  return on && portrait && !(insetPx >= 0.5);
}

export const IOS_CLASS = 'ios-app';
export const NOINSET_CLASS = 'ios-noinset';

/** What `env(safe-area-inset-top)` resolves to, measured with a hidden element. */
function readInset(): number {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-top,0px)';
  document.documentElement.appendChild(el);
  const h = el.getBoundingClientRect().height;
  el.remove();
  return h;
}

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
  markInset(on);
  if (on && !watching) {
    watching = true;
    // Turning the phone changes what the inset reads: look again.
    const again = () => markInset(true);
    window.addEventListener('resize', again);
    window.addEventListener('orientationchange', again);
  }
  return on;
}

let watching = false;
function markInset(on: boolean) {
  const portrait = window.innerHeight >= window.innerWidth;
  // In landscape the inset is 0 by design and the floor is not used: leave the class as it was.
  if (on && !portrait) return;
  document.documentElement.classList.toggle(NOINSET_CLASS, wantsNoInsetClass(on, on ? readInset() : 0, portrait));
}
