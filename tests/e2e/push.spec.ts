// Notifications (phase 3b step 3). The browser's push subscription is stubbed (PushManager.subscribe
// hands back keys made here and the address of a small HTTP server standing in for a push service),
// so the whole path runs for real otherwise: the app builds the schedule, encrypts it for those keys
// and uploads it to the e2e relay; the relay's cron (triggered by hand) posts to the stand-in with a
// VAPID header; the test decrypts what arrived. The relay's local D1 file shows what it holds.
import { test, expect, type Page } from '@playwright/test';
import { E2E_VAPID } from './vapid';
import { importSample, noSideways, expandSettings, expandSheet } from './helpers';
import { openedText, pushId, relayHeld, runCron, startPushStub, stubSubscription, type PushStub } from './pushstub';
import { newReceiver } from '../../src/push/testing';
import { decryptPush, type ReceiverKeys } from '../../src/push/encrypt';
import { verifyVapid, audienceOf } from '../../src/push/vapid';
import { b64uDecode, fromUtf8 } from '../../src/sync/bytes';

// Permissions and the stubbed subscription are set up for Firefox; the worker itself is checked in Chrome by push.android.spec.ts.
test.skip(({ browserName }) => browserName !== 'firefox', 'run in Firefox only');

let stub: PushStub;
let rx: ReceiverKeys;
test.beforeEach(async ({ context }) => {
  stub = await startPushStub();
  rx = await newReceiver();
  await stubSubscription(context, { endpoint: stub.endpoint, p256dh: rx.p256dh, auth: rx.auth });
});
test.afterEach(async () => { await stub.close(); });

const sheet = (page: Page) => page.getByTestId('sheet');
const plus90 = (hm: string) => { const m = (Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)) + 90) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

async function switchOn(page: Page) {
  await page.goto('/#settings'); await expandSettings(page);
  await expect(page.getByTestId('notify')).toBeVisible();
  await page.getByTestId('notify-master').check();
  await expect(page.getByTestId('notify-held')).toBeVisible();
  await expandSettings(page);
  await expect.poll(() => pushId(page)).not.toBeNull();
  return (await pushId(page))!;
}
const held = async (page: Page) => relayHeld((await pushId(page))!);
const ids = async (page: Page) => (await held(page)).map(h => h.id);
const textOf = async (h: { blob: string }) => (JSON.parse(fromUtf8(await decryptPush(b64uDecode(h.blob), rx))) as { body: string }).body;

test('switching on subscribes, registers and uploads the schedule; switching off removes it', async ({ page }) => {
  const pid = await switchOn(page);
  await expect.poll(() => relayHeld(pid).length, { timeout: 15_000 }).toBeGreaterThan(10);
  expect((await ids(page)).some(i => i.startsWith('checkin:'))).toBe(true);
  await expect(page.getByTestId('notify-held')).toContainText(/Waiting at the relay: \d+/);
  // generic by default: no title in any text
  expect(await textOf((await held(page)).find(h => h.id.startsWith('checkin:'))!)).toBe('Morning check-in');
  await page.getByTestId('notify-master').uncheck();
  await expect(page.getByTestId('notify-types')).toBeHidden();
  await expect.poll(() => relayHeld(pid).length).toBe(0);
  expect(await pushId(page)).toBeNull();
});

