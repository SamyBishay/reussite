import { test, expect } from '@playwright/test';
import { importSample, noSideways } from './helpers';

test('Settings → About → Copy diagnostics shows the version and none of the list', async ({ page }) => {
  await importSample(page);
  await page.goto('/#settings');
  await page.getByTestId('about').getByTestId('diagnostics-open').click();
  const block = page.getByTestId('diagnostics-text');
  await expect(block).toContainText('version: 2.');
  await expect(block).toContainText('[sync]');
  await expect(block).not.toContainText('Doctolib');
  await noSideways(page, 'diagnostics sheet');
});
