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

const iso = (n: number) => { const x = new Date(); x.setHours(12); if (new Date().getHours() < 5) x.setDate(x.getDate() - 1); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

test('the Calendar opens on Week on a computer, and has Day, Week, Month and Agenda views', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a phone opens on Day, and its Week is 3 days');
  await importSample(page);
  await page.getByTestId('tab-calendar').click();
  await expect(page.getByTestId('calendar-grid')).toHaveAttribute('data-mode', 'week');
  await expect(page.locator('.sx__week-grid__date')).toHaveCount(7);
  for (const [m, sel] of [['day', '.sx__time-grid-day'], ['month', '.sx__month-grid-wrapper'], ['agenda', '.sx__list-wrapper'], ['week', '.sx__week-grid']] as const) {
    await page.getByTestId('cal-' + m).click();
    await expect(page.getByTestId('calendar-grid')).toHaveAttribute('data-mode', m);
    await expect(page.locator(sel).first()).toBeVisible();
  }
  // The choice is remembered.
  await page.getByTestId('cal-month').click();
  await page.reload();
  await page.getByTestId('tab-calendar').click();
  await expect(page.getByTestId('calendar-grid')).toHaveAttribute('data-mode', 'month');
});

test('on a phone the Calendar opens on Day, and the week is three days', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await importSample(page);
  await page.getByTestId('tab-calendar').click();
  await expect(page.getByTestId('calendar-grid')).toHaveAttribute('data-mode', 'day');
  await page.getByTestId('cal-week').click();
  await expect(page.getByTestId('cal-week')).toHaveText('3 days');
  await expect(page.locator('.sx__week-grid__date')).toHaveCount(3);
  await expect(page.locator('.sx__week-grid__date').first()).toHaveAttribute('data-date', iso(0));
  // Day headers are 44 px targets.
  expect((await page.locator('.sx__week-grid__date').first().boundingBox())!.height).toBeGreaterThanOrEqual(43);
  await page.getByTestId('cal-next').click();
  await expect(page.locator('.sx__week-grid__date').first()).toHaveAttribute('data-date', iso(3));
});

test('the calendar names steps by their short name, with no launch points; a timed step is on the hour grid', async ({ page }) => {
  await importSample(page);
  await page.goto('/#task/t2');
  await sheet(page).getByTestId('time-chip').click();
  await sheet(page).locator('input[name=at]').fill('14:30');
  await sheet(page).getByTestId('label').fill('Lease');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByTestId('tab-calendar').click();
  await page.getByTestId('cal-week').click();
  const grid = page.getByTestId('calendar-grid');
  // The day's planned cards (the sample's first is about Doctolib) are not in the calendar.
  await expect(grid).not.toContainText('Doctolib');
  // Launch points (09:30 and 14:00 on today's list in the sample) are not in the calendar.
  await expect(grid).not.toContainText(/Start|Restart|▶/);
  // The step with a time is on the grid at its time, named by its short name, and not in the all-day row.
  const timed = grid.locator('.sx__time-grid-event', { hasText: 'Lease' });
  await expect(timed).toHaveCount(1);
  await expect(grid.locator('.sx__date-grid-event', { hasText: 'Lease' })).toHaveCount(0);
  await expect(timed).toHaveAttribute('class', /k-fixed/);
  // Its place is not there, but nothing but the short name (and where, when there is a place) is.
  await expect(timed).not.toContainText('Open Mail');
});

test('a tap on a day number opens that day, and past days show no cards played', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('tab-calendar').click();
  await page.getByTestId('cal-month').click();
  // The sample played a card yesterday; the calendar is for fixed times only, so it is not there.
  await expect(page.getByTestId('calendar-grid').locator('.sx__event.is-done')).toHaveCount(0);
  await page.getByTestId('calendar-grid').locator(`[data-date="${iso(1)}"] .sx__month-grid-day__header-date`).click();
  await expect(page.getByTestId('other-day')).toBeVisible();
});

test('the calendar shows a fixed-time item and no planned card, due step or marker', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await importSample(page);
  // Today's list in the sample has planned cards (and a due date or two); none is on the calendar.
  await page.goto('/#task/t2');
  await sheet(page).getByTestId('time-chip').click();
  await sheet(page).locator('input[name=at]').fill('14:30');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByTestId('tab-calendar').click();
  await page.getByTestId('cal-week').click();
  const grid = page.getByTestId('calendar-grid');
  await expect(grid.locator('.sx__time-grid-event.k-fixed')).toHaveCount(1);
  await expect(grid.locator('.sx__event')).toHaveCount(1);
  await expect(grid).not.toContainText(/second paragraph|thesis|Weekly review|Check:/);
  await page.getByTestId('cal-month').click();
  await expect(grid.locator('.sx__event.k-plan, .sx__event.k-due, .sx__event.k-check, .sx__event.k-review')).toHaveCount(0);
  await expect(page.getByTestId('calendar')).not.toContainText(/dashed/i);
});

test('dragging a step with a time on the hour grid changes its time', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await importSample(page);
  await page.goto('/#task/t3');
  await sheet(page).getByTestId('time-chip').click();
  await sheet(page).locator('input[name=at]').fill('10:00');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByTestId('tab-calendar').click();
  const ev = page.getByTestId('calendar-grid').locator('.sx__time-grid-event.k-fixed').first();
  await expect(ev).toBeVisible();
  await ev.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const b = (await ev.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 6);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(b.x + b.width / 2, b.y + 6 + (96 * i) / 10); await page.waitForTimeout(25); }
  await page.mouse.up();
  // Two hours further down the grid (48 px an hour) once the write has come back.
  await expect.poll(async () => Math.round(((await ev.boundingBox())?.y ?? 0) - b.y)).toBeGreaterThan(80);
  await page.goto('/#task/t3');
  await sheet(page).getByTestId('time-chip').click();
  await expect(sheet(page).locator('input[name=at]')).toHaveValue('12:00');
});
