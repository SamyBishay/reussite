import { test, expect, type Page, type Route } from '@playwright/test';
import { importSample, noSideways, goTab, calEvent } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');
const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

/** Answer AI calls with `text`; returns the requests seen. */
async function mockAnthropic(page: Page, text: string | (() => string)) {
  const seen: Record<string, unknown>[] = [];
  await page.route(ANTHROPIC, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    seen.push({ headers: route.request().headers(), body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ content: [{ type: 'text', text: typeof text === 'string' ? text : text() }], stop_reason: 'end_turn' }) });
  });
  return seen;
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

async function setUpAnthropic(page: Page) {
  await page.goto('/#settings');
  await page.getByTestId('ai-anthropic').click();
  await page.getByTestId('ai-key').fill('sk-ant-test');
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-settings')).toContainText('A key is saved.');
}

const changeSet = JSON.stringify({ v: 1, note: 'Three changes.', changes: [
  { op: 'task.update', id: 't5', set: { due: '2030-01-15' } },
  { op: 'task.drop', id: 't7' },
  { op: 'task.create', set: { title: 'Open Mail and thank the agency', project: 'p1', est: 5, w: 5 } },
] });

test('the command box is hidden until a provider is chosen; Ask any AI is always there', async ({ page }) => {
  await importSample(page);
  await expect(page.getByTestId('cmd')).toHaveCount(0);
  await expect(page.getByTestId('ask-any')).toBeVisible();
  await setUpAnthropic(page);
  await page.getByTestId('tab-matrix').click();
  await expect(page.getByTestId('cmd')).toBeVisible();
  await page.getByTestId('tab-projects').click();
  await expect(page.getByTestId('cmd')).toBeVisible();
});

test('Test the connection, through OpenRouter', async ({ page }) => {
  let auth = '';
  await page.route(OPENROUTER, async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    auth = route.request().headers()['authorization'] ?? '';
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: '{"ok": true}' } }] }) });
  });
  await page.goto('/#settings');
  await page.getByTestId('ai-openai').click();
  await expect(page.getByTestId('ai-base')).toHaveValue('https://openrouter.ai/api/v1');
  await page.getByTestId('ai-key').fill('sk-or-test');
  await page.getByTestId('ai-key-save').click();
  await page.getByTestId('ai-test').click();
  await expect(page.getByTestId('ai-test-result')).toContainText('It works');
  expect(auth).toBe('Bearer sk-or-test');
});

test('command box: what is sent is shown first, then only ticked changes are applied', async ({ page }) => {
  await importSample(page);
  await setUpAnthropic(page);
  const seen = await mockAnthropic(page, 'Sure.\n```json\n' + changeSet + '\n```');
  await page.getByTestId('tab-today').click();
  await page.getByTestId('cmd-text').fill('Alex later, drop the receipts, thank the agency');
  await page.getByTestId('cmd-go').click();
  const pv = page.getByTestId('ai-preview');
  await expect(pv).toBeVisible();
  await expect(page.getByTestId('ai-user')).toContainText('Alex later, drop the receipts');
  await expect(pv).toContainText('claude-haiku-5-5');
  await expect(pv).not.toContainText('sk-ant-test');
  expect(seen).toHaveLength(0);
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('review')).toBeVisible();
  expect(seen).toHaveLength(1);
  expect((seen[0]!.headers as Record<string, string>)['anthropic-dangerous-direct-browser-access']).toBe('true');
  await expect(page.getByTestId('chg')).toHaveCount(3);
  await expect(page.getByTestId('review')).toContainText('Three changes.');
  await page.getByTestId('chg').nth(1).getByRole('checkbox').uncheck();
  await page.getByTestId('apply-changes').click();
  await expect(sheet(page)).toBeHidden();
  await page.getByTestId('tab-matrix').click();
  await expect(page.locator('.matrix')).toContainText('thank the agency');
  await expect(page.locator('.matrix')).toContainText('scanned receipts');
  // The second call of the same kind goes straight out.
  await page.getByTestId('cmd-text').fill('again');
  await page.getByTestId('cmd-go').click();
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.getByTestId('ai-preview')).toHaveCount(0);
});

