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
  await sheet.getByRole('button', { name: 'Tap again to drop it' }).click();
  await expect(row).toHaveCount(0);

  await goTab(page, 'matrix');
  await page.getByTestId('cemetery').locator('summary').click();
  await expect(page.getByTestId('cemetery-row')).toContainText('Buried errand');
  await page.getByTestId('cemetery-restore').first().click();
  await expect(page.getByTestId('cemetery-row').filter({ hasText: 'Buried errand' })).toHaveCount(0);
  await expect(page.locator('[data-task]', { hasText: 'Buried errand' }).first()).toBeVisible();
});
