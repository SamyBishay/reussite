// The band under the status bar and the island (2026-11-01): in an iPhone's home-screen app the page runs under the status bar, so a fixed band the height of --sat,
// in the page's ground, covers that strip above everything that scrolls (`html::before`, tokens.css). Nothing scrolled shows under it, on any screen, in either theme.
import { test, expect, type Page } from '@playwright/test';
import { importSample, morningClock } from './helpers';

test.use({ viewport: { width: 390, height: 844 } });

/**
 * WARNING (10 Nov): this spoofs `navigator.standalone`, the user agent and `screen`, so the app takes its iPhone branch in Firefox. It proves the band's
 * CSS is built and positioned as designed under THAT assumption. It does not prove what an iPhone does: the real `env(safe-area-inset-top)`, the real
 * status-bar style and the real visual viewport can only be read on the phone (Settings → Layout diagnostics). Five fixes on 1 Nov passed this test and
 * the phone still failed. Invariant 11: unverified on device.
 */
async function island(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    Object.defineProperty(screen, 'width', { get: () => innerWidth });
    Object.defineProperty(screen, 'height', { get: () => innerHeight });
  });
}

/** What is hit in the top strip: the band is a pseudo-element of <html>, so anything else there is content showing through. */
async function stripHits(page: Page) {
  return page.evaluate(() => {
    const sat = parseFloat(getComputedStyle(document.documentElement, '::before').height) - 2; // the band reaches 2px above the screen
    const hits = new Set<string>();
    for (const y of [1, 20, Math.floor(sat / 2), sat - 1]) for (const x of [4, 100, 195, 290, 385]) {
      const el = document.elementFromPoint(x, y);
      if (el && el !== document.documentElement) hits.add(el.tagName + '.' + el.className);
    }
    return { sat, hits: [...hits] };
  });
}

const VIEWS = ['home', 'today', 'matrix', 'projects', 'calendar', 'settings', 'memory', 'history', 'addresses', 'waiting'];

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: scrolled content never shows under the status bar and the island, on every screen`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    await island(page);
    await morningClock(page);
    await importSample(page);
    await expect(page.locator('html')).toHaveClass(/ios-app/);
    for (const v of VIEWS) {
      await page.evaluate(h => { location.hash = '#' + h; }, v);
      await expect(page.locator(`.app[data-view="${v}"]`)).toBeVisible();
      await page.waitForTimeout(150);
      const before = await stripHits(page);
      expect(before.sat, v).toBe(62);
      expect(before.hits, v + ': content in the strip').toEqual([]);
      // Scroll the page as far as it goes (Home and the Calendar's grid keep to their own box) and look again.
      await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
      await page.waitForTimeout(100);
      const after = await stripHits(page);
      expect(after.hits, v + ': content in the strip once scrolled').toEqual([]);
      // The band is the page's ground.
      const same = await page.evaluate(() => getComputedStyle(document.documentElement, '::before').backgroundColor === getComputedStyle(document.body).backgroundColor);
      expect(same, v + ': the band is not the ground').toBe(true);
    }
  });
}

test('the band is only its 2px above the screen where there is no status bar room', async ({ page }) => {
  await page.goto('/#today');
  await expect(page.locator('html')).not.toHaveClass(/ios-app/);
  const h = await page.evaluate(() => getComputedStyle(document.documentElement, '::before').height);
  expect(parseFloat(h)).toBe(2); // only its 2px above the screen
});

test('a sheet and its scrim sit above the band', async ({ page }) => {
  await island(page);
  await page.goto('/#home');
  await page.getByTestId('home-menu').click();
  const z = await page.evaluate(() => {
    const band = Number(getComputedStyle(document.documentElement, '::before').zIndex);
    const scrim = document.querySelector('.scrim');
    return { band, scrim: scrim ? Number(getComputedStyle(scrim).zIndex) : null };
  });
  expect(z.scrim).not.toBeNull();
  expect(z.scrim!).toBeGreaterThan(z.band);
});