test('invalid AI output shows one sentence and writes nothing', async ({ page }) => {
  await importSample(page);
  await setUpAnthropic(page);
  await mockAnthropic(page, 'I would drop the receipts, honestly.');
  await page.getByTestId('tab-matrix').click();
  const before = await page.locator('.matrix .item').count();
  await page.getByTestId('cmd-text').fill('drop the receipts');
  await page.getByTestId('cmd-go').click();
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('ai-error')).toContainText('couldn’t be read, so nothing was changed');
  await expect(page.getByTestId('review')).toHaveCount(0);
  await expect(page.locator('.matrix .item')).toHaveCount(before);
  // The manual path: Ask any AI, with the request carried over.
  await page.getByTestId('ai-error').getByRole('button', { name: 'Ask any AI' }).click();
  await expect(page.getByTestId('ask-question')).toHaveValue('drop the receipts');
});

test('Ask any AI, then Paste the reply: only ticked changes are applied', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('ask-any').click();
  await page.getByTestId('ask-question').fill('What should I drop?');
  await page.locator('summary', { hasText: 'See the text' }).click();
  const pack = page.getByTestId('pack');
  await expect(pack).toContainText('## My question\n\nWhat should I drop?');
  await expect(pack).toContainText('fenced code block labelled reussite');
  await expect(pack).toContainText('Doctolib');
  await page.getByTestId('ask-scope').selectOption({ label: 'Project: Thesis' });
  await expect(pack).toContainText('Project p2: Thesis');
  await sheet(page).getByRole('button', { name: 'Paste the reply' }).click();
  await page.getByTestId('paste-text').fill('No block here, sorry.');
  await page.getByTestId('paste-go').click();
  await expect(page.getByTestId('paste-error')).toContainText('no change-set');
  await page.getByTestId('paste-text').fill('Here is what I suggest.\n\n```reussite\n' + changeSet + '\n```\nGood luck!');
  await page.getByTestId('paste-go').click();
  await expect(page.getByTestId('chg')).toHaveCount(3);
  await page.getByTestId('chg').nth(2).getByRole('checkbox').uncheck();
  await page.getByTestId('apply-changes').click();
  await expect(sheet(page)).toBeHidden();
  await page.getByTestId('tab-matrix').click();
  await expect(page.locator('.matrix')).not.toContainText('scanned receipts');
  await expect(page.locator('.matrix')).not.toContainText('thank the agency');
});

const standing = JSON.stringify({ v: 1, changes: [
  { op: 'task.create', set: { title: 'Choir, Hill House 602', template: true, weekdays: [1], at: '19:00', dur: 90, lead: 30 } },
  { op: 'memory.add', note: 'Choir', kind: 'topic', text: 'Rehearsal is at Hill House 602' },
] });
const notes = (page: Page) => page.evaluate(() => new Promise<{ name: string; lines: { text: string; by: string }[] }[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => {
    const all = open.result.transaction('memory').objectStore('memory').getAll();
    all.onsuccess = () => res(all.result);
  };
}));

for (const w of [320, 375, 430]) {
  test(`a pasted standing obligation and memory line: memory sits under Remember, at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await importSample(page);
    await page.getByTestId('ask-any').click();
    await sheet(page).getByRole('button', { name: 'Paste the reply' }).click();
    await page.getByTestId('paste-text').fill('```reussite\n' + standing + '\n```');
    await page.getByTestId('paste-go').click();
    await expect(page.getByTestId('chg')).toHaveCount(2);
    await expect(page.getByTestId('remember')).toContainText('Rehearsal is at Hill House 602');
    await expect(page.getByTestId('remember')).toContainText('new');
    await expect(page.getByTestId('review')).toContainText('Mon');
    await noSideways(page, 'review with memory');
    await page.getByTestId('apply-changes').click();
    await expect(sheet(page)).toBeHidden();
    const saved = await notes(page);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Choir', lines: [{ text: 'Rehearsal is at Hill House 602', by: 'ai' }] });
  });
}

for (const w of [320, 375, 430]) {
  test(`AI screens don't scroll sideways at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await importSample(page);
    await setUpAnthropic(page);
    await noSideways(page, 'settings with AI');
    await mockAnthropic(page, changeSet);
    await page.getByTestId('tab-today').click();
    await noSideways(page, 'today with the command box');
    await page.getByTestId('cmd-text').fill('Alex later');
    await page.getByTestId('cmd-go').click();
    await expect(page.getByTestId('ai-preview')).toBeVisible();
    await noSideways(page, 'what is sent');
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('review')).toBeVisible();
    await noSideways(page, 'review');
    await page.keyboard.press('Escape');
    await page.getByTestId('ask-any').click();
    await page.locator('summary', { hasText: 'See the text' }).click();
    await noSideways(page, 'ask any AI');
    await sheet(page).getByRole('button', { name: 'Paste the reply' }).click();
    await noSideways(page, 'paste the reply');
  });
}

