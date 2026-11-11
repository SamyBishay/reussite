// The top edge (2026-11-11, src/app/Topbar.tsx, docs/dev/topbar.md). Safari 26 web apps fill the status bar with the colour of a fixed or sticky element at the top of the
// viewport, and show a soft blur when there is none. The page's `#topbar` is that element: in index.html (so it exists before any script), sticky at y = 0, full width,
// opaque, never re-created, and every screen starts below it by layout. (The band before this was `html::before`, a pseudo-element 2px above the screen.)
//
// WARNING: these tests prove the element is built and placed as designed, in the engines Playwright has. They do not prove what an iPhone's status bar does with it: that can
// only be read on the phone (Settings → Layout diagnostics shows the same numbers). Invariant 11: unverified on device.
import { test, expect, type Page } from '@playwright/test';
import { importSample, morningClock } from './helpers';

/** Spoofs the iPhone home-screen app in an engine that is not one: `ios-app` goes on <html>, and, since the emulated inset reads 0, so does `ios-noinset`. */
async function island(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    Object.defineProperty(screen, 'width', { get: () => innerWidth });
    Object.defineProperty(screen, 'height', { get: () => innerHeight });
  });
}

/** The top edge's box and paint, and every interactive thing outside it whose visible part starts above its bottom edge. */
async function topEdge(page: Page) {
  return page.evaluate(() => {
    const tb = document.getElementById('topbar')!;
    const c = getComputedStyle(tb), r = tb.getBoundingClientRect();
    const alpha = (css: string) => {
      const m = css.match(/rgba?\(([^)]+)\)/);
      if (!m) return 0;
      const p = m[1]!.split(/[ ,/]+/).filter(Boolean);
      return p.length > 3 ? Number(p[3]) : 1;
    };
    const interactive = [...document.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,summary,[role="button"],[tabindex]:not([tabindex="-1"])')];
    const above: string[] = [];
    for (const e of interactive) {
      if (tb.contains(e)) continue;
      const cs = getComputedStyle(e), b = e.getBoundingClientRect();
      if (b.width <= 1 || b.height <= 1 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      // The visible part starts where the element does, or where a clipping ancestor does, whichever is lower.
      let top = b.top;
      for (let a = e.parentElement; a; a = a.parentElement) {
        const o = getComputedStyle(a);
        if (o.overflowY !== 'visible' || o.overflowX !== 'visible') top = Math.max(top, a.getBoundingClientRect().top);
      }
      if (top < r.bottom - 0.5 && b.bottom > 0) above.push(e.tagName.toLowerCase() + (e.getAttribute('data-testid') ? '[' + e.getAttribute('data-testid') + ']' : '.' + e.className) + ' at ' + Math.round(top));
    }
    return {
      position: c.position, top: r.top, left: r.left, width: r.width, bottom: r.bottom, vw: document.documentElement.clientWidth,
      bg: c.backgroundColor, bgAlpha: alpha(c.backgroundColor), bodyBg: getComputedStyle(document.body).backgroundColor, opacity: c.opacity,
      filter: c.backdropFilter || 'none', padTop: parseFloat(c.paddingTop), above,
    };
  });
}

const VIEWS = ['home', 'today', 'matrix', 'projects', 'calendar', 'settings', 'memory', 'history', 'addresses', 'waiting', 'notifications'];

for (const w of [320, 375, 430]) {
  test.describe(`${w}px wide`, () => {
    test.use({ viewport: { width: w, height: 760 } });

    for (const scheme of ['light', 'dark'] as const) {
      test(`${scheme}: on every screen the top edge is at 0, full width and opaque, and nothing interactive starts above its bottom`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.emulateMedia({ colorScheme: scheme });
        await morningClock(page);
        await importSample(page);
        for (const v of VIEWS) {
          await page.evaluate(h => { location.hash = '#' + h; }, v);
          await expect(page.locator(`.app[data-view="${v}"]`)).toBeVisible();
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(120);
          const e = await topEdge(page);
          expect(e.position, v).toBe('sticky');
          expect(e.top, v).toBe(0);
          expect(e.left, v).toBe(0);
          expect(e.width, v).toBe(e.vw);
          expect(e.bgAlpha, v + ': the background has alpha').toBe(1);
          expect(e.bg, v + ': not the page ground').toBe(e.bodyBg);
          expect(e.opacity, v).toBe('1');
          expect(e.filter, v).toBe('none');
          expect(e.above, v + ': interactive content above the top edge\'s bottom').toEqual([]);
          // Scrolled as far as the page goes (Home and the Calendar keep to their own box): it is still at 0 and what is under its strip is itself.
          await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
          await page.waitForTimeout(80);
          const hit = await page.evaluate(() => {
            const tb = document.getElementById('topbar')!, r = tb.getBoundingClientRect();
            const out: string[] = [];
            for (const y of [1, r.bottom / 2, r.bottom - 1]) for (const x of [4, innerWidth / 2, innerWidth - 4]) {
              const el = document.elementFromPoint(x, y);
              if (el && !tb.contains(el)) out.push(el.tagName + '.' + el.className + ' at ' + Math.round(y));
            }
            return { top: r.top, out };
          });
          expect(hit.top, v + ' scrolled').toBe(0);
          expect(hit.out, v + ': content shows in the top edge once scrolled').toEqual([]);
        }
      });
    }

    test('it is the same element across tab switches, and the tabs sit below it', async ({ page }) => {
      await morningClock(page);
      await page.goto('/#home');
      await expect(page.getByTestId('home')).toBeVisible();
      await page.evaluate(() => { (window as unknown as { __tb: Element }).__tb = document.getElementById('topbar')!; });
      for (const tab of ['today', 'matrix', 'projects', 'calendar', 'home']) {
        await page.getByTestId('tab-' + tab).click();
        await expect(page.locator(`.app[data-view="${tab}"]`)).toBeVisible();
        const same = await page.evaluate(() => document.getElementById('topbar') === (window as unknown as { __tb: Element }).__tb && document.body.contains((window as unknown as { __tb: Element }).__tb));
        expect(same, tab).toBe(true);
        expect((await topEdge(page)).top, tab).toBe(0);
      }
    });

    test('an iPhone home-screen app that reports no inset gets 86px of status-bar room in the top edge, and the screens start below it', async ({ page }) => {
      await island(page);
      await morningClock(page);
      await page.goto('/#home');
      await expect(page.locator('html')).toHaveClass(/ios-app/);
      await expect(page.locator('html')).toHaveClass(/ios-noinset/);
      let e = await topEdge(page);
      expect(e.padTop).toBe(86);
      expect(e.above).toEqual([]);
      for (const id of ['home-clock', 'home-bell', 'home-menu']) expect((await page.getByTestId(id).boundingBox())!.y, id).toBeGreaterThanOrEqual(86);
      await page.getByTestId('tab-today').click();
      await expect(page.locator('.app[data-view="today"]')).toBeVisible();
      e = await topEdge(page);
      expect(e.padTop).toBe(86);
      expect(e.above).toEqual([]);
    });
  });
}

