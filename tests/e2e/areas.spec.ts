import { test, expect, type Page } from '@playwright/test';
import { noSideways, openMenu, goTab, calEvent, expandSettings, expandSheet, addCard, newCardSheet, morningDate } from './helpers';

// Areas inside places, half days and people's pages (phase 4b). Every name here is invented.
const sheet = (page: Page) => page.getByTestId('sheet');

/** Cairo with an area, Heliopolis, and the person is in Cairo. */
async function cairoWithHeliopolis(page: Page) {
  await page.goto('/#settings'); await expandSettings(page);
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
async function addStep(page: Page, title: string, where: string, at?: string) {
  await goTab(page, 'today');
  await newCardSheet(page, title);
  await expandSheet(page);
  await sheet(page).locator('label.field', { hasText: /^Where/ }).locator('select').selectOption({ label: where });
  if (at) { await sheet(page).locator('input[name=at]').fill(at); }
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
}

/** Open the place menu from the pill. */
async function placeMenu(page: Page) {
  await page.getByTestId('place-pill').click();
  const menu = page.getByTestId('place-menu');
  await expect(menu).toBeVisible();
  return menu;
}
/** The Matrix's folded list of every card, opened. */
async function allCards(page: Page) {
  const fold = page.getByTestId('all-cards');
  if (!(await fold.evaluate(el => (el as HTMLDetailsElement).open))) await fold.locator('summary').click();
  return page.getByTestId('all-cards-list');
}
/** Tick View for a place or an area in the menu, then close it. */
async function viewOnly(page: Page, name: string) {
  const menu = await placeMenu(page);
  await menu.getByRole('checkbox', { name: `View: ${name}`, exact: true }).check();
  await expect(menu.getByRole('checkbox', { name: `View: ${name}`, exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}

test('an area is made under a place, offered in the place field, and View in the place menu narrows Today, the Matrix and the Calendar to it', async ({ page }) => {
  await morningDate(page); // its fixed items are at 22:00 and 22:30: in the evening they would have passed
  await cairoWithHeliopolis(page);
  await addStep(page, 'Renew the visa', 'Cairo');
  await addStep(page, 'Buy a SIM card', 'Cairo › Heliopolis');
  await addStep(page, 'Fix the shutters', 'Cairo › Heliopolis');
  await addStep(page, 'Call the bank', 'Anywhere');

  // Today: the region is in view by default, so Cairo and its area are both on the page, and there are no chips any more.
  const main = page.locator('main');
  for (const s of ['Renew the visa', 'Buy a SIM card', 'Fix the shutters', 'Call the bank']) await expect(main).toContainText(s);
  await expect(page.getByTestId('area-chips')).toHaveCount(0);
  await expect(page.getByTestId('place-pill')).toContainText('In Cairo');

  // The menu: Cairo is where I am and what I see; the area has a pair of ticks of its own and nothing is ticked on it yet.
  const menu = await placeMenu(page);
  await expect(menu.getByRole('checkbox', { name: 'I’m here: Cairo', exact: true })).toBeChecked();
  await expect(menu.getByRole('checkbox', { name: 'View: Cairo', exact: true })).toBeChecked();
  await expect(menu.getByRole('checkbox', { name: 'View: Cairo › Heliopolis', exact: true })).not.toBeChecked();
  await expect(menu.getByRole('checkbox', { name: 'I’m here: Cairo › Heliopolis', exact: true })).not.toBeChecked();
  await expect(menu.getByRole('checkbox', { name: 'View: Everywhere', exact: true })).not.toBeChecked();
  await expect(menu.getByRole('checkbox', { name: 'I’m here: Everywhere' })).toHaveCount(0); // Everywhere is only a view
  await page.keyboard.press('Escape');

  // Two fixed times for the Calendar's part of this, late in the day so that neither has passed (a missed one is asked about whatever the view).
  for (const [title, at] of [['Renew the visa', '22:00'], ['Buy a SIM card', '22:30']] as const) {
    await page.locator('.row', { hasText: title }).getByTestId('details').click();
    await sheet(page).locator('input[name=at]').fill(at);
    await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet(page)).toBeHidden();
  }

  // The Matrix, whole: a small tag with the area on the area's steps (in the folded list of every card).
  await goTab(page, 'matrix');
  const list = await allCards(page);
  await expect(page.getByTestId('all-cards')).toContainText('All cards (4)');
  await expect(list.locator('.item', { hasText: 'Buy a SIM card' }).locator('.tag.area')).toHaveText('Heliopolis');
  await expect(list.locator('.item', { hasText: 'Renew the visa' }).locator('.tag.area')).toHaveCount(0);

  // The Calendar, whole, then narrowed from the pill on that very page: the step of Cairo's own goes, the area's stays.
  await goTab(page, 'calendar');
  await page.getByTestId('cal-day').click();
  await expect(calEvent(page, 'visa')).toHaveCount(1);
  await expect(calEvent(page, 'SIM')).toHaveCount(1);
  await viewOnly(page, 'Cairo › Heliopolis');
  await expect(page.getByTestId('place-pill')).toContainText('Viewing Heliopolis');
  await expect(calEvent(page, 'visa')).toHaveCount(0);
  await expect(calEvent(page, 'SIM')).toHaveCount(1);

  // The Matrix, narrowed to the steps set to the area alone (not Cairo's own, not Anywhere's).
  await goTab(page, 'matrix');
  await expect(page.locator('.matrix')).not.toContainText('Renew the visa');
  await expect(page.locator('.matrix')).not.toContainText('Call the bank');
  await expect(page.locator('.matrix')).toContainText('Fix the shutters');
  await expect(page.locator('.matrix')).toContainText('Buy a SIM card');
  await expect(page.getByTestId('all-cards')).toContainText('All cards (2)');

  // Today: the area's steps and Anywhere's.
  await goTab(page, 'today');
  await expect(main).not.toContainText('Renew the visa');
  for (const s of ['Buy a SIM card', 'Fix the shutters', 'Call the bank']) await expect(main).toContainText(s);

  // The view is kept on the device: the app reopens on Heliopolis.
  await page.reload();
  await expect(page.getByTestId('place-pill')).toContainText('Viewing Heliopolis');
  await expect(main).not.toContainText('Renew the visa');
  await expect(main).toContainText('Fix the shutters');
  expect(await page.evaluate(() => localStorage.getItem('reussite.placeview'))).toContain('"region"');
  const again = await placeMenu(page);
  await expect(again.getByRole('checkbox', { name: 'View: Cairo › Heliopolis', exact: true })).toBeChecked();
  await expect(again.getByRole('checkbox', { name: 'I’m here: Cairo', exact: true })).toBeChecked();
  // Viewing the region again clears the narrowing, and the banner stays away (it is only for another region's page).
  await again.getByRole('checkbox', { name: 'View: Cairo', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('place-pill')).toContainText('In Cairo');
  await expect(main).toContainText('Renew the visa');
  await expect(page.getByTestId('viewing-banner')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('reussite.placeview'))).toBeNull();
});

test('"I’m here" and "View" are two ticks of their own: viewing another place, Everywhere, and moving to another region resets the view', async ({ page }) => {
  await cairoWithHeliopolis(page);
  await page.getByTestId('place-pill').click();
  await sheet(page).getByTestId('pm-manage').click();
  await sheet(page).getByPlaceholder('Name of the new place').fill('Paris');
  await sheet(page).getByTestId('add-place').click();
  await expect(sheet(page)).toContainText('Paris');
  await page.keyboard.press('Escape');
  await addStep(page, 'Renew the visa', 'Cairo');
  await addStep(page, 'Book the train', 'Paris');
  await addStep(page, 'Call the bank', 'Anywhere');

  // View Paris from Cairo: the pill says so, the banner names the page, and the Matrix has Paris's steps and Anywhere's.
  await viewOnly(page, 'Paris');
  await expect(page.getByTestId('place-pill')).toContainText('Viewing Paris');
  await expect(page.getByTestId('place-pill')).not.toContainText('In Cairo');
  await goTab(page, 'matrix');
  await expect(page.getByTestId('viewing-banner')).toContainText('Paris');
  await expect(page.locator('.matrix')).toContainText('Book the train');
  await expect(page.locator('.matrix')).toContainText('Call the bank');
  await expect(page.locator('.matrix')).not.toContainText('Renew the visa');
  // Back to Cairo from the banner.
  await page.getByTestId('viewing-banner').getByRole('button', { name: 'Back to Cairo' }).click();
  await expect(page.getByTestId('viewing-banner')).toHaveCount(0);
  await expect(page.getByTestId('place-pill')).toContainText('In Cairo');
  await expect(page.locator('.matrix')).toContainText('Renew the visa');

  // Everywhere: the lists ignore the place, on the Matrix and on Projects.
  await viewOnly(page, 'Everywhere');
  await expect(page.getByTestId('place-pill')).toContainText('Everywhere');
  await expect(page.getByTestId('viewing-banner')).toHaveCount(0);
  const every = await allCards(page);
  for (const s of ['Renew the visa', 'Book the train', 'Call the bank']) await expect(every).toContainText(s);
  await page.reload();
  await expect(page.getByTestId('place-pill')).toContainText('Everywhere');
  await expect(await allCards(page)).toContainText('Book the train');

  // Say I'm here in Paris: the pill follows, and the view goes to Paris with it, not back to Everywhere.
  const menu = await placeMenu(page);
  await menu.getByRole('checkbox', { name: 'I’m here: Paris', exact: true }).check();
  await expect(menu.getByRole('checkbox', { name: 'I’m here: Cairo', exact: true })).not.toBeChecked();
  await expect(menu.getByRole('checkbox', { name: 'View: Paris', exact: true })).toBeChecked();
  await expect(menu.getByRole('checkbox', { name: 'View: Everywhere', exact: true })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('place-pill')).toContainText('In Paris');
  await expect(page.locator('.matrix')).toContainText('Book the train');
  await expect(page.locator('.matrix')).not.toContainText('Renew the visa');
  await expect(page.locator('.matrix')).toContainText('Call the bank');

  // Moving between the areas of one region keeps the view: here goes to Heliopolis while Cairo is viewed.
  const m2 = await placeMenu(page);
  await m2.getByRole('checkbox', { name: 'I’m here: Cairo › Heliopolis', exact: true }).check();
  await expect(page.getByTestId('place-pill')).toContainText('In Cairo › Heliopolis');
  await expect(m2.getByRole('checkbox', { name: 'View: Cairo', exact: true })).toBeChecked();
  await m2.getByRole('checkbox', { name: 'View: Cairo › Heliopolis', exact: true }).check();
  await m2.getByRole('checkbox', { name: 'I’m here: Cairo', exact: true }).check();
  await expect(page.getByTestId('place-pill')).toContainText('Viewing Heliopolis');
  await expect(m2.getByRole('checkbox', { name: 'View: Cairo › Heliopolis', exact: true })).toBeChecked();
});

test('the morning check-in can say "afternoon in Heliopolis": the plan puts them together and Today names the half', async ({ page }) => {
  await cairoWithHeliopolis(page);
  for (const [title, where] of [['Renew the visa', 'Cairo'], ['Buy a SIM card', 'Cairo › Heliopolis'], ['Fix the shutters', 'Cairo › Heliopolis']] as const) {
    await goTab(page, 'today');
    await newCardSheet(page, title);
    await expandSheet(page);
    await sheet(page).locator('label.field', { hasText: /^Where/ }).locator('select').selectOption({ label: where });
    await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet(page)).toBeHidden();
  }
  await page.locator('main').getByRole('button', { name: 'Plan the day' }).click();
  await expect(page.getByTestId('ci-shape')).toBeVisible();
  await page.getByTestId('ci-start-at').fill('09:30'); // the start is now by default; the morning's area needs a morning start
  await page.getByTestId('ci-more').evaluate(d => { (d as HTMLDetailsElement).open = true; });
  const halves = page.getByTestId('ci-halves');
  await expect(halves.locator('[data-half=am]')).toBeVisible();
  await noSideways(page, 'check-in shape with the halves');
  await halves.locator('[data-half=pm]').getByRole('button', { name: 'Heliopolis' }).click();
  await page.getByTestId('ci-next').click();
  await expect(page.getByTestId('ci-pillars')).toBeVisible();
  await page.getByTestId('ci-next').click();
  await expect(page.getByTestId('plan-items')).toContainText('Afternoon in Heliopolis');
  await page.getByTestId('go-with-this').click();
  await page.getByTestId('ci-later').click(); // the first step alone
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
    await addCard(page, title);
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
    await noSideways(page, 'today');
    await goTab(page, 'matrix');
    await noSideways(page, 'matrix with the tags');
    await page.getByTestId('place-pill').click();
    await expect(page.getByTestId('place-menu')).toBeVisible();
    await noSideways(page, 'place menu with an area');
    await page.getByTestId('pm-view-' + await page.getByTestId('place-menu').locator('li.pm-area').first().getAttribute('data-place')).check();
    await page.keyboard.press('Escape');
    await noSideways(page, 'matrix narrowed to the area');
    await openMenu(page, 'places');
    await sheet(page).locator('details.more > summary').first().click();
    await noSideways(page, 'places sheet with the areas');
  });
}
