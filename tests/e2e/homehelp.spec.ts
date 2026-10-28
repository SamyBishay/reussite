import { test, expect } from '@playwright/test';
import { goTab, noSideways } from './helpers';

// Home's "?" explains what can be typed; it is only there when no AI is on.
test('the ? opens the help sheet with no AI, and fills the box from an example', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('home-help').click();
  await expect(page.getByTestId('home-help-sheet')).toContainText('What you can type');
  await noSideways(page, 'home help');
  await page.getByTestId('home-help-ex').first().click();
  await expect(page.getByTestId('home-input')).toHaveValue('call the bank tomorrow');
});

test('the ? is absent when an AI is on', async ({ page }) => {
  await page.goto('/');
  await goTab(page, 'settings');
  await page.getByTestId('ai-openai').click();
  await page.getByTestId('ai-key').fill('sk-or-test');
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-settings')).toContainText('A key is saved.');
  await page.getByTestId('tab-home').click();
  await expect(page.getByTestId('home-input')).toBeVisible();
  await expect(page.getByTestId('home-help')).toHaveCount(0);
});
