// First-run setup layout (request of 10 Nov): every setup page starts right under the top padding (and the status-bar inset), scrolls when it is
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
  if (a.sh > a.ih + 1) {
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

    // The AI option page (a key): the last option, then the next page.
    await page.getByTestId('ob-way-none').scrollIntoViewIfNeeded();
    await page.getByTestId('ob-way-key').click();
    await expect(page.getByTestId('ob-key')).toBeVisible();
    await checkPage(page, 'key page');
    await page.getByTestId('ob-back').click();
    await expect(page.getByTestId('ob-language')).toBeVisible();

    // The connector path.
    await page.getByTestId('ob-way-connector').click();
    await expect(page.getByTestId('ob-basics')).toBeVisible();
    await checkPage(page, 'basics page');
    await page.getByTestId('ob-back').click();

    // Any chatbot.
    await page.getByTestId('ob-copypaste-link').click();
    await expect(page.getByTestId('ob-paste')).toBeVisible();
    await checkPage(page, 'paste page');
    await page.getByTestId('ob-back').click();

    // The pairing page.
    await page.getByTestId('ob-pair-link').click();
    await expect(page.getByTestId('ob-pair')).toBeVisible();
    await checkPage(page, 'pair page');
    await page.getByTestId('ob-back').click();

    // By myself: pillars, places, done. After scrolling to the bottom of one page, the next starts at the top.
    await page.getByTestId('ob-way-none').click();
    await expect(page.getByTestId('ob-pillars')).toBeVisible();
    await checkPage(page, 'pillars page');
    await page.getByTestId('ob-next').scrollIntoViewIfNeeded();
    await page.getByTestId('ob-next').click();
    await expect(page.getByTestId('ob-places')).toBeVisible();
    await checkPage(page, 'places page');
    await page.getByTestId('ob-place-name').first().fill('Home');
    await page.getByTestId('ob-next').scrollIntoViewIfNeeded();
    await page.getByTestId('ob-next').click();
    await expect(page.locator('.ob').first()).toBeVisible();
    await checkPage(page, 'page after places');
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
    await page.getByTestId('ob-way-key').click();
    await checkPage(page, 'key page, ios-app');
    expect(await page.locator('.ob').first().evaluate(e => e.getBoundingClientRect().top)).toBeGreaterThanOrEqual(62);
  });
}
