import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { importSample, noSideways, expandSettings, expandSheet, addCard } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');
// The app's day starts at 05:00; before that it is still the day before.
const todayName = () => {
  const x = new Date();
  if (x.getHours() < 5) x.setDate(x.getDate() - 1);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x.getDay()]!;
};

async function addChoir(page: Page) {
  await importSample(page);
  await addCard(page, 'Choir, Hill House 602');
  // Added by hand with nothing running, it goes to the top of what is left: it is the first card.
  const row = page.locator('.row', { hasText: 'Choir, Hill House 602' });
  await page.getByTestId('first').getByRole('button', { name: 'Edit', exact: true }).click();
  await sheet(page).locator('details.more summary').click();
  await expandSheet(page);
  await sheet(page).locator('input[name=template]').check();
  await sheet(page).locator('input[name=at]').fill('19:00');
  await sheet(page).locator('input[name=end]').fill('20:30');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  return row;
}

for (const width of [320, 375, 430]) {
test(`a standing item with weekdays sits in the plan at its time, with its leave-by line at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  // The first card breathes (a looping animation); WebKit then never sees the tall sheet's buttons as still.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await addChoir(page);
  // It is now a standing obligation: open it again to give it days and a lead.
  await page.locator('.row', { hasText: 'Choir, Hill House 602' }).getByTestId('details').click();
  await expect(sheet(page).getByTestId('task-sheet')).toBeVisible();
  await expandSheet(page);
  await expect(sheet(page).getByTestId('weekdays')).toBeVisible();
  await sheet(page).getByTestId('weekdays').getByLabel(todayName(), { exact: true }).check();
  await sheet(page).getByTestId('lead').fill('30');
  await noSideways(page, 'task sheet with weekdays');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();

  await page.getByTestId('tab-today').click();
  await page.locator('main').getByRole('button', { name: 'Plan the day' }).click();
  await page.getByTestId('ci-next').click();
  await page.getByTestId('ci-next').click();
  await page.getByTestId('ci-next').click();
  // The plan is in the order of the day: the choir sits at its time (leave at 18:30), after the steps that come before it.
  const first = page.getByTestId('plan-fixed').first();
  await expect(page.getByTestId('plan-fixed')).toHaveCount(1);
  await expect(first).toContainText('Choir 19:00, Hill House 602');
  await expect(first.getByTestId('plan-leave')).toHaveText('Leave at 18:30');
  // Fixed items cannot be swapped or cut.
  await expect(first.getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Too much, cut it' }).click();
  await expect(first.getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Done cutting' }).click();
  await noSideways(page, 'check-in plan with a fixed item');
  await page.getByTestId('go-with-this').click();
  await page.getByTestId('ci-later').click(); // the first step alone
  await expect(sheet(page)).toBeHidden();
  // Placed on the day, with its time.
  await expect(page.locator('main [data-task]', { hasText: 'Choir, Hill House 602' }).first()).toContainText('19:00–20:30');
});
}

test('Add to calendar downloads an .ics with the day’s fixed-time items and no planned step when sharing is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  await importSample(page);
  await page.getByTestId('tab-today').click();
  await page.goto('/#task/t3'); // on today's list, no due date
  await sheet(page).locator('input[name=at]').fill('11:00');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByTestId('tab-calendar').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('ics-today').click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^reussite-\d{4}-\d{2}-\d{2}\.ics$/);
  const text = readFileSync((await d.path())!, 'utf8');
  expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  // Only the fixed-time step is an event; planned cards and due steps stay in the app.
  expect(text).toMatch(/UID:fixed:t3:/);
  expect(text).not.toMatch(/UID:plan:|UID:due:|VALUE=DATE|TRANSPARENT/);
  expect(text).not.toMatch(/▶|Start/);
  expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
});

for (const width of [320, 375, 430]) {
test(`the Calendar view and Settings do not scroll sideways at ${width}px with Add to calendar`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await importSample(page);
  await page.getByTestId('tab-calendar').click();
  await expect(page.getByTestId('ics-week')).toBeVisible();
  for (const m of ['day', 'week', 'month', 'agenda']) {
    await page.getByTestId('cal-' + m).click();
    await expect(page.getByTestId('calendar-grid')).toHaveAttribute('data-mode', m);
    await noSideways(page, 'calendar ' + m);
  }
  await page.goto('/#settings'); await expandSettings(page);
  await expect(page.getByTestId('calendar-settings')).toBeVisible();
  await noSideways(page, 'settings');
});
}

test('the calendar feed: generic titles, short names when asked, places and links in full, a new address replaces the old, off removes it', async ({ page, request }) => {
  await addChoir(page);
  await page.locator('.row', { hasText: 'Choir, Hill House 602' }).getByTestId('details').click();
  await expandSheet(page);
  await sheet(page).getByTestId('weekdays').getByLabel(todayName(), { exact: true }).check();
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();

  await page.goto('/#settings'); await expandSettings(page);
  const feed = page.getByTestId('calendar-feed');
  await expect(feed.getByTestId('feed-url')).toHaveCount(0);
  await feed.getByTestId('feed-switch').check();
  const link = async () => (await feed.getByTestId('feed-url').textContent())!.trim();
  await expect(feed.getByTestId('feed-url')).toContainText('/cal/');
  const first = await link();
  expect(first).toMatch(/^http:\/\/localhost:8787\/cal\/[A-Za-z0-9_-]{32}\.ics$/);
  await expect(feed.getByTestId('feed-webcal')).toHaveAttribute('href', first.replace('http:', 'webcal:'));
  await expect(feed.getByTestId('feed-titles-warn')).toHaveCount(0); // the default says only times

  const fetchFeed = async (url: string) => request.get(url);
  await expect.poll(async () => (await fetchFeed(first)).status()).toBe(200);
  const res = await fetchFeed(first);
  expect(res.headers()['content-type']).toBe('text/calendar; charset=utf-8');
  expect(res.headers()['access-control-allow-origin']).toBeUndefined();
  const generic = await res.text();
  expect(generic).toContain('SUMMARY:Fixed time');
  expect(generic).not.toContain('Choir');
  expect(generic).not.toContain('VALARM');

  await page.getByTestId('feed-more').evaluate(d => { (d as HTMLDetailsElement).open = true; });
  await feed.getByTestId('feed-detail').selectOption('labels');
  await expect.poll(async () => (await (await fetchFeed(first)).text()).includes('SUMMARY:Choir'), { timeout: 20_000 }).toBe(true);
  expect(await (await fetchFeed(first)).text()).not.toContain('URL:');
  await expect(feed.getByTestId('feed-titles-warn')).toContainText('not end-to-end encrypted');
  await feed.getByTestId('feed-detail').selectOption('full');
  await expect.poll(async () => (await (await fetchFeed(first)).text()).includes('#task/'), { timeout: 20_000 }).toBe(true);

  await feed.getByTestId('feed-regenerate').click();
  await feed.getByTestId('feed-regenerate-confirm').click();
  await expect.poll(link).not.toBe(first);
  const second = await link();
  await expect.poll(async () => (await fetchFeed(second)).status()).toBe(200);
  // The old address is deleted right after the new one is up, a request later: wait for it, don't race it.
  await expect.poll(async () => (await fetchFeed(first)).status()).toBe(404);

  await feed.getByTestId('feed-switch').uncheck();
  await expect(feed.getByTestId('feed-url')).toHaveCount(0);
  await expect.poll(async () => (await fetchFeed(second)).status()).toBe(404);
});

for (const width of [320, 375, 430]) {
test(`the feed block does not scroll sideways at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await importSample(page);
  await page.goto('/#settings'); await expandSettings(page);
  const feed = page.getByTestId('calendar-feed');
  await feed.getByTestId('feed-switch').check();
  await expect(feed.getByTestId('feed-url')).toContainText('/cal/');
  await page.getByTestId('feed-more').evaluate(d => { (d as HTMLDetailsElement).open = true; });
  await feed.getByTestId('feed-regenerate').click();
  await noSideways(page, 'feed block');
  for (const id of ['feed-webcal', 'feed-copy', 'feed-detail', 'feed-regenerate-confirm']) {
    const box = (await feed.getByTestId(id).locator('xpath=ancestor-or-self::*[self::a or self::button or self::label][1]').boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44 - 1);
  }
  await feed.getByTestId('feed-switch').uncheck();
});
}

test('a #task/<id> link, as in a calendar event, opens that step’s sheet and is then forgotten', async ({ page }) => {
  await importSample(page);
  await page.goto('/#task/t1');
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByTestId('task-actions')).toBeVisible();
  expect(new URL(page.url()).hash).not.toContain('task/');
});
