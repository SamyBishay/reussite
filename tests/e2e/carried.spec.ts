// Carried and missed, one at a time (plan 2 Nov, S3): yesterday's open steps are each decided on their own card, a timed item whose
// time passed gets Move / Remove, and nothing moves until the person answers. The clock is fixed to Monday 26 October, 15:00.
import { test, expect, type Page } from '@playwright/test';
import { expandSettings, noSideways } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');
const NOW = new Date(2026, 9, 26, 15, 0, 0);
const YESTERDAY = '2026-10-25', TODAY = '2026-10-26', TOMORROW = '2026-10-27';
const step = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'inbox', suit: 'S', kind: 'task', urgent: true, important: true, due: null, est: 20, estBy: 'samy', spent: 0, sessions: [], status: 'open',
  doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T09:00:00Z', src: 'page',
  starter: 'Open the file', ...o,
});
const day = (date: string, plan: string[]) => ({ date, plan, launches: [], first: null, checkin: null, closed: null, summary: null });
const world = () => ({
  exported: '2026-10-25T00:00:00Z', source: 'reussite-v1',
  tasks: {
    a: step('Answer the landlord'), b: step('Tidy the desk', { order: 2 }), c: step('Sort the receipts', { order: 3 }),
    call: step('Call the dentist', { at: '14:00', dur: 30, due: YESTERDAY, order: 4 }),
    bank: step('Call the bank', { at: '10:00', dur: 30, due: TODAY, order: 5 }),
  },
  projects: { inbox: { name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' } },
  days: { [YESTERDAY]: day(YESTERDAY, ['a', 'b', 'c', 'call']), [TODAY]: day(TODAY, ['bank']) }, decisions: {}, meta: { settings: { here: 'home' } },
});
const store = (page: Page, name: string) => page.evaluate(n => new Promise<Record<string, unknown>[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const all = open.result.transaction(n).objectStore(n).getAll(); all.onsuccess = () => res(all.result); };
}), name);
const doc = async (page: Page, name: string, id: string) => (await store(page, name)).find(d => d.id === id) as Record<string, any>;

async function start(page: Page, tab = 'today') {
  await page.clock.setFixedTime(NOW);
  await page.goto('/#settings');
  await expandSettings(page);
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world())) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  await page.getByTestId('tab-' + tab).click();
}
async function ritual(page: Page) {
  await page.locator('main').getByRole('button', { name: 'Plan the day' }).first().click();
  await expect(page.getByTestId('ci-yesterday')).toBeVisible();
}

test('the ritual asks about each left-open step on its own, and nothing moves before the answer', async ({ page }) => {
  await start(page);
  await ritual(page);
  const card = page.getByTestId('carried-card');
  await expect(card).toContainText('Answer the landlord');
  expect((await doc(page, 'days', YESTERDAY)).plan).toEqual(['a', 'b', 'c', 'call']); // opening it moved nothing
  expect((await doc(page, 'days', TODAY)).plan).toEqual(['bank']);

  // Another day: tomorrow.
  await page.getByTestId('carried-other').click();
  await page.locator('[data-testid=carried-days] [data-day="' + TOMORROW + '"]').click();
  await expect(card).toContainText('Tidy the desk');
  expect((await doc(page, 'days', TOMORROW)).plan).toEqual(['a']);
  expect((await doc(page, 'days', YESTERDAY)).plan).not.toContain('a');

  // Today.
  await page.getByTestId('carried-today').click();
  await expect(card).toContainText('Sort the receipts');
  expect((await doc(page, 'tasks', 'b')).carried).toBe(1);

  // Drop it, on a second tap.
  await page.getByTestId('carried-drop').click();
  await expect(card).toContainText('Sort the receipts'); // armed, not yet dropped
  expect((await doc(page, 'tasks', 'c')).status).toBe('open');
  await page.getByTestId('carried-drop').click();
  await expect(page.locator('.toast')).toContainText('Dropped');
  expect((await doc(page, 'tasks', 'c')).status).toBe('dropped');

  // Yesterday's timed item whose time passed: Move or Remove, asked on its own.
  await expect(page.getByTestId('ci-missed')).toBeVisible();
  await expect(sheet(page).getByTestId('missed-card')).toContainText('“Call the dentist” was at 14:00.');
  await sheet(page).getByTestId('missed-move').click();
  await sheet(page).locator('[data-testid=missed-move-form] [data-day="' + TOMORROW + '"]').click();
  await sheet(page).getByTestId('missed-at').fill('09:30');
  await sheet(page).getByTestId('missed-move-go').click();
  expect(await doc(page, 'tasks', 'call')).toMatchObject({ at: '09:30', due: TOMORROW, status: 'open' });
  await expect(page.getByTestId('ci-shape')).toBeVisible();
});

