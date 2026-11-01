import { test, expect, type Browser, type BrowserContextOptions, type Page, type Route, type TestInfo } from '@playwright/test';
import { importSample, noSideways, goTab, expandSettings } from './helpers';

// First-run setup (S9 and its follow-up): language, then three explicit choices (AI inside the app with a key, your AI chat app through the connector,
// no AI) and a link for another chatbot, by copy and paste. A new device is one that has no data and no
// record of having finished. Every other test runs as a device that has (playwright.config.ts puts the record in localStorage); these ask for a new one.
const NEW_DEVICE = { cookies: [], origins: [] };
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const NEXT = (page: Page) => page.getByTestId('ob-next');
const next = (page: Page) => NEXT(page).click();
/** No cards, suits or Matrix vocabulary during set-up: the pillars are "what matters in your days". */
const noJargon = async (page: Page, where: string) => {
  const text = await page.locator('.ob').innerText();
  expect(text, where).not.toMatch(/\b(cards?|suits?|matrix|quadrants?)\b/i);
};

type Wire = { messages: { role: string; content: string | { type: string; text: string }[] }[] };
/** Answer each AI call with the next reply (the last repeats); returns the request bodies seen. */
async function stub(page: Page, ...replies: (object | number)[]) {
  const seen: Wire[] = [];
  await page.route(OPENROUTER, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = route.request().postDataJSON();
    // The key tutorial's "Test the connection" is not a turn of the conversation.
    if (JSON.stringify(body).includes('Connection test.')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: '{"ok": true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) });
    seen.push(body);
    const r = replies[Math.min(seen.length - 1, replies.length - 1)]!;
    if (typeof r === 'number') return route.fulfill({ status: r, headers: { ...cors, 'content-type': 'application/json' }, body: '{"error":{"message":"down"}}' });
    await route.fulfill({
      status: 200, headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }], usage: { prompt_tokens: 3000, completion_tokens: 400, cost: 0.01 } }),
    });
  });
  return seen;
}
const text = (w: Wire) => w.messages.map(m => (typeof m.content === 'string' ? m.content : m.content.map(c => c.text).join(''))).join('\n---\n');

const PILLARS = [{ name: 'The thesis', short: 'Thesis' }, { name: 'Paperwork', short: 'Papers' }, { name: 'My kids', short: 'Kids' }, { name: 'Rest and my sister', short: 'Rest' }];
const SETUP = [
  { op: 'settings.update', set: { pillars: PILLARS, preferences: { detail: 'very short', know: 'I start better with a time', never: 'no emojis' } } },
  { op: 'place.create', set: { name: 'Flat' } },
  { op: 'place.create', set: { name: 'Library' } },
];
const ASKING = { say: 'What does a usual week look like for you?', changes: [] };
const PROPOSAL = { say: 'You are finishing a thesis, you have two kids, and you want time for your sister. Here are four pillars and two places.', changes: SETUP };

/** The first screen's choice, with the language left as it is. `chatbot` is the link under the three. */
const choose = (page: Page, how: 'key' | 'connector' | 'myself' | 'chatbot') =>
  page.getByTestId({ key: 'ob-way-key', connector: 'ob-way-connector', myself: 'ob-way-none', chatbot: 'ob-copypaste-link' }[how]).click();

/** Finish the by-hand way: keep the pillars, one place. */
async function byMyself(page: Page, place = 'Home') {
  await page.goto('/');
  await choose(page, 'myself');
  await next(page);
  await page.getByTestId('ob-place-name').first().fill(place);
  await next(page);
}

