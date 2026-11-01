// Home's top and its clock (2026-11-01): the wordmark and the date on the left, the Dove clock that says the time, the mark centred above the greeting,
// and the iPhone home-screen app's room for the island.
import { test, expect } from '@playwright/test';
import { stubNow, noSideways } from './helpers';

test('Home shows the wordmark as its h1, the date under it, and the greeting centred under the mark', async ({ page }) => {
  await stubNow(page, new Date(2026, 10, 1, 15, 15, 0));
  await page.goto('/#home');
  const h1 = page.getByTestId('home').locator('h1');
  await expect(h1).toHaveText('Réussite');
  await expect(h1).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  const b = await h1.boundingBox(), g = await page.getByTestId('greeting-hello').boundingBox(), m = await page.locator('.hello .mark').boundingBox();
  const home = await page.getByTestId('home').boundingBox();
  expect(b!.x - home!.x).toBeLessThan(4);
  const mid = home!.x + home!.width / 2;
  expect(Math.abs(g!.x + g!.width / 2 - mid)).toBeLessThan(2);
  expect(Math.abs(m!.x + m!.width / 2 - mid)).toBeLessThan(2);
  expect(m!.y + m!.height).toBeLessThanOrEqual(g!.y + 1);
  await noSideways(page, 'home');
});

test('the clock says the time, in words, and follows the minute', async ({ page }) => {
  test.setTimeout(75_000);
  await stubNow(page, new Date(2026, 10, 1, 15, 15, 0));
  await page.goto('/#home');
  const clock = page.getByTestId('home-clock');
  await expect(clock).toHaveAttribute('role', 'img');
  await expect(clock).toHaveAttribute('data-time', '15:15');
  await expect(clock).toHaveAttribute('aria-label', 'Clock: quarter past three');
  // the hour hand is a quarter of the way past three, the minute hand at the three
  await expect(clock.locator('.clk-min')).toHaveAttribute('transform', /rotate\(90 /);
  await expect(clock.locator('.clk-hour')).toHaveAttribute('transform', /rotate\(97\.5 /);
  await page.evaluate(() => localStorage.setItem('e2e.now', String(new Date(2026, 10, 1, 21, 50, 0).getTime())));
  await expect(clock).toHaveAttribute('data-time', '21:50', { timeout: 45_000 });
  await expect(clock).toHaveAttribute('aria-label', 'Clock: ten to ten');
});

test('the clock is drawn in the theme\'s own colours', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/#home');
  const fill = () => page.getByTestId('home-clock').locator('.clk-r').evaluate(el => getComputedStyle(el).fill);
  const light = await fill();
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await fill();
  expect(light).not.toBe(dark);
});

test('an iPhone home-screen app gets the ios-app class and at least 54px above the content, even when the inset reads 0', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    // The emulated screen is the device's, not the window's: say it is the same, so no system bar is taken to sit above the page.
    Object.defineProperty(screen, 'width', { get: () => innerWidth });
    Object.defineProperty(screen, 'height', { get: () => innerHeight });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#home');
  await expect(page.locator('html')).toHaveClass(/ios-app/);
  const top = await page.locator('.app').evaluate(el => parseFloat(getComputedStyle(el).paddingTop));
  expect(top).toBeGreaterThanOrEqual(54 + 12);
  const h1 = await page.getByTestId('home').locator('h1').boundingBox();
  expect(h1!.y).toBeGreaterThanOrEqual(54 + 12);
});

test('an ordinary browser tab does not get the class', async ({ page }) => {
  await page.goto('/#home');
  await expect(page.getByTestId('home-clock')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/ios-app/);
});
