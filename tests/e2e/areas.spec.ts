import { test, expect, type Page } from '@playwright/test';
import { noSideways, openMenu, goTab, calEvent } from './helpers';

// Areas inside places, half days and people's pages (phase 4b). Every name here is invented.
const sheet = (page: Page) => page.getByTestId('sheet');

/** Cairo with an area, Heliopolis, and the person is in Cairo. */
async function cairoWithHeliopolis(page: Page) {
  await page.goto('/#settings');
  await page.getByPlaceholder('Name of the new place').fill('Cairo');
  await page.getByTestId('add-place').click();
  await page.getByLabel('Current place').selectOption({ label: 'Cairo' });
  const editor = page.getByTestId('area-editor').last();
  await editor.getByPlaceholder('New area in Cairo').fill('Heliopolis');
  await editor.getByTestId('add-area').click();
  await expect(editor.getByLabel('Name of the area')).toHaveValue('Heliopolis');
  await goTab(page, 'today');
}

/** A step added by hand from the quick form's Details sheet, set to `where`. */
async function addStep(page: Page, title: string, where: string) {
  await goTab(page, 'today');
  await page.getByPlaceholder(/The app and the first action/).fill(title);
  await page.getByTestId('quick-details').click();
  await sheet(page).locator('label.field', { hasText: /^Where/ }).locator('select').selectOption({ label: where });
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
}

test('an area is made under a place, offered in the place field, and one tap narrows Today, the Matrix and the Calendar to it', async ({ page }) => {
  await cairoWithHeliopolis(page);
  await addStep(page, 'Renew the visa', 'Cairo');
  await addStep(page, 'Buy a SIM card', 'Cairo › Heliopolis');
  await addStep(page, 'Fix the shutters', 'Cairo › Heliopolis');
  await addStep(page, 'Call the bank', 'Anywhere');

  // Today: both Cairo and its area are on the page; the chip narrows the list to the area and Anywhere.
  const main = page.locator('main');
  const chips = page.getByTestId('area-chips');
  await expect(chips.getByRole('button', { name: 'Heliopolis' })).toBeVisible();
  for (const s of ['Renew the visa', 'Buy a SIM card', 'Fix the shutters', 'Call the bank']) await expect(main).toContainText(s);
  await chips.getByRole('button', { name: 'Heliopolis' }).click();
  await expect(chips.getByRole('button', { name: 'Heliopolis' })).toHaveAttribute('aria-pressed', 'true');
  await expect(main).not.toContainText('Renew the visa');
  for (const s of ['Buy a SIM card', 'Fix the shutters', 'Call the bank']) await expect(main).toContainText(s);
  await chips.getByRole('button', { name: 'Heliopolis' }).click();
  await expect(main).toContainText('Renew the visa');

  // The Matrix: a small tag on the area's steps, the same narrowing, and the choice is its own (Today's is cleared).
  await goTab(page, 'matrix');
  await expect(page.locator('.item', { hasText: 'Buy a SIM card' }).locator('.tag.area')).toHaveText('Heliopolis');
  await expect(page.locator('.item', { hasText: 'Renew the visa' }).locator('.tag.area')).toHaveCount(0);
  await page.getByTestId('area-chips').getByRole('button', { name: 'Heliopolis' }).click();
  await expect(page.locator('.matrix')).not.toContainText('Renew the visa');
  await expect(page.locator('.matrix')).toContainText('Fix the shutters');
  await goTab(page, 'today');
  await expect(main).toContainText('Renew the visa');
  await goTab(page, 'matrix');
  await page.getByTestId('area-chips').getByRole('button', { name: 'Heliopolis' }).click();

  // The Calendar: the same chips, on the day's cards.
  await goTab(page, 'calendar');
  await page.getByTestId('cal-day').click();
  await expect(calEvent(page, 'visa')).toHaveCount(1);
  await page.getByTestId('area-chips').getByRole('button', { name: 'Heliopolis' }).click();
  await expect(calEvent(page, 'visa')).toHaveCount(0);
  await expect(calEvent(page, 'SIM')).toHaveCount(1);
});

