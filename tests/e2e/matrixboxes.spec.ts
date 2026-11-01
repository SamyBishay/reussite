import { test, expect, type Page } from '@playwright/test';
import { importSample, addCard, goTab, noSideways, expandSettings } from './helpers';

// The matrix as four boxes in a 2x2 grid at every width: three compact cards each and "View all", the sheet with the whole quadrant, and every card folded at the bottom.
const sheet = (page: Page) => page.getByTestId('sheet');
const count = async (page: Page, k: number) => Number(await page.getByTestId('quad-count' + k).textContent());

/** The sample list and three cards more, then the Matrix; returns the quadrant that holds more than three. */
async function crowded(page: Page): Promise<number> {
  await importSample(page);
  for (const title of ['Open Mail and pay the electricity bill', 'Open Files and scan the passport', 'Open Notes and write the trip list']) await addCard(page, title);
  await goTab(page, 'matrix');
  await expect(page.getByTestId('quad1')).toBeVisible();
  for (const k of [1, 2, 3, 4]) if ((await count(page, k)) > 3) return k;
  throw new Error('no quadrant holds more than three cards');
}

test('each box shows its first three cards and a View all button only when there are more', async ({ page }) => {
  const k = await crowded(page);
  const n = await count(page, k);
  const box = page.getByTestId('quad' + k);
  await expect(box.locator('.item')).toHaveCount(3);
  await expect(page.getByTestId('quad-all' + k)).toHaveText('View all ' + n);
  // A box with three cards or fewer has no button, and nothing hides in it.
  for (const j of [1, 2, 3, 4]) {
    const m = await count(page, j);
    await expect(page.getByTestId('quad' + j).locator('.item')).toHaveCount(Math.min(m, 3));
    await expect(page.getByTestId('quad-all' + j)).toHaveCount(m > 3 ? 1 : 0);
  }
  // Each box says what it is and how many it holds on one line; what it means is its tooltip. A card is compact: no buttons in it.
  await expect(box.locator('h3')).toBeVisible();
  await expect(box.locator('header')).toHaveAttribute('title', /.+/);
  await expect(box.locator('small')).toHaveCount(0);
  await expect(box.getByTestId('move-btn')).toHaveCount(0);
  const h = await box.locator('header').boundingBox(), c = await page.getByTestId('quad-count' + k).boundingBox();
  expect(Math.abs(c!.y + c!.height / 2 - (h!.y + h!.height / 2))).toBeLessThan(h!.height / 2);
});

test('a card in a box opens its task on tap and Move to… is in that sheet; the title is clamped to two lines', async ({ page }) => {
  const k = await crowded(page);
  const card = page.getByTestId('quad' + k).locator('.item').first();
  const lines = await card.locator('.clamp').evaluate(el => { const c = getComputedStyle(el); return { clamp: c.webkitLineClamp, overflow: c.overflow }; });
  expect(lines).toEqual({ clamp: '2', overflow: 'hidden' });
  await card.locator('.t').click();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Move to…' }).click();
  await expect(sheet(page).getByTestId('to-q1')).toBeVisible();
});

test('View all opens the quadrant in a sheet, whole, with the same move button', async ({ page }) => {
  const k = await crowded(page);
  const n = await count(page, k);
  await page.getByTestId('quad-all' + k).click();
  const s = sheet(page).getByTestId('quad-sheet');
  await expect(s).toBeVisible();
  await expect(s.locator('.item')).toHaveCount(n);
  await noSideways(page, 'quadrant sheet');
  // Move one with ⇄ (to Later, or to Protect if this is Later): the box has one card fewer.
  const to = k === 4 ? 'to-q2' : 'to-q4';
  await s.locator('.item').first().getByTestId('move-btn').click();
  await sheet(page).getByTestId(to).click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByTestId('quad-count' + k)).toHaveText(String(n - 1));
});

test('an empty quadrant says what it is for in one line', async ({ page }) => {
  await page.goto('/#matrix');
  await expect(page.getByTestId('quad1')).toBeVisible();
  for (const k of [1, 2, 3, 4]) {
    await expect(page.getByTestId('quad-count' + k)).toHaveText('0');
    await expect(page.getByTestId('quad' + k).locator('.quad-empty')).toHaveCount(1);
    await expect(page.getByTestId('quad' + k).locator('.item')).toHaveCount(0);
  }
});

