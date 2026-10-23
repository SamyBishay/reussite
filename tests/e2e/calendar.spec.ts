import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
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

test('the calendar names cards by their short name, with no launch points; a timed step is on the hour grid', async ({ page }) => {
  await importSample(page);
  await page.goto('/#task/t2');
  await sheet(page).getByTestId('time-chip').click();
  await sheet(page).locator('input[name=at]').fill('14:30');
  await sheet(page).getByTestId('label').fill('Lease');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByTestId('tab-calendar').click();
  await page.getByTestId('cal-week').click();
  const grid = page.getByTestId('calendar-grid');
  // Short names, not the sentences the steps are titled with; the leading verb and filler are gone.
  await expect(grid.locator('.sx__event', { hasText: 'Doctolib' }).first()).toBeVisible();
  await expect(grid).not.toContainText('Open Doctolib and book');
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

test('past days show the cards played, and a tap on a day number opens that day', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('tab-calendar').click();
  await page.getByTestId('cal-month').click();
  // The sample played a card yesterday (it is done, so it is struck through).
  const played = page.getByTestId('calendar-grid').locator('.sx__event.is-done');
  await expect(played.first()).toBeVisible();
  await page.getByTestId('calendar-grid').locator(`[data-date="${iso(1)}"] .sx__month-grid-day__header-date`).click();
  await expect(page.getByTestId('other-day')).toBeVisible();
});

test('dragging a planned card to another day plans it there', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await importSample(page);
  await page.getByTestId('tab-calendar').click();
  await page.getByTestId('cal-week').click();
  const ev = page.getByTestId('calendar-grid').locator('.sx__time-grid-event', { hasText: 'second paragraph' }).first();
  await expect(ev).toBeVisible();
  await ev.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const b = (await ev.boundingBox())!;
  const dayWidth = (await page.locator('.sx__week-grid__date').first().boundingBox())!.width;
  await page.mouse.move(b.x + 10, b.y + b.height / 2);
  await page.mouse.down();
  // One day to the right, unless today is the last day of the week.
  const dir = new Date(iso(0) + 'T12:00:00Z').getUTCDay() === 0 ? -1 : 1;
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 10 + (dir * dayWidth * i) / 10, b.y + b.height / 2);
  await page.mouse.up();
  await page.getByTestId('tab-today').click();
  if (dir === 1) { await page.getByTestId('next-day').click(); } else { await page.getByTestId('prev-day').click(); }
  await expect(page.getByTestId('other-day')).toContainText('thesis draft and write');
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

/** The sample, plus a plan three days on: three 30-minute cards from a Start at 09:30. */
async function importWithFuturePlan(page: import('@playwright/test').Page) {
  const { sampleExport } = await import('./fixture');
  const ex = sampleExport() as { tasks: Record<string, { est: number | null }>; days: Record<string, unknown> };
  const k = iso(2);
  for (const id of ['t4', 't5', 't7']) ex.tasks[id]!.est = 30;
  ex.days[k] = { date: k, plan: ['t4', 't5', 't7'], launches: [{ t: '09:30', k: 'start' }], first: null, checkin: null, closed: null, summary: null };
  await page.goto('/#settings');
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(ex)) });
  await expect(page.getByTestId('import-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('sheet')).toBeHidden();
  return k;
}

test('a plan with Start 09:30 and three 30-minute cards is on the grid at 09:30, 10:00 and 10:30, dashed, and in the .ics with those times', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  const k = await importWithFuturePlan(page);
  await page.getByTestId('tab-calendar').click();
  await page.getByTestId('cal-day').click();
  await page.getByTestId('cal-next').click();
  await page.getByTestId('cal-next').click();
  const grid = page.getByTestId('calendar-grid');
  const events = grid.locator('.sx__time-grid-event.is-projected');
  await expect(events).toHaveCount(3);
  await expect(grid.locator('.sx__date-grid-event.is-projected')).toHaveCount(0);
  await events.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  // 48 px an hour: 09:30, 10:00 and 10:30 are 24 px apart from the 09:00 line, then 24 px more each.
  const hour = await page.evaluate(() => [...document.querySelectorAll('.sx__week-grid__hour')].find(h => h.textContent?.includes('09:00'))!.getBoundingClientRect().y);
  const tops = await events.evaluateAll(els => els.map(e => e.getBoundingClientRect().y));
  expect(Math.abs(tops[0]! - hour - 24)).toBeLessThan(6);
  expect(Math.abs(tops[1]! - tops[0]! - 24)).toBeLessThan(3);
  expect(Math.abs(tops[2]! - tops[1]! - 24)).toBeLessThan(3);

  const download = page.waitForEvent('download');
  await page.getByTestId('ics-week').click();
  const text = readFileSync((await (await download).path())!, 'utf8');
  const day = k.replace(/-/g, '');
  for (const t of ['093000', '100000', '103000']) expect(text).toContain(`DTSTART;TZID=Europe/Paris:${day}T${t}`.replace('Europe/Paris', text.match(/DTSTART;TZID=([^:]+):/)![1]!));
  expect(text).toContain(`DTEND;TZID=${text.match(/DTSTART;TZID=([^:]+):/)![1]}:${day}T110000`);
});
