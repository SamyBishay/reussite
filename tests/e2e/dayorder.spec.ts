// One order for the day (plan 2 Nov): Start here follows the clock and is the same on Home and Today, done cards fold under the
// list, and Home opens with a greeting line that does not repeat. The clock is fixed to a Monday so the tests do not depend on the hour.
import { test, expect, type Page } from '@playwright/test';
import { goTab, addCard, noSideways } from './helpers';

const input = (page: Page) => page.getByTestId('home-input');
const say = async (page: Page, text: string) => { await input(page).fill(text); await input(page).press('Enter'); await input(page).blur(); };
const at = (hh: number, mm: number) => new Date(2026, 9, 26, hh, mm, 0); // Monday 26 October, this computer's clock
const CALL = 'call the bank 14:00';
// A step added by hand goes to the top of what is left, so the last one added is the first floating step.
const FIRST = 'Water the plants';

/** At 11:00: a call at 14:00 (leave at 13:30) and three floating steps. */
async function aDay(page: Page) {
  await page.clock.setFixedTime(at(11, 0));
  await page.goto('/');
  await say(page, CALL);
  await expect(page.getByTestId('receipt')).toBeVisible();
  await goTab(page, 'today');
  for (const title of ['Buy stamps', 'Sort the drawer', FIRST]) await addCard(page, title);
}
async function at_(page: Page, hh: number, mm: number) {
  await page.clock.setFixedTime(at(hh, mm));
  await page.reload();
}

test('a call at 14:00 and three floating steps: the first step in the morning, the call once it needs the time, the same one on Home and Today', async ({ page }) => {
  await aDay(page);

  // 11:00: the first step in the list, on Today and on Home.
  await expect(page.getByTestId('first')).toContainText(FIRST);
  await goTab(page, 'home');
  await expect(page.getByTestId('greeting-next')).toContainText(FIRST);

  // 13:00: a step takes 15 minutes and 5 of margin, so there is still time for it before 13:30.
  await at_(page, 13, 0);
  await goTab(page, 'today');
  await expect(page.getByTestId('first')).toContainText(FIRST);

  // 13:30: the call, with when to leave. The same on Today and on Home.
  await at_(page, 13, 30);
  await goTab(page, 'today');
  await expect(page.getByTestId('first')).toContainText('Call the bank 14:00 · leave at 13:30');
  await goTab(page, 'home');
  await expect(page.getByTestId('greeting-next')).toContainText('Call the bank 14:00 · leave at 13:30');
  // The floating steps are still on Today's list, with the time each is expected to start.
  await goTab(page, 'today');
  await expect(page.getByTestId('plan-list').getByTestId('proj-at').first()).toContainText('≈');
  await expect(page.getByTestId('plan-list')).toContainText(FIRST);
});

test('the next-step bar on another tab follows the same order', async ({ page }) => {
  await aDay(page);
  await at_(page, 13, 30);
  await goTab(page, 'projects');
  await expect(page.getByTestId('insist')).toContainText('Call the bank');
  await at_(page, 11, 0);
  await goTab(page, 'projects');
  await expect(page.getByTestId('insist')).toContainText(FIRST);
});

test('a ticked step folds into “1 done”, closed until it is opened', async ({ page }) => {
  await aDay(page);
  await expect(page.getByTestId('done-fold')).toHaveCount(0);
  await page.getByTestId('plan-list').locator('[data-task]', { hasText: 'Sort the drawer' }).getByTestId('row-done').click();
  await page.getByRole('button', { name: 'I didn’t time it' }).click();
  const fold = page.getByTestId('done-fold');
  await expect(fold).toContainText('1 done');
  await expect(page.getByTestId('plan-list')).not.toContainText('Sort the drawer');
  await expect(page.getByTestId('done-list')).toBeHidden();
  // The keyboard opens it.
  await page.getByTestId('done-fold-toggle').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('done-list')).toContainText('Sort the drawer');
  await expect(fold).toHaveJSProperty('open', true);
});

test('Home opened three times says three different things', async ({ page }) => {
  await aDay(page);
  const keys: string[] = [];
  for (let n = 0; n < 3; n++) {
    await goTab(page, 'home');
    const hello = page.getByTestId('greeting-hello');
    await expect(hello).toBeVisible();
    const text = (await hello.innerText()).trim();
    expect(text).toMatch(/box|below|Type/i); // it invites the person to type
    keys.push((await hello.getAttribute('data-key'))!);
    await goTab(page, 'today');
  }
  expect(new Set(keys).size).toBe(3);
});

for (const width of [320, 375, 430]) {
  test(`Home and Today do not scroll sideways at ${width}px, with a fixed item in charge`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await aDay(page);
    await at_(page, 13, 30);
    await goTab(page, 'home');
    await expect(page.getByTestId('greeting-hello')).toBeVisible();
    await noSideways(page, 'home with a fixed item in charge');
    await goTab(page, 'today');
    await page.getByTestId('plan-list').locator('[data-task]').first().getByTestId('row-done').click();
    await page.getByRole('button', { name: 'I didn’t time it' }).click();
    await page.getByTestId('done-fold-toggle').click();
    await noSideways(page, 'today with the done fold open');
  });
}