// ---------- features 2–6 ----------
/** The AI answers whatever `answer.text` holds at the time of the call. */
async function aiSession(page: Page) {
  await importSample(page);
  await setUpAnthropic(page);
  const answer = { text: '' };
  const seen = await mockAnthropic(page, () => answer.text);
  await page.getByTestId('tab-today').click();
  return { answer, seen };
}
const userText = (seen: Record<string, unknown>[], i = -1) => String(((seen.at(i)!.body as { messages: { content: string }[] }).messages[0]!).content);
async function toPlan(page: Page) {
  await page.locator('main').getByRole('button', { name: 'Plan the day' }).click();
  await page.getByTestId('ci-next').click();
  await page.getByTestId('ci-next').click();
  await expect(page.getByTestId('plan-items')).toBeVisible();
}

test('Plan my day: a plan with two Protect steps is set aside; a valid one is used, its starters ticked first', async ({ page }) => {
  const { answer, seen } = await aiSession(page);
  await toPlan(page);
  const rulePlan = await page.getByTestId('plan-items').innerText();
  answer.text = JSON.stringify({ plan: [{ id: 't4', role: 'protect' }, { id: 't3', role: 'protect' }, { id: 't6', role: 'obligation' }], note: 'Two big ones.' });
  await page.getByTestId('ai-improve').click();
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('ai-plan-rejected')).toContainText('it had more than one Protect step, so here is the rule-based plan');
  expect(await page.getByTestId('plan-items').innerText()).toBe(rulePlan);
  expect(userText(seen)).toContain('The rule-based plan');
  expect(userText(seen)).toContain('Calibration:');

  answer.text = 'Here you go:\n' + JSON.stringify({
    plan: [{ id: 't4', role: 'protect' }, { id: 't2', role: 'carried' }, { id: 't1', role: 'carried' }, { id: 't3', role: 'carried' }, { id: 't5', role: 'carried' }, { id: 't6', role: 'obligation', at: '18:30' }],
    starters: [{ id: 't4', starter: 'Open a new chat and paste the form name' }], note: 'Protect first, while you are fresh.',
  });
  await page.getByTestId('ai-improve').click();
  await expect(page.getByTestId('ai-plan-note')).toContainText('Protect first');
  await expect(page.getByTestId('ai-plan-rejected')).toHaveCount(0);
  await expect(page.getByTestId('plan-items').locator('li').nth(1)).toContainText('tax form');
  await expect(page.getByTestId('plan-items')).toContainText('18:30');
  // Nothing is written until ticked.
  await page.getByTestId('ai-plan-review').click();
  await expect(page.getByTestId('chg')).toHaveCount(1);
  await expect(page.getByTestId('review')).toContainText('Open a new chat and paste the form name');
  await page.getByTestId('apply-changes').click();
  await expect(page.getByTestId('ai-plan-review')).toHaveCount(0);
  await page.getByTestId('go-with-this').click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByTestId('first')).toContainText('tax form');
});

test('Break it down: proposed steps are ticked and edited before saving', async ({ page }) => {
  const { answer, seen } = await aiSession(page);
  answer.text = JSON.stringify({ steps: [
    { title: 'Open Mail and find the agency’s address', starter: 'Tap the Mail icon', est: 3 },
    { title: 'Attach the signed lease', est: 5 },
    { title: 'Ask for a receipt', est: 2 },
  ], note: 'Three small steps.' });
  await page.locator('.row:not(.done)', { hasText: 'signed lease' }).getByTestId('details').click();
  await sheet(page).getByRole('button', { name: 'Break it down' }).click();
  await page.getByTestId('ai-breakdown').click();
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('ai-step')).toHaveCount(3);
  expect(userText(seen)).toContain('Calibration:');
  await expect(page.getByTestId('bd-ai')).toContainText('AI’s estimate');
  await page.getByTestId('ai-step').nth(2).getByRole('checkbox').uncheck();
  await page.getByTestId('ai-step').nth(1).getByLabel('title').fill('Attach the signed lease as a PDF');
  await page.getByTestId('ai-bd-save').click();
  await expect(page.locator('.toast')).toContainText('Broken down: 2 steps.');
  await page.getByTestId('tab-matrix').click();
  await expect(page.locator('.matrix')).toContainText('Open Mail and find the agency’s address');
  // The steps are in this order, so one card: the second is inside it, under "+1 after".
  await page.locator('.matrix').getByTestId('chain-toggle').click();
  await expect(page.locator('.matrix')).toContainText('Attach the signed lease as a PDF');
  await expect(page.locator('.matrix')).not.toContainText('Ask for a receipt');
});

