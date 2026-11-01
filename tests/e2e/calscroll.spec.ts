// The Calendar's Day and 3-day views open with the time now in the middle of the hour grid's scroll viewport (src/domain/calScroll.ts, CalendarGrid.tsx).
import { test, expect, type Page } from '@playwright/test';
import { importSample, noSideways, stubNow } from './helpers';

/** Where the now-line sits in the grid's scroll viewport: 0 at its top edge, 1 at its bottom edge. */
const nowAt = (page: Page) => page.evaluate(() => {
  const v = document.querySelector('.sx__view-container')!.getBoundingClientRect(), l = document.querySelector('.sx__current-time-indicator');
  if (!l) return null;
  const b = l.getBoundingClientRect();
  return (b.top - v.top) / v.height;
});

for (const [width, height] of [[390, 844], [320, 640]] as [number, number][]) {
  for (const [hour, minute] of [[15, 30], [10, 0], [22, 15]] as [number, number][]) {
    test(`on a phone ${width} wide the Day and 3-day grids open with ${hour}:${String(minute).padStart(2, "0")} in the middle third`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const x = new Date(); x.setHours(hour, minute, 0, 0);
      await stubNow(page, x);
      await importSample(page);
      await page.getByTestId('tab-calendar').click();
      for (const mode of ['day', 'week']) {
        await page.getByTestId('cal-' + mode).click();
        await expect(page.getByTestId('calendar-grid')).toHaveAttribute('data-mode', mode);
        // Late in the day the grid cannot scroll far enough for the middle: the end of the grid is as close as it gets.
        await expect.poll(async () => { const r = await nowAt(page); return r != null && r > 0.33 && r < (hour >= 20 ? 0.9 : 0.67); }, { timeout: 5000 }).toBe(true);
      }
    });
  }
}

test('on a computer the Week view also opens with now in the middle third', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a phone has the 3-day view');
  await page.setViewportSize({ width: 1280, height: 900 });
  const x = new Date(); x.setHours(14, 0, 0, 0);
  await stubNow(page, x);
  await importSample(page);
  await page.getByTestId('tab-calendar').click();
  await expect(page.getByTestId('calendar-grid')).toHaveAttribute('data-mode', 'week');
  await expect.poll(async () => { const r = await nowAt(page); return r != null && r > 0.33 && r < 0.67; }, { timeout: 5000 }).toBe(true);
});

test('another day opens near 08:00 or its first event, and the grid is not re-scrolled once the person has scrolled it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const x = new Date(); x.setHours(15, 30, 0, 0);
  await stubNow(page, x);
  await importSample(page);
  await page.getByTestId('tab-calendar').click();
  await page.getByTestId('cal-day').click();
  for (let i = 0; i < 40; i++) await page.getByTestId('cal-next').click();
  // 40 days on there is nothing: 07:30 is at the top, so 08:00 is in the first fifth.
  await expect.poll(() => page.evaluate(() => {
    const v = document.querySelector('.sx__view-container') as HTMLElement;
    return Math.round(v.scrollTop / 0.8);
  })).toBe(450);
  expect(await nowAt(page)).toBeNull();
  // The person scrolls; a tick of the clock does not move the grid back.
  await page.waitForTimeout(1500);
  await page.evaluate(() => { (document.querySelector('.sx__view-container') as HTMLElement).scrollTop = 500; });
  await page.locator('.sxhost').dispatchEvent('wheel');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (document.querySelector('.sx__view-container') as HTMLElement).scrollTop)).toBe(500);
});

// The Calendar tab is one screen tall, like Home: the page never scrolls, the grid (or the Log) fills the room between the bar and the tab bar and scrolls inside.
const SIZES: [number, number][] = [[320, 568], [375, 667], [390, 844], [1280, 800]];
for (const [width, height] of SIZES) {
  test(`the Calendar tab does not scroll at ${width}x${height}: the grid fills the room above the tab bar, in every view`, async ({ page, isMobile }) => {
    test.skip(isMobile && width > 800, 'a phone has no desktop width');
    await page.setViewportSize({ width, height });
    const x = new Date(); x.setHours(15, 30, 0, 0);
    await stubNow(page, x);
    await importSample(page);
    await page.getByTestId('tab-calendar').click();
    const check = async (where: string) => {
      const r = await page.evaluate(() => {
        const se = document.scrollingElement!, grid = document.querySelector('.sxhost')?.getBoundingClientRect(), bar = document.querySelector('.tabbar')!.getBoundingClientRect();
        return { scroll: se.scrollHeight, inner: innerHeight, gridBottom: grid?.bottom ?? null, gridHeight: grid?.height ?? null, barTop: bar.top, locked: document.documentElement.classList.contains('home-lock') };
      });
      expect(r.scroll, where + ': the page scrolls').toBeLessThanOrEqual(r.inner);
      expect(r.locked, where + ': the page is locked').toBe(true);
      if (r.gridBottom != null) {
        expect(r.gridBottom, where + ': the grid runs under the tab bar').toBeLessThanOrEqual(r.barTop + 1);
        expect(r.gridHeight!, where + ': the grid is too small').toBeGreaterThanOrEqual(height >= 667 ? 300 : 220);
      }
      await noSideways(page, where);
    };
    for (const mode of ['day', 'week', 'month', 'agenda']) {
      await page.getByTestId('cal-' + mode).click();
      await expect(page.getByTestId('calendar-grid')).toHaveAttribute('data-mode', mode);
      await check(mode);
      // What sits under the grid (the line to Settings → Calendar while the feed is off) is in view, not below the fold.
      await expect(page.getByTestId('cal-feed-line')).toBeInViewport({ ratio: 1 });
    }
    // The Log is a mode of the same bar and scrolls inside its own box; the footer is at its end.
    await page.getByTestId('cal-log').click();
    await expect(page.getByTestId('log')).toBeVisible();
    await check('log');
    await page.getByTestId('log').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.locator('.foot')).toBeInViewport({ ratio: 0.95 });
    expect((await page.locator('.foot').boundingBox())!.y + (await page.locator('.foot').boundingBox())!.height).toBeLessThanOrEqual((await page.getByTestId('tabbar').boundingBox())!.y + 1);
    await check('log, scrolled');
  });
}

test('the grid is placed again for the new room when it changes (the window gets shorter)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const x = new Date(); x.setHours(15, 30, 0, 0);
  await stubNow(page, x);
  await importSample(page);
  await page.getByTestId('tab-calendar').click();
  await page.getByTestId('cal-day').click();
  await expect.poll(async () => { const r = await nowAt(page); return r != null && r > 0.33 && r < 0.67; }, { timeout: 5000 }).toBe(true);
  await page.setViewportSize({ width: 390, height: 640 });
  await expect.poll(async () => { const r = await nowAt(page); return r != null && r > 0.33 && r < 0.67; }, { timeout: 5000 }).toBe(true);
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
});
