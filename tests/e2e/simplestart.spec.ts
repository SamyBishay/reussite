// The simple start (15 Nov, src/domain/start.ts, docs/dev/onboarding.md): a new install begins with Home and Today, its deck folded under today's hand;
// Calendar, Projects and the Matrix arrive when they have something to show, each announced once by a line behind Home's bell; Settings → Show every tab
// turns them all on. Places and trips, and Addresses and people, are off until switched on (or until such data arrives). Deal the day is one screen. The
// weekly review waits for a week and ten cards. An install from before (a backup of this version or an older one, a v1 import) keeps everything.
import { test, expect, type Page } from '@playwright/test';
import { appDay, expandSettings, goNotifications, importSample, morningClock, noSideways, openMenu, PHONES, LANGS, setLanguage, dealTheDay } from './helpers';

const NEW_DEVICE = { cookies: [], origins: [] };
const GROW = ['matrix', 'projects', 'calendar'] as const;
const HLC = (n = 1) => '0000000000001:000' + n + ':seed';

/** A new install: the welcome's Skip (the same start as finishing set-up without a first card). */
async function newInstall(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('ob-language')).toBeVisible();
  await page.getByTestId('ob-skip').click();
  await expect(page.getByTestId('home')).toBeVisible();
}

const tabs = async (page: Page) => page.getByTestId('tabbar').locator('.tab').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));

/** A card as the app stores it, made `ago` ms before the page's now (0: now, after this install's set-up; `restore` fills it in). */
function card(id: string, title: string, o: Record<string, unknown> = {}, ago = 0) {
  return [id, { _ago: ago,
    title, suit: 'S', project: 'inbox', kind: 'task', urgent: false, important: true, due: null, est: 15, status: 'open', doneDay: null, doneAt: null,
    started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, src: 'page', advances: null, ...o,
  }] as [string, Record<string, unknown>];
}

/** Restore a backup file (Settings → Data), which merges. `schema` is the version that wrote it. */
async function restore(page: Page, data: Record<string, [string, Record<string, unknown>][]>, schema = 9) {
  // The time each document was made, by the page's clock (which the spec may have pinned), so "made after set-up" holds whatever the computer's clock says.
  const now: number = await page.evaluate(() => Date.now()).catch(() => Date.now());
  const made = (f: Record<string, unknown>) => { const { _ago, ...rest } = f; return '_ago' in f ? { ...rest, created: new Date(now + 1000 - Number(_ago)).toISOString() } : rest; };
  const stamp = (id: string, f0: Record<string, unknown>) => { const f = made(f0); return { id, _v: schema, _hlc: Object.fromEntries(Object.keys(f).map(k => [k, HLC()])), ...f }; };
  const file = { format: 'reussite-backup', schema, exported: new Date().toISOString(), data: Object.fromEntries(Object.entries(data).map(([c, ds]) => [c, ds.map(([id, f]) => stamp(id, f))])) };
  await page.goto('/#settings');
  await expandSettings(page);
  page.once('dialog', d => void d.accept());
  await page.getByTestId('data').locator('input[type=file]').first().setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.locator('.toast')).toContainText(/Backup restored|Sauvegarde restaurée/);
}

const cards = (n: number, from = 0, o: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => card('c' + (from + i), 'Write card number ' + (from + i + 1), { order: from + i + 1, ...o }));

