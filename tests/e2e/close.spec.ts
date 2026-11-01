import { test, expect, type Page } from '@playwright/test';
import { goTab, noSideways, importSample, morningClock } from './helpers';

// The close of the day (plan 2 Nov, S8): one line for the pillars played, the project bars that moved today, tomorrow's first step.
const sheet = (page: Page) => page.getByTestId('sheet');
const card = (page: Page, name: string) => page.locator('article.proj', { hasText: name });

/** A project with a count goal, one step that moves it, done today. */
async function aBarMoves(page: Page) {
  await page.goto('/#projects');
  await page.getByTestId('add-card').click();
  await sheet(page).locator('input[name=name]').fill('Book');
  await sheet(page).getByRole('button', { name: 'Add', exact: true }).click();
  await card(page, 'Book').getByTestId('edit-project').click();
  const smart = sheet(page).getByTestId('smart');
  await smart.getByTestId('goal-outcome').fill('Write the book');
  await smart.getByTestId('measure-count').click();
  await smart.getByTestId('measure-target').fill('10');
  await smart.getByTestId('measure-unit').fill('pages');
  await smart.getByTestId('measure-unit').press('Tab');
  await sheet(page).getByRole('button', { name: 'Done', exact: true }).click();
  const c = card(page, 'Book');
  if (!(await c.locator('details').first().evaluate(d => (d as HTMLDetailsElement).open))) await c.locator('details > summary').first().click();
  for (const title of ['Draft chapter one', 'Buy ink']) {
    await c.locator('.addstep input[name=title]').fill(title);
    await c.locator('.addstep').getByRole('button', { name: 'Add' }).click();
    await expect(c.locator('ol.steps li', { hasText: title }).first()).toBeVisible();
  }
  await c.locator('ol.steps li', { hasText: 'Draft chapter one' }).getByRole('button', { name: 'Draft chapter one' }).click();
  await sheet(page).getByTestId('moves-yes').click();
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  await c.locator('ol.steps li', { hasText: 'Draft chapter one' }).getByRole('button', { name: 'Draft chapter one' }).click();
  await sheet(page).getByRole('button', { name: 'Mark done' }).click();
  await sheet(page).getByRole('button', { name: 'I didn’t time it' }).click();
  await sheet(page).getByRole('button', { name: 'Keep +1' }).click();
  await expect(sheet(page)).toBeHidden();
}

async function openSummary(page: Page) {
  await goTab(page, 'today');
  await page.locator('main').getByRole('button', { name: 'Close the day' }).click();
  await page.getByTestId('skip').click();
  await expect(page.getByTestId('show-summary')).toBeVisible();
}

test('the close names the pillars played, the bar that moved and tomorrow’s first step; open steps count for nothing', async ({ page }) => {
  await morningClock(page);
  await aBarMoves(page);
  await openSummary(page);
  const s = page.getByTestId('show-summary');
  // One pillar played (the project's), once; the other pillars are not listed.
  await expect(s.getByTestId('close-pillars')).toHaveText(/^\s*♠\s*1\s*$/);
  // The bar that moved: its project, the bar as the Projects tab shows it, and what today added. "Buy ink" is open and is not counted.
  const row = s.getByTestId('close-moved-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Book');
  await expect(row).toContainText('1 of 10 pages');
  await expect(row).toContainText('+1 today');
  await expect(row.locator('.goalbar')).toHaveAttribute('aria-label', '1 of 10 pages');
  // Tomorrow's first step: named as soon as it is chosen.
  await expect(s.getByTestId('close-tomorrow')).toHaveCount(0);
  await s.locator('select').selectOption({ label: 'Buy ink' });
  await expect(s.getByTestId('close-tomorrow')).toHaveText('Tomorrow starts with: Buy ink');
  await page.getByTestId('close-confirm').click();
  await expect(page.locator('.toast')).toContainText('Tomorrow starts with: Buy ink');
});

test('when no bar moved the close shows none, only the pillars played', async ({ page }) => {
  await morningClock(page);
  await importSample(page); // the sample played a thesis step today, but its project has no bar
  await openSummary(page);
  await expect(page.getByTestId('close-pillars')).toBeVisible();
  await expect(page.getByTestId('close-moved')).toHaveCount(0);
});

for (const width of [320, 375, 430]) {
  test(`the close with a moved bar does not scroll sideways at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await morningClock(page);
    await aBarMoves(page);
    await openSummary(page);
    await expect(page.getByTestId('close-moved')).toBeVisible();
    await noSideways(page, 'close with a moved bar');
  });
  test(`the close in French does not scroll sideways at ${width} px, and says what moved`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await morningClock(page);
    await aBarMoves(page);
    await goTab(page, 'settings');
    await page.getByRole('button', { name: 'Français' }).click();
    await goTab(page, 'today');
    await page.locator('main').getByRole('button', { name: 'Clôturer la journée' }).click();
    await page.getByTestId('skip').click();
    await expect(page.getByTestId('close-moved-row')).toContainText('1 sur 10 pages');
    await expect(page.getByTestId('close-moved-row')).toContainText('+1 aujourd’hui');
    await noSideways(page, 'close in French');
  });
}