test('Remove on a timed item drops it, on a second tap', async ({ page }) => {
  await start(page);
  await ritual(page);
  for (let i = 0; i < 3; i++) await page.getByTestId('carried-today').click();
  await sheet(page).getByTestId('missed-remove').click();
  expect((await doc(page, 'tasks', 'call')).status).toBe('open');
  await sheet(page).getByTestId('missed-remove').click();
  await expect(page.getByTestId('ci-shape')).toBeVisible();
  expect((await doc(page, 'tasks', 'call')).status).toBe('dropped');
});

test('Make it a decision opens the decision with the step, on today’s list', async ({ page }) => {
  await start(page);
  await ritual(page);
  await page.getByTestId('carried-decision').click();
  await expect(page.getByTestId('ci-yesterday')).toHaveCount(0);
  expect(await doc(page, 'tasks', 'a')).toMatchObject({ kind: 'decision', status: 'open' });
  expect((await doc(page, 'days', TODAY)).plan).toContain('a');
});

test('Today and the bell offer the same cards, with no bulk carry', async ({ page }) => {
  await start(page);
  await expect(page.getByTestId('carry-card')).toContainText('Some steps from yesterday are still open');
  expect((await doc(page, 'days', TODAY)).plan).toEqual(['bank']);
  await page.getByTestId('carry-open').click();
  await expect(page.getByTestId('carried-sheet')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.getByTestId('carried-today').click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByTestId('carry-card')).toHaveCount(0);
  expect((await doc(page, 'days', TODAY)).plan).toEqual(['bank', 'a', 'b', 'c']);
});

test('a timed item that has passed is one small card on Home and on Today: Move, then it is gone', async ({ page }) => {
  await start(page, 'home');
  await expect(page.getByTestId('missed-card')).toContainText('“Call the bank” was at 10:00.');
  await expect(page.getByTestId('greeting-hello')).not.toContainText(/missed|passed|carried|behind/i);
  await page.getByTestId('tab-today').click();
  await expect(page.getByTestId('missed-card')).toContainText('Call the bank');
  await page.getByTestId('missed-move').click();
  await expect(page.getByTestId('missed-at')).toHaveValue(/^1[5-9]:\d\d$/); // today again: a time that has not passed
  await page.getByTestId('missed-at').fill('17:00');
  await page.getByTestId('missed-move-go').click();
  await expect(page.getByTestId('missed-card')).toHaveCount(0);
  expect(await doc(page, 'tasks', 'bank')).toMatchObject({ at: '17:00', due: TODAY });
  await page.getByTestId('tab-home').click();
  await expect(page.getByTestId('missed-card')).toHaveCount(0);
});

for (const width of [320, 375, 430]) {
  test(`the cards don’t scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await start(page, 'home');
    await noSideways(page, 'Home with the missed card');
    await page.getByTestId('missed-move').click();
    await noSideways(page, 'the move form');
    await page.getByTestId('tab-today').click();
    await ritual(page);
    await noSideways(page, 'carried card');
    await page.getByTestId('carried-other').click();
    await noSideways(page, 'carried days');
    await page.getByTestId('carried-days').locator('button').first().click();
    await page.getByTestId('carried-today').click();
    await page.getByTestId('carried-done').click();
    await noSideways(page, 'already done');
  });
}
