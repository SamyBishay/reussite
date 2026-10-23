import { test, expect } from '@playwright/test';
import { noSideways } from './helpers';

// The public manual (docs/dev/manual.md): plain pages at /manual/ (English) and /manual/fr/, made at build time. They must be
// served as themselves, not as the app, and never scroll sideways.
test('the manual index and a page are plain pages, with the app one link away', async ({ page }) => {
  await page.goto('/manual/');
  await expect(page.locator('h1')).toHaveText('The Réussite manual');
  await expect(page.locator('[data-testid="home"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open Réussite' }).first()).toHaveAttribute('href', '/');
  await page.getByRole('link', { name: 'Getting started' }).first().click();
  await expect(page).toHaveURL(/\/manual\/getting-started\.html$/);
  await expect(page.locator('h1')).toHaveText('Getting started');
  await expect(page.getByRole('link', { name: /Next/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Previous/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily.startsWith('"Atkinson'))).toBe(true);
  const img = page.locator('picture img').first();
  if (await img.count()) { await img.scrollIntoViewIfNeeded(); await expect.poll(() => img.evaluate(e => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0); }
});

test('the French pages, the language switch and the pictures', async ({ page }) => {
  await page.goto('/manual/fr/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('h1')).toContainText('Le manuel de Réussite');
  await page.getByRole('link', { name: 'Prise en main' }).first().click();
  await expect(page).toHaveURL(/\/manual\/fr\/getting-started\.html$/);
  await expect(page.getByRole('link', { name: 'Ouvrir Réussite' }).first()).toBeVisible();
  const img = page.locator('picture img').first();
  if (await img.count()) { await img.scrollIntoViewIfNeeded(); await expect.poll(() => img.evaluate(e => (e as HTMLImageElement).currentSrc)).toContain('/manual/shots/fr-light/'); }
  await page.getByRole('link', { name: 'Ce manuel en anglais' }).click();
  await expect(page).toHaveURL(/\/manual\/getting-started\.html$/);
});

test('a dark device gets the dark pictures', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/manual/matrix.html');
  const img = page.locator('picture img').first();
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate(e => (e as HTMLImageElement).currentSrc)).toContain('/manual/shots/en-dark/');
});

for (const [w, h] of [[320, 700], [375, 700], [430, 800]] as const) {
  test(`no sideways scroll on the manual at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    for (const path of ['/manual/', '/manual/getting-started.html', '/manual/ai.html', '/manual/fr/', '/manual/fr/getting-started.html', '/manual/fr/ai.html']) {
      await page.goto(path);
      await noSideways(page, path);
    }
  });
}

test('the app still opens at the root, and the worker leaves /manual/ alone', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(page.locator('h1.word')).toHaveText('Réussite');
  await page.evaluate(async () => { await navigator.serviceWorker?.ready; });
  await page.goto('/manual/');
  await expect(page.locator('h1')).toHaveText('The Réussite manual');
  await expect(page.getByTestId('home')).toHaveCount(0);
});
