// Layout diagnostics (request of 10 Nov): a row at the bottom of Settings opens a screen with what the device reports about its top edge, and two thin
// lines (the reported inset, where the content begins). It changes nothing. The values themselves can only be true on a phone; here we check they are
// measured and shown, at 320 and 390, in both languages, and that the lines sit where the numbers say.
import { test, expect } from '@playwright/test';
import { goTab, noSideways, setLanguage, PHONES, LANGS } from './helpers';

for (const [w, h] of PHONES) for (const lang of LANGS) {
  test(`Settings ends with a Layout diagnostics row; its screen shows every reading and two lines (${w}×${h}, ${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    await goTab(page, 'settings');
    await setLanguage(page, lang);
    const row = page.getByTestId('layout-diag-open');
    // It is the last thing on the page.
    expect(await page.getByTestId('settings').evaluate(el => el.lastElementChild === document.querySelector('[data-testid=layout-diag-open]'))).toBe(true);
    await row.scrollIntoViewIfNeeded();
    await row.click();
    const screenEl = page.getByTestId('layout-diag');
    await expect(screenEl).toBeVisible();
    for (const k of ['standalone', 'display', 'inset', 'applied', 'content', 'inner', 'vv', 'screen', 'viewport', 'statusbar', 'theme']) {
      const v = (await page.getByTestId('ld-' + k).locator('dd').innerText()).trim();
      expect(v, k).not.toBe('');
    }
    // Real values: innerHeight is the viewport's; the viewport meta is the page's own; the status-bar style is the page's own.
    await expect(page.getByTestId('ld-inner').locator('dd')).toHaveText(h + ' px');
    await expect(page.getByTestId('ld-viewport').locator('dd')).toContainText('viewport-fit=cover');
    await expect(page.getByTestId('ld-statusbar').locator('dd')).toHaveText('default');
    await expect(page.getByTestId('ld-theme').locator('dd')).toContainText('#');
    await expect(page.getByTestId('ld-display').locator('dd')).toHaveText('false');
    // The two lines are where the numbers say.
    const inset = Number(await page.getByTestId('ld-line-inset').getAttribute('data-y'));
    const content = Number(await page.getByTestId('ld-line-content').getAttribute('data-y'));
    const yOf = (id: string) => page.getByTestId(id).evaluate(el => el.getBoundingClientRect().top);
    expect(Math.abs((await yOf('ld-line-inset')) - inset)).toBeLessThan(1.5);
    expect(Math.abs((await yOf('ld-line-content')) - content)).toBeLessThan(1.5);
    expect(content).toBeGreaterThanOrEqual(inset);
    await noSideways(page, 'layout diagnostics');
    // With the iPhone class the applied inset reads 62: the screen shows the app's own number, not the browser's.
    await page.evaluate(() => document.documentElement.classList.add('ios-app'));
    await expect(page.getByTestId('ld-applied').locator('dd')).toContainText('62', { timeout: 3000 });
    await page.getByTestId('ld-close').click();
    await expect(screenEl).toHaveCount(0);
    await expect(page.getByTestId('settings')).toBeVisible();
  });
}
