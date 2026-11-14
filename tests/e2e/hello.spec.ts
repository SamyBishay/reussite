import { test, expect } from '@playwright/test';
import { noSideways } from './helpers';

// The hello page (docs/dev/hello.md): what Réussite is, for someone who was sent the link. Plain pages at /hello/ (English) and /hello/fr/,
// made at build time, served as themselves and not as the app; the app's own page carries the words a chat app shows for the link.
test('the hello page is a plain page that says what Réussite is, with the app one link away', async ({ page }) => {
  await page.goto('/hello/');
  await expect(page.locator('h1')).toHaveText('Réussite');
  await expect(page.locator('[data-testid="home"]')).toHaveCount(0);
  await expect(page.locator('.hero')).toContainText('starting harder than working');
  await expect(page.getByRole('link', { name: 'Open Réussite' }).first()).toHaveAttribute('href', '/');
  await expect(page.getByRole('heading', { name: 'Everything you have to do is a card' })).toBeVisible();
  // The mark and the pictures load.
  await expect.poll(() => page.locator('.hero img.mark-l').evaluate(e => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const img = page.locator('picture img').first();
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate(e => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some(f => f.family.replace(/^["']|["']$/g, '') === 'Atkinson Hyperlegible Next' && f.status === 'loaded'); })).toBe(true);
  // The preview tags a chat app reads.
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Réussite');
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /starting harder than working/);
  // On to the manual.
  await page.getByRole('link', { name: 'the manual' }).click();
  await expect(page).toHaveURL(/\/manual\/getting-started\.html$/);
  await expect(page.locator('h1')).toHaveText('Getting started');
});

test('the French page, the language switch, and Open goes to the app', async ({ page }) => {
  await page.goto('/hello/fr/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('.hero')).toContainText('plus de mal à commencer');
  const img = page.locator('picture img').first();
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate(e => (e as HTMLImageElement).currentSrc)).toContain('/manual/shots/fr-light/');
  await page.getByRole('link', { name: 'le manuel' }).click();
  await expect(page).toHaveURL(/\/manual\/fr\/getting-started\.html$/);
  await page.goBack();
  await page.getByRole('link', { name: 'Cette page en anglais' }).click();
  await expect(page).toHaveURL(/\/hello\/$/);
  await page.getByRole('link', { name: 'This page in French' }).click();
  await expect(page).toHaveURL(/\/hello\/fr\/$/);
  await page.getByRole('link', { name: 'Ouvrir Réussite' }).first().click();
  await expect(page.locator('#root')).toBeAttached();
  await expect(page.getByTestId('home')).toBeVisible();
});

test('the app page carries the words and the preview picture exists', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /starting harder than working/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Réussite');
  const og = await request.get('/hello/og.png');
  expect(og.status()).toBe(200);
  expect(og.headers()['content-type']).toContain('image/png');
});

test.describe('on a new device', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('the welcome\'s "What is Réussite?" opens the hello page', async ({ page, context }) => {
    await page.goto('/');
    const [hello] = await Promise.all([context.waitForEvent('page'), page.getByTestId('ob-more').click()]);
    await expect(hello).toHaveURL(/\/hello\/$/);
    await expect(hello.locator('h1')).toHaveText('Réussite');
  });
});

for (const [w, h] of [[320, 568], [375, 667], [390, 844], [430, 800]] as const) {
  test(`no sideways scroll on the hello page at ${w}px, and its main button is in the first screen`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    for (const path of ['/hello/', '/hello/fr/']) {
      await page.goto(path);
      await noSideways(page, path);
      const open = await page.locator('.hero a.open').boundingBox();
      expect(open!.y + open!.height, path + ': Open is below the first screen').toBeLessThanOrEqual(h);
      expect(open!.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test('a dark device gets the dark mark and pictures', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/hello/');
  await expect(page.locator('.hero img.mark-d')).toBeVisible();
  await expect(page.locator('.hero img.mark-l')).toBeHidden();
  const img = page.locator('picture img').first();
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate(e => (e as HTMLImageElement).currentSrc)).toContain('/manual/shots/en-dark/');
});