test('the morning check-in can say "afternoon in Heliopolis": the plan puts them together and Today names the half', async ({ page }) => {
  await cairoWithHeliopolis(page);
  for (const [title, where] of [['Renew the visa', 'Cairo'], ['Buy a SIM card', 'Cairo › Heliopolis'], ['Fix the shutters', 'Cairo › Heliopolis']] as const) {
    await goTab(page, 'today');
    await page.getByPlaceholder(/The app and the first action/).fill(title);
    await page.getByTestId('quick-details').click();
    await sheet(page).locator('label.field', { hasText: /^Where/ }).locator('select').selectOption({ label: where });
    await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet(page)).toBeHidden();
  }
  await page.locator('main').getByRole('button', { name: 'Plan the day' }).click();
  await expect(page.getByTestId('ci-shape')).toBeVisible();
  const halves = page.getByTestId('ci-halves');
  await expect(halves.locator('[data-half=am]')).toBeVisible();
  await noSideways(page, 'check-in shape with the halves');
  await halves.locator('[data-half=pm]').getByRole('button', { name: 'Heliopolis' }).click();
  await page.getByTestId('ci-next').click();
  await expect(page.getByTestId('plan-items')).toContainText('Afternoon in Heliopolis');
  await page.getByTestId('go-with-this').click();
  await expect(sheet(page)).toBeHidden();

  // Today: the area's steps are under their heading; the others are not.
  await expect(page.getByTestId('area-head')).toHaveText('Afternoon · Heliopolis');
  const under = page.getByTestId('area-head').locator('xpath=following-sibling::ol[1]');
  await expect(under).toContainText('Fix the shutters');
  await expect(page.locator('main')).toContainText('Renew the visa');
  await expect(under).not.toContainText('Renew the visa');

  // The Calendar labels the day.
  await goTab(page, 'calendar');
  await page.getByTestId('cal-day').click();
  await expect(calEvent(page, 'Afternoon · Heliopolis')).toHaveCount(1);
});

test('a person has a page of the open steps that go to them or name them', async ({ page }) => {
  await page.goto('/#addresses');
  await page.getByTestId('person-new').click();
  await sheet(page).getByTestId('person-name').fill('Ibrahim');
  await sheet(page).getByTestId('person-save').click();
  await expect(sheet(page)).toBeHidden();
  await goTab(page, 'today');
  for (const title of ['Call Ibrahim about the flat', 'Pay the water bill']) {
    await page.getByPlaceholder(/The app and the first action/).fill(title);
    await page.locator('form.quick').getByRole('button', { name: 'Add', exact: true }).click();
  }
  await openMenu(page, 'addresses');
  await page.getByTestId('person-page-open').click();
  const pg = sheet(page).getByTestId('person-page');
  await expect(pg).toContainText('Call Ibrahim about the flat');
  await expect(pg).toContainText('Names them');
  await expect(pg).not.toContainText('Pay the water bill');
  // Tapping a step opens it.
  await pg.getByRole('button', { name: 'Call Ibrahim about the flat' }).click();
  await expect(sheet(page)).toContainText('Call Ibrahim about the flat');
});

for (const width of [320, 375, 430]) {
  test(`areas do not scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await cairoWithHeliopolis(page);
    await noSideways(page, 'settings with the area editor');
    await addStep(page, 'Fix the shutters in the old flat before the landlord comes back on Tuesday', 'Cairo › Heliopolis');
    await addStep(page, 'Renew the visa', 'Cairo');
    await noSideways(page, 'today with the chips');
    await goTab(page, 'matrix');
    await noSideways(page, 'matrix with the chips and tags');
    await openMenu(page, 'places');
    await sheet(page).locator('details.more > summary').first().click();
    await noSideways(page, 'places sheet with the areas');
  });
}
