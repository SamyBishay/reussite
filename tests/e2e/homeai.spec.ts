import { test, expect, type Page, type Route } from '@playwright/test';
import { importSample, noSideways, goTab, openMenu } from './helpers';

// Home's AI with memory (phase 2b, step 7). OpenRouter is stubbed; every note and name here is invented.
const sheet = (page: Page) => page.getByTestId('sheet');
const input = (page: Page) => page.getByTestId('home-input');
const say = async (page: Page, text: string) => { await input(page).fill(text); await input(page).press('Enter'); await input(page).blur(); };
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

type Wire = { messages: { role: string; content: string | { type: string; text: string; cache_control?: unknown }[] }[] };
/** Answer each AI call with the next reply (the last one repeats); returns the request bodies seen. */
async function stub(page: Page, ...replies: (object | string)[]) {
  const seen: Wire[] = [];
  await page.route(OPENROUTER, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    seen.push(route.request().postDataJSON());
    const r = replies[Math.min(seen.length - 1, replies.length - 1)]!;
    const content = typeof r === 'string' ? r : JSON.stringify(r);
    await route.fulfill({
      status: 200, headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 5000, completion_tokens: 60, cost: 0.5, prompt_tokens_details: { cached_tokens: 3000 } } }),
    });
  });
  return seen;
}
const userOf = (w: Wire) => w.messages[1]!.content as string;

const file = (name: string, text: string) => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(text) });
const IBRAHIM = `---
name: Ibrahim
description: A neighbour
aliases: [Ibra]
type: reference
---
- Works night shifts
- Has a cat called Biscuit
`;
const ME = `---
name: about-me
metadata:
  type: user
---
Works best before noon.
`;

/** OpenRouter as the provider, two notes in Memory (the profile and Ibrahim), and a step that names him. */
async function setUpIn(page: Page) {
  await goTab(page, 'settings');
  await page.getByTestId('ai-openai').click();
  await page.getByTestId('ai-key').fill('sk-or-test');
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-settings')).toContainText('A key is saved.');
  await openMenu(page, 'memory');
  await page.getByTestId('memory-import').click();
  await page.getByTestId('memory-import-files').setInputFiles([file('ibrahim.md', IBRAHIM), file('about-me.md', ME)]);
  await page.getByTestId('memory-import-go').click();
  await expect(sheet(page)).toBeHidden();
  await goTab(page, 'today');
  await page.locator('form.quick input[name=title]').fill('Open Messages and text Ibrahim about the keys');
  await page.locator('form.quick input[name=title]').press('Enter');
  await expect(page.locator('.row', { hasText: 'text Ibrahim about the keys' })).toHaveCount(1);
  await goTab(page, 'home');
}

test('a question about a person sends his note and his steps, shows the notes first, and answers on the card', async ({ page }) => {
  await importSample(page);
  const seen = await stub(page, { v: 1, changes: [], note: 'Ibrahim works night shifts, so mornings are quiet.' });
  await setUpIn(page);
  await say(page, 'what does Ibrahim have on');
  const pv = page.getByTestId('ai-preview');
  await expect(pv).toBeVisible();
  await expect(page.getByTestId('ai-notes')).toHaveText('Memory notes sent: about-me, Ibrahim');
  await expect(page.getByTestId('ai-user')).toContainText('1. Works night shifts');
  expect(seen).toHaveLength(0);
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('card-answer')).toContainText('Ibrahim works night shifts, so mornings are quiet.');
  expect(seen).toHaveLength(1);

  // The stable block carries the profile and the cache marker; the user part, his note and the step that names him.
  const system = seen[0]!.messages[0]!.content as { text: string; cache_control?: unknown }[];
  expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
  expect(system[1]!.cache_control).toBeUndefined();
  expect(system[0]!.text).toContain('1. Works best before noon.');
  expect(system[0]!.text).not.toContain('Ibrahim');
  const user = userOf(seen[0]!);
  expect(user).toContain('| Ibrahim | Ibra\n1. Works night shifts\n2. Has a cat called Biscuit');
  expect(user).toContain('Open Messages and text Ibrahim about the keys');
  expect(user).toContain('Message:\nwhat does Ibrahim have on');

  // The answer is kept as a turn: History lists it, with no Undo and no "Undone".
  await openMenu(page, 'history');
  await expect(page.getByTestId('history-row')).toContainText('what does Ibrahim have on');
  await expect(page.getByTestId('history-undo')).toHaveCount(0);
});

