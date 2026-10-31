// The Sunday review's goals (plan 2 Nov, S7): by hand, a Goals screen per project (the goal: Still right / Edit / Close; then each open step,
// "Moves the goal?" Yes / No, as it stands); with an AI, a conversation one project at a time that proposes, and the person keeps, skips or
// flips each answer before the one change-set is confirmed on the review screen. OpenRouter is stubbed; every name here is invented.
// The clock is fixed to a Sunday morning (the review day) so nothing depends on the hour.
import { test, expect, type Page, type Route } from '@playwright/test';
import { expandSettings, goTab, noSideways, openWeeklyReview } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const at = (hh: number, mm: number) => new Date(2026, 10, 1, hh, mm, 0); // Sunday 1 November, this computer's clock

const step = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'inbox', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 20, estBy: 'samy', spent: 0, sessions: [], status: 'open',
  doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T09:00:00Z', src: 'page',
  starter: '', ...o,
});
const project = (name: string, suit: string, order: number, o: Record<string, unknown> = {}) => ({ name, suit, where: 'any', goal: null, goalBy: null, due: null, order, status: 'active', ...o });
const world = () => ({
  exported: '2026-11-01T00:00:00Z', source: 'reussite-v1',
  tasks: {
    th0: step('Open the draft and write the introduction', { project: 'thesis', order: 0, status: 'done', doneDay: '2026-10-28', doneAt: '2026-10-28T10:00:00.000Z', advances: true }),
    th1: step('Open the draft and read page one', { project: 'thesis', order: 1, advances: true }),
    th2: step('Open the draft and fix the references', { project: 'thesis', order: 2 }),
    th3: step('Open Mail and tidy the supervisor’s old threads', { project: 'thesis', order: 3, advances: false }),
    fl1: step('Open Mail and ask the agency for the keys date', { project: 'flat', suit: 'C', order: 1, est: 10 }),
    fl2: step('Open Calendar and block the move day', { project: 'flat', suit: 'C', order: 2, est: 5 }),
  },
  projects: {
    inbox: project('Inbox', 'S', 99),
    thesis: project('Thesis', 'S', 1, { goal: 'Hand in the draft', outcome: 'Hand in the draft', measure: { kind: 'count', target: 10, unit: 'pages' }, start: '2026-10-01', due: '2026-12-15' }),
    flat: project('Flat move', 'C', 2),
  },
  days: {}, decisions: {}, meta: { settings: {} },
});

const thesisReply = {
  note: 'The goal is clear; the dates are tight.',
  check: [{ part: 'outcome', ok: false, line: 'Says what, not how much' }, { part: 'measure', ok: true, line: 'Ten pages is countable' }, { part: 'dates', ok: true }],
  outcome: 'Hand in ten pages of the draft by 15 December',
  steps: [
    { id: 'th1', belongs: true, moves: true, line: 'A page of the ten' },
    { id: 'th2', belongs: true, moves: true, line: 'Fixes a page' },
    { id: 'th3', belongs: false, moves: false, line: 'Housekeeping' },
  ],
  drop: [{ id: 'th3', line: 'Not part of the draft' }],
  add: [{ title: 'Open the draft and write page two', starter: 'Open the draft', est: 25, moves: true, line: 'Nothing writes page two yet' }],
};
const flatReply = {
  note: 'No way to tell it is reached.',
  check: [{ part: 'outcome', ok: false, line: 'No sentence yet' }, { part: 'measure', ok: false, line: 'No bar' }],
  outcome: 'Be in the new flat by 31 January',
  measure: { kind: 'milestones', items: ['Keys collected', 'Boxes moved'] },
  steps: [{ id: 'fl1', belongs: true, moves: true, line: 'Keys come first' }, { id: 'fl2', belongs: true, moves: false }],
};

