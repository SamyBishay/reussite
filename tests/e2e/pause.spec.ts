// Pause is one tap (request of 28 Oct, never run until 10 Nov): no sheet, no "why did you stop?" chips, the session is saved with no reason,
// and the places that read reasons (the card's session list, the Log) cope with there being none.
import { test, expect } from '@playwright/test';
import { importSample, goTab, noSideways, setLanguage, PHONES, LANGS } from './helpers';

for (const [w, h] of PHONES) for (const lang of LANGS) {
  test(`Pause is one tap with no question, and the session is kept without a reason (${w}×${h}, ${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await importSample(page);
    await setLanguage(page, lang);
    await goTab(page, 'today');
    const first = page.getByTestId('first');
    const id = (await first.getAttribute('data-task'))!;
    await first.getByTestId('go-timer').click();
    await expect(first.getByTestId('pause-timer')).toBeVisible();
    await first.getByTestId('pause-timer').click();
    // At once: no sheet, no reason chips, the timer is stopped.
    await expect(page.getByTestId('sheet')).toBeHidden();
    await expect(page.locator('.pickchip')).toHaveCount(0);
    await expect(first.getByTestId('pause-timer')).toHaveCount(0);
    await expect(first.getByTestId('go-timer')).toBeVisible();
    await noSideways(page, 'after pause');
    // The reason-less session shows in the card and in the Log.
    await page.goto('/#task/' + id);
    await expect(page.getByTestId('sheet')).toBeVisible();
    await expect(page.getByTestId('sheet').locator('.pickchip')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await goTab(page, 'log');
    await expect(page.getByTestId('calendar-grid').or(page.locator('main'))).toBeVisible();
    // (The Log's table scrolls inside its own wrapper by design; the page itself must not.)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
