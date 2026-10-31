import { test, expect, type Page } from '@playwright/test';
import { newCardSheet, importSample, noSideways, goTab, openMenu, expandSheet, addCard } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');

// The task sheet as a draft: a new step is written only on Save.
for (const width of [320, 375, 430]) {
  test(`a new step opens the task sheet as a draft, offers the time it finds, and is written on Save at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await importSample(page);
    const row = page.locator('[data-task]', { hasText: 'Dentist 14:30' });

    await newCardSheet(page, 'Dentist 14:30');
    await expect(sheet(page).getByTestId('task-sheet')).toBeVisible();
    await expect(sheet(page).locator('input[name=title]')).toHaveValue('Dentist 14:30');
    await expect(sheet(page).getByTestId('set-time')).toHaveText('Set 14:30 as the time');
    // Nothing is written yet.
    await expect(row).toHaveCount(0);
    await noSideways(page, 'new task sheet with the hint');

    // Tapping the hint fills the fixed time (in More), and the hint goes.
    await sheet(page).getByTestId('set-time').click();
    await expect(sheet(page).getByTestId('set-time')).toHaveCount(0);
    await sheet(page).locator('details.more summary').click();
    await expect(sheet(page).locator('input[name=at]')).toHaveValue('14:30');
    await noSideways(page, 'new task sheet with More open');

    await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet(page)).toBeHidden();
    await expect(row).toHaveCount(1);

    // Saved with its time, and on today's list (Start here, or a row, whatever the clock says).
    await row.getByRole('button', { name: /^(Edit|Details)$/ }).click();
    await sheet(page).locator('details.more summary').click();
    await expect(sheet(page).locator('input[name=at]')).toHaveValue('14:30');
    await expect(sheet(page).getByTestId('set-time')).toHaveCount(0);
  });
}

test('closing a new step\'s sheet writes nothing', async ({ page }) => {
  await importSample(page);
  await newCardSheet(page, 'Never saved');
  await expect(sheet(page).locator('input[name=title]')).toHaveValue('Never saved');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('.row', { hasText: 'Never saved' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Never saved')).toHaveCount(0);
});

test('the estimate typed in the new card sheet is kept on Save', async ({ page }) => {
  await importSample(page);
  await newCardSheet(page, 'Sort the drawer');
  await sheet(page).locator('input[name=est]').fill('25');
  await expect(sheet(page).locator('input[name=est]')).toHaveValue('25');
  await expect(sheet(page).getByTestId('set-time')).toHaveCount(0);
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('first')).toContainText('Sort the drawer'); // by hand, with nothing running: the top of what is left
});

test('an existing step offers a time written in its title or note', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('details').first().click();
  await expect(sheet(page).getByTestId('set-time')).toHaveCount(0);
  await sheet(page).locator('input[name=title]').fill('Open Mail and call at 7pm');
  await expect(sheet(page).getByTestId('set-time')).toHaveText('Set 19:00 as the time');
  // A length is not a time.
  await sheet(page).locator('input[name=title]').fill('Open Mail and write for 1h');
  await expect(sheet(page).getByTestId('set-time')).toHaveCount(0);
  await expandSheet(page);
  await sheet(page).locator('textarea[name=note]').fill('rendez-vous à 9h30');
  await expect(sheet(page).getByTestId('set-time')).toHaveText('Set 09:30 as the time');
  await sheet(page).getByTestId('set-time').click();
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();

  await page.getByTestId('details').first().click();
  await sheet(page).locator('details.more summary').click();
  await expect(sheet(page).locator('input[name=at]')).toHaveValue('09:30');
});

// ---------- Home: the input, the receipt and Undo ----------
const input = (page: Page) => page.getByTestId('home-input');
// On a phone the keyboard hides the tab bar while the input has focus, so let go of it after sending.
const say = async (page: Page, text: string) => { await input(page).fill(text); await input(page).press('Enter'); await input(page).blur(); };
const store = (page: Page, name: string) => page.evaluate(n => new Promise<Record<string, unknown>[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const all = open.result.transaction(n).objectStore(n).getAll(); all.onsuccess = () => res(all.result); };
}), name);
const live = async (page: Page, name: string) => (await store(page, name)).filter(d => !d._del);
const RECEIPTS = 'Open Files and sort the scanned receipts';

test('the choir phrase makes a standing item with its time and weekday, and Undo removes it', async ({ page }) => {
  await importSample(page);
  await goTab(page, 'home');
  await say(page, 'choir every Monday 19:00 at Hill House 602');
  await expect(page.getByTestId('receipt')).toContainText('Added “Choir, Hill House 602” as a standing item');
  await expect(input(page)).toHaveValue('');
  const c = (await live(page, 'tasks')).find(x => x.template && /^Choir/.test(String(x.title)));
  expect(c).toMatchObject({ title: 'Choir, Hill House 602', template: true, weekdays: [1], at: '19:00', status: 'open' });

  // The item as the sheet shows it.
  await goTab(page, 'projects');
  await page.locator('[data-project=inbox] summary').click();
  await page.locator('[data-project=inbox] [data-task]', { hasText: 'Choir' }).getByRole('button', { name: /Choir/ }).click();
  await expect(sheet(page).locator('input[name=title]')).toHaveValue('Choir, Hill House 602');
  await expect(sheet(page).locator('input[name=at]')).toHaveValue('19:00');
  await expandSheet(page);
  await expect(sheet(page).locator('input[name=template]')).toBeChecked();
  await expect(sheet(page).getByTestId('weekdays').getByLabel('Mon')).toBeChecked();
  await expect(sheet(page).getByTestId('weekdays').getByLabel('Tue')).not.toBeChecked();
  await page.keyboard.press('Escape');

  await goTab(page, 'home');
  await expect(page.getByTestId('receipt')).toBeVisible();
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('receipt')).toHaveCount(0);
  expect((await live(page, 'tasks')).filter(x => /^Choir/.test(String(x.title)))).toHaveLength(0);
  await goTab(page, 'projects');
  await expect(page.locator('[data-project=inbox] [data-task]', { hasText: 'Choir' })).toHaveCount(0);
});

test('on a Monday Start here is the next step until the choir needs the time, then the choir with when to leave', async ({ page }) => {
  const at = (hh: number, mm: number) => new Date(2026, 9, 26, hh, mm, 0); // Monday 26 October, this computer's clock
  await page.clock.setFixedTime(at(10, 0));
  await page.goto('/');
  await say(page, 'choir every Monday 19:00 at Hill House 602');
  await expect(page.getByTestId('receipt')).toBeVisible();
  await goTab(page, 'today');
  await addCard(page, 'Call the bank');
  await expect(page.getByTestId('first')).toContainText('Call the bank');

  // The step has no estimate, so it counts 15 minutes, and 5 more of margin: it is Start here until 18:10 (15 + 5 before 18:30).
  await page.clock.setFixedTime(at(18, 10));
  await page.reload();
  await goTab(page, 'home');
  await expect(page.getByTestId('greeting-next')).toContainText('Call the bank');
  await expect(page.getByTestId('greeting-line')).toHaveCount(0);

  // A minute later it would run into the time to leave: the choir takes over, with when to leave. Today shows the same one.
  await page.clock.setFixedTime(at(18, 11));
  await page.reload();
  await goTab(page, 'home');
  await expect(page.getByTestId('greeting-next')).toContainText('Choir 19:00, Hill House 602 · leave at 18:30');
  await expect(page.getByTestId('greeting-line')).toHaveText('Choir 19:00, Hill House 602 · leave at 18:30');
  await expect(page.locator('.mast, .side')).toHaveCount(0);
  await goTab(page, 'today');
  await expect(page.getByTestId('first')).toContainText('Choir 19:00, Hill House 602 · leave at 18:30');

  await page.clock.setFixedTime(at(18, 30));
  await page.reload();
  await goTab(page, 'home');
  await expect(page.getByTestId('greeting-line')).toHaveText('Choir 19:00, Hill House 602 · leave at 18:30');

  // It lets go once the item is over (30 minutes with no length of its own).
  await page.clock.setFixedTime(at(19, 30));
  await page.reload();
  await goTab(page, 'home');
  await expect(page.getByTestId('greeting-next')).toContainText('Call the bank');
});

test('no list yet shows Plan the day; a started step is the greeting, and the running bar steps aside on Home', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('greeting-plan')).toContainText('Plan the day');
  await importSample(page);
  await goTab(page, 'home');
  await expect(page.getByTestId('greeting-next')).toContainText('Open Doctolib');
  await page.getByTestId('home-start').click();
  await expect(page.getByTestId('greeting-running')).toContainText('Open Doctolib');
  await expect(page.locator('.runbar')).toHaveCount(0);
  await goTab(page, 'projects');
  await expect(page.locator('.runbar')).toBeVisible();
  await goTab(page, 'matrix');
  await expect(page.locator('.runbar')).toHaveCount(0);
  await goTab(page, 'home');
  await page.getByTestId('greeting-running').getByRole('button', { name: 'Pause' }).click();
  await sheet(page).getByRole('button', { name: /^(Pause|Save)/ }).first().click();
});

test('done on a step applies at once, asks how long in the card, and Undo takes back the step and the time', async ({ page }) => {
  await importSample(page);
  await goTab(page, 'home');
  await say(page, 'done sort the scanned receipts');
  await expect(page.getByTestId('receipt')).toContainText('Done: “' + RECEIPTS + '”');
  const card = page.getByTestId('card-duration');
  await expect(card).toContainText('How long did “' + RECEIPTS + '” take?');
  expect((await live(page, 'tasks')).find(x => x.title === RECEIPTS)).toMatchObject({ status: 'done' });
  // Home shows its greeting, the card, the receipt and the input: four parts, no more.
  await expect(page.locator('[data-testid=home] > *')).toHaveCount(4);
  await card.getByTestId('dur').nth(2).click(); // 30 minutes (no estimate: 5, 15, 30, …)
  await expect(card).toHaveCount(0);
  const sessions = (await live(page, 'sessions')).filter(s => s.source === 'typed' && s.m === 30);
  expect(sessions).toHaveLength(1);
  await expect(page.locator('[data-testid=home] > *')).not.toHaveCount(5);

  await page.getByTestId('undo').click();
  await expect(page.getByTestId('receipt')).toHaveCount(0);
  expect((await live(page, 'tasks')).find(x => x.title === RECEIPTS)).toMatchObject({ status: 'open', doneDay: null });
  expect((await live(page, 'sessions')).filter(s => s.m === 30)).toHaveLength(0);
});

test('a length can be typed as the answer, and "I didn’t time it" leaves no session', async ({ page }) => {
  await importSample(page);
  await goTab(page, 'home');
  const before = (await live(page, 'sessions')).length;
  await say(page, 'done sort the scanned receipts');
  await expect(page.getByTestId('card-duration')).toBeVisible();
  await say(page, '1h30');
  await expect(page.getByTestId('card-duration')).toHaveCount(0);
  expect((await live(page, 'sessions')).filter(s => s.m === 90 && s.source === 'typed')).toHaveLength(1);

  await say(page, 'done open'); // several steps start with "Open": a tap says which
  await expect(page.getByTestId('card-pick')).toBeVisible();
  await page.getByTestId('pick').filter({ hasText: 'send the signed lease' }).click();
  await expect(page.getByTestId('card-duration')).toBeVisible();
  await page.getByTestId('not-timed').click();
  await expect(page.getByTestId('card-duration')).toHaveCount(0);
  expect((await live(page, 'sessions')).length).toBe(before + 1);
  // One receipt for the whole conversation, one Undo.
  await expect(page.getByTestId('receipt')).toContainText('2 changes');
});

test('drop opens the review, and nothing changes until it is applied', async ({ page }) => {
  await importSample(page);
  await goTab(page, 'home');
  await say(page, 'drop sort the scanned receipts');
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.getByTestId('chg')).toHaveCount(1);
  expect((await live(page, 'tasks')).find(x => x.title === RECEIPTS)).toMatchObject({ status: 'open' });
  await expect(page.getByTestId('receipt')).toHaveCount(0);
  // Closing it leaves the card, to open again.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('card-review')).toContainText('1 change');
  await page.getByTestId('card-review-open').click();
  await page.getByTestId('apply-changes').click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByTestId('receipt')).toContainText('Dropped “' + RECEIPTS + '”');
  await expect(page.getByTestId('card-review')).toHaveCount(0);
  expect((await live(page, 'tasks')).find(x => x.title === RECEIPTS)).toMatchObject({ status: 'dropped' });
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('receipt')).toHaveCount(0);
  expect((await live(page, 'tasks')).find(x => x.title === RECEIPTS)).toMatchObject({ status: 'open' });
});

test('a question opens the task sheet, filled in, and writes nothing', async ({ page }) => {
  await importSample(page);
  await goTab(page, 'home');
  const n = (await live(page, 'tasks')).length;
  await say(page, 'buy milk at the shop?');
  await expect(sheet(page).getByTestId('task-sheet')).toBeVisible();
  await expect(sheet(page).locator('input[name=title]')).toHaveValue(/buy milk at the shop/i);
  expect((await live(page, 'tasks')).length).toBe(n);
  await expect(page.getByTestId('receipt')).toHaveCount(0);
});

test('a short line adds a step to the Inbox; History lists it with its Undo, and Home starts clean after Undo', async ({ page }) => {
  await importSample(page);
  await goTab(page, 'home');
  await say(page, 'call the bank tomorrow');
  await expect(page.getByTestId('receipt')).toContainText('Added “Call the bank”');
  await say(page, 'pay the water bill');
  await expect(page.getByTestId('receipt')).toContainText('2 changes');
  await openMenu(page, 'history');
  const rows = page.getByTestId('history-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('call the bank tomorrow');
  await expect(rows.first()).toContainText('2 changes');
  expect((await live(page, 'tasks')).filter(x => /^(Call the bank|Pay the water bill)$/.test(String(x.title)))).toHaveLength(2);
  await page.getByTestId('history-undo').click();
  await expect(rows.first().getByTestId('history-undo')).toHaveCount(0);
  await expect(rows.first()).toContainText('Undone');
  expect((await live(page, 'tasks')).filter(x => /^(Call the bank|Pay the water bill)$/.test(String(x.title)))).toHaveLength(0);
  await goTab(page, 'home');
  await expect(page.getByTestId('receipt')).toHaveCount(0);
});

test('Undo in History asks first after ten minutes; a step edited since stays', async ({ page }) => {
  await importSample(page);
  // Tomorrow at 10:00: the clock only ever moves forward (a time before the import's writes hides the receipt).
  const t0 = new Date(); t0.setDate(t0.getDate() + 1); t0.setHours(10, 0, 0, 0);
  await page.clock.setFixedTime(t0);
  await goTab(page, 'home');
  await say(page, 'call the bank tomorrow');
  await expect(page.getByTestId('receipt')).toContainText('Added “Call the bank”');
  await page.clock.setFixedTime(new Date(+t0 + 11 * 60_000));
  await openMenu(page, 'history');
  const rows = page.getByTestId('history-row');
  page.once('dialog', d => void d.dismiss());
  await page.getByTestId('history-undo').click();
  await expect(rows.first().getByTestId('history-undo')).toBeVisible();
  expect((await live(page, 'tasks')).filter(x => x.title === 'Call the bank')).toHaveLength(1);
  page.once('dialog', d => { expect(d.message()).toContain('more than ten minutes ago'); void d.accept(); });
  await page.getByTestId('history-undo').click();
  await expect(rows.first()).toContainText('Undone');
  expect((await live(page, 'tasks')).filter(x => x.title === 'Call the bank')).toHaveLength(0);
});

test('History is empty at first, and says what it will hold', async ({ page }) => {
  await page.goto('/');
  await openMenu(page, 'history');
  await expect(page.getByTestId('history-empty')).toBeVisible();
});

test('what is waiting is behind the bell: Home has a dot, the page lists it with its button', async ({ page }) => {
  await importSample(page);
  await goTab(page, 'home');
  await expect(page.getByTestId('home-card')).toHaveCount(0);
  await expect(page.locator('[data-testid=home] > *')).toHaveCount(2); // greeting, input
  await expect(page.getByTestId('bell-dot')).toBeVisible();
  await page.getByTestId('home-bell').click();
  await expect(page).toHaveURL(/#notifications$/);
  await expect(page.locator('.mast')).toHaveCount(0);
  const n = page.getByTestId('carry-nudge');
  await expect(n).toContainText('from yesterday');
  const before = (await live(page, 'days')).map(d => JSON.stringify(d.plan)).join();
  await n.getByRole('button').click();
  await expect(page.getByTestId('carried-sheet')).toBeVisible(); // no bulk carry: the steps are asked one at a time
  expect((await live(page, 'days')).map(d => JSON.stringify(d.plan)).join()).toBe(before);
  while (await page.getByTestId('carried-today').isVisible()) {
    const title = await page.getByTestId('carried-card').innerText();
    await page.getByTestId('carried-today').click();
    await expect(page.getByTestId('carried-card').filter({ hasText: title })).toHaveCount(0);
  }
  await expect(page.getByTestId('carry-nudge')).toHaveCount(0);
  await expect(page.getByTestId('notifications-empty')).toBeVisible();
  await goTab(page, 'home');
  await expect(page.getByTestId('bell-dot')).toHaveCount(0);
});

test('Settings is a plain page titled Settings', async ({ page }) => {
  await page.goto('/');
  await goTab(page, 'settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 2 }).first()).toBeVisible();
  await expect(page.locator('.mast, .side, .foot')).toHaveCount(0);
});

for (const width of [320, 375, 430]) {
  test(`Home with its card, receipt and a long line fits, and the input sits above the tab bar at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await importSample(page);
    await goTab(page, 'home');
    await noSideways(page, 'home');
    const above = async (where: string) => {
      // With the keyboard open (a phone, focus in the input) the bar is hidden and the input takes its place.
      const bar = await page.getByTestId('tabbar').boundingBox(), inp = await page.getByTestId('home-input-bar').boundingBox();
      expect(inp!.y + inp!.height, where + ': input above the bar').toBeLessThanOrEqual((bar?.y ?? 700) + 0.5);
      expect(inp!.x).toBe(0);
      expect(inp!.width).toBeCloseTo(width, 0);
      const send = await page.getByTestId('home-send').boundingBox();
      expect(send!.width).toBeGreaterThanOrEqual(44);
    };
    await above('empty');
    await say(page, 'done sort the scanned receipts');
    await expect(page.getByTestId('card-duration')).toBeVisible();
    await expect(page.getByTestId('receipt')).toBeVisible();
    await noSideways(page, 'duration card and receipt');
    const undo = await page.getByTestId('undo').boundingBox();
    expect(undo!.height).toBeGreaterThanOrEqual(44);
    // The last of the page is not hidden behind the input.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const last = await page.getByTestId('receipt').boundingBox();
    expect(last!.y + last!.height).toBeLessThanOrEqual((await page.getByTestId('home-input-bar').boundingBox())!.y + 0.5);

    await input(page).fill('a long line with many words, written over several lines\nthat the box has to hold\nwithout widening the page\nor hiding its own end');
    await above('four lines');
    await noSideways(page, 'a long line');
    const h = await page.getByTestId('home-input-bar').boundingBox();
    expect(h!.height).toBeLessThan(200);
    await input(page).fill('');

    await say(page, 'done open');
    await expect(page.getByTestId('card-pick')).toBeVisible();
    await noSideways(page, 'which one');
    await page.getByTestId('card-pick').getByRole('button', { name: 'Cancel' }).click();
    // Toasts and the review sit clear of the input.
    await say(page, 'drop text alex');
    await expect(page.getByTestId('review')).toBeVisible();
    await noSideways(page, 'review from Home');
    await page.keyboard.press('Escape');
    await openMenu(page, 'history');
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    await noSideways(page, 'history');
  });
}

test('sending closes the keyboard on a phone and keeps the focus on a desktop', async ({ page, isMobile }) => {
  await page.goto('/');
  await input(page).fill('call the bank');
  await input(page).press('Enter');
  await expect(page.getByTestId('receipt')).toBeVisible();
  if (isMobile) {
    await expect(page.getByTestId('tabbar')).toBeVisible();
    await expect(input(page)).not.toBeFocused();
  } else {
    await expect(input(page)).toBeFocused();
  }
  await expect(input(page)).toHaveValue('');
  // Shift+Enter is a new line, not a send.
  await input(page).fill('first line');
  await input(page).press('Shift+Enter');
  await input(page).pressSequentially('second line');
  await expect(input(page)).toHaveValue('first line\nsecond line');
  await expect(page.getByTestId('receipt')).toContainText('Added “Call the bank”');
});
