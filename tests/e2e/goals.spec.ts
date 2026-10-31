import { test, expect, type Page } from '@playwright/test';
import { goTab, noSideways } from './helpers';

// SMART goals v2: an outcome, a measure (milestones or a count), and a bar that only steps marked "Moves the goal?" fill.
const sheet = (page: Page) => page.getByTestId('sheet');
const card = (page: Page, name: string) => page.locator('article.proj', { hasText: name });

async function newProject(page: Page, name: string) {
  await page.goto('/#projects');
  await page.getByTestId('add-card').click();
  await sheet(page).locator('input[name=name]').fill(name);
  await sheet(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(card(page, name)).toBeVisible();
}

async function addStep(page: Page, project: string, title: string) {
  const c = card(page, project);
  if (!(await c.locator('details').first().evaluate(d => (d as HTMLDetailsElement).open))) await c.locator('details > summary').first().click();
  await c.locator('.addstep input[name=title]').fill(title);
  await c.locator('.addstep').getByRole('button', { name: 'Add' }).click();
  await expect(c.locator('ol.steps li', { hasText: title }).first()).toBeVisible();
}

async function moves(page: Page, project: string, title: string, answer: 'yes' | 'no' | null) {
  await card(page, project).locator('ol.steps li', { hasText: title }).getByRole('button', { name: title }).click();
  if (answer) await sheet(page).getByTestId('moves-' + answer).click();
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
}

async function markDone(page: Page, project: string, title: string) {
  await card(page, project).locator('ol.steps li', { hasText: title }).getByRole('button', { name: title }).click();
  await sheet(page).getByRole('button', { name: 'Mark done' }).click();
  await sheet(page).getByRole('button', { name: 'I didn’t time it' }).click();
}

test('a milestones goal: two steps move it, one done offers a milestone to tick and the bar moves; a step that does not move it leaves the bar', async ({ page }) => {
  await newProject(page, 'Thesis');
  await card(page, 'Thesis').getByTestId('edit-project').click();
  const smart = sheet(page).getByTestId('smart');
  await smart.getByTestId('goal-outcome').fill('Hand in the draft');
  await smart.getByTestId('goal-outcome').press('Tab');
  // The old five questions are folded.
  await expect(smart.getByTestId('smart-five')).not.toHaveAttribute('open', '');
  await smart.getByTestId('measure-milestones').click();
  for (const m of ['Draft sent', 'Feedback in', 'Final filed']) {
    await smart.getByTestId('milestone-new').fill(m);
    await smart.getByTestId('milestone-add').click();
  }
  await expect(smart.getByTestId('milestones').locator('li')).toHaveCount(3);
  await noSideways(page, 'project sheet with milestones');
  await sheet(page).getByRole('button', { name: 'Done', exact: true }).click();

  const c = card(page, 'Thesis');
  await expect(c.getByTestId('outcome')).toHaveText('Hand in the draft');
  await expect(c.getByTestId('goal-bar')).toHaveAttribute('data-frac', '0');
  await expect(c.getByTestId('goal-line')).toHaveText('0 of 3 milestones');

  for (const s of ['Write the introduction', 'Write the methods', 'Reply to the email']) await addStep(page, 'Thesis', s);
  // "Moves the goal?" is asked for steps of a project with a bar.
  await moves(page, 'Thesis', 'Write the introduction', 'yes');
  await moves(page, 'Thesis', 'Write the methods', 'yes');
  await moves(page, 'Thesis', 'Reply to the email', 'no');

  // A step that does not move the goal: done, and the bar stays.
  await markDone(page, 'Thesis', 'Reply to the email');
  await expect(sheet(page)).toBeHidden();
  await expect(c.getByTestId('goal-bar')).toHaveAttribute('data-frac', '0');

  // One that does: the milestone question, then the bar moves.
  await markDone(page, 'Thesis', 'Write the introduction');
  await expect(sheet(page).getByTestId('goal-done')).toContainText('Tick a milestone?');
  await sheet(page).getByTestId('milestone-pick').filter({ hasText: 'Draft sent' }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(c.getByTestId('goal-line')).toHaveText('1 of 3 milestones');
  await expect(c.getByTestId('goal-bar')).toHaveAttribute('data-frac', '33');

  // Done without ticking anything: the bar does not move by itself.
  await markDone(page, 'Thesis', 'Write the methods');
  await sheet(page).getByRole('button', { name: 'Not now' }).click();
  await expect(c.getByTestId('goal-line')).toHaveText('1 of 3 milestones');
  await noSideways(page, 'projects with a milestones bar');
});

test('a count goal: each advancing step adds 1 by default, the amount is editable when it is done, and cards never count', async ({ page }) => {
  await newProject(page, 'Book');
  await card(page, 'Book').getByTestId('edit-project').click();
  const smart = sheet(page).getByTestId('smart');
  await smart.getByTestId('goal-outcome').fill('Write the book');
  await smart.getByTestId('measure-count').click();
  await smart.getByTestId('measure-target').fill('10');
  await smart.getByTestId('measure-unit').fill('pages');
  await smart.getByTestId('measure-unit').press('Tab');
  await sheet(page).getByRole('button', { name: 'Done', exact: true }).click();
  const c = card(page, 'Book');
  await expect(c.getByTestId('goal-line')).toHaveText('0 of 10 pages');

  for (const s of ['Draft chapter one', 'Draft chapter two', 'Buy ink']) await addStep(page, 'Book', s);
  await moves(page, 'Book', 'Draft chapter one', 'yes');
  await moves(page, 'Book', 'Draft chapter two', 'yes');
  // Buy ink is never answered: it counts as "no".
  await markDone(page, 'Book', 'Buy ink');
  await expect(sheet(page)).toBeHidden();
  await expect(c.getByTestId('goal-line')).toHaveText('0 of 10 pages');

  await markDone(page, 'Book', 'Draft chapter one');
  await expect(sheet(page).getByTestId('goal-done')).toContainText('1 of 10 pages');
  await sheet(page).getByRole('button', { name: 'Keep +1' }).click();
  await expect(c.getByTestId('goal-line')).toHaveText('1 of 10 pages');

  await markDone(page, 'Book', 'Draft chapter two');
  await sheet(page).getByTestId('goal-amount').filter({ hasText: '+5' }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(c.getByTestId('goal-line')).toHaveText('6 of 10 pages');
  await expect(c.getByTestId('goal-bar')).toHaveAttribute('data-frac', '60');
});

test('a project with no measure has no bar; its steps are not asked whether they move the goal', async ({ page }) => {
  await newProject(page, 'Errands');
  await addStep(page, 'Errands', 'Post the parcel');
  const c = card(page, 'Errands');
  await expect(c.getByTestId('goal-bar')).toHaveCount(0);
  await expect(c.locator('.bar')).toHaveCount(0);
  await c.locator('ol.steps li').getByRole('button', { name: 'Post the parcel' }).click();
  await expect(sheet(page).getByTestId('moves-goal')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await markDone(page, 'Errands', 'Post the parcel');
  await expect(sheet(page)).toBeHidden();
  await goTab(page, 'projects');
});

test('switching a measure keeps what the old one held', async ({ page }) => {
  await newProject(page, 'Move');
  await card(page, 'Move').getByTestId('edit-project').click();
  const smart = sheet(page).getByTestId('smart');
  await smart.getByTestId('measure-milestones').click();
  await smart.getByTestId('milestone-new').fill('Boxes packed');
  await smart.getByTestId('milestone-add').click();
  await smart.getByTestId('milestone-tick').check();
  await smart.getByTestId('measure-none').click();
  await expect(smart.getByTestId('milestones')).toHaveCount(0);
  await smart.getByTestId('measure-milestones').click();
  await expect(smart.getByTestId('milestones').locator('li')).toHaveCount(1);
  await expect(smart.getByTestId('milestone-tick')).toBeChecked();
});