test('without the fallback class the top edge pads by exactly the inset the browser reports', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // the floor is for portrait
  await page.goto('/#today');
  await expect(page.locator('html')).not.toHaveClass(/ios-noinset/);
  // `ios-app` alone (the inset is reported): no floor.
  await page.evaluate(() => document.documentElement.classList.add('ios-app'));
  expect((await topEdge(page)).padTop).toBe(0);
  await page.evaluate(() => document.documentElement.classList.add('ios-noinset'));
  expect((await topEdge(page)).padTop).toBe(86);
});

test('the top edge is in the page before the script runs: with every script blocked it is there, sticky at 0, full width and opaque', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/\.js(\?.*)?$/, route => route.abort());
  await page.goto('/');
  await expect(page.locator('#topbar')).toHaveCount(1);
  expect(await page.locator('#root').evaluate(el => el.childElementCount)).toBe(0); // nothing of the app has run
  const e = await topEdge(page);
  expect(e).toMatchObject({ position: 'sticky', top: 0, left: 0, width: 390, opacity: '1', bgAlpha: 1 });
  expect(e.bg).toBe(e.bodyBg);
});

test('a sheet and its scrim sit above the top edge', async ({ page }) => {
  await island(page);
  await page.goto('/#home');
  await page.getByTestId('home-menu').click();
  const z = await page.evaluate(() => {
    const bar = Number(getComputedStyle(document.getElementById('topbar')!).zIndex);
    const scrim = document.querySelector('.scrim');
    return { bar, scrim: scrim ? Number(getComputedStyle(scrim).zIndex) : null };
  });
  expect(z.scrim).not.toBeNull();
  expect(z.scrim!).toBeGreaterThan(z.bar);
});
