import { test, expect, type Page } from '@playwright/test';
import { importSample, noSideways, goTab, openWeeklyReview } from './helpers';

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

test('the calendar tab opens its views; a fixed-time step there opens its sheet', async ({ page }) => {
  await importSample(page);
  await page.goto('/#task/t2');
  await sheet(page).getByTestId('time-chip').click();
  await sheet(page).locator('input[name=at]').fill('11:00');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByTestId('tab-calendar').click();
  await page.getByTestId('cal-week').click();
  await expect(page.getByTestId('calendar')).toBeVisible();
  await page.getByTestId('calendar-grid').locator('.sx__time-grid-event.k-fixed').first().click();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('cal-month').click();
  await expect(page.locator('.sx__month-grid-wrapper')).toBeVisible();
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

test('the close of the day ends on St George: a tap skips it at once; Calm is a still frame, Off nothing', async ({ page }) => {
  await importSample(page);
  const sg = page.getByTestId('stgeorge');
  await page.locator('main').getByRole('button', { name: 'Close the day' }).click();
  await page.getByTestId('skip').click();
  await expect(sg).toBeVisible();
  await expect(sg).toHaveClass(/play/);
  await expect(sg).toContainText('The day is played.');
  // Transforms and opacity only.
  const props = await sg.evaluate(el => [...new Set(el.getAnimations({ subtree: true }).flatMap(a => ((a.effect as KeyframeEffect).getKeyframes()).flatMap(k => Object.keys(k).filter(x => !['offset', 'easing', 'composite', 'computedOffset'].includes(x)))))]);
  expect(props.every(p => p === 'transform' || p === 'opacity'), props.join()).toBe(true);
  const t0 = Date.now();
  await sg.click();
  await expect(sg).toHaveCount(0, { timeout: 1000 });
  expect(Date.now() - t0).toBeLessThan(1000);
  await page.getByTestId('show').getByRole('button', { name: 'Not yet' }).click({ timeout: 1000 });
  // Calm: the last frame, no fight.
  await goTab(page, 'settings');
  await page.getByTestId('appearance').getByRole('button', { name: 'Calm', exact: true }).click();
  await goTab(page, 'today');
  await page.locator('main').getByRole('button', { name: 'Close the day' }).click();
  await page.getByTestId('skip').click();
  await expect(sg).toHaveClass(/still/);
  await expect(sg).not.toHaveClass(/play/);
  await expect(sg).toHaveCount(0, { timeout: 4000 });
  await page.getByTestId('show').getByRole('button', { name: 'Not yet' }).click();
  // Off: the summary, and nothing over it.
  await goTab(page, 'settings');
  await page.getByTestId('appearance').getByRole('button', { name: 'Off', exact: true }).click();
  await goTab(page, 'today');
  await page.locator('main').getByRole('button', { name: 'Close the day' }).click();
  await expect(page.getByTestId('close-summary')).toBeVisible();
  await expect(sg).toHaveCount(0);
});

test('an ordinary Done never brings St George; the day’s last card does', async ({ page }) => {
  await importSample(page);
  const sg = page.getByTestId('stgeorge');
  const doneBtn = page.getByTestId('first').getByRole('button', { name: 'Already done' });
  let seen = false;
  for (let i = 0; i < 12 && await doneBtn.count() > 0; i++) {
    await doneBtn.click();
    await page.getByRole('button', { name: 'I didn’t time it' }).click();
    if (await page.locator('main').getByText('List played').count() > 0) {
      await expect(sg).toBeVisible();
      await expect(sg).toContainText('List played');
      seen = true;
      break;
    }
    await expect(sg).toHaveCount(0);
  }
  expect(seen).toBe(true);
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
    await page.getByTestId('cal-month').click();
    await check('calendar month');
    await page.getByTestId('cal-agenda').click();
    await check('calendar agenda');
    await page.getByTestId('cal-day').click();
    await check('calendar day');
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
    await openWeeklyReview(page);
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
  await sheet(page).getByTestId('time-chip').click();
  await sheet(page).locator('input[name=at]').fill('17:00');
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Walk to the park for 30 minutes' }).first().click();
  await sheet(page).getByRole('button', { name: 'Add to today' }).click();
  await page.getByTestId('tab-today').click();
  await expect(page.locator('ul.fixed')).toContainText('17:00');
  await expect(page.locator('ul.fixed')).toContainText('Walk to the park');
  await page.getByTestId('tab-calendar').click();
  // A fixed time is on the hour grid (not in the all-day row), at its time.
  await page.getByTestId('cal-day').click();
  const timed = page.locator('.sx__time-grid-event', { hasText: 'park' });
  await expect(timed).toHaveCount(1);
  await expect(page.locator('.sx__date-grid-event', { hasText: 'park' })).toHaveCount(0);
  // Both are read in one frame: the grid scrolls to its first position by itself (smoothly) after it is drawn, and two
  // separate measures taken while it moves differ by however far it went between them.
  const gap = await page.evaluate(() => {
    const ev = document.querySelector('.sx__time-grid-event.k-fixed')!.getBoundingClientRect().y;
    const hour = [...document.querySelectorAll('.sx__week-grid__hour')].find(h => h.textContent?.includes('17:00'))!.getBoundingClientRect().y;
    return Math.abs(ev - hour);
  });
  expect(gap).toBeLessThan(4);
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

test('a card’s actions are in a bar at the top of its sheet, which stays in view while the fields scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 560 });
  await importSample(page);
  await page.getByTestId('tab-matrix').click();
  await page.locator('.item', { hasText: 'scanned receipts' }).locator('.linklike').click();
  const bar = sheet(page).getByTestId('task-actions');
  await expect(bar.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Mark done' })).toBeVisible();
  await sheet(page).evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(bar.getByRole('button', { name: 'Save' })).toBeInViewport();
  const [b, s] = await Promise.all([bar.boundingBox(), sheet(page).boundingBox()]);
  expect(b!.y - s!.y).toBeLessThan(4);
});

test('a start time is set from a Time chip next to the title; length and lead appear once there is a time', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('tab-today').click();
  await page.getByTestId('quick-details').click();
  const s = sheet(page);
  await expect(s.getByTestId('time-chip')).toHaveText('Time');
  await expect(s.locator('input[name=at]')).toBeHidden();
  await s.getByTestId('time-chip').click();
  await expect(s.locator('input[name=dur]')).toHaveCount(0);
  await s.locator('input[name=at]').fill('16:30');
  await expect(s.getByTestId('time-chip')).toHaveText('16:30');
  await expect(s.locator('input[name=dur]')).toBeVisible();
  await expect(s.getByTestId('lead')).toBeVisible();
});

const planIds = (page: Page) => page.locator('[data-testid=plan-list] > li').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.task));

test('Today’s list is ordered by dragging a grip, and the order stays; ↑ and ↓ are the keyboard way', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('plan-list').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('[data-testid=plan-list]')!.scrollIntoView({ block: 'start' })); // the whole list in view, so the mouse can reach it
  const before = await planIds(page);
  expect(before.length).toBeGreaterThanOrEqual(3);
  const last = page.locator('[data-testid=plan-list] > li').last();
  const first = page.locator('[data-testid=plan-list] > li').nth(1); // (the first row is a step already done)
  const g = (await last.getByTestId('grip').boundingBox())!, f = (await first.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, g.y - 20, { steps: 5 });
  await page.waitForTimeout(100);
  await page.mouse.move(g.x + g.width / 2, f.y + 4, { steps: 15 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await expect.poll(() => planIds(page)).not.toEqual(before);
  const after = await planIds(page);
  expect(after[1]).toBe(before[before.length - 1]);
  expect(after).toHaveLength(before.length);
  await page.reload();
  await expect(page.getByTestId('first')).toBeVisible();
  expect(await planIds(page)).toEqual(after);
  // keyboard: the hidden ↑ comes into view when focused
  const row = page.locator('[data-testid=plan-list] > li').nth(2);
  const up = row.getByRole('button', { name: 'Earlier' });
  await up.focus();
  await expect(up).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await planIds(page))[1]).toBe(after[2]);
  expect((await planIds(page))[2]).toBe(after[1]);
});

