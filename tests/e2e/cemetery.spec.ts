import { test, expect } from '@playwright/test';
import { importSample, addCard, goTab } from './helpers';

test('a dropped card leaves every list, waits in the Cemetery, and Restore brings it back', async ({ page }) => {
  await importSample(page);
  await addCard(page, 'Buried errand');
  const row = page.locator('[data-task]', { hasText: 'Buried errand' });
  await expect(row).toHaveCount(1);
  await page.getByTestId('first').getByRole('button', { name: 'Edit', exact: true }).click();
  const sheet = page.getByTestId('sheet');
  await sheet.getByRole('button', { name: 'Drop it' }).click();
  await sheet.getByRole('button', { name: 'Confirm' }).click();
  await expect(row).toHaveCount(0);

  await goTab(page, 'matrix');
  await page.getByTestId('cemetery').locator('summary').click();
  await expect(page.getByTestId('cemetery-row')).toContainText('Buried errand');
  await page.getByTestId('cemetery-restore').first().click();
  await expect(page.getByTestId('cemetery-row').filter({ hasText: 'Buried errand' })).toHaveCount(0);
  // Back among the cards: a box shows only its first two, so look in the list of every card.
  await page.getByTestId('all-cards').locator('summary').click();
  await expect(page.getByTestId('all-cards-list').locator('[data-task]', { hasText: 'Buried errand' })).toBeVisible();
});

test('Start here drops its card on a second tap, on Today', async ({ page }) => {
  await importSample(page);
  await addCard(page, 'Dull errand');
  const first = page.getByTestId('first');
  await expect(first).toContainText('Dull errand');
  await first.getByTestId('drop').click();
  await expect(first.getByTestId('drop')).toHaveText('Confirm');
  await first.getByTestId('drop').click();
  await expect(page.locator('[data-task]', { hasText: 'Dull errand' })).toHaveCount(0);
});
