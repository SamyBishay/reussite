import { test, expect, type Browser, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import { importSample, noSideways, goTab, openMenu } from './helpers';

// First-run onboarding (phase 4): a new device is one that has no data and no record of having finished. Every other
// test runs as a device that has (playwright.config.ts puts the record in localStorage); these ask for a new one.
const NEW_DEVICE = { cookies: [], origins: [] };
const NEXT = (page: Page) => page.getByTestId('ob-next');
const next = (page: Page) => NEXT(page).click();

test.describe('on a new device', () => {
  test.use({ storageState: NEW_DEVICE });

  test('a full run: language to the check-in, and every answer is an ordinary setting afterwards', async ({ page }) => {
    await page.goto('/');
    // The first screen: the language switches the UI at once, the not-therapy line is there, and so is the pairing link.
    await expect(page.getByTestId('ob-language')).toBeVisible();
    await expect(page.getByTestId('ob-not-therapy')).toContainText('doesn’t replace therapy');
    await expect(page.getByTestId('ob-pair-link')).toBeVisible();
    await expect(page.locator('.tabbar')).toHaveCount(0);
    await page.getByTestId('ob-lang-fr').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByTestId('ob-next')).toHaveText('Suivant');
    await page.getByTestId('ob-lang-en').click();
    await expect(page.getByTestId('ob-next')).toHaveText('Next');
    await next(page);

    // Places: at least one, with this device's time zone already chosen.
    await expect(page.getByTestId('ob-places')).toBeVisible();
    await expect(NEXT(page)).toBeDisabled();
    const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    await expect(page.getByTestId('ob-place').first().locator('select')).toHaveValue(zone);
    await page.getByTestId('ob-place-name').first().fill('Home');
    await expect(NEXT(page)).toBeEnabled();
    await page.getByTestId('ob-place-add').click();
    await page.getByTestId('ob-place-name').nth(1).fill('Work');
    await next(page);

    // Suits: rename one, keep the rest.
    await expect(page.getByTestId('ob-suits')).toBeVisible();
    await page.getByTestId('ob-suit-S').fill('Study');
    await page.getByTestId('ob-glyph-S').fill('★');
    await next(page);

    // Look: dark, and a preset.
    await expect(page.getByTestId('ob-theme')).toBeVisible();
    await page.getByTestId('ob-theme-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // shown at once, not yet saved
    await page.getByTestId('ob-preset-forest-amber').click();
    await next(page);

    // Addresses & people: off.
    await page.getByTestId('ob-addresses-no').click();
    await next(page);

    // AI: yes, a key (kept on this device only).
    await expect(page.getByTestId('ob-ai')).toBeVisible();
    await page.getByTestId('ob-ai-yes').click();
    await expect(page.getByText('Save a key to switch the AI on')).toBeVisible();
    await page.getByTestId('ai-key').fill('sk-or-test');
    await page.getByTestId('ai-key-save').click();
    await expect(page.getByText('Save a key to switch the AI on')).toBeHidden();
    await next(page);

    // What an AI should know about how they work.
    await expect(page.getByTestId('ob-prefs')).toBeVisible();
    await page.getByTestId('ob-detail-very-short').click();
    await page.getByTestId('ob-prefs-know').fill('I start better with a time');
    await page.locator('.ob details summary').click();
    await expect(page.getByTestId('ob-prefs-text')).toHaveValue(/Level of detail: very short\./);
    await next(page);

    // Sync: not now. Notifications: not now (nothing asks for permission without a tap).
    await expect(page.getByTestId('ob-sync')).toBeVisible();
    await expect(NEXT(page)).toHaveText('Not now');
    await next(page);
    if (await page.getByTestId('ob-notify').isVisible()) {
      // Whatever the browser can do, nothing is switched on without a tap.
      if (await page.getByTestId('notify-master').count()) await expect(page.getByTestId('notify-master')).not.toBeChecked();
      await next(page);
    }

    // The end: the not-therapy line again, and the choice. Nothing is written until here.
    await expect(page.getByTestId('ob-done')).toBeVisible();
    await expect(page.getByTestId('ob-not-therapy')).toBeVisible();
    expect(await page.evaluate(() => new Promise<number>(res => { const r = indexedDB.open('reussite'); r.onsuccess = () => { const q = r.result.transaction('places').objectStore('places').count(); q.onsuccess = () => res(q.result); }; }))).toBe(0);
    await page.getByTestId('ob-plan').click();
    await expect(page.getByTestId('ci-shape')).toBeVisible();
    await expect(page.getByTestId('ob-done')).toBeHidden();
    await page.getByTestId('sheet').getByRole('button', { name: 'Close' }).click();

    // The answers are ordinary settings, places and a local key now, and onboarding never comes back.
    await expect(page.getByTestId('home')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('ob-language')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await openMenu(page, 'places');
    await expect(page.getByTestId('places-sheet')).toContainText('Home');
    await expect(page.getByTestId('places-sheet')).toContainText('Work');
    await page.keyboard.press('Escape');
    await goTab(page, 'settings');
    await expect(page.getByTestId('appearance').locator('select')).toHaveValue('forest-amber');
    await goTab(page, 'today');
    await expect(page.locator('.pile[data-suit=S]')).toHaveAttribute('aria-label', /Study/);
    await expect(page.locator('.pile[data-suit=S] .big')).toHaveText('★');
    await goTab(page, 'settings');
    await expect(page.getByTestId('ai-openai')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('ai-prefs')).toHaveValue(/Things to know about how I work: I start better with a time/);
    await expect(page.getByTestId('ai-prefs')).toHaveValue(/Level of detail: very short\./);
    await expect(page.getByTestId('ai-key')).toHaveAttribute('placeholder', /replace/i);
  });

  test('Back returns to the earlier answers, which are still there', async ({ page }) => {
    await page.goto('/');
    await next(page);
    await page.getByTestId('ob-place-name').first().fill('Home');
    await next(page);
    await expect(page.getByTestId('ob-suits')).toBeVisible();
    await page.getByTestId('ob-back').click();
    await expect(page.getByTestId('ob-place-name').first()).toHaveValue('Home');
    await page.getByTestId('ob-back').click();
    await expect(page.getByTestId('ob-language')).toBeVisible();
    await expect(page.getByTestId('ob-back')).toHaveCount(0);
  });

  test('"Skip, use defaults" leaves everything as it was and goes to the end', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('ob-skip').click();
    await expect(page.getByTestId('ob-done')).toContainText('Defaults are on');
    await expect(page.getByTestId('ob-not-therapy')).toBeVisible();
    await page.getByTestId('ob-home').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.locator('.tabbar .tab')).toHaveCount(5);
    await page.reload();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('ob-language')).toHaveCount(0);
    await goTab(page, 'settings');
    await expect(page.getByTestId('places').locator('input')).toHaveCount(1); // only the "add a place" field: no place was made
    await expect(page.getByTestId('addresses-switch')).toBeChecked();
    await expect(page.getByTestId('ai-none')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('ai-prefs')).toHaveValue(/One question at a time/);
  });

  test('skipping after some answers keeps them', async ({ page }) => {
    await page.goto('/');
    await next(page);
    await page.getByTestId('ob-place-name').first().fill('Lisbon');
    await next(page);
    await page.getByTestId('ob-skip').click();
    await expect(page.getByTestId('ob-done')).toBeVisible();
    await page.getByTestId('ob-home').click();
    await openMenu(page, 'places');
    await expect(page.getByTestId('places-sheet')).toContainText('Lisbon');
  });

  for (const width of [320, 375, 430]) {
    test(`every screen fits at ${width}px, with 44px targets`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/');
      const check = async (id: string) => {
        await expect(page.getByTestId(id)).toBeVisible();
        await noSideways(page, id);
        const small = await page.evaluate(() => [...document.querySelectorAll('.ob button, .ob input, .ob select, .ob textarea, .ob summary')]
          .filter(el => !(el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'checkbox')))
          .map(el => { const r = el.getBoundingClientRect(); return { n: el.tagName + '.' + el.className + ' ' + (el.textContent ?? '').slice(0, 20), w: r.width, h: r.height }; })
          .filter(x => x.w > 0 && (x.h < 43.5 || x.w < 43.5)));
        expect(small, id + ': small targets').toEqual([]);
      };
      await check('ob-language');
      await next(page);
      await page.getByTestId('ob-place-name').first().fill('Home');
      await page.getByTestId('ob-place-add').click();
      await check('ob-places');
      await next(page);
      await check('ob-suits');
      await next(page);
      await check('ob-theme');
      await next(page);
      await check('ob-addresses');
      await next(page);
      await page.getByTestId('ob-ai-yes').click();
      await check('ob-ai');
      await next(page);
      await page.locator('.ob details summary').click();
      await check('ob-prefs');
      await next(page);
      await check('ob-sync');
      await page.getByTestId('ob-sync-setup').click();
      await check('ob-setup');
      await page.getByTestId('ob-back').click();
      await page.getByTestId('ob-sync-pair').click();
      await check('ob-pair');
      await page.getByTestId('ob-back').click();
      await next(page);
      if (await page.getByTestId('ob-notify').isVisible()) { await check('ob-notify'); await next(page); }
      await check('ob-done');
    });
  }
});