test('Delete everywhere also removes the notifications and calendar feed from the relay', async ({ page, request }) => {
  await importSample(page);
  const pid = await switchOn(page);
  await expect.poll(() => relayHeld(pid).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.getByTestId('feed-switch').check();
  await expect(page.getByTestId('feed-url')).toContainText('/cal/');
  const url = (await page.getByTestId('feed-url').textContent())!.trim();
  await expect.poll(async () => (await request.get(url)).status()).toBe(200);

  await page.getByTestId('sync-setup').click();
  await page.getByTestId('sync-make-key').click();
  await expect(page.locator('svg.qr')).toBeVisible();
  await page.getByTestId('sync-key-saved').click();
  await expect(page.getByTestId('sync-status')).toContainText('Synced at');
  await expandSettings(page);
  await expandSettings(page);
  await page.getByTestId('sync-delete').click();
  await page.getByTestId('sync-delete-word').fill('delete');
  await expandSettings(page);
  await page.getByTestId('sync-delete-confirm').click();
  await expect(page.getByTestId('sync-setup')).toBeVisible();

  await expect.poll(() => relayHeld(pid).length).toBe(0);
  expect(await pushId(page)).toBeNull();
  await expect(page.getByTestId('notify-master')).not.toBeChecked();
  await expect(page.getByTestId('feed-switch')).not.toBeChecked();
  await expect.poll(async () => (await request.get(url)).status()).toBe(404);
});

test('a fixed-time item rings at its minute: the relay posts a VAPID-signed push the device can read', async ({ page }) => {
  test.setTimeout(240_000); // it waits for a minute 40 to 100 s away, after a setup that is slower under load
  const hour = new Date().getHours();
  test.skip(hour < 5 || hour >= 23, 'the day starts at 05:00 and the test sets a time within the next minutes');
  await importSample(page);
  // A standing item for every day, due a minute or two from now, with no lead time.
  const due = new Date(Date.now() + 100_000);
  due.setSeconds(0, 0);
  const hhmm = String(due.getHours()).padStart(2, '0') + ':' + String(due.getMinutes()).padStart(2, '0');
  await page.getByPlaceholder(/The app and the first action/).fill('Choir, Hill House 602');
  await page.locator('form.quick').getByRole('button', { name: 'Add', exact: true }).click();
  // Added by hand with nothing running, it goes to the top of what is left: it is the first card.
  const row = page.locator('.row', { hasText: 'Choir, Hill House 602' });
  await page.getByTestId('first').getByRole('button', { name: 'Edit', exact: true }).click();
  await sheet(page).locator('details.more summary').click();
  await expandSheet(page);
  await sheet(page).locator('input[name=template]').check();
  await sheet(page).locator('input[name=at]').fill(hhmm);
  await sheet(page).locator('input[name=end]').fill(plus90(hhmm));
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  await page.locator('.row', { hasText: 'Choir, Hill House 602' }).getByTestId('details').click();
  await expandSheet(page);
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) await sheet(page).getByTestId('weekdays').getByLabel(d, { exact: true }).check();
  await sheet(page).getByTestId('lead').fill('0');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();

  const pid = await switchOn(page);
  const fixed = () => relayHeld(pid).filter(h => h.id.startsWith('fixed:'));
  await expect.poll(() => fixed().length, { timeout: 15_000 }).toBeGreaterThan(7);
  // Today's, at the minute asked for
  const todays = fixed().find(h => Math.abs(h.at - due.getTime()) < 1000);
  expect(todays, 'the item for today, at ' + hhmm).toBeTruthy();

  // Wait for its minute (the relay sends from five seconds before), then run the cron as Cloudflare would.
  await expect.poll(async () => { if (Date.now() >= due.getTime() - 3000) await runCron(); return stub.received.length; }, { timeout: 150_000, intervals: [2000] }).toBeGreaterThan(0);

  const got = stub.received[0]!;
  expect(got.method).toBe('POST');
  expect(got.path).toBe('/push/e2e-subscription');
  expect(got.headers['content-encoding']).toBe('aes128gcm');
  expect(Number(got.headers.ttl)).toBeGreaterThan(0);
  const auth = String(got.headers.authorization);
  const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(auth);
  expect(m, 'a VAPID Authorization header').toBeTruthy();
  expect(m![2]).toBe(E2E_VAPID.publicKey);
  const claims = await verifyVapid(m![1]!, E2E_VAPID.publicKey, Date.now());
  expect(claims?.aud).toBe(audienceOf(stub.endpoint));
  const opened = await openedText(got, rx);
  expect(opened.body).toBe('Leave now · ' + hhmm);
  expect(opened.title).toBe('Réussite');
  expect(opened.tag).toBe(todays!.id);
  expect(opened.url).toBe('./#today');
  // delivered: the relay no longer holds it
  expect((await ids(page)).includes(todays!.id)).toBe(false);
});

