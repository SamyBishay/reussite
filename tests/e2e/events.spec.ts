import { test, expect, type Page } from '@playwright/test';
import { goTab, addCard, openMenu, noSideways } from './helpers';

// Event steps: something the person waits for, built into a chain. Dormant until "It happened".
const sheet = (page: Page) => page.getByTestId('sheet');
const EVENT = 'The bellman calls back with a tailor';
const day = (offset: number) => { const d = new Date(Date.now() + offset * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/** "Phone the bellman", then something waited for, then "Book the tailor", made with Break it down. */
async function makeChain(page: Page, event = EVENT, nudge?: string, sideways = false) {
  await page.goto('/#today');
  await addCard(page, 'Ask the bellman');
  await page.getByTestId('first').getByRole('button', { name: 'Edit' }).click();
  await sheet(page).getByRole('button', { name: 'Break it down' }).click();
  await page.getByTestId('bd-first').getByRole('textbox').first().fill('Phone the bellman');
  await page.getByTestId('bd-first').getByRole('button', { name: 'Next' }).click();
  const starter = page.getByTestId('bd-starter');
  await starter.getByRole('textbox').fill('Dial the number on the card');
  for (const c of await starter.getByRole('checkbox').all()) await c.check();
  await starter.getByRole('button', { name: 'Next' }).click();
  await page.getByTestId('bd-estimate').getByRole('button', { name: 'Next' }).click();
  const next = page.getByTestId('bd-next');
  await next.locator('.addstep input[type=text]').fill(event);
  if (nudge) await next.getByTestId('bd-nudge').fill(nudge);
  await next.getByTestId('bd-add-event').click();
  await expect(next.getByTestId('bd-event-row')).toContainText('Waiting for: ' + event);
  await next.locator('.addstep input[type=text]').fill('Book the tailor');
  await next.locator('.addstep').getByRole('button', { name: 'Add' }).click();
  if (sideways) await noSideways(page, 'break it down with something waited for');
  await page.getByTestId('bd-finish').click();
  await expect(sheet(page)).toBeHidden();
}

test('something I’m waiting for: made in Break it down, listed under Waiting for, and "it happened" frees the step', async ({ page }) => {
  await makeChain(page);
  // In the chain's fold, calm, as a "Waiting for" line; it is not a step on the list.
  const first = page.getByTestId('first');
  await expect(first).toContainText('Phone the bellman');
  await expect(first.getByTestId('chain-toggle')).toHaveText(/\+2 after/);
  await first.getByTestId('chain-toggle').click();
  await expect(first.locator('.chain-list li')).toHaveText(['Waiting for: ' + EVENT, 'Book the tailor']);

  // Its project's page shows it too, outside the progress count.
  await goTab(page, 'projects');
  await expect(page.getByTestId('event-step')).toContainText('Waiting for: ' + EVENT);
  await goTab(page, 'matrix');
  await expect(page.locator('.matrix .item')).toHaveCount(1);
  await expect(page.locator('.matrix')).not.toContainText(EVENT);

  // The first step done: the event is next in the chain but dormant, so nothing else appears on the list.
  await goTab(page, 'today');
  await page.getByTestId('first').getByRole('button', { name: 'Already done' }).click();
  await page.getByRole('button', { name: 'I didn’t time it' }).click();
  await expect(page.locator('main')).not.toContainText(EVENT);
  await expect(page.locator('main')).not.toContainText('Book the tailor');
  await expect(page.getByTestId('nudge-row')).toHaveCount(0);

  // Waiting for, behind Home's menu: the event, since when, and what it holds back.
  await openMenu(page, 'waiting');
  const row = page.getByTestId('waiting-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(EVENT);
  await expect(row.getByTestId('waiting-days')).toHaveText('Waiting since today');
  await expect(row.getByTestId('waiting-unlocks')).toHaveText('Unlocks: Book the tailor');

  // It happened: a day (today to begin with), one line, no animation.
  await row.getByTestId('event-happened').click();
  await expect(page.getByTestId('happened-day')).toHaveValue(day(0));
  await page.getByTestId('happened-save').click();
  await expect(page.locator('.toast')).toHaveText('Unlocked: Book the tailor');
  await expect(page.getByTestId('waiting-empty')).toBeVisible();

  // The freed step is on Today.
  await goTab(page, 'today');
  await expect(page.getByTestId('first')).toContainText('Book the tailor');
});

test('a nudge shows from its day, with three answers; a step can be turned into an event and back', async ({ page }) => {
  await page.goto('/#today');
  await addCard(page, 'Hear back from the bank');
  // Turn it into something waited for, with a nudge a day ago: the time, estimate and quadrant fields go.
  await page.getByTestId('first').getByRole('button', { name: 'Edit' }).click();
  await sheet(page).getByTestId('task-more').locator('summary').click();
  await sheet(page).getByTestId('kind').selectOption('event');
  await expect(sheet(page).locator('input[name=est]')).toHaveCount(0);
  await expect(sheet(page).locator('input[name=at]')).toHaveCount(0);
  await expect(sheet(page).locator('input[name=urgent]')).toHaveCount(0);
  await sheet(page).getByTestId('nudge').fill(day(-1));
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();

  // It leaves the list and is never Start here; the nudge row asks about it, once.
  await expect(page.getByTestId('first')).not.toContainText('Hear back from the bank');
  const nudge = page.getByTestId('nudge-row');
  await expect(nudge).toHaveCount(1);
  await expect(nudge).toContainText('Check: Hear back from the bank');
  await expect(nudge.getByRole('button')).toHaveText(['It happened', 'Still waiting', 'Drop it']);

  // Still waiting: in 3 days. The row is gone until then.
  await nudge.getByTestId('event-still').click();
  await page.getByTestId('snooze-3d').click();
  await expect(page.getByTestId('nudge-row')).toHaveCount(0);
  await openMenu(page, 'waiting');
  await expect(page.getByTestId('waiting-row')).toContainText('Hear back from the bank');
  await expect(page.getByTestId('waiting-row')).toContainText('ask again');

  // Back to a step: it is a step again, with the fields of a step.
  await page.getByTestId('waiting-row').getByRole('button', { name: 'Hear back from the bank' }).click();
  await sheet(page).getByTestId('task-more').locator('summary').click();
  await sheet(page).getByTestId('kind').selectOption('task');
  await expect(sheet(page).locator('input[name=est]')).toHaveCount(1);
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByTestId('waiting-empty')).toBeVisible();
});

for (const width of [320, 375, 430]) {
  test(`Waiting for, its nudge row and the Break it down row do not scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const long = 'The very long confirmation from the notary’s clerk about the second signature on the sale';
    await makeChain(page, long, day(-1), true);
    await noSideways(page, 'today with a nudge');
    await expect(page.getByTestId('nudge-row')).toBeVisible();
    await goTab(page, 'projects');
    await noSideways(page, 'projects with a Waiting for line');
    await openMenu(page, 'waiting');
    await expect(page.getByTestId('waiting-row')).toBeVisible();
    await noSideways(page, 'waiting for');
    await page.getByTestId('waiting-row').getByTestId('event-still').click();
    await noSideways(page, 'still waiting sheet');
    await page.keyboard.press('Escape');
    await page.getByTestId('waiting-row').getByTestId('event-happened').click();
    await noSideways(page, 'it happened sheet');
  });
}
