import { test, expect, type Page } from '@playwright/test';
import { importSample, noSideways } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');
const quickTitle = (page: Page) => page.getByPlaceholder(/The app and the first action/);

// The task sheet as a draft: a new step is written only on Save.
for (const width of [320, 375, 430]) {
  test(`a new step opens the task sheet as a draft, offers the time it finds, and is written on Save at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await importSample(page);
    const row = page.locator('.row', { hasText: 'Dentist 14:30' });

    await quickTitle(page).fill('Dentist 14:30');
    await page.getByTestId('quick-details').click();
    await expect(sheet(page).getByTestId('task-sheet')).toBeVisible();
    await expect(sheet(page).locator('input[name=title]')).toHaveValue('Dentist 14:30');
    await expect(sheet(page).getByTestId('set-time')).toHaveText('Set 14:30 as the time');
    // The form it was typed in is emptied, and nothing is written yet.
    await expect(quickTitle(page)).toHaveValue('');
    await expect(row).toHaveCount(0);
    await noSideways(page, 'new task sheet with the hint');

    // Tapping the hint fills the fixed time (in More), and the hint goes.
    await sheet(page).getByTestId('set-time').click();
    await expect(sheet(page).getByTestId('set-time')).toHaveCount(0);
    await sheet(page).locator('details.more summary').click();
    await expect(sheet(page).locator('input[name=at]')).toHaveValue('14:30');
    await noSideways(page, 'new task sheet with More open');

    await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet(page)).toBeHidden();
    await expect(row).toHaveCount(1);

    // Saved with its time, and on today's list.
    await row.getByTestId('details').click();
    await sheet(page).locator('details.more summary').click();
    await expect(sheet(page).locator('input[name=at]')).toHaveValue('14:30');
    await expect(sheet(page).getByTestId('set-time')).toHaveCount(0);
  });
}

test('closing a new step\'s sheet writes nothing', async ({ page }) => {
  await importSample(page);
  await quickTitle(page).fill('Never saved');
  await page.getByTestId('quick-details').click();
  await expect(sheet(page).locator('input[name=title]')).toHaveValue('Never saved');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('.row', { hasText: 'Never saved' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Never saved')).toHaveCount(0);
});

test('the estimate and suit typed in the quick form carry into the draft', async ({ page }) => {
  await importSample(page);
  await quickTitle(page).fill('Sort the drawer');
  await page.locator('form.quick input[name=est]').fill('25');
  await page.getByTestId('quick-details').click();
  await expect(sheet(page).locator('input[name=est]')).toHaveValue('25');
  await expect(sheet(page).getByTestId('set-time')).toHaveCount(0);
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.row', { hasText: 'Sort the drawer' })).toHaveCount(1);
});

test('an existing step offers a time written in its title or note', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('details').first().click();
  await expect(sheet(page).getByTestId('set-time')).toHaveCount(0);
  await sheet(page).locator('input[name=title]').fill('Open Mail and call at 7pm');
  await expect(sheet(page).getByTestId('set-time')).toHaveText('Set 19:00 as the time');
  // A length is not a time.
  await sheet(page).locator('input[name=title]').fill('Open Mail and write for 1h');
  await expect(sheet(page).getByTestId('set-time')).toHaveCount(0);
  await sheet(page).locator('textarea[name=note]').fill('rendez-vous à 9h30');
  await expect(sheet(page).getByTestId('set-time')).toHaveText('Set 09:30 as the time');
  await sheet(page).getByTestId('set-time').click();
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();

  await page.getByTestId('details').first().click();
  await sheet(page).locator('details.more summary').click();
  await expect(sheet(page).locator('input[name=at]')).toHaveValue('09:30');
});
