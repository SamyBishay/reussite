// The morning with an AI (plan 2 Nov, S4, "Morning" point 3): the AI proposes the day in five sections, the person keeps, swaps or skips each
// item, a short exchange adjusts it, and it ends in one change-set on the review screen. OpenRouter is stubbed; every name here is invented.
// The clock is fixed to a Monday morning so nothing depends on the hour.
import { test, expect, type Page, type Route } from '@playwright/test';
import { expandSettings, goTab, noSideways } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const D = '2026-11-02';
const at = (hh: number, mm: number) => new Date(2026, 10, 2, hh, mm, 0); // Monday 2 November, this computer's clock

const step = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'inbox', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 20, estBy: 'samy', spent: 0, sessions: [], status: 'open',
  doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T09:00:00Z', src: 'page',
  starter: '', ...o,
});
const project = (name: string, suit: string, order: number, o: Record<string, unknown> = {}) => ({ name, suit, where: 'any', goal: null, goalBy: null, due: null, order, status: 'active', ...o });
const world = () => ({
  exported: '2026-11-01T00:00:00Z', source: 'reussite-v1',
  tasks: {
    tax: step('Open the tax site and file the form', { suit: 'D', due: D, urgent: true, est: 30, starter: 'Open the tax site' }),
    dent: step('Dentist', { at: '14:00', dur: 60, due: D, important: false, est: 60 }),
    th1: step('Open the draft and read page one', { project: 'thesis', order: 1, starter: 'Open the draft' }),
    th2: step('Open the draft and fix the references', { project: 'thesis', order: 2 }),
    fl1: step('Open Mail and ask the agency for the keys date', { project: 'flat', suit: 'C', order: 1, est: 10 }),
    fl2: step('Open Calendar and block the move day', { project: 'flat', suit: 'C', order: 2, est: 5 }),
    work1: step('Open the lab notes and tidy the figures', { order: 1 }),
    fam1: step('Open Messages and text Mum about Sunday', { suit: 'C', order: 2, est: 10 }),
    fam2: step('Open Calendar and book the family lunch', { suit: 'C', order: 3, est: 10 }),
    life1: step('Open Maps and find a pool to swim in', { suit: 'H', order: 1, est: 30 }),
    shop1: step('Open the shopping list and buy printer paper', { suit: 'D', where: 'office', order: 1 }),
  },
  projects: {
    inbox: project('Inbox', 'S', 99), thesis: project('Thesis', 'S', 1, { goal: 'Hand in the draft', due: '2026-12-15' }), flat: project('Flat move', 'C', 2),
  },
  days: {}, decisions: {}, meta: { settings: { here: 'office' } },
});

const reply1 = {
  note: 'Dentist at 14:00 and the tax form today; the rest fits around them.',
  must: [{ id: 'tax', line: 'Due today' }],
  goals: [{ project: 'thesis', id: 'th1', line: 'The draft is due in six weeks' }, { project: 'flat', id: 'fl1', line: 'The agency closes at five' }],
  pillars: [
    { suit: 'S', id: 'work1', line: 'A short one for work' },
    { suit: 'D', new: { title: 'Open the bank site and check the transfer', starter: 'Open the bank site', est: 10 }, line: 'Nothing waiting for papers yet' },
    { suit: 'C', id: 'fam1', line: 'For family: text Mum about Sunday' },
    { suit: 'H', id: 'life1', line: 'A swim clears the head' },
  ],
  here: [{ id: 'shop1', line: 'You are at the office: paper is on the list' }],
  first: 'tax',
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

async function start(page: Page, o: { ai?: boolean; world?: object } = {}) {
  await page.clock.setFixedTime(at(8, 0));
  await page.goto('/#settings');
  await expandSettings(page);
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(o.world ?? world())) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  if (o.ai !== false) {
    await page.getByTestId('ai-openai').click();
    await page.getByTestId('ai-key').fill('sk-or-test');
    await page.getByTestId('ai-key-save').click();
    await expect(page.getByTestId('ai-settings')).toContainText('A key is saved.');
  }
  await goTab(page, 'home');
}
/** Home's "Plan the day", the AI's request let through, and the proposal on screen. */
async function openMorning(page: Page, button = 'home-plan-ai') {
  await page.getByTestId(button).click();
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('morning-note')).toBeVisible();
}
const item = (page: Page, key: string) => page.locator(`[data-testid=morning-item][data-key=${key}]`);

