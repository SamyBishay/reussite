import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { importSample, noSideways } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');
// The app's day starts at 05:00; before that it is still the day before.
const todayName = () => {
  const x = new Date();
  if (x.getHours() < 5) x.setDate(x.getDate() - 1);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x.getDay()]!;
};

async function addChoir(page: Page) {
  await importSample(page);
  await page.getByPlaceholder(/The app and the first action/).fill('Choir, Hill House 602');
  await page.locator('form.quick').getByRole('button', { name: 'Add', exact: true }).click();
  const row = page.locator('.row', { hasText: 'Choir, Hill House 602' });
  await row.getByTestId('details').click();
  await sheet(page).locator('details.more summary').click();
  await sheet(page).locator('input[name=template]').check();
  await sheet(page).locator('input[name=at]').fill('19:00');
  await sheet(page).locator('input[name=dur]').fill('90');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  return row;
}

for (const width of [320, 375, 430]) {
test(`a standing item with weekdays leads the plan with its time and leave-by line at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await addChoir(page);
  // It is now a standing obligation: open it again to give it days and a lead.
  await page.locator('.row', { hasText: 'Choir, Hill House 602' }).getByTestId('details').click();
  await expect(sheet(page).getByTestId('task-sheet')).toBeVisible();
  await expect(sheet(page).getByTestId('weekdays')).toBeVisible();
  await sheet(page).getByTestId('weekdays').getByLabel(todayName(), { exact: true }).check();
  await sheet(page).getByTestId('lead').fill('30');
  await noSideways(page, 'task sheet with weekdays');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();

  await page.getByTestId('tab-today').click();
  await page.locator('main').getByRole('button', { name: 'Plan the day' }).click();
  await page.getByTestId('ci-next').click();
  await page.getByTestId('ci-next').click();
  const first = page.getByTestId('plan-items').locator('li').nth(1);
  await expect(first).toHaveAttribute('data-testid', 'plan-fixed');
  await expect(first).toContainText('Choir 19:00, Hill House 602');
  await expect(first.getByTestId('plan-leave')).toHaveText('Leave at 18:30');
  // Fixed items cannot be swapped or cut.
  await expect(first.getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Too much, cut it' }).click();
  await expect(first.getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Done cutting' }).click();
  await noSideways(page, 'check-in plan with a fixed item');
  await page.getByTestId('go-with-this').click();
  await expect(sheet(page)).toBeHidden();
  // Placed on the day, with its time.
  await expect(page.locator('ul.fixed')).toContainText('19:00');
  await expect(page.locator('ul.fixed')).toContainText('Choir, Hill House 602');
});
}

test('Add to calendar downloads an .ics with the day’s launch point when sharing is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  await importSample(page);
  await page.getByTestId('tab-today').click();
  await page.locator('form.launch-add input[name=time]').fill('23:30');
  await page.locator('form.launch-add').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.launches .chip')).toContainText('23:30');
  await page.getByTestId('tab-calendar').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('ics-today').click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^reussite-\d{4}-\d{2}-\d{2}\.ics$/);
  const text = readFileSync((await d.path())!, 'utf8');
  expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(text).toContain('SUMMARY:▶ Start');
  expect(text).toContain('TRIGGER:-PT0M');
  expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
});

for (const width of [320, 375, 430]) {
test(`the Calendar view and Settings do not scroll sideways at ${width}px with Add to calendar`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await importSample(page);
  await page.getByTestId('tab-calendar').click();
  await expect(page.getByTestId('ics-week')).toBeVisible();
  await noSideways(page, 'calendar week');
  await page.goto('/#settings');
  await expect(page.getByTestId('calendar-settings')).toBeVisible();
  await noSideways(page, 'settings');
});
}