test('a follow-up within ten minutes sends the earlier turns', async ({ page }) => {
  await importSample(page);
  const seen = await stub(page, { v: 1, changes: [], note: 'Nights.' }, { v: 1, changes: [], note: 'Biscuit.' });
  await setUpIn(page);
  await say(page, 'what does Ibrahim have on');
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('card-answer')).toContainText('Nights.');
  await say(page, 'and what is his cat called?');
  await expect(page.getByTestId('card-answer')).toContainText('Biscuit.');
  expect(seen).toHaveLength(2);
  const user = userOf(seen[1]!);
  expect(user).toContain('Person: what does Ibrahim have on\nRéussite: Nights.');
  expect(user).toContain('1. Works night shifts'); // the note named before still goes
});

test('one added step is applied at once with Undo; three changes open the review', async ({ page }) => {
  await importSample(page);
  const one = { v: 1, changes: [{ op: 'task.create', set: { title: 'Open Messages and ask Ibrahim for the spare key', est: 5 } }] };
  const three = { v: 1, changes: ['A', 'B', 'C'].map(x => ({ op: 'task.create', set: { title: 'Open Notes and write ' + x } })) };
  await stub(page, one, three);
  await setUpIn(page);
  await say(page, 'I should probably get the spare key from Ibrahim before the weekend');
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('receipt')).toContainText('1 change');
  await expect(page.getByTestId('review')).toHaveCount(0);
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('receipt')).toHaveCount(0);
  await goTab(page, 'matrix');
  await expect(page.locator('.matrix')).not.toContainText('spare key');
  await goTab(page, 'home');

  await say(page, 'could you sort out three things around the keys for me');
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.getByTestId('chg')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('card-review')).toContainText('3 changes');
});

test('a weather question gets the one line and a button to Ask any AI with the question ready', async ({ page }) => {
  await importSample(page);
  await stub(page, { v: 1, changes: [], outside: true, note: 'I only help with your list, your memory and the method; your usual AI can help with the weather.' });
  await setUpIn(page);
  await say(page, 'what is the weather in Lyon tomorrow?');
  await page.getByTestId('ai-send').click();
  const card = page.getByTestId('card-answer');
  await expect(card).toContainText('your usual AI can help with the weather');
  await card.getByRole('button', { name: 'Ask any AI' }).click();
  await expect(page.getByTestId('ask-question')).toHaveValue('what is the weather in Lyon tomorrow?');
});

test('the month’s spend shows in Settings, and at the limit Home goes back to the sheet without calling the AI', async ({ page }) => {
  await importSample(page);
  const seen = await stub(page, { v: 1, changes: [], note: 'Nights.' });
  await setUpIn(page);
  await say(page, 'what does Ibrahim have on');
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('card-answer')).toContainText('Nights.');
  await goTab(page, 'settings');
  await expect(page.getByTestId('ai-spend-line')).toContainText('1 call, 5,060 tokens');
  await expect(page.getByTestId('ai-spend-line')).toContainText('About $0.500 spent.');
  await page.getByTestId('ai-cap').fill('0.4');
  await page.getByTestId('ai-cap').blur();
  await goTab(page, 'home');
  await say(page, 'what does Ibrahim have on');
  await expect(page.getByTestId('card-answer')).toContainText('limit on this device is reached');
  expect(seen).toHaveLength(1);
  await page.getByTestId('card-answer').getByRole('button', { name: 'Add as a step' }).click();
  await expect(sheet(page).getByTestId('task-sheet')).toBeVisible();
  await expect(sheet(page).locator('input[name=title]')).toHaveValue('what does Ibrahim have on');
});

for (const width of [320, 375, 430]) {
  test(`the answer card, the preview and the spend in Settings do not scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await importSample(page);
    await stub(page, { v: 1, changes: [], note: 'Ibrahim works night shifts, has a cat called Biscuit and, as the notes say, a very long street name to see that it wraps: Rue-des-Marronniers-Fleuris-et-des-Tilleuls.' });
    await setUpIn(page);
    await say(page, 'what does Ibrahim have on');
    await expect(page.getByTestId('ai-preview')).toBeVisible();
    await noSideways(page, 'AI preview with notes');
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('card-answer')).toBeVisible();
    await noSideways(page, 'answer card');
    await goTab(page, 'settings');
    await expect(page.getByTestId('ai-spend')).toBeVisible();
    await noSideways(page, 'settings with the spend');
  });
}