test('a step added by hand goes right after the one running, not at the bottom', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('first').getByRole('button', { name: /Start timer|Just start the timer/ }).click();
  const ids0 = await page.evaluate(() => [...document.querySelectorAll('[data-testid=plan-list] > li')].map(e => (e as HTMLElement).dataset.task));
  await page.locator('form.quick input[name=title]').fill('Zebra errand');
  await page.locator('form.quick').getByRole('button', { name: 'Add', exact: true }).click();
  const rows = page.locator('[data-testid=plan-list] > li');
  await expect(rows).toHaveCount(ids0.length + 1);
  await expect(rows.nth(1)).toContainText('Zebra errand'); // the done step stays above; the running one is the first card
});

test('a project’s steps are ordered by dragging a grip, too', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('tab-projects').click();
  await page.locator('details').evaluateAll(ds => ds.forEach(d => ((d as HTMLDetailsElement).open = true)));
  const list = page.locator('ol.steps').filter({ has: page.locator('li[data-sort]:nth-of-type(3)') }).first();
  await list.scrollIntoViewIfNeeded();
  await list.evaluate(el => el.scrollIntoView({ block: 'start' }));
  const ids = () => list.locator('> li[data-sort]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.task));
  const before = await ids();
  const a = (await list.locator('> li[data-sort]').nth(1).getByTestId('grip').boundingBox())!, b = (await list.locator('> li[data-sort]').first().boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y - 10, { steps: 5 });
  await page.waitForTimeout(100);
  await page.mouse.move(a.x + a.width / 2, b.y + 2, { steps: 12 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await expect.poll(ids).not.toEqual(before);
  const after = await ids();
  expect(after[0]).toBe(before[1]);
  expect(after[1]).toBe(before[0]);
  await page.reload();
  await page.locator('details').evaluateAll(ds => ds.forEach(d => ((d as HTMLDetailsElement).open = true)));
  expect(await ids()).toEqual(after);
});
