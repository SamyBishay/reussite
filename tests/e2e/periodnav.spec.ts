// The ‹ label › navigator (src/app/PeriodNav.tsx), on Today and on the Calendar: ‹ and › stay exactly where they are whatever the label says and
// whether or not "Back to today" shows, so tapping › again and again in the same spot keeps stepping.
import { test, expect, type Page } from '@playwright/test';
import { importSample, appDay } from './helpers';

const box = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!;
const same = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => expect([a.x, a.y, a.width, a.height].map(Math.round)).toEqual([b.x, b.y, b.width, b.height].map(Math.round));

for (const width of [320, 390]) {
  test(`Today at ${width}: the arrows do not move on today, tomorrow or a far date with a long label; back-today returns`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await importSample(page);
    await page.getByTestId('tab-today').click();
    const prev = await box(page, 'prev-day'), next = await box(page, 'next-day');
    await expect(page.getByTestId('back-today')).toHaveCount(0);
    await page.getByTestId('next-day').click();
    await expect(page.getByTestId('back-today')).toBeVisible();
    same(await box(page, 'prev-day'), prev); same(await box(page, 'next-day'), next);
    // A far date: a long label ("Wednesday 29 September").
    await page.getByTestId('day-label').locator('input').fill('2027-09-29');
    await expect(page.getByTestId('back-today')).toBeVisible();
    await expect(page.getByTestId('day-label')).toContainText(/September/);
    same(await box(page, 'prev-day'), prev); same(await box(page, 'next-day'), next);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The label never covers an arrow, and the chip is under the label, between the arrows.
    const chip = await box(page, 'back-today');
    expect(chip.x).toBeGreaterThanOrEqual(prev.x + prev.width);
    expect(chip.x + chip.width).toBeLessThanOrEqual(next.x);
    await page.getByTestId('back-today').click();
    await expect(page.getByTestId('back-today')).toHaveCount(0);
    same(await box(page, 'prev-day'), prev); same(await box(page, 'next-day'), next);
  });

  test(`Today at ${width}: three taps on › at the same spot land three days ahead`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await importSample(page);
    await page.getByTestId('tab-today').click();
    const b = await box(page, 'next-day');
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    for (let i = 0; i < 3; i++) await page.mouse.click(x, y);
    await expect(page.getByTestId('day-label').locator('input')).toHaveValue(appDay(3));
    for (let i = 0; i < 3; i++) await page.mouse.click(x, y);
    await expect(page.getByTestId('day-label').locator('input')).toHaveValue(appDay(6));
    const p = await box(page, 'prev-day');
    for (let i = 0; i < 4; i++) await page.mouse.click(p.x + p.width / 2, p.y + p.height / 2);
    await expect(page.getByTestId('day-label').locator('input')).toHaveValue(appDay(2));
  });

  test(`Calendar at ${width}: the arrows do not move across days, views or the return chip; three taps step three days`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await importSample(page);
    await page.getByTestId('tab-calendar').click();
    await page.getByTestId('cal-day').click();
    const prev = await box(page, 'cal-prev'), next = await box(page, 'cal-next');
    await expect(page.getByTestId('back-today')).toHaveCount(0);
    const title0 = await page.getByTestId('cal-title').innerText();
    const x = next.x + next.width / 2, y = next.y + next.height / 2;
    for (let i = 0; i < 3; i++) await page.mouse.click(x, y);
    await expect(page.getByTestId('cal-title')).not.toHaveText(title0);
    await expect(page.getByTestId('back-today')).toBeVisible();
    same(await box(page, 'cal-prev'), prev); same(await box(page, 'cal-next'), next);
    // A long label: the month view's, on a far month; a week's range.
    await page.getByTestId('cal-month').click();
    for (let i = 0; i < 4; i++) await page.mouse.click(x, y);
    same(await box(page, 'cal-prev'), prev); same(await box(page, 'cal-next'), next);
    await page.getByTestId('cal-week').click();
    same(await box(page, 'cal-prev'), prev); same(await box(page, 'cal-next'), next);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByTestId('back-today').click();
    await expect(page.getByTestId('back-today')).toHaveCount(0);
    same(await box(page, 'cal-prev'), prev); same(await box(page, 'cal-next'), next);
    // Day view: three taps move the title to three days later, which "today" no longer says.
    await page.getByTestId('cal-day').click();
    const t1 = await page.getByTestId('cal-title').innerText();
    for (let i = 0; i < 3; i++) await page.mouse.click(x, y);
    await expect(page.getByTestId('cal-title')).not.toHaveText(t1);
    for (let i = 0; i < 3; i++) await page.mouse.click(prev.x + prev.width / 2, prev.y + prev.height / 2);
    await expect(page.getByTestId('cal-title')).toHaveText(t1);
    await expect(page.getByTestId('back-today')).toHaveCount(0);
  });
}
