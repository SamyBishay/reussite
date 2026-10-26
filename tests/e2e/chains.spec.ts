import { test, expect, type Page } from '@playwright/test';
import { goTab, addCard } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');

/** Three steps in one order, made with Break it down: "Gather papers", then "Fill the form", then "Post the file". */
async function makeChain(page: Page) {
  await page.goto('/#today');
  await addCard(page, 'Gather papers');
  await page.getByTestId('first').getByRole('button', { name: 'Edit' }).click();
  await sheet(page).getByRole('button', { name: 'Break it down' }).click();
  await page.getByTestId('bd-first').getByRole('textbox').first().fill('Open the drawer');
  await page.getByTestId('bd-first').getByRole('button', { name: 'Next' }).click();
  const starter = page.getByTestId('bd-starter');
  await starter.getByRole('textbox').fill('Open the drawer and take the papers');
  for (const c of await starter.getByRole('checkbox').all()) await c.check();
  await starter.getByRole('button', { name: 'Next' }).click();
  await page.getByTestId('bd-estimate').getByRole('button', { name: 'Next' }).click();
  const next = page.getByTestId('bd-next');
  await expect(next.getByTestId('bd-order').getByRole('button', { name: 'In this order' })).toHaveAttribute('aria-pressed', 'true');
  for (const title of ['Fill the form', 'Post the file']) {
    await next.getByPlaceholder(/Then/i).or(next.locator('.addstep input[type=text]')).first().fill(title);
    await next.locator('.addstep').getByRole('button', { name: 'Add' }).click();
  }
  await page.getByTestId('bd-finish').click();
  await expect(sheet(page)).toBeHidden();
}

test('a chain is one card: +2 after on Today and the Matrix, unfolding, and the next step takes the head’s place', async ({ page }) => {
  await makeChain(page);
  const first = page.getByTestId('first');
  await expect(first).toContainText('Open the drawer');
  await expect(first.getByTestId('chain-toggle')).toHaveText(/\+2 after/);
  await expect(page.getByTestId('plan-list')).toHaveCount(0);

  await first.getByTestId('chain-toggle').click();
  await expect(first.locator('.chain-list li')).toHaveText([/Fill the form/, /Post the file/]);

  await goTab(page, 'matrix');
  await expect(page.locator('.matrix .item')).toHaveCount(1);
  const item = page.locator('.matrix .item');
  await expect(item.getByTestId('chain-toggle')).toHaveText(/\+2 after/);
  await item.getByTestId('chain-toggle').click();
  await expect(item.locator('.chain-list li')).toHaveCount(2);
  await item.locator('.chain-list li').first().getByRole('button').click();
  await expect(sheet(page)).toContainText('Fill the form');
  await page.keyboard.press('Escape');

  await goTab(page, 'today');
  await page.getByTestId('first').getByRole('button', { name: 'Already done' }).click();
  await page.getByRole('button', { name: 'I didn’t time it' }).click();
  await expect(page.getByTestId('first')).toContainText('Fill the form');
  await expect(page.getByTestId('first').getByTestId('chain-toggle')).toHaveText(/\+1 after/);
  await goTab(page, 'matrix');
  await expect(page.locator('.matrix .item')).toHaveCount(1);
  await expect(page.locator('.matrix .item')).toContainText('Fill the form');
});