test('the five sections show; skip a pillar item, swap a goal’s first step, accept the change-set, and Today shows the plan in the day’s order', async ({ page }) => {
  const seen = await stub(page, reply1);
  await start(page);
  // The dentist is already Start here, and the plan is one tap away.
  await expect(page.getByTestId('home-plan-ritual')).toHaveCount(0);
  await page.getByTestId('home-plan-ai').click();
  // "Show me what's sent": the five sections go out as candidates, with the person's own names for the pillars.
  await expect(page.getByTestId('ai-preview')).toBeVisible();
  await expect(page.getByTestId('ai-user')).toContainText('1. Must happen');
  await expect(page.getByTestId('ai-user')).toContainText('S = Work; D = Papers; C = Family; H = Life');
  await page.getByTestId('ai-send').click();

  await expect(page.getByTestId('morning-note')).toContainText('Dentist at 14:00');
  for (const s of ['must', 'goals', 'pillars', 'here', 'total']) await expect(page.getByTestId('morning-' + s)).toBeVisible();
  // What has to happen: the dentist (fixed, not a choice) and the tax form, with the AI's wording.
  await expect(page.getByTestId('morning-must')).toContainText('Dentist');
  await expect(item(page, 'dent')).toHaveAttribute('data-state', 'fixed');
  await expect(item(page, 'dent').getByTestId('morning-skip')).toHaveCount(0);
  await expect(item(page, 'tax')).toContainText('Due today');
  // The goals: two projects, each with the step to start with.
  await expect(page.getByTestId('morning-goals')).toContainText('Thesis');
  await expect(page.getByTestId('morning-goals')).toContainText('Open the draft and read page one');
  await expect(page.getByTestId('morning-goals')).toContainText('Flat move');
  // One for each pillar, under the person's own names; Papers has a new step the AI wrote.
  for (const [s, name] of [['S', 'Work'], ['D', 'Papers'], ['C', 'Family'], ['H', 'Life']]) await expect(page.getByTestId('morning-pillar-' + s)).toContainText(name!);
  await expect(page.getByTestId('morning-pillar-D')).toContainText('Open the bank site and check the transfer');
  await expect(page.getByTestId('morning-pillar-D').getByTestId('morning-new')).toBeVisible();
  await expect(page.getByTestId('morning-pillar-C')).toContainText('For family: text Mum about Sunday');
  await expect(page.getByTestId('morning-here')).toContainText('buy printer paper');
  // The jargon of the app is not in what the person reads.
  expect(await page.getByTestId('morning').innerText()).not.toMatch(/\b(card|suit)s?\b/i);
  await expect(page.getByTestId('morning-first')).toContainText('Open the tax site');
  const free = await page.getByTestId('morning-free').innerText();
  expect(free).toMatch(/^.+ of .+ free\.$/);

  // Skip the life pillar's item: it stays on the screen, struck out, and the planned time drops.
  await item(page, 'life1').getByTestId('morning-skip').click();
  await expect(item(page, 'life1')).toHaveAttribute('data-state', 'skipped');
  expect(await page.getByTestId('morning-free').innerText()).not.toBe(free);
  // Swap the thesis' first step for its second.
  await item(page, 'th1').getByTestId('morning-swap-btn').click();
  await expect(page.getByTestId('morning-swap')).toContainText('Open the draft and fix the references');
  await page.getByTestId('morning-swap-choose').first().click();
  await expect(item(page, 'th2')).toBeVisible();
  await expect(item(page, 'th1')).toHaveCount(0);

  // The plan: one change-set on the review screen, with what was skipped left out.
  await page.getByTestId('morning-make').click();
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.getByTestId('review')).toContainText('Open the bank site and check the transfer');
  await expect(page.getByTestId('review')).not.toContainText('find a pool');
  await page.getByTestId('apply-changes').click();
  await expect(sheet(page)).toBeHidden();
  expect(seen).toHaveLength(1);

  // Home shows the receipt with Undo and no longer offers the plan; Today lists the day in its order.
  await expect(page.getByTestId('receipt')).toBeVisible();
  await expect(page.getByTestId('home-plan-ai')).toHaveCount(0);
  await goTab(page, 'today');
  const titles = await page.getByTestId('plan-list').locator('[data-task]').allInnerTexts();
  // The first step is Start here, above the list.
  const order = [
    'Open the draft and fix the references', 'Open Mail and ask the agency', 'buy printer paper',
    'tidy the figures', 'Open the bank site', 'text Mum about Sunday', 'Dentist',
  ];
  expect(titles.map(x => order.findIndex(o => x.includes(o)))).toEqual(order.map((_, i) => i));
  await expect(page.getByTestId('plan-list')).not.toContainText('find a pool');
  await expect(page.getByTestId('first')).toContainText('Open the tax site');
});

