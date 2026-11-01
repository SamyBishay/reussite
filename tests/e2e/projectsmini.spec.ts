import { test, expect, type Page } from '@playwright/test';
import { importSample, addProject, openProjectCard, goTab, noSideways } from './helpers';

// Projects, condensed: each suit shows two projects as small cards and "View all n" for the rest, in a sheet, whole.
const sheet = (page: Page) => page.getByTestId('sheet');

/** The sample's one Work project plus three more: four in the suit. */
async function crowded(page: Page) {
  await importSample(page);
  for (const name of ['Garden', 'Tax return', 'Choir']) await addProject(page, name, 'S');
  await goTab(page, 'projects');
}

test('a suit shows two projects as condensed cards and View all for the rest', async ({ page }) => {
  await crowded(page);
  const suit = page.getByTestId('suit-S');
  // Projects just added are open in place (they are whole); fold them to see the condensed cards.
  const fold = page.getByTestId('project-fold');
  while (await fold.count()) await fold.first().click();
  await expect(suit.getByTestId('suit-count-S')).toHaveText('4');
  await expect(suit.locator('article.proj')).toHaveCount(2);
  await expect(suit.locator('article.proj.mini')).toHaveCount(2);
  await expect(page.getByTestId('suit-all-S')).toHaveText('View all 4');
  // The other suits hold one project each: no button.
  await expect(page.getByTestId('suit-all-D')).toHaveCount(0);
  await expect(page.getByTestId('suit-sheet')).toHaveCount(0);
});

test('View all opens the suit whole in a sheet, with every project', async ({ page }) => {
  await crowded(page);
  await page.getByTestId('suit-all-S').click();
  const s = page.getByTestId('suit-sheet');
  await expect(s).toBeVisible();
  await expect(s.locator('article.proj')).toHaveCount(4);
  await expect(s.locator('article.proj.mini')).toHaveCount(0);
  for (const name of ['Thesis', 'Garden', 'Tax return', 'Choir']) await expect(s).toContainText(name);
  await noSideways(page, 'suit sheet');
});

test('a condensed card names the project, its open steps and the next step, and opens in place when tapped', async ({ page }) => {
  await importSample(page);
  await goTab(page, 'projects');
  const c = page.locator('article.proj.mini', { hasText: 'Thesis' });
  await expect(c).toBeVisible();
  await expect(c.getByTestId('project-open-steps')).toHaveText(/\d+ open/);
  await expect(c).toContainText('the thesis draft');
  await expect(c.locator('.steps')).toHaveCount(0);
  await expect(c.locator('.addstep')).toHaveCount(0);
  const whole = await openProjectCard(page, 'Thesis');
  await expect(whole.locator('.addstep')).toBeVisible();
  await whole.getByTestId('project-fold').click();
  await expect(page.locator('article.proj.mini', { hasText: 'Thesis' })).toBeVisible();
});

for (const width of [320, 360, 390, 430]) {
  test(`condensed Projects and the suit sheet do not scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await crowded(page);
    await noSideways(page, 'projects');
    await page.getByTestId('suit-all-S').click();
    await expect(page.getByTestId('suit-sheet')).toBeVisible();
    await noSideways(page, 'suit sheet');
  });
}

test('two condensed cards sit side by side from 360px and stack below', async ({ page }) => {
  await crowded(page);
  const fold = page.getByTestId('project-fold');
  while (await fold.count()) await fold.first().click();
  const x = () => page.locator('[data-testid=suit-S] article.proj').evaluateAll(els => els.slice(0, 2).map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
  await page.setViewportSize({ width: 390, height: 800 });
  let [a, b] = await x();
  expect(b!.y).toBeCloseTo(a!.y, 0);
  expect(b!.x).toBeGreaterThan(a!.x);
  await page.setViewportSize({ width: 340, height: 800 });
  [a, b] = await x();
  expect(b!.y).toBeGreaterThan(a!.y);
});
