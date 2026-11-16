// One day of a weekly series called off (2026-11-16): the series' sheet has "Skip <date>" for the next day it comes on. That day's card
// is dropped and is not placed again; the series goes on. The connector's side (task.drop with a day) is relay/test/connector.standing.test.ts.
import { test, expect, type Page } from '@playwright/test';
import { morningClock, importSample, expandSheet, addCard, noSideways } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');
const todayName = () => {
  const x = new Date();
  if (x.getHours() < 5) x.setDate(x.getDate() - 1);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x.getDay()]!;
};

test('Skip on a series calls off its next day only: the card leaves today and is not put back', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await morningClock(page);
  await importSample(page);
  await addCard(page, 'Choir, Hill House 602');
  const id = (await page.getByTestId('first').getAttribute('data-task'))!;
  await page.getByTestId('first').locator('p.t').click();
  await sheet(page).locator('details.more summary').click();
  await expandSheet(page);
  await sheet(page).locator('input[name=template]').check();
  await sheet(page).locator('input[name=at]').fill('19:00');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  // Give it today's weekday: the app then places today's card by itself.
  await page.goto('/#task/' + id);
  await expect(sheet(page).getByTestId('task-sheet')).toBeVisible();
  await expandSheet(page);
  await sheet(page).getByTestId('weekdays').getByLabel(todayName(), { exact: true }).check();
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  await page.getByTestId('tab-today').click();
  const copy = page.locator(`[data-task^="${id}-"]`);
  await expect(copy.first()).toBeVisible({ timeout: 10_000 });

  await page.goto('/#task/' + id);
  const skip = sheet(page).getByTestId('skip-day');
  await expect(skip).toContainText('Skip');
  await page.setViewportSize({ width: 320, height: 568 });
  await noSideways(page, 'a series sheet with Skip');
  const first = await skip.textContent();
  await skip.click();
  await expect(sheet(page)).toBeHidden();
  await expect(copy).toHaveCount(0);
  // Not put back: neither now nor after a reload.
  await page.reload();
  await page.getByTestId('tab-today').click();
  await expect(page.locator('.todayview')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(copy).toHaveCount(0);
  // The series goes on: the button now names the week after.
  await page.goto('/#task/' + id);
  await expect(sheet(page).getByTestId('skip-day')).toBeVisible();
  expect(await sheet(page).getByTestId('skip-day').textContent()).not.toBe(first);
});
