import { test, expect, type Browser, type BrowserContextOptions, type Page, type Route, type TestInfo } from '@playwright/test';
import { importSample, noSideways, goTab, goNotifications, expandSettings, setLanguage } from './helpers';

// First-run setup (S9 and its follow-ups): two screens, the language and the four kinds of time in the person's days (prefilled, editable), then Home.
// An AI (a key and a conversation, the AI chat app through the connector, any chatbot by copy and paste) is "Later": the same screens open from Settings in a sheet.
// A new device is one that has no data and no record of having finished. Every other test runs as a device that has (playwright.config.ts puts the record in
// localStorage); these ask for a new one.
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

const placeCount = (page: Page) => page.evaluate(() => new Promise<number>(res => { const r = indexedDB.open('reussite'); r.onsuccess = () => { const q = r.result.transaction('places').objectStore('places').count(); q.onsuccess = () => res(q.result); }; }));

/** Finish the by-hand way: keep the four categories. */
async function byMyself(page: Page) {
  await page.goto('/');
  await next(page);
  await expect(page.getByTestId('ob-pillars')).toBeVisible();
  await next(page);
  await expect(page.getByTestId('home')).toBeVisible();
}

/** A device that finished set-up (the default one here), in Settings with the AI section open. */
async function settingsAi(page: Page) {
  await page.goto('/#settings');
  await expandSettings(page);
}