test.describe('on a new device', () => {
  test.use({ storageState: NEW_DEVICE });

  test('the first screen is the language and three explicit choices, each saying what it gives, with the copy-and-paste link and the pairing link, and no tabs, look or cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('ob-language')).toBeVisible();
    await expect(page.getByTestId('ob-not-therapy')).toContainText('doesn’t replace therapy');
    await expect(page.getByTestId('ob-pair-link')).toBeVisible();
    await expect(page.getByTestId('ob-skip')).toBeVisible();
    await expect(page.getByTestId('ob-way-key')).toContainText('AI inside the app (a key)');
    await expect(page.getByTestId('ob-way-key')).toContainText('conversation inside the app');
    await expect(page.getByTestId('ob-way-key')).toContainText('few cents a month');
    await expect(page.getByTestId('ob-way-connector')).toContainText('Your AI chat app, through the connector');
    await expect(page.getByTestId('ob-way-connector')).toContainText('talking to your AI chat app');
    await expect(page.getByTestId('ob-way-connector')).toContainText('with your yes');
    await expect(page.getByTestId('ob-way-none')).toContainText('No AI');
    await expect(page.getByTestId('ob-way-none')).toContainText('a few questions, one at a time');
    await expect(page.getByTestId('ob-way-none')).toContainText('without AI');
    await expect(page.getByTestId('ob-copypaste-link')).toContainText('Any chatbot');
    await expect(page.locator('.tabbar')).toHaveCount(0);
    await noJargon(page, 'first screen');
    // The language switches the UI at once.
    await page.getByTestId('ob-lang-fr').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByTestId('ob-way-connector')).toContainText('Votre appli de chat IA, par le connecteur');
    await page.getByTestId('ob-lang-en').click();
    await expect(page.getByTestId('ob-way-none')).toContainText('No AI');
  });

  test('by myself: four plain questions, a place, done; every answer is an ordinary setting afterwards, in the default look', async ({ page }) => {
    await page.goto('/');
    await choose(page, 'myself');
    // The four pillars as plain questions with examples, each with a name to keep or change.
    await expect(page.getByTestId('ob-pillars')).toBeVisible();
    await expect(page.getByTestId('ob-pillars')).toContainText('What matters in your days?');
    await expect(page.getByTestId('ob-pillars')).toContainText('For example: Work & studies');
    await expect(page.getByTestId('ob-pillar-S')).toHaveValue('Work & studies');
    await noJargon(page, 'pillars');
    await page.getByTestId('ob-pillar-S').fill('Study');
    await page.getByTestId('ob-pillar-C').fill('My kids and the flat');
    await next(page);

    // Places: at least one, with this device's time zone already chosen.
    await expect(page.getByTestId('ob-places')).toBeVisible();
    await expect(NEXT(page)).toBeDisabled();
    const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    await expect(page.getByTestId('ob-place').first().locator('select')).toHaveValue(zone);
    await page.getByTestId('ob-place-name').first().fill('Home');
    await expect(NEXT(page)).toBeEnabled();
    await page.getByTestId('ob-place-add').click();
    await page.getByTestId('ob-place-name').nth(1).fill('Work');
    await noJargon(page, 'places');
    await next(page);

    // Done: nothing is written until here; the rest is on Home.
    await expect(page.getByTestId('ob-done')).toBeVisible();
    await expect(page.getByTestId('ob-not-therapy')).toBeVisible();
    await expect(page.getByTestId('ob-done-next')).toContainText('Next steps');
    await noJargon(page, 'done');
    expect(await page.evaluate(() => new Promise<number>(res => { const r = indexedDB.open('reussite'); r.onsuccess = () => { const q = r.result.transaction('places').objectStore('places').count(); q.onsuccess = () => res(q.result); }; }))).toBe(0);
    await page.getByTestId('ob-plan').click();
    await expect(page.getByTestId('ci-shape')).toBeVisible();
    await expect(page.getByTestId('ob-done')).toBeHidden();
    await page.getByTestId('sheet').getByRole('button', { name: 'Close' }).click();

    // Home carries the Next steps card, and onboarding never comes back.
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('next-steps')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('ob-language')).toHaveCount(0);
    await page.getByTestId('home-menu').click();
    await page.getByTestId('menu-places').click();
    await expect(page.getByTestId('places-sheet')).toContainText('Home');
    await expect(page.getByTestId('places-sheet')).toContainText('Work');
    await page.keyboard.press('Escape');
    await goTab(page, 'settings');
    // St George and the system's light or dark: the look screen is gone, the look stays in Settings.
    await expect(page.getByTestId('appearance').locator('select')).toHaveValue('st-george');
    await goTab(page, 'today');
    await expect(page.locator('.pile[data-suit=S]')).toHaveAttribute('aria-label', /Study/);
    await expect(page.locator('.pile[data-suit=C]')).toHaveAttribute('aria-label', /My kids and the flat/);
    await goTab(page, 'settings');
    await expect(page.getByTestId('ai-none')).toHaveAttribute('aria-pressed', 'true');
    await expandSettings(page);
    await expect(page.getByTestId('ai-prefs')).toHaveValue(/One question at a time/);
  });

  test('Back returns to the earlier answers, which are still there', async ({ page }) => {
    await page.goto('/');
    await choose(page, 'myself');
    await page.getByTestId('ob-pillar-D').fill('Admin');
    await next(page);
    await page.getByTestId('ob-place-name').first().fill('Home');
    await page.getByTestId('ob-back').click();
    await expect(page.getByTestId('ob-pillar-D')).toHaveValue('Admin');
    await page.getByTestId('ob-back').click();
    await expect(page.getByTestId('ob-language')).toBeVisible();
    await expect(page.getByTestId('ob-back')).toHaveCount(0);
  });

  test('"Skip, use defaults" leaves everything as it was and goes to the end', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('ob-skip').click();
    await expect(page.getByTestId('ob-done')).toContainText('Defaults are on');
    await expect(page.getByTestId('ob-not-therapy')).toBeVisible();
    await page.getByTestId('ob-home').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.locator('.tabbar .tab')).toHaveCount(5);
    await page.reload();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('ob-language')).toHaveCount(0);
    await goTab(page, 'settings');
    await expect(page.getByTestId('places').locator('input')).toHaveCount(1); // only the "add a place" field: no place was made
    await expect(page.getByTestId('addresses-switch')).toBeChecked();
    await expect(page.getByTestId('ai-none')).toHaveAttribute('aria-pressed', 'true');
    await expandSettings(page);
    await expect(page.getByTestId('ai-prefs')).toHaveValue(/One question at a time/);
  });

  test('skipping after some answers keeps them', async ({ page }) => {
    await page.goto('/');
    await choose(page, 'myself');
    await page.getByTestId('ob-pillar-H').fill('Rest');
    await page.getByTestId('ob-skip').click();
    await expect(page.getByTestId('ob-done')).toBeVisible();
    await page.getByTestId('ob-home').click();
    await goTab(page, 'today');
    await expect(page.locator('.pile[data-suit=H]')).toHaveAttribute('aria-label', /Rest/);
  });

  // ---- With an AI

  test('with a key in the app: the tutorial, then a conversation that ends on the review screen, then Home with the Next steps', async ({ page }) => {
    const seen = await stub(page, ASKING, PROPOSAL);
    await page.goto('/');
    await choose(page, 'key');
    // The tutorial: get a key, test it.
    await expect(page.getByTestId('ob-key')).toBeVisible();
    await expect(page.getByTestId('ob-key-link')).toHaveAttribute('href', 'https://openrouter.ai/keys');
    await expect(page.getByTestId('ob-provider-hint')).toContainText('many models');
    await expect(page.getByTestId('ob-next')).toBeDisabled(); // nothing to talk to yet
    await page.getByTestId('ob-ai-anthropic').click();
    await expect(page.getByTestId('ob-key-link')).toHaveAttribute('href', /anthropic\.com/);
    await page.getByTestId('ob-ai-openai').click();
    await expect(page.getByTestId('ob-key-link')).toHaveAttribute('href', 'https://openrouter.ai/keys'); // the switch has rendered
    await page.getByTestId('ai-key').fill('sk-or-test');
    await page.getByTestId('ai-key-save').click();
    await expect(page.getByTestId('ob-next')).toBeEnabled();
    await page.getByTestId('ob-key-test').click();
    await expect(page.getByTestId('ob-key-test-result')).toBeVisible();
    await next(page);

    // The conversation. The AI's first line is the app's own: nothing is sent until the person has written.
    await expect(page.getByTestId('ob-chat')).toBeVisible();
    await expect(page.getByTestId('ob-chat-first')).toBeVisible();
    await noJargon(page, 'chat');
    const before = seen.length;
    await page.getByTestId('ob-chat-say').fill('I am finishing a thesis, I have two kids, and I would like to see my sister more.');
    await page.getByTestId('ob-chat-send').click();
    await page.getByTestId('ai-send').click(); // "Show me what's sent" appears here too
    await expect(page.getByTestId('ob-chat-you').first()).toContainText('usual week');
    expect(seen.length).toBe(before + 1);
    const first = text(seen[before]!);
    expect(first).toContain('four pillars');
    expect(first).toContain('I am finishing a thesis');
    expect(first).toContain('Never say "card", "suit"');
    await page.getByTestId('ob-chat-say').fill('Mostly at home, and the library on weekdays.');
    await page.getByTestId('ob-chat-send').click();
    // The proposal: its words, then every change with a tick.
    await expect(page.getByTestId('review')).toBeVisible();
    await expect(page.getByTestId('ob-chat-you').last()).toContainText('four pillars and two places');
    expect(text(seen[before + 1]!)).toContain('usual week'); // the exchange so far goes with it
    await expect(page.getByTestId('chg')).toHaveCount(3);
    await expect(page.getByTestId('review')).toContainText('Pillar 1');
    await expect(page.getByTestId('review')).toContainText('The thesis');
    await expect(page.getByTestId('review')).toContainText('Rest and my sister');
    await expect(page.getByTestId('review')).toContainText('Flat');
    await noJargon(page, 'review');
    // One tick off: the library is not made.
    await page.getByTestId('chg').nth(2).locator('input').uncheck();
    await page.getByTestId('apply-changes').click();
    await expect(page.getByTestId('ob-done')).toBeVisible();
    await expect(page.getByTestId('ob-done')).toContainText('Your set-up is done');
    await page.getByTestId('ob-home').click();

    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('next-steps')).toBeVisible();
    await expect(page.getByTestId('next-connector')).toHaveCount(0); // a key was chosen: no connector to connect
    await goTab(page, 'today');
    await expect(page.locator('.pile[data-suit=S]')).toHaveAttribute('aria-label', /The thesis/);
    await expect(page.locator('.pile[data-suit=D]')).toHaveAttribute('aria-label', /Papers|Paperwork/);
    await expect(page.locator('.pile[data-suit=H]')).toHaveAttribute('aria-label', /Rest/);
    await goTab(page, 'settings');
    await expect(page.getByTestId('places')).toContainText('Flat');
    await expect(page.getByTestId('places')).not.toContainText('Library');
    await expect(page.getByTestId('ai-openai')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('ai-key')).toHaveAttribute('placeholder', /replace/i);
    await expect(page.getByTestId('ai-prefs')).toHaveValue(/Level of detail: very short\./);
    await expect(page.getByTestId('ai-prefs')).toHaveValue(/Things to know about how I work: I start better with a time/);
    await expect(page.getByTestId('ai-prefs')).toHaveValue(/Things never to do: no emojis/);
    await page.reload();
    await expect(page.getByTestId('ob-language')).toHaveCount(0);
  });

  test('with an AI: unticking everything goes back to the conversation, and an AI that is down offers a chatbot instead', async ({ page }) => {
    await stub(page, PROPOSAL, 500);
    await page.goto('/');
    await choose(page, 'key');
    await page.getByTestId('ai-key').fill('sk-or-test');
    await page.getByTestId('ai-key-save').click();
    await next(page);
    await page.getByTestId('ob-chat-say').fill('Thesis, kids, sister.');
    await page.getByTestId('ob-chat-send').click();
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('review')).toBeVisible();
    await page.getByTestId('review').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('ob-chat-say')).toBeVisible(); // back to talking, nothing written
    expect(await page.evaluate(() => new Promise<number>(res => { const r = indexedDB.open('reussite'); r.onsuccess = () => { const q = r.result.transaction('places').objectStore('places').count(); q.onsuccess = () => res(q.result); }; }))).toBe(0);
    await page.getByTestId('ob-chat-say').fill('Change the second one.');
    await page.getByTestId('ob-chat-send').click();
    await expect(page.getByTestId('ai-error')).toBeVisible();
    await page.getByTestId('ai-error').getByRole('button', { name: 'Use a chatbot instead' }).click();
    await expect(page.getByTestId('ob-paste')).toBeVisible();
  });

  test('any chatbot: the link under the choices, copy the message in, paste the reply back, and the same review; no connector', async ({ page }) => {
    await page.goto('/');
    await choose(page, 'chatbot');
    await expect(page.getByTestId('ob-paste')).toBeVisible();
    await expect(page.getByTestId('ob-paste')).toContainText('any chatbot');
    await expect(page.getByTestId('ob-paste').locator('.eyebrow')).toHaveCount(0); // one screen: no "n of N"
    await noJargon(page, 'paste');
    // The message it copies: the job, the block it must end with, and nothing of the person's.
    await page.getByTestId('ob-paste').locator('details summary').click();
    const pack = await page.getByTestId('ob-pack').innerText();
    expect(pack).toContain('four parts of my days');
    expect(pack).toContain('settings.update');
    expect(pack).toContain('fenced code block labelled reussite');
    await expect(page.getByTestId('ob-connector-note')).toHaveCount(0);
    // A reply with no block says so; one that holds nothing to set up says so.
    await page.getByTestId('ob-paste-text').fill('Sure! Here are your pillars: work, home...');
    await page.getByTestId('ob-paste-go').click();
    await expect(page.getByTestId('ob-paste-error')).toContainText('no change-set');
    await page.getByTestId('ob-paste-text').fill('```reussite\n' + JSON.stringify({ v: 1, changes: [{ op: 'task.create', set: { title: 'Open Mail and reply' } }] }) + '\n```');
    await page.getByTestId('ob-paste-go').click();
    await expect(page.getByTestId('ob-paste-error')).toContainText('nothing to set up');
    // The real reply (a step in it is left out: a set-up makes none).
    const reply = 'Here you go.\n\n```reussite\n' + JSON.stringify({ v: 1, note: 'Your set-up', changes: [...SETUP, { op: 'task.create', set: { title: 'Open Mail and reply' } }] }) + '\n```\n';
    await page.getByTestId('ob-paste-text').fill(reply);
    await page.getByTestId('ob-paste-go').click();
    await expect(page.getByTestId('review')).toBeVisible();
    await expect(page.getByTestId('chg')).toHaveCount(3);
    await page.getByTestId('apply-changes').click();
    await expect(page.getByTestId('ob-done')).toBeVisible();
    await page.getByTestId('ob-home').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('next-connector')).toHaveCount(0);
    await goTab(page, 'today');
    await expect(page.locator('.pile[data-suit=C]')).toHaveAttribute('aria-label', /My kids/);
    await goTab(page, 'settings');
    await expect(page.getByTestId('places')).toContainText('Flat');
    await expect(page.getByTestId('places')).toContainText('Library');
    await expect(page.getByTestId('ai-none')).toHaveAttribute('aria-pressed', 'true'); // no key: no provider
  });

  // ---- The AI chat app through the connector (needs the relay on :8787, which has a throwaway wrap key)

  /** From "Connect your AI chat app" to the steps in the app: the privacy cost said first, sync and its recovery key, then the address and the pairing code. */
  async function connectApp(page: Page) {
    await expect(page.getByTestId('ob-link')).toBeVisible();
    await expect(page.getByTestId('ob-link')).toContainText('whoever runs the relay can read your whole list');
    await noJargon(page, 'connect the app');
    await page.getByTestId('ob-link-on').click();
    await expect(page.getByTestId('recovery-key')).toBeVisible(); // sync is on, its key to keep
    await expect(page.locator('svg.qr')).toBeVisible();
    await noJargon(page, 'recovery key');
    await page.getByTestId('ob-link-key-saved').click();
    await expect(page.getByTestId('ob-link-url')).toHaveText(/^http:\/\/localhost:8787\/mcp$/);
    await expect(page.getByTestId('ob-link-steps')).toContainText('Add custom connector');
    // Per-app steps, each with the same weight: Claude, and a line for any other app that accepts MCP connectors.
    await expect(page.getByTestId('ob-link-apps').locator('li')).toHaveCount(2);
    await expect(page.getByTestId('ob-link-apps').locator('li').nth(1)).toContainText('accepts MCP connectors');
    await expect(page.getByTestId('connector-code')).toBeVisible();
    await expect(page.getByTestId('ob-link-state')).toContainText('Waiting for your app');
  }

  test('through the connector, the pillars and places by a copy and paste in the app, then Connect your AI chat app: sync and its key, the address and code, a check; the Next steps drop the connector', async ({ page }) => {
    test.slow();
    await page.goto('/');
    await choose(page, 'connector');
    // First the basics: the connector cannot write settings.
    await expect(page.getByTestId('ob-basics')).toBeVisible();
    await expect(page.getByTestId('ob-basics')).toContainText('cannot change your settings');
    await noJargon(page, 'basics');
    await page.getByTestId('ob-basics-chat').click();
    await expect(page.getByTestId('ob-paste')).toContainText('Set up in your AI chat app');
    await expect(page.getByTestId('ob-connector-note')).toContainText('can’t change your settings');
    await page.getByTestId('ob-paste-text').fill('```reussite\n' + JSON.stringify({ v: 1, note: 'Your set-up', changes: SETUP }) + '\n```');
    await page.getByTestId('ob-paste-go').click();
    await page.getByTestId('apply-changes').click();
    // Then connect the app, in set-up.
    await connectApp(page);
    await expect(page.getByTestId('ob-link-error')).toHaveCount(0);
    await noSideways(page, 'connect the app, steps');
    // Not connected yet: the check says so.
    await page.getByTestId('ob-link-check').click();
    await expect(page.getByTestId('ob-link-state')).toContainText('hasn’t connected yet');
    // The relay says the app has come in (it has not, for real: the status is stubbed).
    await page.route('**/v1/spaces/*/connector', async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ on: true, lastUsed: Date.now(), url: 'http://localhost:8787/mcp' }) });
    });
    await page.getByTestId('ob-link-check').click();
    await expect(page.getByTestId('ob-link-state')).toContainText('Your app is connected');
    await expect(page.getByTestId('ob-link-state')).toContainText('Plan my day with Réussite');
    await page.getByTestId('ob-link-continue').click();
    await expect(page.getByTestId('ob-done-text')).toContainText('AI chat app is connected');
    await page.getByTestId('ob-home').click();
    await expect(page.getByTestId('home')).toBeVisible();
    // Everything it set is there; the connector is on, so it is not on the Next steps (the recovery key was saved, sync is on).
    await expect(page.getByTestId('next-connector')).toHaveCount(0);
    await expect(page.getByTestId('next-sync')).toHaveCount(0);
    await expect(page.getByTestId('next-key')).toHaveCount(0);
    await goTab(page, 'today');
    await expect(page.locator('.pile[data-suit=S]')).toHaveAttribute('aria-label', /The thesis/);
    await goTab(page, 'settings');
    await expect(page.getByTestId('places')).toContainText('Flat');
    await expandSettings(page);
    await expect(page.getByTestId('connector-state')).toContainText('The connector is on');
    await expect(page.getByTestId('sync-status')).toBeVisible();
    // After a restart it is still on the connector's side.
    await page.reload();
    await expect(page.getByTestId('ob-language')).toHaveCount(0);
    await expect(page.getByTestId('next-connector')).toHaveCount(0);
  });

  test('through the connector, by hand: pillars, places, then connect the app; "Not now" leaves it on the Next steps, and the Next steps line opens the connector', async ({ page }) => {
    test.slow();
    await page.goto('/');
    await choose(page, 'connector');
    await page.getByTestId('ob-basics-hand').click();
    await page.getByTestId('ob-pillar-S').fill('The thesis');
    await next(page);
    await page.getByTestId('ob-place-name').first().fill('Flat');
    await next(page);
    // The answers are written before connecting (sync would make a restart look like an existing install).
    await expect(page.getByTestId('ob-link')).toBeVisible();
    await expect(page.getByTestId('ob-link').locator('.eyebrow')).toContainText('4 of 4');
    expect(await page.evaluate(() => new Promise<number>(res => { const r = indexedDB.open('reussite'); r.onsuccess = () => { const q = r.result.transaction('places').objectStore('places').count(); q.onsuccess = () => res(q.result); }; }))).toBe(1);
    await page.getByTestId('ob-back').click(); // back to the places, nothing lost
    await expect(page.getByTestId('ob-place-name').first()).toHaveValue('Flat');
    await next(page);
    await page.getByTestId('ob-link-later').click();
    await expect(page.getByTestId('ob-done-text')).not.toContainText('is connected');
    await page.getByTestId('ob-home').click();
    await expect(page.getByTestId('next-connector')).toBeVisible();
    await expect(page.getByTestId('next-connector')).toContainText('Connect your AI chat app');
    await page.getByTestId('next-connector').click();
    await expect(page.getByTestId('connector')).toHaveJSProperty('open', true);
    await goTab(page, 'today');
    await expect(page.locator('.pile[data-suit=S]')).toHaveAttribute('aria-label', /The thesis/);
  });

  test('through the connector, by hand, connected without a copy and paste; a relay without the connector says so and "Not now" still finishes', async ({ page }) => {
    test.slow();
    await page.route('**/v1/spaces/*/connector', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'connector_unavailable' }) });
    });
    await page.goto('/');
    await choose(page, 'connector');
    await page.getByTestId('ob-basics-hand').click();
    await next(page);
    await page.getByTestId('ob-place-name').first().fill('Flat');
    await next(page);
    await page.getByTestId('ob-link-on').click();
    await page.getByTestId('ob-link-key-later').click();
    // The relay has no connector: plain words, and a way on. Sync is on by now, so the button says what is left to do.
    await expect(page.getByTestId('ob-link-error')).toContainText('no connector set up');
    await expect(page.getByTestId('ob-link-on')).toContainText('Switch on the connector');
    await page.getByTestId('ob-link-later').click();
    await page.getByTestId('ob-home').click();
    await expect(page.getByTestId('next-connector')).toBeVisible();
    await expect(page.getByTestId('next-key')).toBeVisible(); // "I'll do it later": the key is still to save
  });

  test('the Next steps: each line opens its Settings section, a line that is done goes, and the card can be hidden for good', async ({ page }) => {
    await byMyself(page);
    await page.getByTestId('ob-home').click();
    await expect(page.getByTestId('next-steps')).toBeVisible();
    await noSideways(page, 'next steps');
    await expect(page.getByTestId('next-sync')).toBeVisible();
    await expect(page.getByTestId('next-addresses')).toBeVisible();
    await page.getByTestId('next-addresses').click();
    await expect(page.getByTestId('settings')).toBeVisible();
    await expect(page.getByTestId('addresses-settings')).toBeVisible(); // its folds opened
    await expect(page.getByTestId('addresses-switch')).toBeVisible();
    await page.getByTestId('tab-home').click();
    await page.getByTestId('next-sync').click();
    await expect(page.getByTestId('sync')).toHaveJSProperty('open', true);
    await page.getByTestId('tab-home').click();
    await page.getByTestId('next-dismiss').click();
    await expect(page.getByTestId('next-steps')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('next-steps')).toHaveCount(0);
  });

  test('a line that is done goes by itself: Addresses & people switched off', async ({ page }) => {
    await byMyself(page);
    await page.getByTestId('ob-home').click();
    await page.getByTestId('next-addresses').click();
    await page.getByTestId('addresses-switch').uncheck();
    await page.getByTestId('tab-home').click();
    await expect(page.getByTestId('next-addresses')).toHaveCount(0);
    await expect(page.getByTestId('next-sync')).toBeVisible();
  });

  for (const [width, french] of [[320, false], [375, false], [430, false], [320, true]] as const) {
    test(`every screen fits at ${width}px, with 44px targets${french ? ', in French' : ''}`, async ({ page }) => {
      await stub(page, ASKING, PROPOSAL);
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/');
      if (french) {
        await page.getByTestId('ob-lang-fr').click();
        await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      }
      const check = async (id: string) => {
        await expect(page.getByTestId(id)).toBeVisible();
        await noSideways(page, id);
        const small = await page.evaluate(() => [...document.querySelectorAll('.ob button, .ob input, .ob select, .ob textarea, .ob summary')]
          .filter(el => !(el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'checkbox')))
          .map(el => { const r = el.getBoundingClientRect(); return { n: el.tagName + '.' + el.className + ' ' + (el.textContent ?? '').slice(0, 20), w: r.width, h: r.height }; })
          .filter(x => x.w > 0 && (x.h < 43.5 || x.w < 43.5)));
        expect(small, id + ': small targets').toEqual([]);
      };
      await check('ob-language');
      // By myself.
      await choose(page, 'myself');
      await check('ob-pillars');
      await next(page);
      await page.getByTestId('ob-place-name').first().fill('Home');
      await page.getByTestId('ob-place-add').click();
      await check('ob-places');
      await next(page);
      await check('ob-done');
      await page.getByTestId('ob-back').click();
      await page.getByTestId('ob-back').click();
      await page.getByTestId('ob-back').click();
      // Any chatbot: the link under the choices.
      await choose(page, 'chatbot');
      await check('ob-paste');
      await page.getByTestId('ob-paste').locator('details summary').click();
      await check('ob-paste');
      await page.getByTestId('ob-back').click();
      // The connector: the basics, the message to the app, and Connect the app with each of its stages.
      await choose(page, 'connector');
      await check('ob-basics');
      await page.getByTestId('ob-basics-chat').click();
      await check('ob-paste');
      await page.getByTestId('ob-back').click();
      await page.getByTestId('ob-back').click();
      // With a key, every screen of the tutorial and the conversation.
      await choose(page, 'key');
      await check('ob-key');
      await page.getByTestId('ai-key').fill('sk-or-test');
      await page.getByTestId('ai-key-save').click();
      await page.getByTestId('ob-key-test').click();
      await expect(page.getByTestId('ob-key-test-result')).toBeVisible();
      await check('ob-key');
      await next(page);
      await check('ob-chat');
      await page.getByTestId('ob-chat-say').fill('A long first message about my days, '.repeat(6));
      await page.getByTestId('ob-chat-send').click();
      await page.getByTestId('ai-send').click();
      await expect(page.getByTestId('ob-chat-you').first()).toBeVisible();
      await page.getByTestId('ob-chat-say').fill('Mostly at home.');
      await page.getByTestId('ob-chat-send').click();
      await expect(page.getByTestId('review')).toBeVisible();
      await check('ob-chat');
      // The pairing screen.
      await page.getByTestId('ob-back').click();
    });

    test(`Connecting the app fits at ${width}px, with 44px targets${french ? ', in French' : ''}`, async ({ page }) => {
      test.slow();
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/');
      if (french) {
        await page.getByTestId('ob-lang-fr').click();
        await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      }
      const check = async (id: string) => {
        await expect(page.getByTestId(id)).toBeVisible();
        await noSideways(page, id);
        const small = await page.evaluate(() => [...document.querySelectorAll('.ob button, .ob a, .ob input, .ob select, .ob textarea, .ob summary')]
          .filter(el => !(el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'checkbox')))
          .map(el => { const r = el.getBoundingClientRect(); return { n: el.tagName + '.' + el.className + ' ' + (el.textContent ?? '').slice(0, 20), w: r.width, h: r.height }; })
          .filter(x => x.w > 0 && (x.h < 43.5 || x.w < 43.5)));
        expect(small, id + ': small targets').toEqual([]);
      };
      await choose(page, 'connector');
      await page.getByTestId('ob-basics-hand').click();
      await next(page);
      await page.getByTestId('ob-place-name').first().fill(french ? 'Maison' : 'Home');
      await next(page);
      await check('ob-link');
      await page.getByTestId('ob-link-on').click();
      await check('ob-link');
      await expect(page.getByTestId('recovery-key')).toBeVisible();
      await page.getByTestId('ob-link-key-saved').click();
      await expect(page.getByTestId('ob-link-url')).toBeVisible();
      await check('ob-link');
      await page.getByTestId('ob-link-check').click();
      await check('ob-link');
      await page.getByTestId('ob-link-continue').click();
      await check('ob-done');
    });
  }
});

