// Layout diagnostics (10 Nov): what this device says about its top edge, measured, so the iPhone's blurred band can be fixed from what it really reports
// and not guessed (five blind attempts on 1 Nov). Nothing here changes the layout. It draws two thin lines over the page: red at the inset the browser
// reports (`env(safe-area-inset-top)`, measured with a probe), blue where the page's content begins. A screenshot of this screen is the evidence.
import { useEffect, useState } from 'preact/hooks';
import { overlay } from './sheet';
import { t } from '../i18n';

export const openLayoutDiagnostics = () => { window.scrollTo(0, 0); overlay.value = <LayoutDiagnostics />; };
const close = () => { overlay.value = null; };

const px = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? '—' : (Math.round(n * 100) / 100) + ' px');
const meta = (name: string): string => {
  const els = [...document.querySelectorAll<HTMLMetaElement>(`meta[name="${name}"]`)];
  return els.length ? els.map(e => e.content + (e.media ? ` (${e.media})` : '')).join(' · ') : '—';
};

/** A hidden element with the given CSS height, measured: how the browser resolves `env(...)` and `var(--sat)`. */
function probe(height: string): number {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:${height}`;
  document.body.appendChild(el);
  const h = el.getBoundingClientRect().height;
  el.remove();
  return h;
}

export interface Reading {
  standalone: string; displayStandalone: string; inset: number; applied: number; appPad: number; contentTop: number | null; contentWhat: string;
  innerHeight: number; vvHeight: number | null; vvOffsetTop: number | null; vvScale: number | null; screenHeight: number; iosClass: boolean;
  viewport: string; statusBar: string; themeColor: string; touchCallout: string; ua: string;
}

export function read(): Reading {
  const nav = navigator as Navigator & { standalone?: boolean };
  const app = document.querySelector('.app') as HTMLElement | null, main = document.querySelector('.app main, main') as HTMLElement | null;
  const first = (main?.firstElementChild ?? main) as HTMLElement | null;
  const vv = window.visualViewport;
  return {
    standalone: nav.standalone === undefined ? 'undefined' : String(nav.standalone),
    displayStandalone: String(matchMedia('(display-mode: standalone)').matches),
    inset: probe('env(safe-area-inset-top, 0px)'),
    applied: probe('var(--sat)'),
    appPad: app ? parseFloat(getComputedStyle(app).paddingTop) : NaN,
    contentTop: first ? first.getBoundingClientRect().top : null,
    contentWhat: first ? first.tagName.toLowerCase() + (first.dataset.testid ? '[' + first.dataset.testid + ']' : first.className ? '.' + String(first.className).split(' ')[0] : '') : '',
    innerHeight: window.innerHeight,
    vvHeight: vv ? vv.height : null, vvOffsetTop: vv ? vv.offsetTop : null, vvScale: vv ? vv.scale : null,
    screenHeight: screen.height,
    iosClass: document.documentElement.classList.contains('ios-app'),
    viewport: meta('viewport'), statusBar: meta('apple-mobile-web-app-status-bar-style'), themeColor: meta('theme-color'),
    touchCallout: typeof CSS !== 'undefined' && CSS.supports ? String(CSS.supports('-webkit-touch-callout', 'none')) : '—',
    ua: /iPhone|iPod|iPad/.test(navigator.userAgent) ? navigator.userAgent.replace(/^Mozilla\/5\.0 /, '') : navigator.userAgent.slice(0, 60),
  };
}

export function LayoutDiagnostics() {
  const [r, setR] = useState<Reading>(() => read());
  useEffect(() => {
    const upd = () => setR(read());
    window.addEventListener('resize', upd);
    window.visualViewport?.addEventListener('resize', upd);
    window.visualViewport?.addEventListener('scroll', upd);
    const i = setInterval(upd, 1000);
    return () => { window.removeEventListener('resize', upd); window.visualViewport?.removeEventListener('resize', upd); window.visualViewport?.removeEventListener('scroll', upd); clearInterval(i); };
  }, []);
  const rows: [string, string, string][] = [
    ['standalone', t('diagLStandalone'), r.standalone],
    ['display', t('diagLDisplay'), r.displayStandalone],
    ['inset', t('diagLInset'), px(r.inset)],
    ['applied', t('diagLApplied'), px(r.applied) + ' · ' + t('diagLAppPad', { n: px(r.appPad) }) + (r.iosClass ? ' · ios-app' : '')],
    ['content', t('diagLContent'), px(r.contentTop) + ' · ' + r.contentWhat],
    ['inner', t('diagLInner'), px(r.innerHeight)],
    ['vv', t('diagLVv'), px(r.vvHeight) + ' · ' + t('diagLVvTop', { n: px(r.vvOffsetTop) }) + (r.vvScale != null && r.vvScale !== 1 ? ' · ×' + r.vvScale : '')],
    ['screen', t('diagLScreen'), px(r.screenHeight)],
    ['viewport', t('diagLViewport'), r.viewport],
    ['statusbar', t('diagLStatus'), r.statusBar],
    ['theme', t('diagLTheme'), r.themeColor],
    ['callout', t('diagLCallout'), r.touchCallout],
    ['ua', t('diagLUa'), r.ua],
  ];
  return (
    <div class="layoutdiag" role="dialog" aria-modal="true" aria-label={t('diagLTitle')} data-testid="layout-diag">
      {/* The two lines are fixed to the screen's top: red at the inset the browser reports, blue where the page's content begins. */}
      <div class="ld-line ld-inset" style={`top:${r.inset}px`} data-testid="ld-line-inset" data-y={String(r.inset)} />
      {r.contentTop != null && <div class="ld-line ld-content" style={`top:${r.contentTop}px`} data-testid="ld-line-content" data-y={String(r.contentTop)} />}
      <div class="ld-body">
        <h2>{t('diagLTitle')}</h2>
        <p class="hint">{t('diagLHint')}</p>
        <p class="ld-key"><span class="ld-sw ld-inset" /> {t('diagLRed')} · <span class="ld-sw ld-content" /> {t('diagLBlue')}</p>
        <dl class="ld-rows">
          {rows.map(([k, label, value]) => <div class="ld-row" data-testid={'ld-' + k}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <div class="actions"><button class="btn primary" type="button" onClick={close} data-testid="ld-close">{t('close')}</button></div>
      </div>
    </div>
  );
}
