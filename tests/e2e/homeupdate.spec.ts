// The reload-for-a-new-version box is on Home too (2026-11-11), above the greeting, and Home still fits its screen and never scrolls sideways.
// The box is asked for with an event (src/app/UpdateBanner.tsx): a real second worker can't be made in Firefox. The worker's own path is unverified by tests.
import { test, expect } from '@playwright/test';
import { noSideways, setLanguage, goTab } from './helpers';

for (const [w, h] of [[320, 568], [390, 844]] as const) for (const lang of ['en', 'fr'] as const) {
  test(`a new version's Reload box shows on Home (${w}×${h}, ${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    await setLanguage(page, lang);
    await goTab(page, 'home');
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('update-banner')).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('reussite:update-ready')));
    const box = page.getByTestId('update-banner');
    await expect(box).toBeVisible({ timeout: 15_000 });
    await expect(box.getByRole('button')).toHaveCount(2);
    // Above the greeting, inside the screen, and Home does not scroll.
    const r = await page.evaluate(() => {
      const b = document.querySelector('[data-testid=update-banner]')!.getBoundingClientRect(), g = document.querySelector('[data-testid=greeting]')!.getBoundingClientRect(), bar = document.querySelector('.tabbar')!.getBoundingClientRect();
      return { bTop: b.top, bBottom: b.bottom, gTop: g.top, gBottom: g.bottom, barTop: bar.top, scroll: document.scrollingElement!.scrollHeight, ih: innerHeight, topbarBottom: document.getElementById('topbar')!.getBoundingClientRect().bottom };
    });
    expect(r.bTop).toBeGreaterThanOrEqual(r.topbarBottom - 1);
    expect(r.bBottom).toBeLessThanOrEqual(r.gTop + 1);
    expect(r.gBottom).toBeLessThanOrEqual(r.barTop + 1);
    expect(r.scroll).toBeLessThanOrEqual(r.ih);
    await noSideways(page, 'home with the update box');
  });
}
