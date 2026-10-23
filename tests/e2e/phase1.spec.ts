import { test, expect, type Page } from '@playwright/test';
import { importSample, noSideways, goTab } from './helpers';

const iso = (n: number) => { const x = new Date(); x.setHours(12); x.setDate(x.getDate() + n - (new Date().getHours() < 5 ? 1 : 0)); return x.toISOString().slice(0, 10); };
const sheet = (page: Page) => page.getByTestId('sheet');

test('the tab bar never scrolls vertically', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const r = await page.locator('.tabbar').evaluate(el => [el.scrollHeight, el.clientHeight]);
  expect(r[0]).toBeLessThanOrEqual(r[1]!);
});

test('a place can be added from the place switcher on a fresh start', async ({ page }) => {
  await page.goto('/#today');
  await page.getByTestId('place-pill').click();
  await sheet(page).getByPlaceholder('Name of the new place').fill('Lyon');
  await sheet(page).getByTestId('add-place').click();
  await expect(sheet(page)).toContainText('Lyon');
  await sheet(page).locator('li', { hasText: 'Lyon' }).getByRole('button', { name: 'I’m here' }).click();
  await expect(page.getByTestId('place-pill')).toContainText('Lyon');
});

test('morning check-in: yesterday, shape, then a rule-based plan', async ({ page }) => {
  await importSample(page);
  await page.locator('main').getByRole('button', { name: 'Plan the day' }).click();
  await expect(page.getByTestId('ci-yesterday')).toContainText('text Alex');
  await page.getByTestId('ci-next').click();
  await expect(page.getByTestId('ci-shape')).toBeVisible();
  await page.getByTestId('ci-next').click();
  await expect(page.getByTestId('plan-items')).toContainText('Plan the day');
  await expect(page.getByTestId('plan-total')).toContainText('planning included');
  await page.getByTestId('go-with-this').click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('.tableau')).toContainText('Plan the day');
  await expect(page.getByTestId('first')).toBeVisible();
});

test('moving a step into Now asks for a due date, then moves it', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('tab-matrix').click();
  const later = page.getByTestId('quad4');
  await later.locator('.item', { hasText: 'scanned receipts' }).getByTestId('move-btn').click();
  await sheet(page).getByTestId('to-q1').click();
  await expect(page.getByTestId('ask-due')).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Tomorrow' }).click();
  await expect(page.getByTestId('quad1')).toContainText('scanned receipts');
});

test('calendar week view: plan a step on a day, or make it due', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('tab-calendar').click();
  await expect(page.getByTestId('calendar')).toBeVisible();
  const today = page.getByTestId('wday-' + iso(0));
  await today.locator('.cal-item', { hasText: 'thesis draft and write' }).getByTestId('cal-move').click();
  await sheet(page).getByRole('button', { name: 'Plan it on…' }).click();
  await sheet(page).getByRole('button', { name: 'Tomorrow' }).click();
  // Tomorrow may fall in next week's view; open it in the day navigator instead.
  await page.getByTestId('tab-today').click();
  await page.getByTestId('next-day').click();
  await expect(page.getByTestId('other-day')).toContainText('thesis draft and write');
  await page.getByTestId('tab-calendar').click();
  await page.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'Month' }).click();
  await expect(page.getByTestId('month')).toBeVisible();
});

test('a stay switches the current place on its first day', async ({ page }) => {
  await importSample(page);
  await goTab(page, 'settings');
  const stays = page.getByTestId('stays');
  const form = stays.locator('form');
  await form.locator('select').selectOption({ label: 'Away' });
  await form.locator('input[name=from]').fill(iso(0));
  await form.locator('input[name=to]').fill(iso(3));
  await form.getByRole('button', { name: 'Add' }).click();
  await page.getByTestId('tab-today').click();
  await expect(page.getByTestId('place-pill')).toContainText('Away');
  await expect(page.getByTestId('stay-notice')).toContainText('Away');
});

test('a forgotten timer is fixed in two taps', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('first').getByRole('button', { name: 'I started earlier' }).click();
  await sheet(page).locator('select').first().selectOption('2');
  await sheet(page).getByRole('button', { name: 'Started that long ago' }).click();
  await expect(page.getByTestId('still-banner')).toBeVisible();
  await page.getByTestId('still-fix').click(); // tap 1
  await page.getByTestId('stopped-at').click();
  await page.getByTestId('dur').first().click(); // tap 2 (after choosing "I stopped at…")
  await expect(page.getByTestId('still-banner')).toBeHidden();
});

