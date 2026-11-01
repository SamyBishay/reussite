// Home's top and its clock (2026-11-01): the wordmark and the date on the left, the Dove clock (an hour pie with twelve ticks, a minutes ring and a seconds ring, no hands)
// small beside the wordmark, the mark centred above the greeting, and the iPhone home-screen app's room for the island.
import { test, expect } from '@playwright/test';
import { stubNow, noSideways } from './helpers';

test('Home shows the wordmark as its h1 with the small clock beside it, the date under it, and the greeting centred under the bigger mark', async ({ page }) => {
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
  // the clock is small, right beside the wordmark, on its line, and not under the greeting
  const c = await page.getByTestId('home-clock').boundingBox();
  expect(c!.height).toBeGreaterThanOrEqual(36);
  expect(c!.height).toBeLessThanOrEqual(44);
  expect(c!.x).toBeGreaterThanOrEqual(b!.x + b!.width - 1);
  expect(c!.x - (b!.x + b!.width)).toBeLessThan(24);
  expect(Math.abs(c!.y + c!.height / 2 - (b!.y + b!.height / 2))).toBeLessThan(10);
  expect(c!.y + c!.height).toBeLessThan(m!.y);
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
  // no hands: the inner pie is the hour on a 12-hour dial (a quarter and a little past three: 3.25 of 12), the ring round it the minutes (a quarter)
  await expect(clock).toHaveAttribute('data-hour', '0.2708');
  await expect(clock).toHaveAttribute('data-minute', '0.2500');
  await expect(clock.locator('.clk-hand, .clk-dot')).toHaveCount(0);
  await expect(clock.locator('.clk-pie')).toHaveCount(1);
  await expect(clock.locator('.clk-tick')).toHaveCount(12);
  await expect(clock.locator('.clk-tick.q')).toHaveCount(4);
  await page.evaluate(() => localStorage.setItem('e2e.now', String(new Date(2026, 10, 1, 21, 50, 0).getTime())));
  await expect(clock).toHaveAttribute('data-time', '21:50', { timeout: 10_000 });
  await expect(clock).toHaveAttribute('aria-label', 'Clock: ten to ten');
});

test('the seconds ring fills with the second, and follows it while the page is visible', async ({ page }) => {
  await stubNow(page, new Date(2026, 10, 1, 15, 15, 30));
  await page.goto('/#home');
  const clock = page.getByTestId('home-clock');
  await expect(clock).toHaveAttribute('data-second', '30');
  const dash = () => clock.locator('.clk-sec').getAttribute('stroke-dasharray');
  const half = parseFloat((await dash())!.split(' ')[0]!), total = 2 * Math.PI * 47.5;
  expect(half / total).toBeCloseTo(0.5, 2);
  await page.evaluate(() => localStorage.setItem('e2e.now', String(new Date(2026, 10, 1, 15, 16, 7).getTime())));
  await expect(clock).toHaveAttribute('data-second', '7', { timeout: 3000 });
  await expect(clock).toHaveAttribute('data-time', '15:16');
  // on the minute the ring is empty: nothing drawn, not a dot
  await page.evaluate(() => localStorage.setItem('e2e.now', String(new Date(2026, 10, 1, 15, 17, 0).getTime())));
  await expect(clock).toHaveAttribute('data-second', '0', { timeout: 3000 });
  await expect(clock.locator('.clk-sec')).toHaveCount(0);
});

test('with reduced motion there are no seconds: the clock keeps to the minute', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubNow(page, new Date(2026, 10, 1, 15, 15, 30));
  await page.goto('/#home');
  const clock = page.getByTestId('home-clock');
  await expect(clock).toHaveAttribute('data-time', '15:15');
  await expect(clock).toHaveAttribute('data-second', '');
  await expect(clock.locator('.clk-sec, .clk-secring')).toHaveCount(0);
  await expect(clock.locator('.clk-min')).toHaveCount(1);
});

test('the clock is drawn in the theme\'s own colours', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await stubNow(page, new Date(2026, 10, 1, 15, 15, 0));
  await page.goto('/#home');
  const fill = () => page.getByTestId('home-clock').locator('.clk-min').evaluate(el => getComputedStyle(el).stroke);
  const light = await fill();
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await fill();
  expect(light).not.toBe(dark);
});

test('an iPhone home-screen app gets the ios-app class and at least 62px above the content, even when the inset reads 0', async ({ page }) => {
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
  expect(top).toBeGreaterThanOrEqual(62 + 12);
  const h1 = await page.getByTestId('home').locator('h1').boundingBox();
  expect(h1!.y).toBeGreaterThanOrEqual(62 + 12);
});

test('an ordinary browser tab does not get the class', async ({ page }) => {
  await page.goto('/#home');
  await expect(page.getByTestId('home-clock')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/ios-app/);
});

test('no title but Home\'s: Today, Matrix, Projects and Calendar have the date and the place pill in one slim row and a hidden heading', async ({ page }) => {
  await stubNow(page, new Date(2026, 10, 1, 15, 15, 0));
  await page.goto('/#home');
  for (const [tab, name] of [['today', 'Today'], ['matrix', 'Matrix'], ['projects', 'Projects'], ['calendar', 'Calendar']] as const) {
    await page.getByTestId('tab-' + tab).click();
    await expect(page.locator('.mast')).toBeVisible();
    await expect(page.locator('.mast .word')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText(name);
    await expect(page.locator('h1')).not.toContainText('Réussite');
    await expect(page.locator('.mast')).toContainText('1 November');
    await expect(page.getByTestId('place-pill')).toBeVisible();
    const row = (await page.locator('.mast').boundingBox())!;
    expect(row.height).toBeLessThan(60);
    await noSideways(page, tab);
  }
});

test('Home keeps the rubber band off: html is locked while Home shows and free elsewhere', async ({ page }) => {
  await page.goto('/#home');
  await expect(page.locator('html')).toHaveClass(/home-lock/);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe('none');
  await page.getByTestId('tab-today').click();
  await expect(page.locator('html')).not.toHaveClass(/home-lock/);
});
