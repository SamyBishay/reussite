import { test, expect, type Browser, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import { deflateRawSync } from 'node:zlib';
import { importSample, noSideways, goTab } from './helpers';
import { decodeRecoveryKey, deriveKeys } from '../../src/sync/keys';

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
  await goTab(pa, 'settings');
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
  await goTab(pa, 'settings');
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
  // Restore detects the encrypted file and opens it with the key held here
  page.once('dialog', d => void d.accept());
  await page.getByTestId('data').locator('input[type=file]').first().setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('.toast')).toContainText('Backup restored');
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

// ---- The connector (Settings → Connector). The relay started by playwright.config.ts has a throwaway wrap key.

test('connector: needs sync first; then switch on shows an address and a code, switch off returns to off', async ({ page }) => {
  await page.goto('/#settings');
  await expect(page.getByTestId('connector')).toContainText('sync comes first');
  await expect(page.getByTestId('connector-on')).toBeHidden();
  await page.getByTestId('connector-to-sync').click();
  await expect(page.getByTestId('sync-setup')).toBeFocused();

  await setUp(page);
  await page.getByTestId('sync-key-saved').click();
  await expect(page.getByTestId('sync-status')).toContainText('Synced at');
  const box = page.getByTestId('connector');
  // off: what it does, and the privacy cost, before the button
  await expect(page.getByTestId('connector-on')).toBeVisible();
  await expect(box).toContainText('whoever runs the relay can read your whole list');
  await expect(box).toContainText('Only a new recovery key fully undoes having shared it');
  await page.getByTestId('connector-on').click();
  await expect(page.getByTestId('connector-on-sheet')).toContainText('Switch the connector on?');
  await noSideways(page, 'connector confirmation');
  await page.getByTestId('connector-on-confirm').click();

  await expect(page.getByTestId('connector-state')).toContainText('The connector is on');
  await expect(page.getByTestId('connector-state')).toContainText('Not used yet');
  await expect(page.getByTestId('connector-url')).toHaveText(/^http:\/\/localhost:8787\/mcp$/);
  const code1 = (await page.getByTestId('connector-code').innerText()).replace(/\s+/g, '');
  expect(code1).toMatch(/^[A-Z0-9]{8}$/);
  await expect(page.getByTestId('connector-expiry')).toContainText(/[0-9]:[0-5][0-9]/);
  // the relay lists itself in Sync & devices, as "Connector"
  await expect(page.getByTestId('device-connector')).toContainText('Connector', { timeout: 10_000 });
  await noSideways(page, 'connector on');

  await page.getByTestId('connector-new-code').click();
  await expect.poll(async () => (await page.getByTestId('connector-code').innerText()).replace(/\s+/g, '')).not.toBe(code1);

  // the diagnostics say on / off and never the address or a code
  await page.getByTestId('about').getByTestId('diagnostics-open').click();
  await expect(page.getByTestId('diagnostics-text')).toContainText(/\[connector\]\s+state: on/);
  await expect(page.getByTestId('diagnostics-text')).not.toContainText('/mcp');
  await expect(page.getByTestId('diagnostics-text')).not.toContainText(code1);
  await page.keyboard.press('Escape');

  // turning sync off while it is on says so
  await page.getByTestId('sync-off').click();
  await expect(page.getByTestId('sync-off-connector')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTestId('connector-off').click();
  await noSideways(page, 'connector off confirmation');
  await page.getByTestId('connector-off-confirm').click();
  await expect(page.getByTestId('connector-on')).toBeVisible();
  await expect(page.getByTestId('connector-code')).toBeHidden();
  await expect(page.getByTestId('device-connector')).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId('about').getByTestId('privacy')).toContainText('your whole list while the connector is on');
});