test('Decision help drafts the problem, options and items, and never weights', async ({ page }) => {
  const { answer } = await aiSession(page);
  await goTab(page, 'projects');
  await page.getByTestId('new-decision').click();
  answer.text = JSON.stringify({ title: 'Stay or move?', problem: { what: 'Rent goes up 8% in January', should: 'Rent under a third of income', gap: '60 a month short' } });
  await page.getByTestId('ai-dw-describe').fill('My rent goes up and I’m not sure whether to move.');
  await page.getByTestId('ai-dw-problem').click();
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('chg')).toHaveCount(4);
  await page.getByTestId('chg').nth(3).getByRole('checkbox').uncheck();
  await page.getByTestId('apply-changes').click();
  await expect(page.getByTestId('dw-prob-what')).toHaveValue('Rent goes up 8% in January');
  await expect(page.getByTestId('dw-prob-should')).toHaveValue('Rent under a third of income');
  await expect(page.getByTestId('dw-prob-gap')).toHaveValue('');
  await expect(page.getByTestId('dw-title')).toHaveValue('Stay or move?');
  await page.getByTestId('dw-next').click();
  for (const o of ['Stay', 'Move']) { await page.getByTestId('dw-option').fill(o); await page.getByTestId('dw-option').press('Enter'); }
  answer.text = JSON.stringify({ options: [{ name: 'Stay' }, { name: 'Ask the landlord to cap the rise', w: 5 }] });
  await page.getByTestId('ai-dw-options').click();
  await expect(page.getByTestId('chg')).toHaveCount(1);
  await page.getByTestId('apply-changes').click();
  await expect(sheet(page)).toContainText('Ask the landlord to cap the rise');
  await page.getByTestId('dw-close-list').click();
  answer.text = JSON.stringify({ options: [{ name: 'Stay', pros: [{ text: 'No move to organise', w: 5, weight: 5 }], cons: ['Rent keeps rising'], prosNot: [], consNot: [] }], weights: { Stay: 5 } });
  await page.getByTestId('ai-dw-items').click();
  await expect(page.getByTestId('chg')).toHaveCount(2);
  await page.getByTestId('apply-changes').click();
  const item = sheet(page).locator('.items-w > li').filter({ hasText: /^No move to organise/ });
  await expect(item).toContainText('suggested');
  await expect(item.getByRole('group', { name: 'Weight of No move to organise' }).locator('[aria-pressed=true]')).toHaveText('3');
  await expect(sheet(page).locator('.items-w > li').filter({ hasText: /^Rent keeps rising/ }).locator('[aria-pressed=true]')).toHaveText('3');
  // Setting the weight makes it the person's.
  await item.getByRole('button', { name: 'Weight 5' }).click();
  await expect(item).not.toContainText('suggested');
});

test('Stuck: the AI proposes a smaller starter, which the person can edit', async ({ page }) => {
  const { answer } = await aiSession(page);
  answer.text = JSON.stringify({ starter: 'Open Doctolib and type “dentist”', note: 'Just the search.' });
  await page.getByTestId('stuck').first().click();
  await sheet(page).getByRole('button', { name: /Can’t start/ }).click();
  await page.getByTestId('ai-stuck').click();
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('stuck-smaller')).toHaveValue('Open Doctolib and type “dentist”');
  await expect(page.getByTestId('stuck-ai-note')).toContainText('Just the search.');
  await page.getByTestId('stuck-smaller').fill('Open Doctolib');
  await page.getByTestId('stuck-restart').click();
  await expect(page.locator('.toast')).toContainText('Back on it');
});

async function toProjects(page: Page) {
  await page.getByTestId('tab-calendar').click();
  await page.getByTestId('cal-week').click();
  await calEvent(page, 'Weekly review').first().click();
  for (let i = 0; i < 3; i++) await page.getByTestId('rv-next').click();
  await expect(page.getByTestId('rv-3')).toBeVisible();
}

