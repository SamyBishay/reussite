// First-run setup layout (request of 10 Nov; the pages are the language and the four kinds of time, and the pairing page; the AI screens are a sheet in Settings): every setup page starts right under the top padding (and the status-bar inset), scrolls when it is
// taller than the screen (by wheel and touch-scroll, as a person does, not by script), and its last button can be brought into view.
import { test, expect, type Page } from '@playwright/test';
import { noSideways, PHONES, LANGS } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

/** Where the page begins, whether it can be scrolled by the wheel, and whether its last control can be brought on screen. */
async function checkPage(page: Page, where: string) {
  await page.waitForTimeout(150);
  const info = () => page.evaluate(() => {
    const app = document.querySelector('.app.onboard') as HTMLElement, ob = document.querySelector('.ob') as HTMLElement;
    const controls = [...ob.querySelectorAll('button, a, input, select, textarea')].filter(e => (e as HTMLElement).getClientRects().length);
    const lowest = controls.reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);
    return {
      scrollY: window.scrollY, ih: window.innerHeight, sh: document.documentElement.scrollHeight,
      padTop: parseFloat(getComputedStyle(app).paddingTop), obTop: ob.getBoundingClientRect().top, lowest,
      locked: getComputedStyle(document.documentElement).overflow === 'hidden',
    };
  });
  const a = await info();
  expect(a.scrollY, where + ': a new page starts at the top').toBe(0);
  // Starts right under the top padding (which already holds the status-bar inset): at most one spacing step (the mark's margin) lower.
  expect(a.obTop, where + ': the page starts too low').toBeLessThanOrEqual(a.padTop + 25);
  expect(a.obTop, where + ': the page starts above its padding').toBeGreaterThanOrEqual(a.padTop - 1);
  expect(a.locked, where + ': the page is locked (home-lock)').toBe(false);
  await noSideways(page, where);
  if (a.sh > a.ih + 1 && test.info().project.name === 'iphone') {
    // Mobile WebKit has no mouse wheel (Playwright refuses it), so here the test asserts what makes a swipe able to scroll the page: the document is the
    // scroller and nothing locks it. The swipe itself stays on the owner's phone checklist (invariant 11, unverified on device).
    const s = await page.evaluate(() => {
      const ob = document.querySelector('.ob') as HTMLElement, root = document.documentElement;
      const cs = (e: Element) => getComputedStyle(e);
      // On the viewport's scroller, `visible` on html acts as `auto` (the overflow of html, or of body when html is visible, goes to the viewport).
      const viewportOverflow = cs(root).overflowY !== 'visible' ? cs(root).overflowY : cs(document.body).overflowY;
      const touchNone: string[] = [];
      for (let e: Element | null = ob; e; e = e.parentElement) if (cs(e).touchAction === 'none') touchNone.push(e.tagName + '.' + e.className);
      return {
        scroller: document.scrollingElement === root, viewportOverflow, rootOverflow: cs(root).overflowY, bodyOverflow: cs(document.body).overflowY,
        rootPos: cs(root).position, bodyPos: cs(document.body).position, touchNone, clientH: root.clientHeight, scrollH: root.scrollHeight,
        lock: root.classList.contains('home-lock'),
      };
    });
    expect(s.scroller, where + ': the document is not the scroller').toBe(true);
    expect(['auto', 'scroll', 'visible'], where + ': the scroller does not scroll (overflow-y ' + s.viewportOverflow + ')').toContain(s.viewportOverflow);
    expect(s.scrollH, where + ': scrollHeight does not exceed clientHeight').toBeGreaterThan(s.clientH);
    expect(s.lock, where + ': home-lock is on').toBe(false);
    expect([s.rootOverflow, s.bodyOverflow], where + ': html or body has overflow hidden').not.toContain('hidden');
    expect([s.rootPos, s.bodyPos], where + ': html or body is position fixed').not.toContain('fixed');
    expect(s.touchNone, where + ': touch-action none on an ancestor').toEqual([]);
    // A programmatic scroll brings the last control fully into view, and back.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY), { message: where + ': the page does not scroll' }).toBeGreaterThan(0);
    const b = await info();
    expect(b.lowest, where + ': the last control is below the screen').toBeLessThanOrEqual(b.ih + 0.5);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  } else if (a.sh > a.ih + 1) {
    // Taller than the screen: the wheel moves it, and the lowest control comes on screen.
    await page.mouse.move(a.ih / 4, a.ih / 2);
    for (let i = 0; i < Math.ceil(a.sh / 250); i++) { await page.mouse.wheel(0, 250); await page.waitForTimeout(40); }
    await expect.poll(() => page.evaluate(() => window.scrollY), { message: where + ': the page does not scroll' }).toBeGreaterThan(0);
    // Wait for the wheel to reach the end of the page.
    await expect.poll(() => page.evaluate(() => Math.round(document.documentElement.scrollHeight - window.innerHeight - window.scrollY)), { message: where + ': cannot reach the end' }).toBeLessThanOrEqual(1);
    const b = await info();
    expect(b.lowest, where + ': the last control is below the screen').toBeLessThanOrEqual(b.ih + 0.5);
    for (let i = 0; i < Math.ceil(a.sh / 250); i++) { await page.mouse.wheel(0, -250); await page.waitForTimeout(40); }
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
}

for (const [w, h] of PHONES) for (const lang of LANGS) {
  test(`every setup page scrolls, starts under the top and keeps its last button reachable (${w}×${h}, ${lang})`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    await expect(page.getByTestId('ob-language')).toBeVisible();
    if (lang === 'fr') await page.getByTestId('ob-lang-fr').click();
    await checkPage(page, 'first page');

    // The pairing page.
    await page.getByTestId('ob-pair-link').scrollIntoViewIfNeeded();
    await page.getByTestId('ob-pair-link').click();
    await expect(page.getByTestId('ob-pair')).toBeVisible();
    await checkPage(page, 'pair page');
    await page.getByTestId('ob-back').click();
    await expect(page.getByTestId('ob-language')).toBeVisible();

    // The four kinds of time. After scrolling to the bottom of one page, the next starts at the top.
    await page.getByTestId('ob-next').scrollIntoViewIfNeeded();
    await page.getByTestId('ob-next').click();
    await expect(page.getByTestId('ob-pillars')).toBeVisible();
    await checkPage(page, 'categories page');
    await page.getByTestId('ob-next').scrollIntoViewIfNeeded();
    await page.getByTestId('ob-next').click();
    // Start goes Home: no third page, and Home locks the page again as it always did.
    await expect(page.getByTestId('home')).toBeVisible();
  });
}

for (const [w, h] of PHONES) {
  test(`on the iPhone home-screen app the setup pages start below the status-bar band (${w}×${h})`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    await expect(page.getByTestId('ob-language')).toBeVisible();
    // The class `ios-app` (src/app/ios.ts) raises the top inset to 62px; only a phone can show the real one (invariant 11: unverified on device).
    await page.evaluate(() => document.documentElement.classList.add('ios-app'));
    await checkPage(page, 'first page, ios-app');
    const top = await page.locator('.ob').first().evaluate(e => e.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(62);
    await page.getByTestId('ob-next').click();
    await expect(page.getByTestId('ob-pillars')).toBeVisible();
    await checkPage(page, 'categories page, ios-app');
    expect(await page.locator('.ob').first().evaluate(e => e.getBoundingClientRect().top)).toBeGreaterThanOrEqual(62);
  });
}