for (const w of WIDTHS) {
  test(`connector and one-tap link settings don't scroll sideways at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto('/#settings');
    await expect(page.getByTestId('drop-needs-sync')).toBeVisible();
    await noSideways(page, 'sync off');
    await setUp(page);
    await page.getByTestId('sync-key-saved').click();
    await expect(page.getByTestId('sync-status')).toContainText('Synced at');
    await expect(page.getByTestId('drop-address')).toContainText('/drop#');
    await noSideways(page, 'drop address');
    await page.getByTestId('connector-on').click();
    await page.getByTestId('connector-on-confirm').click();
    await expect(page.getByTestId('connector-code')).toBeVisible();
    await noSideways(page, 'connector on');
    await expect(page.getByTestId('privacy')).toBeVisible();
    await noSideways(page, 'privacy note');
  });
}

// ---- The one-tap link

const ORIGIN = 'http://localhost:4174';
const cs = (title: string) => ({ v: 1, note: 'From my AI', changes: [{ op: 'task.create', set: { title } }] });

/** What an AI with a code tool would write: the drop address, then z. and the compressed change-set. */
const linkFor = (address: string, change: unknown) => address.trim() + 'z.' + deflateRawSync(Buffer.from(JSON.stringify(change))).toString('base64url');

async function dropAddress(page: Page): Promise<string> {
  await page.goto('/#settings');
  await expect(page.getByTestId('drop-address')).toContainText('/drop#');
  return (await page.getByTestId('drop-address').innerText()).trim();
}

/** The change-sets the relay holds for a recovery key (read as the app does, with the space's secret). */
async function inboxSize(recovery: string): Promise<number> {
  const keys = await deriveKeys(decodeRecoveryKey(recovery));
  const res = await fetch('http://localhost:8787/v1/spaces/' + keys.spaceId + '/inbox', { headers: { Authorization: 'Bearer ' + keys.authSecret } });
  return ((await res.json()) as { items: unknown[] }).items.length;
}

test('one-tap link: Settings → AI shows the drop address and the sentence to paste; Ask any AI then asks for the link', async ({ page }) => {
  await page.goto('/#settings');
  await expect(page.getByTestId('drop-needs-sync')).toBeVisible();
  await page.getByTestId('tab-today').click();
  await page.getByTestId('ask-any').click();
  await page.locator('summary', { hasText: 'See the text' }).click();
  await expect(page.getByTestId('pack')).toContainText('fenced code block labelled reussite');
  await expect(page.getByTestId('pack')).not.toContainText('/drop#');
  await page.keyboard.press('Escape');

  await setUp(page);
  await page.getByTestId('sync-key-saved').click();
  const addr = await dropAddress(page);
  expect(addr).toMatch(new RegExp('^' + ORIGIN + '/drop#[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}\\.$'));
  await expect(page.getByTestId('drop-sentence')).toContainText(addr + 'z.DATA');
  await expect(page.getByTestId('drop-sentence')).toContainText('8,000');
  await page.getByTestId('tab-today').click();
  await page.getByTestId('ask-any').click();
  await page.locator('summary', { hasText: 'See the text' }).click();
  await expect(page.getByTestId('pack')).toContainText(addr + 'z.DATA');
  await expect(page.getByTestId('pack')).not.toContainText('end your reply with one fenced code block labelled reussite that holds');
  // a link pasted where a block is expected is read the same way
  await page.getByTestId('ask-any-sheet').getByRole('button', { name: 'Paste the reply' }).click();
  await page.getByTestId('paste-text').fill('Here you go: ' + linkFor(addr, cs('Open Mail and answer the pasted one')) + ' — hope it helps.');
  await page.getByTestId('paste-go').click();
  await expect(page.getByTestId('review')).toContainText('answer the pasted one');
});

test('one-tap link: a browser with nothing leaves it in the inbox; the device with the list shows it at its next sync, one at a time, and the relay forgets each', async ({ browser }, info) => {
  test.slow();
  const a = await secondDevice(browser, info);
  const pa = a.page;
  const recovery = await setUp(pa);
  await pa.getByTestId('sync-key-saved').click();
  await expect(pa.getByTestId('sync-status')).toContainText('Synced at');
  const addr = await dropAddress(pa);

  // "iPhone Safari": a context of its own, no data, no sync
  const b = await secondDevice(browser, info);
  const requests: string[] = [];
  b.page.on('request', r => { if (r.method() === 'POST') requests.push(r.url()); });
  await b.page.goto(linkFor(addr, cs('Open Mail and answer the drop one')).replace(ORIGIN, ''));
  await expect(b.page.getByTestId('drop-sent')).toHaveText('Sent to your list. Open Réussite to review it.', { timeout: 20_000 });
  await b.page.goto(linkFor(addr, cs('Open Mail and answer the drop two')).replace(ORIGIN, ''));
  await expect(b.page.getByTestId('drop-sent')).toBeVisible({ timeout: 20_000 });
  expect(requests.filter(u => u.endsWith('/inbox'))).toHaveLength(2);
  expect(await inboxSize(recovery)).toBe(2);
  const dropWidth = await b.page.evaluate(() => { const d = document.querySelector('.drop')!; return [d.scrollWidth, d.clientWidth]; });
  expect(dropWidth[0]).toBeLessThanOrEqual(dropWidth[1]!);
  await b.page.getByTestId('drop-open-app').click();
  await expect(b.page.getByTestId('drop-page')).toBeHidden();
  expect(new URL(b.page.url()).pathname).toBe('/'); // the link is not run again on reload
  await b.ctx.close();

  // the device holding the list finds them at its next sync; nothing was written by itself
  await pa.goto('/#today');
  await eventually(pa, async () => { await expect(pa.getByTestId('review')).toBeVisible({ timeout: 500 }); });
  await expect(pa.getByTestId('review')).toContainText('answer the drop one');
  await expect(pa.getByTestId('review')).not.toContainText('answer the drop two');
  await expect(pa.getByTestId('review')).toContainText('From my AI');
  await noSideways(pa, 'inbox review');
  await pa.getByTestId('apply-changes').click();
  // then the second, which the person dismisses
  await expect(pa.getByTestId('review')).toContainText('answer the drop two', { timeout: 10_000 });
  await pa.getByRole('button', { name: 'Cancel' }).click();
  await expect(pa.getByTestId('review')).toBeHidden();
  await expect.poll(() => inboxSize(recovery), { timeout: 10_000 }).toBe(0);
  await pa.getByTestId('tab-matrix').click();
  await expect(pa.locator('.matrix')).toContainText('answer the drop one');
  await expect(pa.locator('.matrix')).not.toContainText('answer the drop two');
  // and it does not come back
  await nudge(pa);
  await pa.waitForTimeout(1500);
  await expect(pa.getByTestId('review')).toBeHidden();
  await a.ctx.close();
});

test('one-tap link: opened in the browser that holds the list, it shows the review at once and posts nothing', async ({ browser }, info) => {
  test.slow();
  const a = await secondDevice(browser, info);
  const recovery = await setUp(a.page);
  await a.page.getByTestId('sync-key-saved').click();
  await expect(a.page.getByTestId('sync-status')).toContainText('Synced at');
  const addr = await dropAddress(a.page);
  const posts: string[] = [];
  const tab = await a.ctx.newPage(); // the same storage
  tab.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  // the "j" form, as an AI that cannot compress would write it
  const link = addr + 'j.' + encodeURIComponent(JSON.stringify(cs('Open Mail and answer the direct one')));
  await tab.goto(link);
  await expect(tab.getByTestId('review')).toContainText('answer the direct one', { timeout: 20_000 });
  await expect(tab.getByTestId('drop-page')).toBeHidden();
  expect(new URL(tab.url()).hash).toBe('');
  await noSideways(tab, 'drop review');
  await tab.getByTestId('apply-changes').click();
  await expect(tab.getByTestId('sheet')).toBeHidden();
  await tab.getByTestId('tab-matrix').click();
  await expect(tab.locator('.matrix')).toContainText('answer the direct one');
  expect(posts.filter(u => u.endsWith('/inbox'))).toEqual([]);
  expect(await inboxSize(recovery)).toBe(0);
  await a.ctx.close();
});

test('one-tap link: a broken link says so in a plain sentence and sends nothing', async ({ browser }, info) => {
  const a = await secondDevice(browser, info);
  const requests: string[] = [];
  a.page.on('request', r => { if (r.url().includes('/inbox')) requests.push(r.url()); });
  const open = async (hash: string) => { await a.page.goto('/drop#' + hash); await a.page.reload(); };
  const addr = 'S'.repeat(22) + '.' + 'K'.repeat(43) + '.';
  await open('garbage');
  await expect(a.page.getByTestId('drop-error')).toContainText('isn’t a Réussite change-set');
  // a well-formed address with a change-set that holds nothing usable
  await open(addr + 'j.' + encodeURIComponent('{"v":1,"changes":[{"op":"nope"}]}'));
  await expect(a.page.getByTestId('drop-error')).toContainText('isn’t a Réussite change-set');
  expect(requests).toEqual([]);
  // a good change-set for a list that isn't on the relay: it tries, and says so
  await open(addr + 'j.' + encodeURIComponent(JSON.stringify(cs('x'))));
  await expect(a.page.getByTestId('drop-error')).toContainText('isn’t on the relay');
  await a.page.getByTestId('drop-open-app').click();
  await expect(a.page.getByTestId('drop-page')).toBeHidden();
  await a.ctx.close();
});