test('a repeating step comes back once when done', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('tab-matrix').click();
  await page.locator('.item', { hasText: 'scanned receipts' }).locator('.linklike').click();
  await sheet(page).locator('details.more summary').click();
  await page.getByTestId('repeat').locator('select').selectOption('day');
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await page.locator('.item', { hasText: 'scanned receipts' }).locator('.linklike').click();
  await sheet(page).getByRole('button', { name: 'Mark done' }).click();
  await sheet(page).getByRole('button', { name: 'I didn’t time it' }).click();
  await expect(page.locator('.toast')).toContainText('Comes back on');
  await expect(page.locator('.item', { hasText: 'scanned receipts' })).toHaveCount(1);
});

test('a whole decision by hand: problem, options, balances, scores, choice, steps', async ({ page }) => {
  await page.goto('/#projects');
  await page.getByTestId('new-decision').click();
  await page.getByTestId('dw-title').fill('Train or plane?');
  await page.getByTestId('dw-title').blur();
  await page.getByTestId('dw-next').click();
  for (const o of ['Train', 'Plane']) { await page.getByTestId('dw-option').fill(o); await page.getByTestId('dw-option').press('Enter'); }
  await page.getByTestId('dw-close-list').click();
  await sheet(page).getByLabel('Add to: Pros of doing it').fill('Calm');
  await sheet(page).getByLabel('Add to: Pros of doing it').press('Enter');
  await sheet(page).getByRole('group', { name: 'Weight of Calm' }).getByRole('button', { name: 'Weight 5' }).click();
  await page.getByTestId('dw-next-option').click();
  await page.getByTestId('dw-next').click();
  await expect(page.getByTestId('dw-bars')).toContainText('Train');
  await page.getByTestId('dw-next').click();
  await page.getByTestId('dw-decide').click();
  await page.getByTestId('dw-step').fill('Open the SNCF app and book the train');
  await page.getByTestId('dw-step').press('Enter');
  await page.getByTestId('dw-finish').click();
  await expect(page.locator('main')).toContainText('Train or plane?');
  await expect(page.locator('main')).toContainText('Chosen: Train');
});

test('completing a step never blocks the next tap', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('first').getByRole('button', { name: 'Just start the timer' }).click();
  await page.getByTestId('first').getByRole('button', { name: 'Done', exact: true }).click();
  const t0 = Date.now();
  await page.getByTestId('tab-matrix').click({ timeout: 1000 });
  await expect(page.getByTestId('quad1')).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(1000);
  expect(await page.locator('.flycard').evaluateAll(els => els.every(e => getComputedStyle(e).pointerEvents === 'none'))).toBe(true);
});

test('close of the day: the cards land readable, then the summary', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await importSample(page);
  await page.locator('main').getByRole('button', { name: 'Close the day' }).click();
  await expect(page.getByTestId('show')).toBeVisible();
  await page.getByTestId('skip').click();
  await expect(page.getByTestId('show-summary')).toBeVisible();
  const sizes = await page.locator('.tcard .tt').evaluateAll(els => els.map(e => parseFloat(getComputedStyle(e).fontSize)));
  expect(sizes.length).toBeGreaterThan(0);
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(14);
  await noSideways(page, 'show');
  await page.getByTestId('close-confirm').click();
  await expect(page.getByTestId('show')).toBeHidden();
});

test('personal estimates wait for five timed steps', async ({ page }) => {
  await importSample(page);
  await page.locator('.row:not(.done)').getByTestId('details').first().click();
  await sheet(page).locator('input[name=est]').fill('25');
  await expect(page.getByTestId('personal')).toContainText('Learning your pace');
});