// ---- A device that pairs does not answer what its space already holds (needs the relay on :8787)

async function device(browser: Browser, info: TestInfo, newDevice: boolean) {
  const use = info.project.use as BrowserContextOptions;
  const ctx = await browser.newContext(newDevice ? { ...use, storageState: NEW_DEVICE } : use);
  return { ctx, page: await ctx.newPage() };
}
const nudge = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test('"I already use Réussite on another device" goes to pairing and skips the questions the space fills', async ({ browser }, info) => {
  test.slow();
  const a = await device(browser, info, false);
  await a.page.goto('/#settings');
  await a.page.getByPlaceholder('Name of the new place').fill('Cabin');
  await a.page.getByTestId('add-place').click();
  await a.page.getByTestId('sync-setup').click();
  await a.page.getByTestId('sync-make-key').click();
  await expect(a.page.locator('svg.qr')).toBeVisible();
  const key = (await a.page.getByTestId('recovery-key').innerText()).trim();

  const b = await device(browser, info, true);
  await b.page.goto('/');
  await b.page.getByTestId('ob-pair-link').click();
  await expect(b.page.getByTestId('ob-pair')).toBeVisible();
  await noSideways(b.page, 'pairing');
  // A wrong key says so; the right one joins.
  await b.page.getByTestId('sync-join-key').fill('NOPE');
  await b.page.getByTestId('sync-join-go').click();
  await expect(b.page.getByTestId('sync-join-error')).toBeVisible();
  await b.page.getByTestId('sync-join-key').fill(key);
  await b.page.getByTestId('sync-join-go').click();
  // Straight to the last questions: no places, suits, look or AI screens, no recovery key to save.
  await expect(b.page.getByTestId('ob-places')).toHaveCount(0);
  await expect(b.page.getByTestId('ob-notify').or(b.page.getByTestId('ob-done'))).toBeVisible();
  if (await b.page.getByTestId('ob-notify').isVisible()) await next(b.page);
  await expect(b.page.getByTestId('ob-done')).toBeVisible();
  await expect(b.page.getByTestId('ob-done')).toContainText('coming from your other device');
  await b.page.getByTestId('ob-home').click();
  await expect(b.page.getByTestId('home')).toBeVisible();
  // The space's own places arrive; nothing from this device's defaults was pushed over it.
  await expect(async () => {
    await nudge(b.page);
    await goTab(b.page, 'settings');
    await expect(b.page.getByTestId('places')).toContainText('Cabin', { timeout: 800 });
  }).toPass({ timeout: 25_000, intervals: [700, 1000, 1500] });
  await b.page.reload();
  await expect(b.page.getByTestId('ob-language')).toHaveCount(0);
  await a.ctx.close(); await b.ctx.close();
});

