// Home never scrolls (2026-11-01): the page is exactly one screen tall, whatever Home shows, on a tall phone and on the smallest one, with the island's room
// taken off the top (the iPhone home-screen app). The mark and the greeting shrink first; the card area scrolls inside itself as a last resort.
import { test, expect, type Page } from '@playwright/test';
import { importSample, morningClock, noSideways } from './helpers';

const SIZES = [{ width: 390, height: 844 }, { width: 320, height: 568 }];
const NOW = new Date(2026, 9, 26, 15, 0, 0);
const step = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'inbox', suit: 'S', kind: 'task', urgent: true, important: true, due: null, est: 20, estBy: 'samy', spent: 0, sessions: [], status: 'open',
  doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T09:00:00Z', src: 'page',
  starter: 'Open the file', ...o,
});
const world = () => ({
  exported: '2026-10-25T00:00:00Z', source: 'reussite-v1',
  tasks: { a: step('Answer the landlord'), bank: step('Call the bank', { at: '10:00', dur: 30, due: '2026-10-26', order: 5 }) },
  projects: { inbox: { name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' } },
  days: { '2026-10-26': { date: '2026-10-26', plan: ['bank', 'a'], launches: [], first: null, checkin: null, closed: null, summary: null } }, decisions: {}, meta: { settings: { here: 'home' } },
});

/** The island: a phone's home-screen app with the inset read as 0 (--sat is then 62px). */
async function island(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    Object.defineProperty(screen, 'width', { get: () => innerWidth });
    Object.defineProperty(screen, 'height', { get: () => innerHeight });
  });
}

async function fits(page: Page, where: string) {
  // The page itself: no scroll, and the input bar still on screen under everything.
  const r = await page.evaluate(() => {
    const se = document.scrollingElement!;
    const home = document.querySelector('[data-testid=home]')!.getBoundingClientRect();
    const bar = document.querySelector('[data-testid=home-input-bar]')!.getBoundingClientRect();
    return { scroll: se.scrollHeight, inner: innerHeight, homeBottom: home.bottom, barTop: bar.top, barBottom: bar.bottom };
  });
  expect(r.scroll, where + ': the page scrolls').toBeLessThanOrEqual(r.inner);
  expect(r.homeBottom, where + ': Home runs under the input').toBeLessThanOrEqual(r.barTop + 1);
  expect(r.barBottom, where + ': the input is off screen').toBeLessThanOrEqual(r.inner + 1);
  await noSideways(page, where);
}

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    test('empty state: the mark, the greeting, nothing scrolls', async ({ page }) => {
      await island(page);
      await morningClock(page);
      await importSample(page);
      await page.getByTestId('tab-home').click();
      await expect(page.getByTestId('greeting-hello')).toBeVisible();
      await expect(page.getByTestId('home-cards')).toBeHidden();
      await fits(page, 'empty');
      if (size.height >= 800) {
        const m = (await page.locator('.hello .mark').boundingBox())!;
        expect(m.height).toBeGreaterThanOrEqual(180);
        expect(m.height).toBeLessThanOrEqual(200);
      }
    });

    test('with the Plan the day card', async ({ page }) => {
      await island(page);
      await page.goto('/');
      await expect(page.getByTestId('home-plan')).toBeVisible();
      await fits(page, 'plan the day');
      await expect(page.getByTestId('home-plan')).toBeInViewport();
    });

    test('with an exchange\'s card (How long?)', async ({ page }) => {
      await island(page);
      await morningClock(page);
      await importSample(page);
      await page.getByTestId('tab-home').click();
      await page.getByTestId('home-input').fill('done sort the scanned receipts');
      await page.getByTestId('home-input').press('Enter');
      await page.getByTestId('home-input').blur();
      await expect(page.getByTestId('card-duration')).toBeVisible();
      await fits(page, 'duration card');
    });

    test('with Next steps and a missed card', async ({ page }) => {
      await island(page);
      await page.clock.setFixedTime(NOW);
      await page.goto('/#settings');
      await page.getByTestId('open-import').waitFor({ state: 'attached' }).catch(() => undefined);
      await page.evaluate(() => document.querySelectorAll('[data-testid=settings] details').forEach(d => { (d as HTMLDetailsElement).open = true; }));
      await page.getByTestId('open-import').click();
      await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world())) });
      await page.getByRole('button', { name: 'Import', exact: true }).click();
      await expect(page.getByTestId('sheet')).toBeHidden();
      // The device that ran set-up has the Next steps card.
      await page.evaluate(() => new Promise<void>((res, rej) => {
        const open = indexedDB.open('reussite');
        open.onerror = () => rej(open.error);
        open.onsuccess = () => { const tx = open.result.transaction('local', 'readwrite'); tx.objectStore('local').put({ key: 'nextSteps', value: { on: true, connector: false } }); tx.oncomplete = () => res(); };
      }));
      await page.reload();
      await page.getByTestId('tab-home').click();
      await expect(page.getByTestId('next-steps')).toBeVisible();
      await expect(page.getByTestId('missed-card')).toBeVisible();
      await fits(page, 'next steps and missed');
      // Whatever does not fit scrolls inside the card area, which can be read to its end.
      const cards = page.getByTestId('home-cards');
      await cards.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect(page.getByTestId('next-dismiss')).toBeInViewport();
      await fits(page, 'next steps and missed, scrolled');
    });
  });
}
