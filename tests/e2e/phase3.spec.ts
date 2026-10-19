import { test, expect, type Browser, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import { importSample, noSideways } from './helpers';

test('Settings → About → Copy diagnostics shows the version and none of the list', async ({ page }) => {
  await importSample(page);
  await page.goto('/#settings');
  await page.getByTestId('about').getByTestId('diagnostics-open').click();
  const block = page.getByTestId('diagnostics-text');
  await expect(block).toContainText('version: 2.');
  await expect(block).toContainText('[sync]');
  await expect(block).not.toContainText('Doctolib');
  await noSideways(page, 'diagnostics sheet');
});

// ---- Sync (needs the relay that playwright.config.ts starts on :8787; the app is built for it)

const WIDTHS = [320, 375, 430];
const nudge = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

/** A second device: a fresh browser context with the same emulation as the project, so its own storage. */
async function secondDevice(browser: Browser, info: TestInfo) {
  const ctx = await browser.newContext(info.project.use as BrowserContextOptions);
  return { ctx, page: await ctx.newPage() };
}

async function setUp(page: Page): Promise<string> {
  await page.goto('/#settings');
  await page.getByTestId('sync-setup').click();
  await page.getByTestId('sync-make-key').click();
  await expect(page.locator('svg.qr')).toBeVisible();
  return (await page.getByTestId('recovery-key').innerText()).trim();
}

async function addPlace(page: Page, name: string) {
  await page.goto('/#settings');
  await page.getByPlaceholder('Name of the new place').fill(name);
  await page.getByTestId('add-place').click();
  await expect(page.getByLabel('Current place')).toContainText(name);
}

/** Keep nudging until the other device's change shows up (no background sync on phones: it is pulled on becoming visible). */
async function eventually(page: Page, check: () => Promise<void>) {
  await expect(async () => { await nudge(page); await check(); }).toPass({ timeout: 20_000, intervals: [700, 1000, 1500] });
}

test('sync: set up on one device, join on another by typing the key, edits travel both ways', async ({ browser }, info) => {
  test.slow();
  const a = await secondDevice(browser, info);
  const b = await secondDevice(browser, info);
  const pa = a.page, pb = b.page;
  const key = await setUp(pa);
  expect(key.replace(/\s+/g, '-')).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
  await expect(pa.getByTestId('sync-setup-sheet').or(pa.getByTestId('sync-key-sheet'))).toBeVisible();
  // "later": the card on Today stays until the key is confirmed
  await pa.getByRole('button', { name: 'I’ll do it later' }).click();
  await pa.getByTestId('tab-today').click();
  await expect(pa.getByTestId('key-card')).toBeVisible();
  await expect(pa.locator('main')).not.toContainText('Synced at'); // quiet on Today
  // data imported after set-up is sent too
  await importSample(pa);
  await expect(pa.getByTestId('key-card')).toBeVisible();
  await pa.getByTestId('tab-settings').click();
  await expect(pa.getByTestId('sync-status')).toContainText('Synced at');
  await addPlace(pa, 'Cabin');

  // B joins with the key typed in lower case, with spaces
  await pb.goto('/#settings');
  await pb.getByTestId('sync-join').click();
  await pb.getByTestId('sync-join-key').fill(key.toLowerCase().replace(/-/g, ' '));
  await pb.getByTestId('sync-join-go').click();
  await expect(pb.getByTestId('sheet')).toBeHidden();
  await eventually(pb, async () => { await expect(pb.getByLabel('Current place')).toContainText('Cabin', { timeout: 500 }); });
  await expect(pb.getByTestId('sync-status')).toContainText('Synced at');
  await pb.getByTestId('tab-today').click();
  await expect(pb.getByTestId('first')).toContainText('Doctolib', { timeout: 15_000 });
  await expect(pb.getByTestId('key-card')).toBeHidden(); // joining means they have the key

  // an edit on B reaches A
  await addPlace(pb, 'Harbour');
  await pb.waitForTimeout(2600); // two seconds after the last edit
  await pa.goto('/#settings');
  await eventually(pa, async () => { await expect(pa.getByLabel('Current place')).toContainText('Harbour', { timeout: 500 }); });
  // the devices list shows both devices, with this one named
  await pa.getByTestId('sync-device-name').fill('Desk');
  await pa.getByRole('button', { name: 'Save name' }).click();
  await expect(pa.getByTestId('sync-devices')).toContainText('Desk');
  await expect(pa.getByTestId('sync-devices').locator('li')).toHaveCount(2, { timeout: 10_000 });
  // confirming from the card
  await pa.getByTestId('tab-today').click();
  await pa.getByTestId('key-card-saved').click();
  await expect(pa.getByTestId('key-card')).toBeHidden();
  // the persistence line is there
  await pa.getByTestId('tab-settings').click();
  await expect(pa.getByTestId('data')).toContainText('Storage');
  await a.ctx.close(); await b.ctx.close();
});

test('sync: a mistyped key says what is wrong', async ({ page }) => {
  await page.goto('/#settings');
  await page.getByTestId('sync-join').click();
  const input = page.getByTestId('sync-join-key');
  await input.fill('ABCD-EFGH');
  await page.getByTestId('sync-join-go').click();
  await expect(page.getByTestId('sync-join-error')).toContainText('right length');
  await input.fill('!'.repeat(56));
  await page.getByTestId('sync-join-go').click();
  await expect(page.getByTestId('sync-join-error')).toContainText('character');
  // 56 valid characters that don't add up
  await input.fill('0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AB-CDEF-GHJK-MNPQ');
  await page.getByTestId('sync-join-go').click();
  await expect(page.getByTestId('sync-join-error')).toContainText('add up');
  await noSideways(page, 'key error');
});

test('sync: a valid key with no list on the relay warns first, and "go back" joins nothing', async ({ page }) => {
  await page.goto('/#settings');
  // Generated in the page with the app's own encoder, never sent anywhere before.
  const key = await page.evaluate(async () => {
    const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const k = crypto.getRandomValues(new Uint8Array(32));
    const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    let c = 0xffffffff; for (const b of k) c = crcT[(c ^ b) & 0xff]! ^ (c >>> 8); c = (c ^ 0xffffffff) >>> 0;
    const data = [...k, (c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
    let bits = 0, acc = 0, out = '';
    for (const b of data) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { out += A[(acc >>> (bits - 5)) & 31]; bits -= 5; } acc &= (1 << bits) - 1; }
    return out.match(/.{4}/g)!.join('-');
  });
  await page.getByTestId('sync-join').click();
  await page.getByTestId('sync-join-key').fill(key);
  await page.getByTestId('sync-join-go').click();
  await expect(page.getByTestId('sync-empty')).toBeVisible();
  await noSideways(page, 'empty space warning');
  await page.getByTestId('sync-empty-back').click();
  await expect(page.getByTestId('sync-join-key')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sync')).toContainText('Join with a recovery key'); // still off
});

test('sync: turning it off keeps the list and forgets the key; delete everywhere needs the typed word', async ({ page }) => {
  await importSample(page);
  const key = await setUp(page);
  expect(key).toBeTruthy();
  await page.getByTestId('sync-key-saved').click();
  await expect(page.getByTestId('sync-status')).toContainText('Synced at');
  // turn off needs the confirmation
  await page.getByTestId('sync-off').click();
  await expect(page.getByTestId('sync-off-confirm')).toBeDisabled();
  await page.getByTestId('sync-off-saved').check();
  await page.getByTestId('sync-off-confirm').click();
  await expect(page.getByTestId('sync-setup')).toBeVisible();
  await page.getByTestId('tab-today').click();
  await expect(page.getByTestId('first')).toContainText('Doctolib');
  // a new set-up, then delete everywhere
  await setUp(page);
  await page.getByTestId('sync-key-saved').click();
  await expect(page.getByTestId('sync-status')).toContainText('Synced at');
  await page.getByTestId('sync-delete').click();
  await expect(page.getByTestId('sync-delete-confirm')).toBeDisabled();
  await page.getByTestId('sync-delete-word').fill('delet');
  await expect(page.getByTestId('sync-delete-confirm')).toBeDisabled();
  await page.getByTestId('sync-delete-word').fill('delete');
  await page.getByTestId('sync-delete-confirm').click();
  await expect(page.getByTestId('sync-setup')).toBeVisible();
  await page.getByTestId('tab-today').click();
  await expect(page.getByTestId('first')).toContainText('Doctolib');
});

test('sync: the recovery key is shown only on a tap, and an encrypted backup needs the key', async ({ page }) => {
  await importSample(page);
  await page.goto('/#settings');
  await expect(page.getByTestId('export-encrypted')).toBeHidden(); // sync off: plain only
  await setUp(page);
  await page.getByTestId('sync-key-saved').click();
  await expect(page.getByTestId('recovery-key')).toBeHidden();
  await page.getByTestId('sync-show-key-btn').click();
  await expect(page.getByTestId('recovery-key')).toBeVisible();
  await page.keyboard.press('Escape');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-encrypted').click()]);
  const text = await (await import('node:fs/promises')).readFile((await dl.path())!, 'utf8');
  expect(JSON.parse(text).format).toBe('reussite-backup-encrypted');
  expect(text).not.toContain('Doctolib');
});

test('sync: a backup reminder appears after two weeks with sync off, and can be put off', async ({ page }) => {
  await importSample(page);
  await expect(page.getByTestId('backup-card')).toBeHidden();
  // pretend the app was first used 15 days ago
  await page.evaluate(() => new Promise<void>((res, rej) => {
    const open = indexedDB.open('reussite');
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('local', 'readwrite');
      tx.objectStore('local').put({ key: 'app.firstSeen', value: Date.now() - 15 * 86_400_000 });
      tx.oncomplete = () => res();
    };
  }));
  await page.reload();
  await expect(page.getByTestId('backup-card')).toBeVisible();
  await noSideways(page, 'backup card');
  await page.getByTestId('backup-card-snooze').click();
  await expect(page.getByTestId('backup-card')).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('backup-card')).toBeHidden();
});

for (const w of WIDTHS) {
  test(`sync screens don't scroll sideways at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto('/#settings');
    await noSideways(page, 'sync off');
    await page.getByTestId('sync-join').click();
    await page.getByTestId('sync-join-key').fill('0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AB-CDEF-GHJK-MNPQ');
    await noSideways(page, 'join');
    await page.keyboard.press('Escape');
    await setUp(page);
    await noSideways(page, 'recovery key');
    await page.getByTestId('sync-key-saved').click();
    await expect(page.getByTestId('sync-status')).toContainText('Synced at');
    await noSideways(page, 'sync on');
    await page.getByTestId('sync-off').click();
    await noSideways(page, 'turn off');
    await page.keyboard.press('Escape');
    await page.getByTestId('sync-delete').click();
    await noSideways(page, 'delete everywhere');
  });
}
