// The recovery key (needs the relay on :8787): it is shown when it is made, with Copy and Save as a file and one "I've saved it" before moving on; it can be shown
// again in Settings → Sync; and "Restore with a recovery key" (the first screen of set-up and Settings → Sync) brings the list back on a fresh browser profile.
import { test, expect, type Browser, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { expandSettings, goTab, noSideways, setLanguage } from './helpers';

const NEW_DEVICE = { cookies: [], origins: [] };

async function freshDevice(browser: Browser, info: TestInfo, width = 390, height = 844) {
  const use = info.project.use as BrowserContextOptions;
  const ctx = await browser.newContext({ ...use, storageState: NEW_DEVICE });
  const page = await ctx.newPage();
  await page.setViewportSize({ width, height });
  return { ctx, page };
}
const liveTitles = (page: Page) => page.evaluate(() => new Promise<string[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const all = open.result.transaction('tasks').objectStore('tasks').getAll(); all.onsuccess = () => res((all.result as { _del?: boolean; title?: { v?: string } | string }[]).filter(d => !d._del).map(d => String((d as Record<string, unknown>).title ?? ''))); };
}));
const nudge = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

/** Set-up in two taps, then one line on Home. */
async function setUpWithACard(page: Page, line: string) {
  await page.goto('/');
  await page.getByTestId('ob-next').click();
  await page.getByTestId('ob-next').click();
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('home-input').fill(line);
  await page.getByTestId('home-input').press('Enter');
  await expect(page.getByTestId('home-line')).toContainText('Created: ');
}

for (const [width, height] of [[320, 568], [390, 844]] as const) {
  test(`the recovery key: shown with Copy and Save as a file, one "I've saved it", shown again later, and restored on a fresh profile (${width}×${height})`, async ({ browser }, info) => {
    test.slow();
    const a = await freshDevice(browser, info, width, height);
    await setUpWithACard(a.page, 'call the bank tomorrow');

    // Switch sync on: the key is shown when it is made.
    await goTab(a.page, 'settings');
    await expandSettings(a.page);
    await expect(a.page.getByTestId('sync')).toContainText('Restore with a recovery key');
    await a.page.getByTestId('sync-setup').click();
    await a.page.getByTestId('sync-make-key').click();
    const sheet = a.page.getByTestId('sync-key-sheet');
    await expect(sheet).toBeVisible();
    await expect(a.page.getByTestId('recovery-key')).toBeVisible();
    await expect(a.page.locator('svg.qr')).toBeVisible();
    await expect(a.page.getByTestId('key-copy')).toBeVisible();
    await expect(a.page.getByTestId('key-save-file')).toBeVisible();
    await expect(sheet.getByRole('button')).toHaveCount(3); // Copy, Save as a file, I've saved it: no "later"
    await expect(a.page.getByRole('button', { name: 'I’ll do it later' })).toHaveCount(0);
    await noSideways(a.page, 'the key sheet');
    const keyOf = async () => (await a.page.getByTestId('recovery-key').innerText()).trim().replace(/\s+/g, '-');
    const key = await keyOf();
    expect(key).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);

    // Save as a file: the file holds the key and nothing else.
    const [download] = await Promise.all([a.page.waitForEvent('download'), a.page.getByTestId('key-save-file').click()]);
    expect(download.suggestedFilename()).toBe('reussite-recovery-key.txt');
    const saved = (await readFile((await download.path())!, 'utf8')).trim();
    expect(saved).toBe(key);
    // One tap, and it is saved: the reminder on the bell page is gone.
    await a.page.getByTestId('sync-key-saved').click();
    await expect(a.page.getByTestId('sync-key-sheet')).toBeHidden();
    await a.page.getByTestId('tab-home').click();
    await a.page.getByTestId('home-bell').click();
    await expect(a.page.getByTestId('key-card')).toHaveCount(0);

    // Shown again in Settings → Sync, with the same two ways to keep it.
    await goTab(a.page, 'settings');
    await expandSettings(a.page);
    await a.page.getByTestId('sync-show-key-btn').click();
        expect(await keyOf()).toBe(key);
    await expect(a.page.getByTestId('key-save-file')).toBeVisible();
    await a.page.getByRole('button', { name: 'Close', exact: true }).last().click();

    // A fresh profile restores it from the first screen of set-up, with the text of the saved file.
    const b = await freshDevice(browser, info, width, height);
    await b.page.goto('/');
    await expect(b.page.getByTestId('ob-pair-link')).toContainText('Restore with a recovery key');
    await b.page.getByTestId('ob-pair-link').click();
    await expect(b.page.getByTestId('ob-pair')).toBeVisible();
    await noSideways(b.page, 'restore');
    await b.page.getByTestId('sync-join-key').fill('0123-4567');
    await b.page.getByTestId('sync-join-go').click();
    await expect(b.page.getByTestId('sync-join-error')).toBeVisible(); // a wrong key says so, and joins nothing
    await b.page.getByTestId('sync-join-key').fill(saved);
    await b.page.getByTestId('sync-join-go').click();
    await expect(b.page.getByTestId('home')).toBeVisible();
    await expect(async () => {
      await nudge(b.page);
      expect(await liveTitles(b.page)).toContain('Call the bank');
    }).toPass({ timeout: 25_000, intervals: [700, 1000, 1500] });
    await b.page.reload();
    await expect(b.page.getByTestId('ob-language')).toHaveCount(0);
    await goTab(b.page, 'projects');
    await a.ctx.close(); await b.ctx.close();
  });
}

test('Settings → Sync offers the same restore, in French too', async ({ page }) => {
  await page.goto('/');
  await setLanguage(page, 'fr');
  await expandSettings(page);
  await expect(page.getByTestId('sync')).toContainText('Restaurer avec une clé de récupération');
  await page.getByTestId('sync-join').click();
  await expect(page.getByTestId('sync-join-sheet')).toContainText('Restaurer avec une clé de récupération');
});
