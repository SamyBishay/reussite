import { test, expect, type Page } from '@playwright/test';
import { importSample, noSideways } from './helpers';

// Optional fields sit under one folded "More", after the essentials; Settings sections are folded disclosures.
const sheet = (page: Page) => page.getByTestId('sheet');

test('a task sheet shows only the essentials until More is opened', async ({ page }) => {
  await importSample(page);
  await page.goto('/#task/t3'); // the thesis step: no link, no app, no note
  const s = sheet(page);
  await expect(s.locator('input[name=title]')).toBeVisible();
  await expect(s.getByTestId('time-chip')).toBeVisible();
  await expect(s.locator('input[name=urgent]')).toBeVisible();
  await expect(s.locator('input[name=est]')).toBeVisible();
  await expect(s.locator('input[name=due]')).toBeVisible();
  for (const hidden of [s.getByTestId('label'), s.locator('input[name=starter]'), s.locator('textarea[name=note]'), s.locator('select[name=project]'), s.locator('input[name=link]'), s.locator('input[name=app]')]) await expect(hidden).toBeHidden();
  await expect(s.getByTestId('task-more')).not.toHaveAttribute('open', '');
  await s.getByTestId('task-more').locator('summary').click();
  for (const shown of [s.getByTestId('label'), s.locator('input[name=starter]'), s.locator('textarea[name=note]'), s.locator('select[name=project]'), s.locator('input[name=link]')]) await expect(shown).toBeVisible();
});

test('More says how many hidden fields have a value', async ({ page }) => {
  await importSample(page);
  // A new step with an app and a link set under More, then opened again: "More · 2 set".
  await page.getByPlaceholder(/The app and the first action/).fill('Call the plumber');
  await page.getByTestId('quick-details').click();
  const more = sheet(page).getByTestId('task-more');
  await expect(more.locator('summary')).toHaveText('More');
  await more.locator('summary').click();
  await sheet(page).locator('input[name=app]').fill('Phone');
  await sheet(page).locator('input[name=link]').fill('https://example.org/plumber');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  // Added by hand with nothing running, it is the first card.
  await expect(page.getByTestId('first')).toContainText('plumber');
  await page.getByTestId('first').getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(sheet(page).getByTestId('task-more').locator('summary')).toHaveText('More · 2 set');
  // The fold stays closed (a count is a hint, not a surprise) and opens with a tap.
  await expect(sheet(page).getByTestId('task-more')).not.toHaveAttribute('open', '');
  await sheet(page).getByTestId('task-more').locator('summary').click();
  await expect(sheet(page).locator('input[name=link]')).toHaveValue('https://example.org/plumber');
  // The Doctolib step in the sample has more set (link, app, its project).
  await page.keyboard.press('Escape');
  await page.goto('/#task/t1');
  await expect(sheet(page).getByTestId('task-more-count')).toContainText('set');
});

test('the add sheet and the project sheet fold their optional fields too', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('tab-projects').click();
  await page.getByTestId('edit-project').first().click();
  const p = sheet(page).getByTestId('project-sheet');
  await expect(p.locator('input[type=text]').first()).toBeVisible();
  await expect(p.getByTestId('smart')).toBeHidden();
  await expect(p.getByTestId('project-more')).not.toHaveAttribute('open', '');
  await p.getByTestId('project-more').locator('summary').click();
  await expect(p.getByTestId('smart')).toBeVisible();
});

test('Settings sections are folded; only the first is open, and one tap opens another', async ({ page }) => {
  await importSample(page);
  await page.goto('/#settings');
  const root = page.getByTestId('settings');
  await expect(root.getByTestId('appearance')).toHaveAttribute('open', '');
  for (const id of ['method', 'notify', 'calendar-settings', 'ai-settings', 'sync', 'connector', 'data', 'language', 'about']) {
    const d = root.getByTestId(id);
    if (await d.count()) await expect(d, id).not.toHaveAttribute('open', '');
  }
  await expect(root.getByTestId('feed-switch')).toBeHidden();
  await root.getByTestId('calendar-settings').locator('summary').first().click();
  await expect(root.getByTestId('feed-switch')).toBeVisible();
  // The method's essentials are visible once it opens; the rest sits under More.
  await root.getByTestId('method').locator('summary').first().click();
  await expect(root.getByTestId('method').getByTestId('start-review-now')).toBeVisible();
  await expect(root.getByTestId('method-more')).not.toHaveAttribute('open', '');
});

for (const width of [320, 375, 430]) {
test(`folded Settings and an opened More do not scroll sideways at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await importSample(page);
  await page.goto('/#settings');
  await noSideways(page, 'settings folded');
  await page.getByTestId('settings').locator('details').evaluateAll(ds => ds.forEach(d => { (d as HTMLDetailsElement).open = true; }));
  await noSideways(page, 'settings open');
  await page.goto('/#task/t1');
  await sheet(page).getByTestId('task-more').locator('summary').click();
  await noSideways(page, 'task sheet with More open');
});
}

test('the suit and project selects show the step’s own values, and saving the sheet keeps them', async ({ page }) => {
  await importSample(page);
  await page.goto('/#task/t1'); // project p1, suit D
  const s = sheet(page);
  await expect(s.locator('select[name=project]')).toHaveValue('p1');
  await expect(s.locator('select[name=suit]')).toHaveValue('D');
  await s.locator('input[name=est]').fill('12');
  await s.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(s).toBeHidden();
  await page.goto('/#task/t1');
  await expect(sheet(page).locator('select[name=project]')).toHaveValue('p1');
  await expect(sheet(page).locator('select[name=suit]')).toHaveValue('D');
});