type Wire = { messages: { role: string; content: string | { type: string; text: string }[] }[] };
/** Answer each AI call with the next reply (the last repeats); returns the request bodies seen. */
async function stub(page: Page, ...replies: (object | string | number)[]) {
  const seen: Wire[] = [];
  await page.route(OPENROUTER, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    seen.push(route.request().postDataJSON());
    const r = replies[Math.min(seen.length - 1, replies.length - 1)]!;
    if (typeof r === 'number') return route.fulfill({ status: r, headers: { ...cors, 'content-type': 'application/json' }, body: '{"error":{"message":"down"}}' });
    await route.fulfill({
      status: 200, headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ choices: [{ message: { content: typeof r === 'string' ? r : JSON.stringify(r) } }], usage: { prompt_tokens: 3000, completion_tokens: 400, cost: 0.01 } }),
    });
  });
  return seen;
}
const userOf = (w: Wire) => w.messages[1]!.content as string;

async function start(page: Page, o: { ai?: boolean } = {}) {
  await page.clock.setFixedTime(at(10, 0));
  await page.goto('/#settings');
  await expandSettings(page);
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world())) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  if (o.ai !== false) {
    await page.getByTestId('ai-openai').click();
    await page.getByTestId('ai-key').fill('sk-or-test');
    await page.getByTestId('ai-key-save').click();
    await expect(page.getByTestId('ai-settings')).toContainText('A key is saved.');
  }
}
const card = (page: Page, name: string) => page.locator('article.proj', { hasText: name });
const line = (page: Page, name: string) => card(page, name).getByTestId('goal-line');
async function openGoalsAi(page: Page) {
  await goTab(page, 'settings');
  await page.getByTestId('start-review-ai').click();
}
async function markDone(page: Page, project: string, title: string, asked = false) {
  await goTab(page, 'projects');
  const c = card(page, project);
  if (!(await c.locator('details').first().evaluate(d => (d as HTMLDetailsElement).open))) await c.locator('details > summary').first().click();
  await c.locator('ol.steps li', { hasText: title }).getByRole('button', { name: title }).click();
  await sheet(page).getByRole('button', { name: 'Mark done' }).click();
  await sheet(page).getByRole('button', { name: 'I didn’t time it' }).click();
  // A step that moves a goal with a count asks how much it added; closing the question keeps +1.
  if (asked) await sheet(page).getByRole('button', { name: /Keep \+1/ }).click();
  await expect(sheet(page)).toBeHidden();
}
/** The Goals screen of the project on screen is reached by tapping Next from the questions before it. */
async function toGoals(page: Page) {
  await openWeeklyReview(page);
  for (let i = 0; i < 4; i++) await page.getByTestId('rv-next').click();
  await expect(page.getByTestId('rv-4')).toBeVisible();
}

