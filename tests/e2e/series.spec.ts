// A weekly series made on the day it comes (after the morning, or with no check-in) shows on that day's list once, at its time; and a series
// can end: "until 31 Dec" is its last day. The clock is fixed to a Monday at 11:00, so the evening's rehearsal is still ahead.
import { test, expect, type Page } from '@playwright/test';
import { goTab, noSideways, expandSheet, undoLast } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');
const input = (page: Page) => page.getByTestId('home-input');
const say = async (page: Page, text: string) => { await input(page).fill(text); await input(page).press('Enter'); await input(page).blur(); };
const store = (page: Page, name: string) => page.evaluate(n => new Promise<Record<string, unknown>[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const all = open.result.transaction(n).objectStore(n).getAll(); all.onsuccess = () => res(all.result); };
}), name);
const live = async (page: Page, name: string) => (await store(page, name)).filter(d => !d._del);
const MONDAY = '2026-10-26';
const at = (hh: number, mm: number) => new Date(2026, 9, 26, hh, mm, 0); // Monday 26 October, this computer's clock

/** The copies of a series on the list: the steps that come from it, with their day and place on the day's list. */
async function copies(page: Page, title: string) {
  const tasks = await live(page, 'tasks'), days = await live(page, 'days');
  const tpl = tasks.find(t => t.template && t.title === title);
  const mine = tasks.filter(t => !t.template && t.title === title);
  const plan = (days.find(d => d.id === MONDAY)?.plan as string[] | undefined) ?? [];
  return { tpl, mine, onList: mine.filter(t => plan.includes(String(t.id))) };
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(at(11, 0));
  await page.goto('/');
});

test('a weekly series said on its day, before its time, is on the list once, and stays one after a reload', async ({ page }) => {
  await say(page, 'rehearsal every Monday 19:00');
  await expect(page.getByTestId('home-line')).toContainText('Created: ');
  await goTab(page, 'today');
  // Its copy for tonight is put on the list by itself, once.
  const row = page.locator('[data-task]', { hasText: 'Rehearsal' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('19:00');
  const { tpl, mine, onList } = await copies(page, 'Rehearsal');
  expect(tpl).toMatchObject({ template: true, weekdays: [1], at: '19:00' });
  expect(mine).toHaveLength(1);
  expect(onList).toHaveLength(1);
  expect(mine[0]).toMatchObject({ from: tpl!.id, due: MONDAY, at: '19:00', status: 'open' });
  // Opening the app again makes no second one; nor does the clock moving on.
  await page.reload();
  await goTab(page, 'today');
  await expect(page.locator('[data-task]', { hasText: 'Rehearsal' })).toHaveCount(1);
  expect((await copies(page, 'Rehearsal')).mine).toHaveLength(1);
  await page.clock.setFixedTime(at(11, 30));
  await page.reload();
  expect((await copies(page, 'Rehearsal')).mine).toHaveLength(1);
});

test('a one-off for tonight with the same words and time stands in for the series: one card, not two', async ({ page }) => {
  await say(page, 'rehearsal 19:00');
  await expect(page.getByTestId('home-line')).toBeVisible();
  await say(page, 'rehearsal every Monday 19:00');
  await expect(page.getByTestId('home-line')).toContainText('Rehearsal');
  await goTab(page, 'today');
  await expect(page.locator('[data-task]', { hasText: 'Rehearsal' })).toHaveCount(1);
  const tasks = await live(page, 'tasks');
  expect(tasks.filter(t => !t.template && /^Rehearsal/.test(String(t.title)))).toHaveLength(1);
  expect(tasks.filter(t => !t.template && t.from)).toHaveLength(0);
});

test('a series that ended before today is not put on the list', async ({ page }) => {
  await say(page, 'rehearsal every Monday 19:00 until 2026-10-25');
  await expect(page.getByTestId('home-line')).toContainText('Created: ');
  const { tpl, mine } = await copies(page, 'Rehearsal');
  expect(tpl).toMatchObject({ template: true, weekdays: [1], at: '19:00', until: '2026-10-25' });
  expect(mine).toHaveLength(0);
  await goTab(page, 'today');
  await expect(page.locator('[data-task]', { hasText: 'Rehearsal' })).toHaveCount(0);
});

test('its last day is today: it is put on the list tonight', async ({ page }) => {
  await say(page, 'rehearsal every Monday 19:00 until 2026-10-26');
  await expect(page.getByTestId('home-line')).toContainText('Created: ');
  expect((await copies(page, 'Rehearsal')).mine).toHaveLength(1);
});

for (const width of [320, 375, 430]) {
  test(`the step sheet of a series has an Until field, in More, that is saved and cleared at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await say(page, 'choir every Tuesday 18:00 until 2026-12-31');
    await expect(page.getByTestId('home-line')).toContainText('Created: ');
    expect((await copies(page, 'Choir')).tpl).toMatchObject({ weekdays: [2], at: '18:00', until: '2026-12-31' });

    await goTab(page, 'projects');
    await page.locator('[data-project=inbox] summary').click();
    await page.locator('[data-project=inbox] [data-task]', { hasText: 'Choir' }).getByRole('button', { name: /Choir/ }).click();
    await expandSheet(page);
    await expect(sheet(page).getByTestId('weekdays').getByLabel('Tue')).toBeChecked();
    await expect(sheet(page).getByTestId('until')).toHaveValue('2026-12-31');
    await noSideways(page, 'task sheet with Until');
    await sheet(page).getByTestId('until').fill('2027-01-15');
    await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet(page)).toBeHidden();
    await expect.poll(async () => (await copies(page, 'Choir')).tpl?.until).toBe('2027-01-15');

    await page.locator('[data-project=inbox] [data-task]', { hasText: 'Choir' }).getByRole('button', { name: /Choir/ }).click();
    await expandSheet(page);
    await sheet(page).getByTestId('until').fill('');
    await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet(page)).toBeHidden();
    await expect.poll(async () => (await copies(page, 'Choir')).tpl?.until ?? null).toBeNull();
  });
}

test('Undo of a series takes tonight\'s copy with it', async ({ page }) => {
  await say(page, 'rehearsal every Monday 19:00');
  await expect(page.getByTestId('home-line')).toContainText('Created: ');
  await expect.poll(async () => (await copies(page, 'Rehearsal')).mine.length).toBe(1);
  await undoLast(page);
  await expect(page.getByTestId('home-line')).toHaveCount(0);
  await expect.poll(async () => (await live(page, 'tasks')).filter(t => t.title === 'Rehearsal').length).toBe(0);
});