// ---- A device that pairs does not answer what its space already holds (needs the relay on :8787)

async function device(browser: Browser, info: TestInfo, newDevice: boolean) {
  const use = info.project.use as BrowserContextOptions;
  const ctx = await browser.newContext(newDevice ? { ...use, storageState: NEW_DEVICE } : use);
  return { ctx, page: await ctx.newPage() };
}
const nudge = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test('"I already use Réussite on another device" goes to pairing, then straight to the end; nothing is pushed over the space', async ({ browser }, info) => {
  test.slow();
  const a = await device(browser, info, false);
  await a.page.goto('/#settings'); await expandSettings(a.page);
  await a.page.getByPlaceholder('Name of the new place').fill('Cabin');
  await a.page.getByTestId('add-place').click();
  // A pillar this device named its own way: the other must not overwrite it with defaults.
  await a.page.getByTestId('method').getByLabel('Name', { exact: true }).first().fill('Studio');
  await a.page.getByTestId('method').getByLabel('Name', { exact: true }).first().blur();
  await a.page.getByTestId('sync-setup').click();
  await a.page.getByTestId('sync-make-key').click();
  await expect(a.page.locator('svg.qr')).toBeVisible();
  const key = (await a.page.getByTestId('recovery-key').innerText()).trim();

  const b = await device(browser, info, true);
  await b.page.goto('/');
  await b.page.getByTestId('ob-pair-link').click();
  await expect(b.page.getByTestId('ob-pair')).toBeVisible();
  await noSideways(b.page, 'pairing');
  // A wrong key says so; the right one joins.
  await b.page.getByTestId('sync-join-key').fill('NOPE');
  await b.page.getByTestId('sync-join-go').click();
  await expect(b.page.getByTestId('sync-join-error')).toBeVisible();
  await b.page.getByTestId('sync-join-key').fill(key);
  await b.page.getByTestId('sync-join-go').click();
  // Straight to the end: no pillars, places, tutorial or conversation, no recovery key to save.
  await expect(b.page.getByTestId('ob-done')).toBeVisible();
  await expect(b.page.getByTestId('ob-pillars')).toHaveCount(0);
  await expect(b.page.getByTestId('ob-places')).toHaveCount(0);
  await expect(b.page.getByTestId('ob-done')).toContainText('coming from your other device');
  await b.page.getByTestId('ob-home').click();
  await expect(b.page.getByTestId('home')).toBeVisible();
  // The space's own places and pillar names arrive; nothing from this device's defaults was pushed over them.
  await expect(async () => {
    await nudge(b.page);
    await goTab(b.page, 'settings');
    await expect(b.page.getByTestId('places')).toContainText('Cabin', { timeout: 800 });
  }).toPass({ timeout: 25_000, intervals: [700, 1000, 1500] });
  await goTab(b.page, 'today');
  await expect(b.page.locator('.pile[data-suit=S]')).toHaveAttribute('aria-label', /Studio/);
  // It was told of notifications and the rest on Home, not in a wizard.
  await goTab(b.page, 'home');
  await b.page.reload();
  await expect(b.page.getByTestId('ob-language')).toHaveCount(0);
  await a.ctx.close(); await b.ctx.close();
});