test('by hand: each project’s goal, then each open step; the answers are the steps’ own, and the bar follows', async ({ page }) => {
  await start(page, { ai: false });
  await goTab(page, 'projects');
  await expect(line(page, 'Thesis')).toHaveText('1 of 10 pages');
  await toGoals(page);
  // The goal: its sentence, its bar, its dates. One question per screen.
  const goal = page.getByTestId('rv-goal');
  await expect(goal).toHaveAttribute('data-project', /.+/);
  await expect(page.getByTestId('goal-sentence')).toHaveText('Hand in the draft');
  await expect(page.getByTestId('goal-bar')).toHaveText('1 of 10 pages');
  await page.getByTestId('rv-goal-still').click();
  // The steps: Moves the goal? as it stands (Yes for the one answered yes, No for the one answered no, none for the one never answered).
  await expect(page.getByTestId('rv-moves')).toBeVisible();
  const row = (title: string) => page.getByTestId('rv-move').filter({ hasText: title });
  await expect(row('read page one').getByTestId('rv-move-yes')).toHaveAttribute('aria-pressed', 'true');
  await expect(row('tidy the supervisor').getByTestId('rv-move-no')).toHaveAttribute('aria-pressed', 'true');
  await expect(row('fix the references').getByTestId('rv-move-yes')).toHaveAttribute('aria-pressed', 'false');
  await expect(row('fix the references').getByTestId('rv-move-no')).toHaveAttribute('aria-pressed', 'false');
  await expect(row('fix the references')).toContainText('Not said');
  // Answer: the references move the goal; page one does not.
  await row('fix the references').getByTestId('rv-move-yes').click();
  await row('read page one').getByTestId('rv-move-no').click();
  await expect(row('fix the references').getByTestId('rv-move-yes')).toHaveAttribute('aria-pressed', 'true');
  await expect(row('read page one').getByTestId('rv-move-no')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('rv-next').click();

  // The flat has no goal yet: Edit writes one in the screen.
  await expect(page.getByTestId('goal-sentence')).toContainText('No goal yet');
  await expect(page.getByTestId('goal-nobar')).toBeVisible();
  await page.getByTestId('rv-goal-edit').click();
  await sheet(page).getByTestId('goal-outcome').fill('Be in the new flat by January');
  await sheet(page).getByTestId('goal-outcome').press('Tab');
  await page.getByTestId('rv-goal-edit').click();
  await expect(page.getByTestId('goal-sentence')).toHaveText('Be in the new flat by January');
  await page.getByTestId('rv-goal-still').click();
  // No bar: the steps are still asked, with a word that the answers wait.
  await expect(page.getByTestId('rv-moves')).toContainText('no bar yet');
  await page.getByTestId('rv-next').click();
  // Back on the usual questions.
  await expect(page.getByTestId('rv-8')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // The answers are the steps’ own: the references now fill the bar when done, page one no longer does.
  await markDone(page, 'Thesis', 'fix the references', true);
  await expect(line(page, 'Thesis')).toHaveText('2 of 10 pages');
  await markDone(page, 'Thesis', 'read page one');
  await expect(line(page, 'Thesis')).toHaveText('2 of 10 pages');
});

test('by hand: Close it asks whether the goal was reached or let go, and skips that project’s steps', async ({ page }) => {
  await start(page, { ai: false });
  await toGoals(page);
  await page.getByTestId('rv-goal-still').click();
  await page.getByTestId('rv-next').click();
  await page.getByTestId('rv-goal-closeit').click();
  await expect(page.getByTestId('rv-goal-close')).toBeVisible();
  await page.getByTestId('rv-goal-reached').click();
  // The two screens of the flat were one (the goal, then its steps): closing goes past the steps.
  await expect(page.getByTestId('rv-8')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await goTab(page, 'projects');
  await expect(page.locator('article.proj', { hasText: 'Flat move' })).toHaveCount(0);
  await expect(page.locator('main')).toContainText('Closed (1)');
});

test('with an AI: the review of a goal is a proposal; flip one answer, skip one, and the one change-set is confirmed on the review screen', async ({ page }) => {
  const seen = await stub(page, thesisReply, flatReply);
  await start(page);
  await goTab(page, 'projects');
  await expect(line(page, 'Thesis')).toHaveText('1 of 10 pages');
  await openGoalsAi(page);

  // "Show me what's sent": the goal, its measure and the open steps of this project, each with its present answer.
  await expect(page.getByTestId('ai-preview')).toBeVisible();
  await expect(page.getByTestId('ai-user')).toContainText('measure: count, 1 of 10 pages');
  await expect(page.getByTestId('ai-user')).toContainText('read page one');
  await expect(page.getByTestId('ai-user')).toContainText('not said');
  await expect(page.getByTestId('ai-user')).not.toContainText('agency');
  await page.getByTestId('ai-send').click();

  // Thesis, first: the check, the proposals, the steps.
  const ai = page.getByTestId('goalai');
  await expect(ai).toBeVisible();
  await expect(page.getByTestId('goalai-note')).toContainText('dates are tight');
  await expect(page.getByTestId('goalai-check-outcome')).toHaveAttribute('data-ok', 'no');
  await expect(page.getByTestId('goalai-check-measure')).toHaveAttribute('data-ok', 'yes');
  const prop = (key: string) => page.locator(`[data-testid=goalai-prop][data-key="${key}"]`);
  await expect(prop('outcome')).toContainText('Hand in ten pages of the draft by 15 December');
  await expect(prop('outcome')).toContainText('Hand in the draft →');
  await expect(prop('drop:th3')).toContainText('tidy the supervisor');
  await expect(prop('new:1')).toContainText('write page two');
  const row = (id: string) => page.locator(`[data-testid=goalai-step][data-task=${id}]`);
  await expect(row('th1')).toHaveAttribute('data-moves', 'yes');
  await expect(row('th2')).toHaveAttribute('data-moves', 'yes');
  await expect(row('th2')).toContainText('Now: Not said');
  await expect(row('th3')).toHaveAttribute('data-moves', 'no');
  await expect(row('th3')).toContainText('Doesn’t belong to this goal');
  expect(await ai.innerText()).not.toMatch(/\b(card|suit)s?\b/i);

  // Flip the references to "No"; skip the proposal to drop the old threads.
  await row('th2').getByTestId('goalai-moves-no').click();
  await expect(row('th2')).toHaveAttribute('data-moves', 'no');
  await prop('drop:th3').getByTestId('goalai-skip').click();
  await expect(prop('drop:th3')).toHaveAttribute('data-state', 'skipped');
  // Nothing is written yet.
  expect(seen).toHaveLength(1);

  // The flat, second: its own request. Keep both proposals.
  await page.getByTestId('goalai-next').click();
  await expect(page.getByTestId('goalai-note')).toContainText('No way to tell');
  expect(seen).toHaveLength(2);
  expect(userOf(seen[1]!)).toContain('fl1');
  expect(userOf(seen[1]!)).not.toContain('read page one');
  await expect(prop('measure')).toContainText('Keys collected, Boxes moved');
  await expect(prop('outcome')).toContainText('Be in the new flat by 31 January');

  await page.getByTestId('goalai-make').click();
  const review = page.getByTestId('review');
  await expect(review).toBeVisible();
  // The project’s outcome, the new step, the references left alone (flipped to No = as it was), the threads kept, the flat’s measure and answers.
  await expect(review).toContainText('Hand in ten pages of the draft by 15 December');
  await expect(review).toContainText('write page two');
  await expect(review).toContainText('Keys collected');
  await expect(review).not.toContainText('tidy the supervisor');
  await expect(review).not.toContainText('fix the references');
  await page.getByTestId('apply-changes').click();
  await expect(page.getByTestId('goalai-done')).toBeVisible();

  // The bars follow: page one still moves the goal, the references no longer do, and the new page-two step does.
  await page.getByTestId('goalai-close').click();
  await goTab(page, 'projects');
  await expect(line(page, 'Thesis')).toHaveText('1 of 10 pages');
  await markDone(page, 'Thesis', 'read page one', true);
  await expect(line(page, 'Thesis')).toHaveText('2 of 10 pages');
  await markDone(page, 'Thesis', 'fix the references');
  await expect(line(page, 'Thesis')).toHaveText('2 of 10 pages');
  await markDone(page, 'Thesis', 'write page two', true);
  await expect(line(page, 'Thesis')).toHaveText('3 of 10 pages');
  await expect(card(page, 'Thesis')).toContainText('Hand in ten pages of the draft by 15 December');
  await expect(line(page, 'Flat move')).toHaveText('0 of 2 milestones');
  // The change-set joined Home's receipt, with its Undo.
  await goTab(page, 'home');
  await expect(page.getByTestId('receipt')).toBeVisible();
});

test('a proposal never writes without the yes: cancelling the review leaves the list as it was', async ({ page }) => {
  await stub(page, thesisReply, flatReply);
  await start(page);
  await openGoalsAi(page);
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('goalai')).toBeVisible();
  await page.getByTestId('goalai-next').click();
  await page.getByTestId('goalai-make').click();
  await expect(page.getByTestId('review')).toBeVisible();
  await page.getByTestId('review').getByRole('button', { name: 'Cancel' }).click();
  // Back in the conversation, with the choices still there.
  await expect(page.getByTestId('goalai')).toBeVisible();
  await page.keyboard.press('Escape');
  await goTab(page, 'projects');
  await expect(card(page, 'Thesis')).not.toContainText('ten pages of the draft');
  await expect(card(page, 'Thesis')).toContainText('Hand in the draft');
  await expect(line(page, 'Flat move')).toHaveCount(0);
  await expect(card(page, 'Thesis')).toContainText('tidy the supervisor');
});

test('a short exchange adjusts a project: what was skipped is told to the AI, and the revised proposal replaces the old', async ({ page }) => {
  const revised = { ...thesisReply, note: 'Smaller, as asked.', outcome: 'Hand in five pages by 15 December', add: [] };
  const seen = await stub(page, thesisReply, revised);
  await start(page);
  await openGoalsAi(page);
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('goalai-note')).toContainText('dates are tight');
  await page.locator('[data-testid=goalai-prop][data-key="drop:th3"]').getByTestId('goalai-skip').click();
  await page.getByTestId('goalai-say').fill('Make the goal smaller');
  await page.getByTestId('goalai-adjust').click();
  await expect(page.getByTestId('goalai-note')).toContainText('Smaller, as asked.');
  expect(seen).toHaveLength(2);
  expect(userOf(seen[1]!)).toContain('They say: Make the goal smaller');
  expect(userOf(seen[1]!)).toContain('never offer them again: drop th3');
  expect(userOf(seen[1]!)).toContain('th1 moves it');
  await expect(page.locator('[data-testid=goalai-prop][data-key="outcome"]')).toContainText('five pages');
  await expect(page.locator('[data-testid=goalai-prop][data-key="new:1"]')).toHaveCount(0);
});

test('a reply that is not usable still leaves the steps to answer, with the review by hand one tap away', async ({ page }) => {
  await stub(page, 500, 500);
  await start(page);
  await openGoalsAi(page);
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('ai-error')).toBeVisible();
  const row = (id: string) => page.locator(`[data-testid=goalai-step][data-task=${id}]`);
  await expect(row('th1')).toHaveAttribute('data-moves', 'yes');
  await expect(row('th2')).toHaveAttribute('data-moves', 'no');
  await row('th2').getByTestId('goalai-moves-yes').click();
  await page.getByTestId('goalai-next').click();
  await page.getByTestId('goalai-make').click();
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.getByTestId('review')).toContainText('fix the references');
  await page.getByTestId('review').getByRole('button', { name: 'Cancel' }).click();
  await page.getByTestId('goalai-myself').click();
  await expect(page.getByTestId('rv-0')).toBeVisible();
});

