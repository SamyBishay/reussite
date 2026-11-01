// Today on a Sunday before the weekly review, on the smallest phone in use (iPhone SE, 375x667): the whole Start here card, its buttons included, is in view
// on first load, above the tab bar, with no scrolling (2026-11-01). The tallest Start here there is: a long title, a starter, a link and the quiet row.
import { test, expect, type Page } from '@playwright/test';
import { expandSettings, noSideways } from './helpers';

const SUNDAY = new Date(2026, 10, 1, 9, 0, 0);
const step = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'inbox', suit: 'S', kind: 'task', urgent: true, important: true, due: null, est: 20, estBy: 'samy', spent: 0, sessions: [], status: 'open',
  doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T09:00:00Z', src: 'page',
  starter: 'Open the quote and read the first line', ...o,
});
const world = (o: { timed?: boolean; language?: string } = {}) => ({
  exported: '2026-10-31T00:00:00Z', source: 'reussite-v1',
  tasks: {
    a: step('Answer the landlord about the repair quote for the kitchen', { link: 'https://example.org/quote' }),
    b: step('Call the bank', { order: 2 }),
    ...(o.timed ? { c: step('Send the form', { order: 3, status: 'done', doneDay: '2026-11-01', doneAt: '2026-11-01T07:30:00.000Z', spent: 85, sessions: [{ d: '2026-11-01', m: 85, why: 'done', at: '2026-11-01T07:30:00.000Z' }] }) } : {}),
  },
  projects: { inbox: { name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' } },
  days: { '2026-11-01': { date: '2026-11-01', plan: ['a', 'b'], launches: [], first: null, checkin: null, closed: null, summary: null } }, decisions: {}, meta: { settings: { here: 'home', ...(o.language ? { language: o.language } : {}) } },
});

async function load(page: Page, o: { timed?: boolean; language?: string } = {}) {
  await page.clock.setFixedTime(SUNDAY);
  await page.goto('/#settings');
  await expandSettings(page);
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world(o))) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('sheet')).toBeHidden();
  await page.getByTestId('tab-today').click();
  await expect(page.getByTestId('first')).toContainText('Answer the landlord');
  await expect(page.getByTestId('review-card')).toBeVisible();
}

test.describe('375x667', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('Sunday, before the review: the whole Start here card is in view on first load, above the tab bar', async ({ page }) => {
    await load(page);
    const first = (await page.getByTestId('first').boundingBox())!;
    const bar = (await page.getByTestId('tabbar').boundingBox())!;
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(first.y, 'the card starts below the top').toBeGreaterThanOrEqual(0);
    expect(first.y + first.height, 'the card ends above the tab bar').toBeLessThanOrEqual(bar.y);
    // Every button of the card is on screen, and the main ones and the arrows are 44px tall.
    for (const b of await page.getByTestId('first').getByRole('button').all()) await expect(b).toBeInViewport({ ratio: 1 });
    for (const b of await page.getByTestId('first').locator('.go:not(.quiet) .btn').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const id of ['prev-day', 'next-day']) expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noSideways(page, 'today on a sunday');
  });

  test('another day: the navigator is one row, the label is short and has no date under it', async ({ page }) => {
    await load(page);
    const nav = (await page.locator('.daynav').boundingBox())!;
    expect(nav.height).toBeLessThanOrEqual(48);
    await expect(page.getByTestId('day-label')).toHaveText('Today');
    await page.getByTestId('next-day').click();
    await page.getByTestId('next-day').click();
    await expect(page.getByTestId('back-today')).toBeVisible();
    expect((await page.locator('.daynav').boundingBox())!.height).toBeLessThanOrEqual(48);
    await expect(page.getByTestId('day-label')).toContainText('3 Nov');
  });
});

// The minutes timed so far sit in the masthead on Today, between the date and the place pill: small, whole or not at all, and the masthead stays one line.
for (const language of ['en', 'fr']) {
  for (const width of [320, 375, 390]) {
    test(`${language} at ${width}: the timed time is between the date and the pill, whole or hidden, on one line`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await load(page, { timed: true, language });
      const mast = await page.locator('.mast').boundingBox();
      expect(mast!.height).toBeLessThanOrEqual(44);
      const r = await page.evaluate(() => {
        const cell = document.querySelector('.mast-timed')!.getBoundingClientRect(), span = document.querySelector('.mast-timed span')!.getBoundingClientRect();
        const date = document.querySelector('.mast .dateline')!.getBoundingClientRect(), pill = document.querySelector('.mast .here')!.getBoundingClientRect();
        return { date: [date.left, date.right, date.height], pill: [pill.left, pill.right], span: [span.left, span.right, span.top], cell: [cell.left, cell.right, cell.top, cell.bottom] };
      });
      const shown = r.span[2]! < r.cell[3]!;
      if (shown) {
        expect(r.span[0]!).toBeGreaterThanOrEqual(r.date[1]! - 1);
        expect(r.span[1]!).toBeLessThanOrEqual(r.pill[0]! + 1);
      }
      if (width >= 375 && language === 'en') expect(shown, 'it fits at 375 and up in English').toBe(true);
      await expect(page.getByTestId('mast-timed')).toHaveAttribute('title', language === 'fr' ? /^1.h.25.chronométrées$/ : '1 h 25 timed');
      await noSideways(page, 'the masthead with the timed time');
    });
  }
}

test('no cards-count line on Today, and no timed time on the other tabs', async ({ page }) => {
  await load(page, { timed: true });
  await expect(page.locator('.daystat')).toHaveCount(0);
  await expect(page.getByTestId('mast-timed')).toHaveCount(1);
  await page.getByTestId('tab-matrix').click();
  await expect(page.getByTestId('mast-timed')).toHaveCount(0);
});