test('a short exchange adjusts it: what was skipped does not come back, and the AI’s cut shows struck out', async ({ page }) => {
  const reply2 = { ...reply1, note: 'Lighter: the paper can wait.', must: [{ id: 'tax' }], pillars: [...reply1.pillars], here: [{ id: 'shop1', cut: true, line: 'Can wait' }],
    goals: reply1.goals, first: 'tax' };
  // The AI offers fam1 again; the person skipped it, so it does not come back.
  reply2.pillars = reply1.pillars.map(p => (p.suit === 'C' ? { suit: 'C', id: 'fam1', line: 'again' } : p));
  const seen = await stub(page, reply1, reply2);
  await start(page);
  await openMorning(page);
  await item(page, 'fam1').getByTestId('morning-skip').click();
  await page.getByTestId('morning-say').fill('Lighter on the errands');
  await page.getByTestId('morning-adjust').click();
  await expect(page.getByTestId('morning-note')).toContainText('Lighter: the paper can wait.');
  expect(seen).toHaveLength(2);
  const u2 = userOf(seen[1]!);
  expect(u2).toContain('They say: Lighter on the errands');
  expect(u2).toContain('Skipped, so never offer them again: fam1');
  expect(u2).toMatch(/Kept: .*tax/);
  // fam1 is not offered again (the family pillar offers its next one or nothing); the cut item is left out, with a way back.
  await expect(item(page, 'fam1')).toHaveCount(0);
  await expect(item(page, 'shop1')).toHaveAttribute('data-state', 'skipped');
  await item(page, 'shop1').getByTestId('morning-keep').click();
  await expect(item(page, 'shop1')).toHaveAttribute('data-state', 'kept');
  // The tap targets for the common adjustments ask the AI too.
  await page.getByTestId('morning-toomuch').click();
  await expect(page.getByTestId('morning-note')).toBeVisible();
  expect(seen).toHaveLength(3);
  expect(userOf(seen[2]!)).toContain('That is too much');
});

test('a reply that is not usable still leaves the five sections, with a way to the ritual', async ({ page }) => {
  await stub(page, 500);
  await start(page);
  await page.getByTestId('home-plan-ai').click();
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('ai-error')).toBeVisible();
  for (const s of ['must', 'goals', 'pillars', 'here']) await expect(page.getByTestId('morning-' + s)).toBeVisible();
  await expect(item(page, 'tax')).toHaveAttribute('data-state', 'kept');
  await page.getByRole('button', { name: 'Plan it myself' }).first().click();
  await expect(page.getByTestId('ci-shape')).toBeVisible();
});

test('an empty day: Plan the day opens the conversation, and the ritual is one tap away', async ({ page }) => {
  const w = world();
  const empty = { ...w, tasks: Object.fromEntries(Object.entries(w.tasks).filter(([id]) => id !== 'dent')) };
  await stub(page, reply1);
  await start(page, { world: empty });
  await expect(page.getByTestId('home-plan')).toBeVisible();
  await page.getByTestId('home-plan-ritual').click();
  await expect(page.getByTestId('ci-shape')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('home-plan').click();
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('morning')).toBeVisible();
  // "Plan it myself" from inside the conversation.
  await page.getByTestId('morning-ritual').click();
  await expect(page.getByTestId('ci-shape')).toBeVisible();

});

test('with no AI set up, Plan the day on Home opens the ritual', async ({ page }) => {
  const w = world();
  await start(page, { ai: false, world: { ...w, tasks: Object.fromEntries(Object.entries(w.tasks).filter(([id]) => id !== 'dent')) } });
  await page.getByTestId('home-plan').click();
  await expect(page.getByTestId('ci-shape')).toBeVisible();
  await expect(page.getByTestId('home-plan-ritual')).toHaveCount(0);
});

test('the morning notification (#plan) opens the conversation with an AI, and Today without', async ({ page }) => {
  await stub(page, reply1);
  await start(page);
  await page.goto('/#plan');
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('morning')).toBeVisible();
  await expect(page).not.toHaveURL(/#plan/);
});

test('the notification without an AI goes to Today as it always did', async ({ page }) => {
  await start(page, { ai: false });
  await page.goto('/#plan');
  await expect(page.getByTestId('first')).toBeVisible();
  await expect(page.getByTestId('morning')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#plan/);
});

for (const width of [320, 375, 430]) {
  test(`nothing scrolls sideways at ${width} px: the request, the proposal with a swap open, and the review`, async ({ page }) => {
    await stub(page, reply1);
    await page.setViewportSize({ width, height: 800 });
    await start(page);
    await page.getByTestId('home-plan-ai').click();
    await expect(page.getByTestId('ai-preview')).toBeVisible();
    await noSideways(page, `request at ${width}`);
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('morning-note')).toBeVisible();
    await noSideways(page, `proposal at ${width}`);
    await item(page, 'th1').getByTestId('morning-swap-btn').click();
    await expect(page.getByTestId('morning-swap')).toBeVisible();
    await noSideways(page, `swap at ${width}`);
    await page.getByTestId('morning-swap').getByRole('button', { name: 'Cancel' }).click();
    await item(page, 'life1').getByTestId('morning-skip').click();
    await noSideways(page, `skipped at ${width}`);
    await page.getByTestId('morning-make').click();
    await expect(page.getByTestId('review')).toBeVisible();
    await noSideways(page, `review at ${width}`);
  });
}