test('starting a timer adds the "Still on…?" item and stopping it removes it', async ({ page }) => {
  await importSample(page);
  const pid = await switchOn(page);
  await expect.poll(() => relayHeld(pid).length, { timeout: 15_000 }).toBeGreaterThan(5);
  expect((await ids(page)).some(i => i.startsWith('still:'))).toBe(false);
  await page.getByTestId('tab-today').click();
  await page.getByTestId('first').getByRole('button', { name: 'Just start the timer' }).click();
  await expect.poll(() => relayHeld(pid).filter(h => h.id.startsWith('still:')).length, { timeout: 15_000 }).toBe(1);
  const still = relayHeld(pid).find(h => h.id.startsWith('still:'))!;
  expect(still.at).toBeGreaterThan(Date.now() + 40 * 60_000);
  expect(await textOf(still)).toBe('Still on a step?');
  await page.getByTestId('first').getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => relayHeld(pid).filter(h => h.id.startsWith('still:')).length, { timeout: 15_000 }).toBe(0);
});

test('the settings switches take a type out of the schedule and back; the lead and text choices are kept', async ({ page }) => {
  await importSample(page);
  const pid = await switchOn(page);
  const has = (prefix: string) => relayHeld(pid).some(h => h.id.startsWith(prefix));
  await expect.poll(() => has('close:'), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => has('checkin:')).toBe(true);
  await page.getByTestId('notify-close').uncheck();
  await expect.poll(() => has('close:'), { timeout: 15_000 }).toBe(false);
  expect(has('checkin:')).toBe(true);
  await page.getByTestId('notify-checkin').uncheck();
  await expect.poll(() => has('checkin:'), { timeout: 15_000 }).toBe(false);
  await page.getByTestId('notify-close').check();
  await page.getByTestId('notify-checkin').check();
  await expect.poll(() => has('close:') && has('checkin:'), { timeout: 15_000 }).toBe(true);
  // the lead time is a setting, saved
  await expandSettings(page);
  await page.getByTestId('notify-lead').fill('15');
  await page.getByTestId('notify-lead').blur();
  await page.reload();
  await expandSettings(page);
  await expandSettings(page);
  await expect(page.getByTestId('notify-lead')).toHaveValue('15');
  // the choice is kept across a reload, and the relay still holds the list
  await expect(page.getByTestId('notify-master')).toBeChecked();
  await expandSettings(page);
  await expect(page.getByTestId('notify-text-generic')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('notify-text-titles').click();
  await expandSettings(page);
  await expect(page.getByTestId('notify-text-titles')).toHaveAttribute('aria-pressed', 'true');
});

test('"Send a test notification" posts one to the push service', async ({ page }) => {
  await switchOn(page);
  await expandSettings(page);
  await page.getByTestId('notify-test').click();
  await expect(page.locator('.toast')).toContainText('Test sent');
  await expect.poll(() => stub.received.length, { timeout: 15_000 }).toBe(1);
  const opened = await openedText(stub.received[0]!, rx);
  expect(opened).toMatchObject({ title: 'Réussite', tag: 'test', url: './#today' });
  expect(opened.body).toContain('test');
  expect(stub.received[0]!.headers.authorization).toMatch(/^vapid t=/);
});

test('offers nothing to switch on when permission is blocked, and says how to allow it', async ({ page, context }) => {
  await context.clearPermissions();
  await context.addInitScript(() => { Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'denied' }); });
  await page.goto('/#settings'); await expandSettings(page);
  await expect(page.getByTestId('notify-denied')).toBeVisible();
  await expect(page.getByTestId('notify-master')).toBeHidden();
});

for (const width of [320, 375, 430]) {
  test(`notification settings don't scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await switchOn(page);
    await page.getByTestId('notify').scrollIntoViewIfNeeded();
    await noSideways(page, 'notification settings');
    for (const id of ['notify-master', 'notify-test', 'notify-text-generic', 'notify-lead', 'notify-launch']) {
      const b = await page.getByTestId(id).evaluate(el => { const r = (el.closest('label, button') ?? el).getBoundingClientRect(); return r.height; });
      expect(b, id + ' is at least 44px tall').toBeGreaterThanOrEqual(43.5);
    }
  });
}

test.describe('on an iPhone outside the Home Screen app', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  test('it asks to add the app to the Home Screen first, with no switch', async ({ page }) => {
    await page.goto('/#settings'); await expandSettings(page);
    await expect(page.getByTestId('notify-install')).toContainText('Add Réussite to your Home Screen first');
    await expect(page.getByTestId('notify-master')).toBeHidden();
    await noSideways(page, 'install explanation');
  });
});
