import { test, expect, type Page, type Route } from '@playwright/test';
import { importSample, noSideways } from './helpers';

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
