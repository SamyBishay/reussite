import { test, expect, type Page } from '@playwright/test';
import { noSideways } from './helpers';

// The manual in Settings → About (docs/dev/manual.md): opens in the app's language and look, falls back to English, keeps its
// links inside the sheet or out of the app, and never scrolls sideways.
const sheet = (page: Page) => page.getByTestId('sheet');
async function openManual(page: Page) {
  await page.goto('/#settings');
  await page.getByTestId('open-manual').click();
  await expect(sheet(page).getByTestId('manual')).toBeVisible();
}
const loaded = (page: Page) => page.locator('.manual img.shot').evaluateAll(els => els.map(e => { const i = e as HTMLImageElement; return [i.getAttribute('src'), i.complete && i.naturalWidth > 0]; }));

test('About opens the manual: the contents, a page, a picture, and back', async ({ page }) => {
  await openManual(page);
  await expect(sheet(page).locator('article h2')).toContainText('The Réussite manual');
  await sheet(page).getByRole('link', { name: 'Matrix', exact: false }).filter({ hasText: 'The matrix' }).click();
  await expect(sheet(page).locator('article[data-page=matrix] h2')).toHaveText('The matrix');
  await expect.poll(async () => (await loaded(page)).length).toBe(1);
  await expect.poll(async () => (await loaded(page))[0]).toEqual(['manual/shots/en-light/matrix.png', true]);
  await sheet(page).getByTestId('manual-contents').click();
  await expect(sheet(page).locator('article[data-page=index]')).toBeVisible();
});

test('a dark look gets the dark picture', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openManual(page);
  await sheet(page).getByRole('link', { name: 'The matrix' }).click();
  await expect.poll(async () => (await loaded(page))[0]).toEqual(['manual/shots/en-dark/matrix.png', true]);
});

test('in French, a page that has no French yet is shown in English, with a line saying so', async ({ page }) => {
  await page.goto('/#settings');
  await page.getByRole('button', { name: 'Français' }).click();
  await page.getByTestId('open-manual').click();
  await expect(sheet(page).locator('article')).toHaveAttribute('lang', 'en');
  await expect(sheet(page).locator('article')).toContainText('The Réussite manual');
  await expect(sheet(page).locator('article > p.hint').first()).toBeVisible();
});

test('links: a page stays in the sheet, anything else must be an allowed link', async ({ page }) => {
  await openManual(page);
  // No link in the manual leaves the app by a scheme that is not allowed, and none opens a page by itself.
  const hrefs = await sheet(page).locator('article a').evaluateAll(els => els.map(e => e.getAttribute('href')));
  for (const h of hrefs) expect(h === '#' || /^(https:|mailto:|tel:|sms:)/.test(h ?? '')).toBe(true);
  await sheet(page).getByRole('link', { name: 'Getting started' }).click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(sheet(page).locator('article[data-page=getting-started]')).toBeVisible();
});

for (const width of [320, 375, 430]) {
  test(`the manual does not scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await openManual(page);
    await noSideways(page, 'contents');
    for (const link of ['Getting started', 'The daily loop', 'Addresses and people', 'Sync and recovering a lost device', 'Privacy']) {
      await sheet(page).locator('article[data-page=index]').getByRole('link', { name: link }).first().click();
      await expect(sheet(page).locator('article:not([data-page=index])')).toBeVisible();
      // Pictures load as they come into view.
      await page.locator('.manual img.shot').evaluateAll(els => els.forEach(e => e.scrollIntoView()));
      await expect.poll(async () => (await loaded(page)).every(([, ok]) => ok)).toBe(true);
      await page.locator('.manual').evaluate(el => el.closest('.sheet')?.scrollTo(0, 0));
      await noSideways(page, link);
      await sheet(page).getByTestId('manual-contents').click();
    }
  });
}