for (const width of [320, 375, 430]) {
  test(`phase 1 screens don’t scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await importSample(page);
    const check = async (name: string) => { await noSideways(page, name); };
    // Check-in, each screen.
    await page.locator('main').getByRole('button', { name: 'Plan the day' }).click();
    await check('check-in yesterday');
    await page.getByTestId('ci-next').click();
    await check('check-in shape');
    await page.getByTestId('ci-next').click();
    await check('check-in plan');
    await page.keyboard.press('Escape');
    // Task sheet with everything open, and break it down.
    await page.locator('.row:not(.done)').getByTestId('details').first().click();
    await sheet(page).locator('details.more summary').click();
    await page.getByTestId('repeat').locator('select').selectOption('week');
    await check('task sheet, all fields');
    await sheet(page).getByRole('button', { name: 'Break it down' }).click();
    await check('break it down');
    await page.keyboard.press('Escape');
    // I'm stuck.
    await page.getByTestId('stuck').click();
    await check('stuck: friction');
    await sheet(page).getByRole('button', { name: /Can’t start/ }).click();
    await check('stuck: starter');
    await page.keyboard.press('Escape');
    // Calendar, both views; the day navigator.
    await page.getByTestId('tab-calendar').click();
    await check('calendar week');
    await page.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'Month' }).click();
    await check('calendar month');
    await page.getByTestId('tab-today').click();
    await page.getByTestId('next-day').click();
    await check('tomorrow');
    await page.getByRole('button', { name: 'Back to today' }).click();
    // Decisions: the wizard's balance screen and a decision page.
    await goTab(page, 'projects');
    await page.getByTestId('new-decision').click();
    await check('decision problem');
    await page.getByTestId('dw-next').click();
    for (const o of ['A long option name that wraps', 'B']) { await page.getByTestId('dw-option').fill(o); await page.getByTestId('dw-option').press('Enter'); }
    await page.getByTestId('dw-close-list').click();
    await sheet(page).getByLabel('Add to: Pros of doing it').fill('An item');
    await sheet(page).getByLabel('Add to: Pros of doing it').press('Enter');
    await check('decision balance');
    await page.keyboard.press('Escape');
    await page.locator('main').getByRole('button', { name: 'Stay in the flat or move?' }).click();
    await check('decision page');
    await page.keyboard.press('Escape');
    // Projects editor, the place switcher, settings with stays.
    await page.getByTestId('tab-projects').click();
    await page.getByTestId('edit-project').first().click();
    await check('project editor');
    await page.keyboard.press('Escape');
    await page.getByTestId('place-pill').click();
    await check('places');
    await page.keyboard.press('Escape');
    // The weekly review, each screen.
    await page.getByTestId('tab-calendar').click();
    await page.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'Week' }).click();
    await page.locator('main').getByRole('button', { name: '☀ Weekly review' }).first().click();
    for (let i = 0; i < 10; i++) {
      await check('review ' + i);
      if (i < 9) await page.getByTestId('rv-next').click();
    }
  });
}

test('a timed standing item added by hand shows in fixed times and on the calendar', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('tab-projects').click();
  await page.locator('details').evaluateAll(ds => ds.forEach(d => ((d as HTMLDetailsElement).open = true)));
  await page.getByRole('button', { name: 'Walk to the park for 30 minutes' }).first().click();
  await sheet(page).locator('details').evaluateAll(ds => ds.forEach(d => ((d as HTMLDetailsElement).open = true)));
  await sheet(page).locator('input[name=at]').fill('17:00');
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Walk to the park for 30 minutes' }).first().click();
  await sheet(page).getByRole('button', { name: 'Add to today' }).click();
  await page.getByTestId('tab-today').click();
  await expect(page.locator('ul.fixed')).toContainText('17:00');
  await expect(page.locator('ul.fixed')).toContainText('Walk to the park');
  await page.getByTestId('tab-calendar').click();
  await expect(page.getByTestId('wday-' + iso(0))).toContainText('Walk to the park');
});

test('a standing obligation is not in the four quadrants: it is on the Obligations line, folded', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('tab-matrix').click();
  await expect(page.getByTestId('obligations')).not.toContainText('scanned receipts');
  await page.locator('.item', { hasText: 'scanned receipts' }).locator('.linklike').click();
  await sheet(page).locator('details').evaluateAll(ds => ds.forEach(d => ((d as HTMLDetailsElement).open = true)));
  await sheet(page).locator('input[name=template]').check();
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.matrix')).not.toContainText('scanned receipts');
  const ob = page.getByTestId('obligations');
  await expect(ob).toBeVisible();
  expect(await ob.evaluate(d => (d as HTMLDetailsElement).open)).toBe(false);
  await ob.locator('summary').click();
  await expect(ob).toContainText('scanned receipts');
});