test.describe('on a new device', () => {
  test.use({ storageState: NEW_DEVICE });

  test('the first screen is the language, Continue, Restore with a recovery key and Skip; nothing about AI, places or cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('ob-language')).toBeVisible();
    await expect(page.getByTestId('ob-not-therapy')).toContainText('doesn’t replace therapy');
    await expect(page.getByTestId('ob-pair-link')).toContainText('Restore with a recovery key');
    await expect(page.getByTestId('ob-skip')).toBeVisible();
    await expect(page.getByTestId('ob-next')).toBeVisible();
    await expect(page.getByTestId('ob-later')).toContainText('come later');
    for (const gone of ['ob-way-key', 'ob-way-connector', 'ob-way-none', 'ob-copypaste-link']) await expect(page.getByTestId(gone)).toHaveCount(0);
    await expect(page.locator('.tabbar')).toHaveCount(0);
    await noJargon(page, 'first screen');
    // The language switches the UI at once.
    await page.getByTestId('ob-lang-fr').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByTestId('ob-pair-link')).toContainText('Restaurer avec une clé de récupération');
    await page.getByTestId('ob-lang-en').click();
    await expect(page.getByTestId('ob-pair-link')).toContainText('Restore with a recovery key');
  });

  test('two screens: the four kinds of time are prefilled and editable, Start goes Home, and every answer is an ordinary setting afterwards', async ({ page }) => {
    await page.goto('/');
    await next(page);
    await expect(page.getByTestId('ob-pillars')).toBeVisible();
    await expect(page.getByTestId('ob-pillars')).toContainText('Four kinds of time in your days');
    for (const [k, name, desc] of [['S', 'Work', 'Job or studies, bureaucracy, administrative paperwork'], ['D', 'Leisure', 'Fun, relaxation, consumption, hobbies, outings'], ['C', 'Personal projects', 'Side projects, chores, research'], ['H', 'Interpersonal obligations', 'Functions and services for family and friends']] as const) {
      await expect(page.getByTestId('ob-pillar-' + k)).toHaveValue(name);
      await expect(page.getByTestId('ob-pillar-desc-' + k)).toHaveValue(desc);
    }
    await noJargon(page, 'categories');
    await page.getByTestId('ob-pillar-S').fill('Study');
    await page.getByTestId('ob-pillar-desc-C').fill('The shop, the garden');
    // Nothing is written until Start.
    expect(await placeCount(page)).toBe(0);
    await expect(page.getByTestId('ob-next')).toContainText('Start');
    await next(page);
    await expect(page.getByTestId('home')).toBeVisible(); // no third screen
    await expect(page.getByTestId('ob-language')).toHaveCount(0);
    // Home is bare; what is left for later waits behind the bell.
    await expect(page.getByTestId('next-steps')).toHaveCount(0);
    await expect(page.getByTestId('bell-dot')).toBeVisible();
    await page.getByTestId('home-bell').click();
    await expect(page.getByTestId('next-steps')).toBeVisible();
    await page.reload();
    await page.getByTestId('tab-home').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('ob-language')).toHaveCount(0);
    expect(await placeCount(page)).toBe(0); // places are for later: Anywhere stands
    await goTab(page, 'settings');
    // St George and the system's light or dark: the look screen is gone, the look stays in Settings.
    await expect(page.getByTestId('appearance').locator('select')).toHaveValue('st-george');
    await goTab(page, 'today');
    await expect(page.locator('.pile[data-suit=S]')).toHaveAttribute('aria-label', /Study/);
    await expect(page.locator('.pile[data-suit=H]')).toHaveAttribute('aria-label', /Interpersonal obligations/);
    await goTab(page, 'settings');
    await expect(page.getByTestId('suit-desc-C')).toHaveValue('The shop, the garden');
    await expect(page.getByTestId('suit-desc-S')).toHaveValue(/Job or studies/);
    await expect(page.getByTestId('ai-none')).toHaveAttribute('aria-pressed', 'true');
    await expandSettings(page);
    await expect(page.getByTestId('ai-prefs')).toHaveValue(/One question at a time/);
  });

  test('in French the categories come in French', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('ob-lang-fr').click();
    await next(page);
    await expect(page.getByTestId('ob-pillar-S')).toHaveValue('Travail');
    await expect(page.getByTestId('ob-pillar-desc-H')).toHaveValue(/famille et les amis/);
    await next(page);
    await expect(page.getByTestId('home')).toBeVisible();
    await goTab(page, 'today');
    await expect(page.locator('.pile[data-suit=D]')).toHaveAttribute('aria-label', /Loisirs/);
  });

  test('Back returns to the earlier answers, which are still there', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('ob-lang-fr').click();
    await next(page);
    await page.getByTestId('ob-pillar-D').fill('Admin');
    await page.getByTestId('ob-back').click();
    await expect(page.getByTestId('ob-language')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByTestId('ob-back')).toHaveCount(0);
    await next(page);
    await expect(page.getByTestId('ob-pillar-D')).toHaveValue('Admin');
  });

  test('"Skip, use defaults" goes straight Home, with the same four kinds of time and no place', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('ob-skip').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.locator('.tabbar .tab')).toHaveCount(5);
    await page.reload();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('ob-language')).toHaveCount(0);
    await goTab(page, 'today');
    await expect(page.locator('.pile[data-suit=C]')).toHaveAttribute('aria-label', /Personal projects/);
    await goTab(page, 'settings');
    await expect(page.getByTestId('places').locator('input')).toHaveCount(1); // only the "add a place" field: no place was made
    await expect(page.getByTestId('addresses-switch')).toBeChecked();
    await expect(page.getByTestId('ai-none')).toHaveAttribute('aria-pressed', 'true');
  });

  test('skipping after some answers keeps them', async ({ page }) => {
    await page.goto('/');
    await next(page);
    await page.getByTestId('ob-pillar-H').fill('Rest');
    await page.getByTestId('ob-skip').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await goTab(page, 'today');
    await expect(page.locator('.pile[data-suit=H]')).toHaveAttribute('aria-label', /Rest/);
  });

  test('the Next steps are on the bell page: each line opens its Settings section, a line that is done goes, and the list can be hidden for good', async ({ page }) => {
    await byMyself(page);
    await page.getByTestId('home-bell').click();
    await expect(page.getByTestId('next-steps')).toBeVisible();
    await noSideways(page, 'next steps');
    for (const l of ['sync', 'ai', 'calendar', 'addresses']) await expect(page.getByTestId('next-' + l)).toBeVisible();
    await page.getByTestId('next-addresses').click();
    await expect(page.getByTestId('settings')).toBeVisible();
    await expect(page.getByTestId('addresses-settings')).toBeVisible(); // its folds opened
    await expect(page.getByTestId('addresses-switch')).toBeVisible();
    await goNotifications(page);
    await page.getByTestId('next-sync').click();
    await expect(page.getByTestId('sync')).toHaveJSProperty('open', true);
    await goNotifications(page);
    await page.getByTestId('next-calendar').click();
    await expect(page.getByTestId('calendar-feed')).toBeVisible();
    await goNotifications(page);
    // A line that is done goes by itself.
    await page.getByTestId('next-addresses').click();
    await page.getByTestId('addresses-switch').uncheck();
    await goNotifications(page);
    await expect(page.getByTestId('next-addresses')).toHaveCount(0);
    await expect(page.getByTestId('next-sync')).toBeVisible();
    await page.getByTestId('next-dismiss').click();
    await expect(page.getByTestId('next-steps')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('next-steps')).toHaveCount(0);
  });

  for (const [width, french] of [[320, false], [375, false], [430, false], [320, true]] as const) {
    test(`both screens and the pairing screen fit at ${width}px, with 44px targets${french ? ', in French' : ''}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/');
      if (french) {
        await page.getByTestId('ob-lang-fr').click();
        await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      }
      await checkFits(page, 'ob-language');
      await next(page);
      await checkFits(page, 'ob-pillars');
      await page.getByTestId('ob-back').click();
      await page.getByTestId('ob-pair-link').click();
      await checkFits(page, 'ob-pair');
    });
  }
});

/** Nothing scrolls sideways and every target is at least 44px, on the screen named. */
async function checkFits(page: Page, id: string) {
  await expect(page.getByTestId(id)).toBeVisible();
  await noSideways(page, id);
  const small = await page.evaluate(() => [...document.querySelectorAll('.ob button, .ob a, .ob input, .ob select, .ob textarea, .ob summary')]
    .filter(el => !(el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'checkbox')) && !(el instanceof HTMLAnchorElement && el.closest('.obsteps'))) // a link inside a sentence of the steps is text
    .map(el => { const r = el.getBoundingClientRect(); return { n: el.tagName + '.' + el.className + ' ' + (el.textContent ?? '').slice(0, 20), w: r.width, h: r.height }; })
    .filter(x => x.w > 0 && (x.h < 43.5 || x.w < 43.5)));
  expect(small, id + ': small targets').toEqual([]);
}

// ---- An AI, later: the guided screens open from Settings in a sheet (on a device that finished set-up)

/** Settings → AI → Set up with an AI…, then one of the ways. */
async function guided(page: Page, how: 'key' | 'connector' | 'chatbot') {
  await settingsAi(page);
  if (how === 'connector') {
    await page.getByTestId('connector-guided').click();
    return;
  }
  await page.getByTestId('ai-guided').click();
  await expect(page.getByTestId('ob-ways')).toBeVisible();
  await page.getByTestId(how === 'key' ? 'ob-way-key' : 'ob-copypaste-link').click();
}
const sheet = (page: Page) => page.getByTestId('sheet');

test.describe('with an AI, from Settings', () => {
  test('with a key in the app: the tutorial, then a conversation that ends on the review screen, then Settings holds what was ticked', async ({ page }) => {
    const seen = await stub(page, ASKING, PROPOSAL);
    await settingsAi(page);
    await page.getByTestId('ai-guided').click();
    // The ways: a key, the AI chat app, or any chatbot.
    await expect(page.getByTestId('ob-way-key')).toContainText('AI inside the app (a key)');
    await expect(page.getByTestId('ob-way-key')).toContainText('few cents a month');
    await expect(page.getByTestId('ob-way-connector')).toContainText('Your AI chat app, through the connector');
    await expect(page.getByTestId('ob-copypaste-link')).toContainText('Any chatbot');
    await page.getByTestId('ob-way-key').click();
    // The tutorial: get a key, test it.
    await expect(page.getByTestId('ob-key')).toBeVisible();
    await expect(page.getByTestId('ob-key-link')).toHaveAttribute('href', 'https://openrouter.ai/keys');
    await expect(page.getByTestId('ob-provider-hint')).toContainText('many models');
    await expect(page.getByTestId('ob-next')).toBeDisabled(); // nothing to talk to yet
    await page.getByTestId('ob-ai-anthropic').click();
    await expect(page.getByTestId('ob-key-link')).toHaveAttribute('href', /anthropic\.com/);
    await page.getByTestId('ob-ai-openai').click();
    await expect(page.getByTestId('ob-key-link')).toHaveAttribute('href', 'https://openrouter.ai/keys'); // the switch has rendered
    await sheet(page).getByTestId('ai-key').fill('sk-or-test');
    await sheet(page).getByTestId('ai-key-save').click();
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
    expect(first).toContain('Interpersonal obligations'); // it starts from the four kinds of time
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
    await expect(sheet(page)).toBeHidden(); // done: back in Settings

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
  });

  test('unticking everything goes back to the conversation, and an AI that is down offers a chatbot instead', async ({ page }) => {
    await stub(page, PROPOSAL, 500);
    await guided(page, 'key');
    await sheet(page).getByTestId('ai-key').fill('sk-or-test');
    await sheet(page).getByTestId('ai-key-save').click();
    await next(page);
    await page.getByTestId('ob-chat-say').fill('Thesis, kids, sister.');
    await page.getByTestId('ob-chat-send').click();
    await page.getByTestId('ai-send').click();
    await expect(page.getByTestId('review')).toBeVisible();
    await page.getByTestId('review').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('ob-chat-say')).toBeVisible(); // back to talking, nothing written
    expect(await placeCount(page)).toBe(0);
    await page.getByTestId('ob-chat-say').fill('Change the second one.');
    await page.getByTestId('ob-chat-send').click();
    await expect(page.getByTestId('ai-error')).toBeVisible();
    await page.getByTestId('ai-error').getByRole('button', { name: 'Use a chatbot instead' }).click();
    await expect(page.getByTestId('ob-paste')).toBeVisible();
  });

  test('any chatbot: copy the message in, paste the reply back, and the same review; no connector', async ({ page }) => {
    await guided(page, 'chatbot');
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
    await expect(sheet(page)).toBeHidden();
    await goTab(page, 'today');
    await expect(page.locator('.pile[data-suit=C]')).toHaveAttribute('aria-label', /My kids/);
    await goTab(page, 'settings');
    await expect(page.getByTestId('places')).toContainText('Flat');
    await expect(page.getByTestId('places')).toContainText('Library');
    await expect(page.getByTestId('ai-none')).toHaveAttribute('aria-pressed', 'true'); // no key: no provider
  });

  // ---- The AI chat app through the connector (needs the relay on :8787, which has a throwaway wrap key)

  /** From "Connect my AI chat app" to the steps in the app: the privacy cost said first, sync and its recovery key, then the address and the pairing code. */
  async function connectApp(page: Page) {
    await expect(page.getByTestId('ob-link')).toBeVisible();
    await expect(page.getByTestId('ob-link')).toContainText('whoever runs the relay can read your whole list');
    await noJargon(page, 'connect the app');
    await page.getByTestId('ob-link-on').click();
    await expect(page.getByTestId('recovery-key')).toBeVisible(); // sync is on, its key to keep
    await expect(page.locator('svg.qr')).toBeVisible();
    await expect(page.getByTestId('key-copy')).toBeVisible();
    await expect(page.getByTestId('key-save-file')).toBeVisible();
    await expect(page.getByTestId('ob-link-key-later')).toHaveCount(0); // one tap, "I've saved it", before moving on
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

  test('through the connector: Connect my AI chat app, step by step: sync and its key, the address and code, a check', async ({ page }) => {
    test.slow();
    await guided(page, 'connector');
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
    await expect(sheet(page)).toBeHidden();
    await expandSettings(page);
    await expect(page.getByTestId('connector-state')).toContainText('The connector is on');
    await expect(page.getByTestId('sync-status')).toBeVisible();
    // The recovery key was saved, sync is on: neither is on the bell page any more.
    await goNotifications(page);
    await expect(page.getByTestId('next-sync')).toHaveCount(0);
    await expect(page.getByTestId('next-key')).toHaveCount(0);
    await expect(page.getByTestId('key-card')).toHaveCount(0);
  });

  test('a relay without the connector says so, and "Not now" still finishes; the key is not saved yet', async ({ page }) => {
    test.slow();
    await page.route('**/v1/spaces/*/connector', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'connector_unavailable' }) });
    });
    await guided(page, 'connector');
    await page.getByTestId('ob-link-on').click();
    await page.getByTestId('sheet').getByTestId('ob-link-key-saved').click();
    // The relay has no connector: plain words, and a way on. Sync is on by now, so the button says what is left to do.
    await expect(page.getByTestId('ob-link-error')).toContainText('no connector set up');
    await expect(page.getByTestId('ob-link-on')).toContainText('Switch on the connector');
    await page.getByTestId('ob-link-later').click();
    await expect(sheet(page)).toBeHidden();
  });

  for (const [width, french] of [[320, false], [375, false], [430, false], [320, true]] as const) {
    test(`the guided AI screens fit at ${width}px, with 44px targets${french ? ', in French' : ''}`, async ({ page }) => {
      test.slow();
      await stub(page, ASKING, PROPOSAL);
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/');
      if (french) {
        await setLanguage(page, 'fr');
        await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      } else await goTab(page, 'settings');
      await expandSettings(page);
      await page.getByTestId('ai-guided').click();
      await checkFits(page, 'ob-ways');
      // Any chatbot.
      await page.getByTestId('ob-copypaste-link').click();
      await checkFits(page, 'ob-paste');
      await page.getByTestId('ob-paste').locator('details summary').click();
      await checkFits(page, 'ob-paste');
      await page.getByTestId('ob-back').click();
      // With a key, every screen of the tutorial and the conversation.
      await page.getByTestId('ob-way-key').click();
      await checkFits(page, 'ob-key');
      await sheet(page).getByTestId('ai-key').fill('sk-or-test');
      await sheet(page).getByTestId('ai-key-save').click();
      await page.getByTestId('ob-key-test').click();
      await expect(page.getByTestId('ob-key-test-result')).toBeVisible();
      await checkFits(page, 'ob-key');
      await next(page);
      await checkFits(page, 'ob-chat');
      await page.getByTestId('ob-chat-say').fill('A long first message about my days, '.repeat(6));
      await page.getByTestId('ob-chat-send').click();
      await page.getByTestId('ai-send').click();
      await expect(page.getByTestId('ob-chat-you').first()).toBeVisible();
      await page.getByTestId('ob-chat-say').fill('Mostly at home.');
      await page.getByTestId('ob-chat-send').click();
      await expect(page.getByTestId('review')).toBeVisible();
      await checkFits(page, 'ob-chat');
    });

    test(`Connecting the app fits at ${width}px, with 44px targets${french ? ', in French' : ''}`, async ({ page }) => {
      test.slow();
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/');
      if (french) {
        await setLanguage(page, 'fr');
        await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      } else await goTab(page, 'settings');
      await expandSettings(page);
      await page.getByTestId('connector-guided').click();
      await checkFits(page, 'ob-link');
      await page.getByTestId('ob-link-on').click();
      await checkFits(page, 'ob-link');
      await expect(page.getByTestId('recovery-key')).toBeVisible();
      await page.getByTestId('ob-link-key-saved').click();
      await expect(page.getByTestId('ob-link-url')).toBeVisible();
      await checkFits(page, 'ob-link');
      await page.getByTestId('ob-link-check').click();
      await checkFits(page, 'ob-link');
      await page.getByTestId('ob-link-continue').click();
      await expect(sheet(page)).toBeHidden();
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

test('"Restore with a recovery key" goes to pairing, then straight Home; nothing is pushed over the space', async ({ browser }, info) => {
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
  // Straight Home: no categories, tutorial or conversation, no recovery key to save.
  await expect(b.page.getByTestId('home')).toBeVisible();
  await expect(b.page.getByTestId('ob-pillars')).toHaveCount(0);
  // The space's own places and pillar names arrive; nothing from this device's defaults was pushed over them.
  await expect(async () => {
    await nudge(b.page);
    await goTab(b.page, 'settings');
    await expect(b.page.getByTestId('places')).toContainText('Cabin', { timeout: 800 });
  }).toPass({ timeout: 25_000, intervals: [700, 1000, 1500] });
  await goTab(b.page, 'today');
  await expect(b.page.locator('.pile[data-suit=S]')).toHaveAttribute('aria-label', /Studio/);
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
  await expect(b.page.getByTestId('home')).toBeVisible();
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