test.describe('a new install', () => {
  test.use({ storageState: NEW_DEVICE });

  test('begins with Home and Today, the deck under today\'s hand, and no places, trips or addresses', async ({ page }) => {
    await morningClock(page);
    await newInstall(page);
    await expect.poll(() => tabs(page)).toEqual(['tab-home', 'tab-today']);
    await page.getByTestId('tab-today').click();
    await expect(page.getByTestId('deck-fold')).toContainText('The deck · 0 cards');
    await expect(page.getByTestId('place-pill')).toHaveCount(0);
    await page.getByTestId('tab-home').click();
    await page.getByTestId('home-menu').click();
    await expect(page.getByTestId('menu-settings')).toBeVisible();
    for (const x of ['places', 'addresses', 'add-address']) await expect(page.getByTestId('menu-' + x)).toHaveCount(0);
    await page.keyboard.press('Escape');
    // The round plus's card has no place field, and no address or person to go to.
    await page.getByTestId('tab-today').click();
    await page.getByTestId('add-card').click();
    await page.getByTestId('sheet').locator('details').evaluateAll(ds => ds.forEach(d => { (d as HTMLDetailsElement).open = true; }));
    await expect(page.getByTestId('sheet').getByTestId('where-field')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Settings: Show every tab, and the two switches off; no stays or Plan this trip while Places and trips is off.
    await openMenu(page, 'settings');
    await expect(page.getByTestId('tabs-settings')).toBeVisible();
    await expect(page.getByTestId('places-switch')).not.toBeChecked();
    await expect(page.getByTestId('addresses-switch')).not.toBeChecked();
    await expect(page.getByTestId('stays')).toHaveCount(0);
    // A hash still opens a tab that has not arrived.
    await page.goto('/#matrix');
    await expect(page.getByTestId('matrix')).toBeVisible();
    await expect.poll(() => tabs(page)).toEqual(['tab-home', 'tab-today']);
  });

  test('each tab arrives on its condition, announced once by a line behind the bell; a tab that came stays', async ({ page }) => {
    await morningClock(page);
    await newInstall(page);
    // Calendar: the first card with a fixed time, said on Home.
    await page.getByTestId('home-input').fill('dentist tomorrow at 15:00');
    await page.getByTestId('home-input').press('Enter');
    await expect(page.getByTestId('tab-calendar')).toBeVisible();
    await expect.poll(() => tabs(page)).toEqual(['tab-home', 'tab-today', 'tab-calendar']);
    await expect(page.getByTestId('bell-dot')).toBeVisible();
    await goNotifications(page);
    await expect(page.getByTestId('tab-news-calendar')).toContainText('Calendar is now a tab');
    await page.getByTestId('tab-news-calendar').click();
    await expect(page.getByTestId('calendar-grid').or(page.getByTestId('calview'))).toBeVisible();
    await goNotifications(page);
    await expect(page.getByTestId('tab-news')).toHaveCount(0);

    // Projects at eight cards (a backup of this deck, made after its set-up, keeps it a new deck), then the Matrix at twelve open ones.
    await restore(page, { tasks: cards(7) });
    await page.goto('/');
    await expect(page.getByTestId('tab-projects')).toBeVisible();
    await expect.poll(() => tabs(page)).toEqual(['tab-home', 'tab-today', 'tab-projects', 'tab-calendar']);
    await restore(page, { tasks: cards(4, 7) });
    await page.goto('/');
    await expect(page.getByTestId('tab-matrix')).toBeVisible();
    await expect.poll(() => tabs(page)).toEqual(['tab-home', 'tab-today', 'tab-matrix', 'tab-projects', 'tab-calendar']);
    await goNotifications(page);
    await expect(page.getByTestId('tab-news-projects')).toBeVisible();
    await expect(page.getByTestId('tab-news-matrix')).toBeVisible();
    await page.getByTestId('tab-news-ok').click();
    await expect(page.getByTestId('tab-news')).toHaveCount(0);
    // The deck has left Today for the Matrix; Settings no longer offers Show every tab.
    await page.getByTestId('tab-today').click();
    await expect(page.getByTestId('deck-fold')).toHaveCount(0);
    await openMenu(page, 'settings');
    await expect(page.getByTestId('tabs-settings')).toHaveCount(0);
    // Dropping cards does not take a tab away.
    await page.evaluate(() => new Promise<void>((res, rej) => {
      const open = indexedDB.open('reussite');
      open.onerror = () => rej(open.error);
      open.onsuccess = () => { const tx = open.result.transaction('tasks', 'readwrite'); tx.objectStore('tasks').clear(); tx.oncomplete = () => res(); };
    }));
    await page.reload();
    await expect.poll(() => tabs(page)).toEqual(['tab-home', 'tab-today', 'tab-matrix', 'tab-projects', 'tab-calendar']);
  });

  test('Projects also arrives with the first project; the Matrix with the first weekly review', async ({ page }) => {
    await morningClock(page);
    await newInstall(page);
    await restore(page, { projects: [['p1', { name: 'Thesis', suit: 'S', where: 'any', goal: null, due: null, order: 1, status: 'active', _ago: 0 }]] });
    await page.goto('/');
    await expect.poll(() => tabs(page)).toEqual(['tab-home', 'tab-today', 'tab-projects']);
    await restore(page, { days: [[appDay(-1), { date: appDay(-1), plan: [], launches: [], first: null, checkin: null, closed: null, summary: null, review: new Date().toISOString() }]] });
    await page.goto('/');
    await expect.poll(() => tabs(page)).toEqual(['tab-home', 'tab-today', 'tab-matrix', 'tab-projects']);
  });

  test('Show every tab turns them all on at once, for good', async ({ page }) => {
    await newInstall(page);
    await openMenu(page, 'settings');
    await page.getByTestId('tabs-every').click();
    await expect(page.getByTestId('tabs-settings')).toHaveCount(0);
    await expect.poll(() => tabs(page)).toEqual(['tab-home', 'tab-today', 'tab-matrix', 'tab-projects', 'tab-calendar']);
    await page.reload();
    await expect.poll(() => tabs(page)).toEqual(['tab-home', 'tab-today', 'tab-matrix', 'tab-projects', 'tab-calendar']);
    // No bell line for tabs the person turned on themselves.
    await goNotifications(page);
    await expect(page.getByTestId('tab-news')).toHaveCount(0);
  });

  test('Places and trips, and Addresses and people, come back with their switches; data that arrives turns them on', async ({ page }) => {
    await morningClock(page);
    await newInstall(page);
    await openMenu(page, 'settings');
    await page.getByTestId('places-switch').check();
    await expect(page.getByTestId('stays')).toBeVisible();
    await page.getByTestId('addresses-switch').check();
    await page.getByTestId('tab-today').click();
    await expect(page.getByTestId('place-pill')).toBeVisible();
    await page.getByTestId('tab-home').click();
    await page.getByTestId('home-menu').click();
    for (const x of ['places', 'addresses', 'add-address']) await expect(page.getByTestId('menu-' + x)).toBeVisible();
    await page.keyboard.press('Escape');
    // Off again: hidden, nothing deleted.
    await openMenu(page, 'settings');
    await page.getByTestId('places-switch').uncheck();
    await page.getByTestId('addresses-switch').uncheck();
    await page.getByTestId('tab-today').click();
    await expect(page.getByTestId('place-pill')).toHaveCount(0);

    // A place and an address that arrive (here by a backup of this deck) turn both on, and the switches say why.
    await restore(page, {
      places: [['lyon', { name: 'Lyon', timeZone: 'Europe/Paris', order: 1 }]],
      addresses: [['a1', { name: 'Chez Zed', category: 'food', placeId: 'any', mapsUrl: null, state: 'want', visits: [], by: 'me', note: '' }]],
    });
    await page.reload();
    await expandSettings(page);
    await expect(page.getByTestId('places-switch')).toBeChecked();
    await expect(page.getByTestId('places-switch')).toBeDisabled();
    await expect(page.getByTestId('addresses-switch')).toBeChecked();
    await page.getByTestId('tab-today').click();
    await expect(page.getByTestId('place-pill')).toBeVisible();
  });

  test('a backup from an install from before gives the deck everything, with no bell line', async ({ page }) => {
    await morningClock(page);
    await newInstall(page);
    await restore(page, { tasks: [card('old1', 'Open Mail and reply to the landlord', {}, 90 * 86400_000)] }, 4);
    await page.goto('/');
    await expect.poll(() => tabs(page)).toEqual(['tab-home', 'tab-today', 'tab-matrix', 'tab-projects', 'tab-calendar']);
    await page.getByTestId('tab-today').click();
    await expect(page.getByTestId('place-pill')).toBeVisible();
    await page.getByTestId('tab-home').click();
    await page.getByTestId('home-menu').click();
    await expect(page.getByTestId('menu-addresses')).toBeVisible();
    await page.keyboard.press('Escape');
    await goNotifications(page);
    await expect(page.getByTestId('tab-news')).toHaveCount(0);
  });

  test('Deal the day is one screen: three cards and one for leisure or people, Keep or Swap, then Deal; the ritual is one tap away', async ({ page }) => {
    await morningClock(page);
    await newInstall(page);
    await restore(page, { tasks: [...cards(5), card('fun', 'Go to the cinema with Sam', { suit: 'D', order: 9 })] });
    await page.goto('/#today');
    await dealTheDay(page);
    const qd = page.getByTestId('sheet').getByTestId('quick-deal');
    await expect(qd).toBeVisible();
    await expect(qd.getByTestId('qd-row')).toHaveCount(3);
    await expect(qd.getByTestId('qd-leisure')).toContainText('Go to the cinema with Sam');
    // Swap shows another card from the deck; Keep off leaves a card out of the hand.
    const first = qd.getByTestId('qd-row').first();
    const before = await first.locator('p').first().innerText();
    await first.getByTestId('qd-swap').click();
    await expect(first.locator('p').first()).not.toHaveText(before);
    const swapped = await first.locator('p').first().innerText();
    await qd.getByTestId('qd-row').nth(2).getByTestId('qd-keep').click();
    await expect(qd.getByTestId('qd-row').nth(2).getByTestId('qd-keep')).toHaveAttribute('aria-pressed', 'false');
    const left = await qd.getByTestId('qd-row').nth(2).locator('p').first().innerText();
    await qd.getByTestId('qd-deal').click();
    await expect(page.getByTestId('sheet')).toBeHidden();
    const today = page.getByTestId('todayview');
    await expect(today).toContainText(swapped.trim().replace(/^\S+\s/, ''));
    await expect(today).toContainText('Go to the cinema with Sam');
    await expect(page.getByTestId('first')).not.toContainText(left.trim().replace(/^\S+\s/, ''));
    await expect(page.getByTestId('plan-list')).not.toContainText(left.trim().replace(/^\S+\s/, ''));
  });

  test('the ritual is one tap from the quick deal', async ({ page }) => {
    await morningClock(page);
    await newInstall(page);
    await restore(page, { tasks: cards(2) });
    await page.goto('/#today');
    await dealTheDay(page);
    await page.getByTestId('sheet').getByTestId('qd-ritual').click();
    await expect(page.getByTestId('sheet').locator('[data-testid^=ci-]').first()).toBeVisible();
  });

  test('no weekly review before the deck is a week old and holds ten cards: no box on Today, no line behind the bell', async ({ page }) => {
    await morningClock(page);
    await newInstall(page);
    await restore(page, { tasks: cards(12) });
    // Today is the review day.
    const dow = await page.evaluate(d => new Date(d + 'T12:00:00').getDay() || 7, appDay(0));
    await page.goto('/#settings');
    await expandSettings(page);
    await page.getByTestId('method').locator('select').first().selectOption(String(dow));
    await page.goto('/#today');
    await expect(page.getByTestId('todayview')).toBeVisible();
    await expect(page.getByTestId('review-card')).toHaveCount(0);
    await goNotifications(page);
    await expect(page.getByTestId('review-card')).toHaveCount(0);
    // The Matrix (twelve open cards) has no box either.
    await page.getByTestId('tab-matrix').click();
    await expect(page.getByTestId('matrix')).toBeVisible();
    await expect(page.getByTestId('matrix-review-card')).toHaveCount(0);
  });

  test('the service worker is registered once through set-up, so a new device never hears of a "new version"', async ({ page }) => {
    await page.addInitScript(() => {
      const sw = navigator.serviceWorker;
      if (!sw) return;
      const reg = sw.register.bind(sw);
      (window as unknown as { swCalls: number }).swCalls = 0;
      sw.register = (...a: Parameters<typeof reg>) => { (window as unknown as { swCalls: number }).swCalls++; return reg(...a); };
    });
    await page.goto('/');
    await expect(page.getByTestId('ob-language')).toBeVisible();
    await page.getByTestId('ob-next').click();
    await page.getByTestId('ob-next').click();
    await page.getByTestId('ob-first-skip').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await page.getByTestId('tab-today').click();
    await page.getByTestId('tab-home').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { swCalls: number }).swCalls)).toBe(1);
    await expect(page.getByTestId('update-banner')).toHaveCount(0);
  });
});