test('Sunday review help: a proposed SMART goal and next step, confirmed by the person', async ({ page }) => {
  const { answer } = await aiSession(page);
  answer.text = JSON.stringify({ goal: 'Method section drafted by November 15', smart: { specific: 'Draft the method section', dated: 'November 15' }, next: [{ title: 'Open the thesis draft and list the method subsections', est: 10 }], note: 'One goal, one step.' });
  await toProjects(page);
  const proj = page.locator('details.proj-rv', { hasText: 'Thesis' });
  await proj.locator('summary').click();
  await proj.getByTestId('ai-review').click();
  await page.getByTestId('ai-send').click();
  await expect(proj.getByTestId('chg')).toHaveCount(3);
  await proj.getByTestId('apply-changes').click();
  await expect(proj.getByTestId('smart')).toContainText('proposed');
  await expect(proj.getByTestId('smart').locator('input').first()).toHaveValue('Method section drafted by November 15');
  await proj.getByTestId('smart').getByRole('button', { name: 'Confirm' }).click();
  await expect(proj.getByTestId('smart')).not.toContainText('proposed');
  await expect(proj.getByTestId('ai-review')).toBeVisible();
});

for (const w of [320, 375, 430]) {
  test(`AI help in the flows doesn't scroll sideways at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    const { answer } = await aiSession(page);
    await toPlan(page);
    await noSideways(page, 'plan with the AI button');
    answer.text = JSON.stringify({ plan: [{ id: 't4', role: 'protect' }, { id: 't1', role: 'carried' }, { id: 't6', role: 'obligation' }], starters: [{ id: 't4', starter: 'Open a new chat and paste the name of the form you need to file' }], note: 'A long note about why the plan changed, long enough to wrap on a narrow screen.' });
    await page.getByTestId('ai-improve').click();
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('ai-plan-note')).toBeVisible();
    await noSideways(page, 'AI plan');
    await page.getByTestId('ai-plan-review').click();
    await noSideways(page, 'AI plan changes');
    await page.keyboard.press('Escape');
    answer.text = JSON.stringify({ steps: [{ title: 'Open Doctolib and search for a dentist with a long name', starter: 'Tap the icon', est: 3 }, { title: 'Pick a slot', est: 5 }] });
    await page.locator('.row:not(.done)', { hasText: 'signed lease' }).getByTestId('details').click();
    await sheet(page).getByRole('button', { name: 'Break it down' }).click();
    await noSideways(page, 'break it down with the AI button');
    await page.getByTestId('ai-breakdown').click();
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('bd-ai')).toBeVisible();
    await noSideways(page, 'AI steps');
    await page.keyboard.press('Escape');
    answer.text = JSON.stringify({ starter: 'Open Doctolib and type the word dentist into the search box' });
    await page.getByTestId('stuck').first().click();
    await sheet(page).getByRole('button', { name: /Can’t start/ }).click();
    await page.getByTestId('ai-stuck').click();
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('stuck-ai-note')).toBeVisible();
    await noSideways(page, 'stuck with an AI starter');
    await page.keyboard.press('Escape');
    answer.text = JSON.stringify({ title: 'Stay or move?', problem: { what: 'Rent goes up', should: 'Less than a third of income', constraints: 'Lease ends in June' } });
    await goTab(page, 'projects');
    await page.getByTestId('new-decision').click();
    await page.getByTestId('ai-dw-describe').fill('Rent goes up.');
    await page.getByTestId('ai-dw-problem').click();
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('review')).toBeVisible();
    await noSideways(page, 'decision help');
    await page.keyboard.press('Escape');
    answer.text = JSON.stringify({ goal: 'A goal', smart: { specific: 'Something specific' }, next: [{ title: 'Open the draft', est: 10 }] });
    await toProjects(page);
    const proj = page.locator('details.proj-rv', { hasText: 'Thesis' });
    await proj.locator('summary').click();
    await proj.getByTestId('ai-review').click();
    await page.getByTestId('ai-send').click();
    await expect(proj.getByTestId('review')).toBeVisible();
    await noSideways(page, 'review help');
  });
}

test('the built page breaks none of its own Content-Security-Policy', async ({ page }) => {
  const blocked: string[] = [];
  page.on('console', m => { if (/Content-Security-Policy/i.test(m.text())) blocked.push(m.text()); });
  await importSample(page);
  for (const tab of ['matrix', 'projects', 'calendar', 'log', 'settings', 'today'] as const) await goTab(page, tab);
  expect(blocked).toEqual([]);
});