test('the four boxes are two by two at every width, 320 px included', async ({ page }) => {
  await page.goto('/#matrix');
  await expect(page.getByTestId('quad1')).toBeVisible();
  const rect = (k: number) => page.getByTestId('quad' + k).evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  for (const width of [320, 390, 600, 900]) {
    await page.setViewportSize({ width, height: 900 });
    const [a, b, c, d] = [await rect(1), await rect(2), await rect(3), await rect(4)];
    expect(b.y).toBeCloseTo(a.y, 0); // Now and Protect side by side
    expect(b.x).toBeGreaterThan(a.x + a.w - 1);
    expect(c.y).toBeGreaterThan(a.y); // Quick below Now, Later below Protect
    expect(c.x).toBeCloseTo(a.x, 0);
    expect(d.y).toBeCloseTo(c.y, 0);
    expect(d.x).toBeCloseTo(b.x, 0);
  }
});

// The owner's iPhone is 390x844 with a ~59px status bar above and ~34px of home indicator in the tab bar; Chromium has no
// safe-area insets, so they are added here. The masthead and the command box (an AI is set up) are above the grid.
test('on a 390x844 phone the whole grid is on screen above the tab bar, with the command box', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await crowded(page);
  await page.goto('/#settings'); await expandSettings(page);
  await page.getByTestId('ai-anthropic').click();
  await page.getByTestId('ai-key').fill('sk-ant-test');
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-settings')).toContainText('A key is saved.');
  await page.addStyleTag({ content: '.tabbar{padding-bottom:34px !important} body{padding-top:59px}' });
  await goTab(page, 'matrix');
  await expect(page.getByTestId('cmd')).toBeVisible();
  await expect(page.getByTestId('quad4')).toBeVisible();
  const m = await page.evaluate(() => {
    const bottom = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().bottom;
    return { grid: bottom('[data-testid=matrix]'), tab: document.querySelector('.tabbar')!.getBoundingClientRect().top, cmd: bottom('[data-testid=cmd]') };
  });
  expect(m.cmd).toBeLessThan(m.grid);
  expect(m.grid).toBeLessThanOrEqual(m.tab - 8);
  await noSideways(page, 'matrix 390');
});

test('every card is in one list, folded at the bottom, each with its quadrant named', async ({ page }) => {
  await importSample(page);
  await goTab(page, 'matrix');
  const fold = page.getByTestId('all-cards');
  await expect(fold).toBeVisible();
  await expect(fold).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('all-cards-list')).toHaveCount(0);
  const total = (await count(page, 1)) + (await count(page, 2)) + (await count(page, 3)) + (await count(page, 4));
  await expect(fold.locator('summary')).toContainText('All cards (' + total + ')');
  await fold.locator('summary').click();
  const list = page.getByTestId('all-cards-list');
  await expect(list.locator('.item')).toHaveCount(total);
  await expect(list.locator('[data-testid=quad-tag]')).toHaveCount(total);
  await expect(list.locator('.item', { hasText: 'scanned receipts' }).getByTestId('quad-tag')).toHaveText('Later');
  // The search and the project and suit filters are in the fold.
  await fold.getByRole('searchbox').fill('receipts');
  await expect(list.locator('.item')).toHaveCount(1);
  await fold.getByRole('searchbox').fill('');
  await fold.getByLabel('Project').selectOption({ label: 'Thesis' });
  await expect(list.locator('.item')).toHaveCount(1);
  await expect(list).toContainText('second paragraph');
  // It sits after the boxes.
  const order = await page.evaluate(() => { const q = document.querySelector('[data-testid=quad4]')!, f = document.querySelector('[data-testid=all-cards]')!; return q.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING; });
  expect(order).toBeTruthy();
});

for (const width of [320, 375, 430]) {
  test(`the boxes, the sheet and the folded list do not scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const k = await crowded(page);
    await noSideways(page, 'matrix boxes');
    await page.getByTestId('quad-all' + k).click();
    await expect(sheet(page).getByTestId('quad-sheet')).toBeVisible();
    await noSideways(page, 'quadrant sheet');
    await page.keyboard.press('Escape');
    await page.getByTestId('all-cards').locator('summary').click();
    await expect(page.getByTestId('all-cards-list')).toBeVisible();
    await noSideways(page, 'all cards fold open');
    await page.getByTestId('place-pill').click();
    await expect(page.getByTestId('place-menu')).toBeVisible();
    await noSideways(page, 'place menu');
  });
}