test('a device that pairs by the usual way never sees onboarding, even before any data arrives', async ({ browser }, info) => {
  test.slow();
  const a = await device(browser, info, false);
  await a.page.goto('/#settings');
  await a.page.getByTestId('sync-setup').click();
  await a.page.getByTestId('sync-make-key').click();
  const key = (await a.page.getByTestId('recovery-key').innerText()).trim();
  // A device that has a key but nothing else yet: the record of the key is enough.
  const b = await device(browser, info, true);
  await b.page.goto('/');
  await b.page.getByTestId('ob-pair-link').click();
  await b.page.getByTestId('sync-join-key').fill(key);
  await b.page.getByTestId('sync-join-go').click();
  await expect(b.page.getByTestId('ob-notify').or(b.page.getByTestId('ob-done'))).toBeVisible();
  await b.page.reload(); // closed before finishing
  await expect(b.page.getByTestId('home')).toBeVisible();
  await expect(b.page.getByTestId('ob-language')).toHaveCount(0);
  await a.ctx.close(); await b.ctx.close();
});

// ---- Existing installs never see it

test('a device with data never sees it, even with no record of having finished', async ({ page }) => {
  await importSample(page); // the record is in localStorage here; take it away to look like an install from before onboarding
  await page.evaluate(() => localStorage.removeItem('reussite.onboarded'));
  await page.reload();
  await expect(page.getByTestId('tabbar')).toBeVisible();
  await expect(page.getByTestId('ob-language')).toHaveCount(0);
  await goTab(page, 'today');
  await expect(page.getByTestId('first')).toContainText('Doctolib');
  // It is recorded now: wiping the list later does not start it.
  expect(await page.evaluate(() => localStorage.getItem('reussite.onboarded'))).toBe('1');
});

test('a device with only a changed setting never sees it', async ({ page }) => {
  await page.goto('/#settings');
  await page.getByTestId('addresses-switch').click();
  await page.evaluate(() => localStorage.removeItem('reussite.onboarded'));
  await page.reload();
  await expect(page.getByTestId('ob-language')).toHaveCount(0);
  await expect(page.getByTestId('addresses-switch')).not.toBeChecked();
});
