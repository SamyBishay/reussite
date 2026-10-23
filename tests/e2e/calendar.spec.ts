import { test, expect } from '@playwright/test';
import { importSample } from './helpers';

const sheet = (page: import('@playwright/test').Page) => page.getByTestId('sheet');

test('the task sheet has a Short name under the title: placeholder is the derived one, saving writes it, empty clears it', async ({ page }) => {
  await importSample(page);
  await page.goto('/#task/t1');
  const field = sheet(page).getByTestId('label');
  await expect(field).toBeVisible();
  await expect(field).toHaveValue('');
  const derived = await field.getAttribute('placeholder');
  expect(derived).toBeTruthy();
  expect(derived!.split(' ').length).toBeLessThanOrEqual(5);
  expect(derived).not.toMatch(/^Open /);
  // The placeholder follows the title as it is typed.
  await sheet(page).locator('input[name=title]').fill('Call the plumber about the leak');
  await expect(field).toHaveAttribute('placeholder', /plumber/i);
  await field.fill('Plumber');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  await page.goto('/#task/t1');
  await expect(sheet(page).getByTestId('label')).toHaveValue('Plumber');
  await sheet(page).getByTestId('label').fill('');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  await page.goto('/#task/t1');
  await expect(sheet(page).getByTestId('label')).toHaveValue('');
});
