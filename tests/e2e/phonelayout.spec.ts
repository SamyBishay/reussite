// The phone layout (iPhone feedback, 1 Nov): the suit piles are Today's alone, and on a phone the Calendar is condensed: the views and the dates
// in two tight rows, the grid right under them and filling the screen down to the tab bar (it scrolls inside), no Add to calendar buttons (the
// feed is in Settings → Calendar).
import { test, expect } from '@playwright/test';
import { importSample } from './helpers';

for (const [width, height] of [[390, 844], [320, 640]] as [number, number][]) {
  test(`on a phone ${width} wide the Day and 3-day grids fit above the tab bar with no piles over them`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await importSample(page);
    await page.getByTestId('tab-calendar').click();
    await expect(page.locator('.side')).toHaveCount(0);
    await expect(page.getByTestId('add-to-calendar')).toHaveCount(0);
    for (const mode of ['day', 'week']) {
      await page.getByTestId('cal-' + mode).click();
      await expect(page.getByTestId('calendar-grid')).toHaveAttribute('data-mode', mode);
      const fits = async () => page.evaluate(() => {
        const g = document.querySelector('.sxhost')!.getBoundingClientRect(), tb = document.querySelector('.tabbar')!.getBoundingClientRect();
        return { top: g.top >= 0, bottom: g.bottom <= tb.top + 0.5, tall: g.height >= 240, sideways: document.documentElement.scrollWidth <= window.innerWidth };
      });
      await expect.poll(fits).toEqual({ top: true, bottom: true, tall: true, sideways: true });
    }
  });
}

test('the piles are on Today alone: Matrix, Projects and Calendar have none and use the full width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await importSample(page);
  await page.getByTestId('tab-today').click();
  await expect(page.locator('.side')).toBeVisible();
  for (const tab of ['matrix', 'projects', 'calendar']) {
    await page.getByTestId('tab-' + tab).click();
    await expect(page.locator('.mast')).toBeVisible();
    await expect(page.locator('.side')).toHaveCount(0);
    const main = (await page.locator('main').boundingBox())!;
    expect(main.width).toBeGreaterThan(tab === 'projects' ? 600 : 900);
  }
});