test('on the review day the banner opens the conversation with an AI, and the questions without', async ({ page }) => {
  await stub(page, thesisReply);
  await start(page);
  await goTab(page, 'today');
  await page.getByTestId('review-card').getByRole('button', { name: 'Start the review' }).click();
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('goalai')).toBeVisible();
});

test('the banner without an AI opens the questions', async ({ page }) => {
  await start(page, { ai: false });
  await goTab(page, 'today');
  await page.getByTestId('review-card').getByRole('button', { name: 'Start the review' }).click();
  await expect(page.getByTestId('rv-0')).toBeVisible();
  await expect(page.getByTestId('goalai')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await goTab(page, 'settings');
  await expect(page.getByTestId('start-review-ai')).toHaveCount(0);
});

for (const width of [320, 375, 430]) {
  test(`nothing scrolls sideways at ${width} px: the goal, its steps, the editor, the request, the proposal and the review`, async ({ page }) => {
    await stub(page, thesisReply, flatReply);
    await page.setViewportSize({ width, height: 800 });
    await start(page);
    await toGoals(page);
    await noSideways(page, `goal at ${width}`);
    await page.getByTestId('rv-goal-edit').click();
    await noSideways(page, `goal editor at ${width}`);
    await page.getByTestId('rv-goal-edit').click();
    await page.getByTestId('rv-goal-closeit').click();
    await noSideways(page, `close at ${width}`);
    await page.getByTestId('rv-goal-still').click();
    await noSideways(page, `steps at ${width}`);
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    await openGoalsAi(page);
    await expect(page.getByTestId('ai-preview')).toBeVisible();
    await noSideways(page, `request at ${width}`);
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('goalai-note')).toBeVisible();
    await noSideways(page, `proposal at ${width}`);
    await page.locator('[data-testid=goalai-prop][data-key="drop:th3"]').getByTestId('goalai-skip').click();
    await noSideways(page, `skipped at ${width}`);
    await page.getByTestId('goalai-next').click();
    await expect(page.getByTestId('goalai-note')).toContainText('No way to tell');
    await page.getByTestId('goalai-make').click();
    await expect(page.getByTestId('review')).toBeVisible();
    await noSideways(page, `review at ${width}`);
    await page.getByTestId('apply-changes').click();
    await expect(page.getByTestId('goalai-done')).toBeVisible();
    await noSideways(page, `done at ${width}`);
  });
}
