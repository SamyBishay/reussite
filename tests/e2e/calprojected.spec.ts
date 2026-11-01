// SHELVED (DECISIONS.md, 2026-11-01): the Calendar no longer draws projected steps; every test here is skipped. The domain function and its unit tests stay.
// Projected steps in the Calendar (plan 2 Nov, S5): today's planned steps sit on the hour grid as faded blocks between the fixed
// items, follow the clock, are not dragged and open the step on a tap. The clock is fixed to a Monday so the hour does not matter.
// The fixed clock is a stub of Date and not `page.clock`: the Calendar's library loads the Temporal polyfill, which wraps
// `Intl.DateTimeFormat`, and wrapping the fake clock's version of it breaks `formatToParts` (the app's day maths) in the browser.
import { test, expect, type Page } from '@playwright/test';
import { goTab, addCard, noSideways, stubNow } from './helpers';

const input = (page: Page) => page.getByTestId('home-input');
const say = async (page: Page, text: string) => { await input(page).fill(text); await input(page).press('Enter'); await input(page).blur(); };
const at = (hh: number, mm: number) => new Date(2026, 9, 26, hh, mm, 0); // Monday 26 October, this computer's clock
const setNow = stubNow;
const proj = (page: Page) => page.getByTestId('calendar-grid').locator('.sx__event.k-projected');
const fixed = (page: Page, text: string) => page.getByTestId('calendar-grid').locator('.sx__event.k-fixed', { hasText: text });
const boxes = (page: Page) => proj(page).evaluateAll(els => els.map(e => ({ y: e.getBoundingClientRect().top, h: e.getBoundingClientRect().height, run: e.classList.contains('is-running') })).sort((a, b) => a.y - b.y));

/** 11:00: a visit at 12:00 (leave at 11:30) and a call at 15:00 (30 minutes each), and three floating steps of 15 minutes. */
async function aDay(page: Page) {
  await setNow(page, at(11, 0));
  await page.goto('/');
  await say(page, 'visit the flat 12:00');
  await expect(page.getByTestId('receipt')).toBeVisible();
  await say(page, 'call the bank 15:00');
  await goTab(page, 'today');
  for (const title of ['Buy stamps', 'Sort the drawer', 'Water the plants']) await addCard(page, title);
}
async function openDay(page: Page) {
  await goTab(page, 'calendar');
  await page.getByTestId('cal-day').click();
  await expect(proj(page).first()).toBeVisible();
}

test.skip('after planning, the steps sit between the fixed items on today’s grid, faded and not draggable', async ({ page }) => {
  await aDay(page);
  await openDay(page);
  await expect(proj(page)).toHaveCount(3);
  // Two steps fit before the visit; the third waits for the gap after it. The call comes later still.
  const tops = () => page.getByTestId('calendar-grid').evaluate(g => {
    const y = (sel: string, text?: string) => [...g.querySelectorAll<HTMLElement>(sel)].filter(e => !text || e.innerText.includes(text)).map(e => e.getBoundingClientRect().top).sort((a, b) => a - b);
    return { ys: y('.sx__event.k-projected'), visit: y('.sx__event.k-fixed', 'flat')[0]!, call: y('.sx__event.k-fixed', 'bank')[0]! };
  });
  await expect.poll(async () => { const { ys, visit, call } = await tops(); return ys.length === 3 && ys[0]! < visit && ys[1]! < visit && ys[2]! > visit && ys[2]! < call; }).toBe(true);
  // Not like a real event: dashed, and not draggable.
  await expect(proj(page).first()).toHaveCSS('border-top-style', 'dashed');
  const before = (await proj(page).first().boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + 6);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + 120, { steps: 6 });
  await page.mouse.up();
  // Dropped nowhere: the step has no time of its own, so there are still only the two fixed items and three blocks.
  await expect(page.getByTestId('calendar-grid').locator('.sx__event.k-fixed')).toHaveCount(2);
  await expect(proj(page)).toHaveCount(3);
  // A tap opens the step's sheet.
  await proj(page).first().click();
  await expect(page.getByTestId('sheet')).toBeVisible();
});

test.skip('a step run past its estimate pushes the later blocks on', async ({ page }) => {
  await aDay(page);
  await goTab(page, 'today');
  await page.getByTestId('first').getByRole('button', { name: /start the timer/i }).click(); // the first step, at 11:00
  await openDay(page);
  const first = await boxes(page);
  const small = first.find(b => b.run)!.h;
  // 25 minutes later the step (15 min) is still going: its block has grown and the next one has moved after it.
  await setNow(page, at(11, 25));
  await page.reload();
  await openDay(page);
  const later = await boxes(page);
  expect(later.find(b => b.run)!.h).toBeGreaterThan(small);
  // (the grid may be scrolled differently after a reload, so compare the gap below the step in hand)
  expect(later[1]!.y - later[0]!.y).toBeGreaterThan(first[1]!.y - first[0]!.y);
});

for (const width of [320, 375, 430]) {
  test(`the Calendar with projected blocks does not scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await aDay(page);
    await openDay(page);
    await noSideways(page, 'calendar day');
    await page.getByTestId('cal-week').click();
    await expect(proj(page).first()).toBeVisible();
    await noSideways(page, 'calendar week');
  });
}