test.describe('an install from before', () => {
  // The default device of every spec: past set-up (its record in localStorage), so set-up never writes the simple start.
  const everything = async (page: Page, where: string) => {
    await expect.poll(() => tabs(page), { message: where }).toEqual(['tab-home', 'tab-today', 'tab-matrix', 'tab-projects', 'tab-calendar']);
    await page.getByTestId('tab-today').click();
    await expect(page.getByTestId('place-pill'), where).toBeVisible();
    await expect(page.getByTestId('deck-fold'), where).toHaveCount(0);
    await page.getByTestId('tab-home').click();
    await page.getByTestId('home-menu').click();
    for (const x of ['places', 'addresses']) await expect(page.getByTestId('menu-' + x), where).toBeVisible();
    await page.keyboard.press('Escape');
    await openMenu(page, 'settings');
    await expect(page.getByTestId('tabs-settings'), where).toHaveCount(0);
    await expect(page.getByTestId('places-switch'), where).toBeChecked();
    await expect(page.getByTestId('addresses-switch'), where).toBeChecked();
    await expect(page.getByTestId('stays'), where).toBeVisible();
  };

  test('an empty one shows everything, as before', async ({ page }) => {
    await page.goto('/');
    await everything(page, 'empty');
  });

  for (const schema of [9, 4]) {
    test(`seeded from a backup of schema ${schema}: everything as before, the ritual and the review on its day`, async ({ page }) => {
      await morningClock(page);
      await page.goto('/');
      const dow = await page.evaluate(d => new Date(d + 'T12:00:00').getDay() || 7, appDay(0));
      await restore(page, {
        tasks: [card('t1', 'Open Mail and reply to the landlord', {}, 40 * 86400_000), card('t2', 'Open the thesis draft and write a paragraph', {}, 40 * 86400_000)],
        places: [['home', { name: 'Home', timeZone: 'Europe/Paris', order: 1 }]],
        meta: [['settings', { here: 'home', reviewDay: dow }]],
      }, schema);
      await page.goto('/');
      await everything(page, 'schema ' + schema);
      await page.goto('/#today');
      await expect(page.getByTestId('review-card')).toBeVisible();
      await dealTheDay(page);
      await expect(page.getByTestId('sheet').locator('[data-testid^=ci-]').first()).toBeVisible();
      await expect(page.getByTestId('quick-deal')).toHaveCount(0);
    });
  }

  test('a v1 import: everything as before', async ({ page }) => {
    await morningClock(page);
    await importSample(page);
    await page.goto('/');
    await everything(page, 'v1 import');
  });
});