test('a device that pairs by the usual way never sees onboarding, even before any data arrives', async ({ browser }, info) => {
  test.slow();
  const a = await device(browser, info, false);
  await a.page.goto('/#settings'); await expandSettings(a.page);
  await a.page.getByTestId('sync-setup').click();
  await a.page.getByTestId('sync-make-key').click();
  const key = (await a.page.getByTestId('recovery-key').innerText()).trim();
  // A device that has a key but nothing else yet: the record of the key is enough.
  const b = await device(browser, info, true);
  await b.page.goto('/');
  await b.page.getByTestId('ob-pair-link').click();
  await b.page.getByTestId('sync-join-key').fill(key);
  await b.page.getByTestId('sync-join-go').click();
  await expect(b.page.getByTestId('ob-done')).toBeVisible();
  await b.page.reload(); // closed before finishing
  await expect(b.page.getByTestId('home')).toBeVisible();
  await expect(b.page.getByTestId('ob-language')).toHaveCount(0);
  await a.ctx.close(); await b.ctx.close();
});

// ---- Existing installs never see it

test('a device with data never sees it, even with no record of having finished', async ({ page }) => {
  await importSample(page); // the record is in localStorage here; take it away to look like an install from before onboarding
  await page.evaluate(() => localStorage.removeItem('reussite.onboarded'));
  await page.reload();
  await expect(page.getByTestId('tabbar')).toBeVisible();
  await expect(page.getByTestId('ob-language')).toHaveCount(0);
  await goTab(page, 'today');
  await expect(page.getByTestId('first')).toContainText('Doctolib');
  // It is recorded now: wiping the list later does not start it. And there is no Next steps card on an install from before.
  expect(await page.evaluate(() => localStorage.getItem('reussite.onboarded'))).toBe('1');
  await goTab(page, 'home');
  await expect(page.getByTestId('next-steps')).toHaveCount(0);
});

test('a device with only a changed setting never sees it', async ({ page }) => {
  await page.goto('/#settings'); await expandSettings(page);
  await page.getByTestId('addresses-switch').click();
  await page.evaluate(() => localStorage.removeItem('reussite.onboarded'));
  await page.reload();
  await expect(page.getByTestId('ob-language')).toHaveCount(0);
  await expect(page.getByTestId('addresses-switch')).not.toBeChecked();
});