test.describe('the new screens fit', () => {
  test.use({ storageState: NEW_DEVICE });
  for (const [w, h] of PHONES) for (const lang of LANGS) {
    test(`Today with the deck, the bell's line, Settings' Tabs and the quick deal (${w}×${h}, ${lang})`, async ({ page }) => {
      await morningClock(page);
      await page.setViewportSize({ width: w, height: h });
      await newInstall(page);
      if (lang === 'fr') await setLanguage(page, 'fr');
      await restore(page, { tasks: [...cards(4, 0, { title: 'Write to the agency about the heating that stopped working again in the flat on the third floor' }), card('fun', 'Call Grandmother about the long weekend plans in the countryside', { suit: 'H' }), card('fix', 'Dentist appointment at the clinic', { at: '15:00', due: appDay(1) })] });
      await page.goto('/#today');
      await expect(page.getByTestId('deck-fold')).toBeVisible();
      await page.getByTestId('deck-fold').locator('summary').click();
      await expect(page.getByTestId('all-cards-list')).toBeVisible();
      await noSideways(page, 'today with the deck');
      await goNotifications(page);
      await expect(page.getByTestId('tab-news')).toBeVisible();
      await noSideways(page, 'the bell');
      await openMenu(page, 'settings');
      await expect(page.getByTestId('tabs-settings')).toBeVisible();
      await noSideways(page, 'settings');
      await page.goto('/#today');
      await dealTheDay(page);
      await expect(page.getByTestId('sheet').getByTestId('quick-deal')).toBeVisible();
      await noSideways(page, 'quick deal');
      // Each row's two buttons stay on screen beside or under the title.
      const box = await page.getByTestId('sheet').getByTestId('qd-swap').first().boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(w);
    });
  }
});
