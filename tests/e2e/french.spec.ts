import { test, expect, type Page } from '@playwright/test';
import { carryAll, openWeeklyReview, goTab, importSample, morningDate, openMenu, expandSettings, expandSheet, noSideways, openAllProjects } from './helpers';

// The app in French has no English left (plan 2 Nov, S8): the screens a person meets are read in French, and the words that only English has
// (the, your, step, …) are looked for in what is shown. Names that are the same in both languages (Mail, Maps, Menu, OK, Agenda…) are not on the list.
const ENGLISH = /(?<![\p{L}’'])(the|and|your|you|you’ll|with|this|that|these|from|have|will|are|was|were|not|for|what|when|which|where|how|into|about|step|steps|card|cards|today|tomorrow|yesterday|settings|close|save|cancel|open|next|back|done|skip|swap|keep|add|edit|delete|remove|choose|pick|tap|set up|start|plan the day|undo|nothing|loading|error|none|yes|no)(?![\p{L}])/giu;
// A word that is French as well, or that the person wrote (the sample's steps are English on purpose).
const OK_WORDS = new Set(['no', 'a', 'start', 'open', 'add', 'back', 'close', 'next', 'for', 'not', 'done', 'none', 'error']);
const SAMPLE_TEXT = /write the second|park for|café near|Open |Doctolib|Maps|Mail|Messages|Files|thesis|lease|landlord|dentist|bank|statement|Claude|supervisor|receipts|Alex|tax form|Sunday|Housing papers|Thesis|Friends & outings|Inbox|Stay in the flat|Rent goes up|Cheaper overall|Lease signed|See a friend|Walk to the park|Weekly review|Choir/i;

/** `only`: a selector to read instead of the whole page (the guided AI sheet over Settings, which holds the one-tap link's sentence for any AI, English on purpose). */
async function english(page: Page, only = ''): Promise<string[]> {
  const text = await page.evaluate((only) => {
    // Every visible text node, one per line (inputs' values and placeholders are what the person typed or the app suggests).
    const out: string[] = [];
    const w = document.createTreeWalker(only ? document.querySelector(only) ?? document.body : document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest('script,style,noscript,[hidden],[aria-hidden=true],.toast,.help-ex')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const t = (n.textContent ?? '').trim();
      if (t) out.push(t);
    }
    document.querySelectorAll<HTMLElement>('[placeholder],[aria-label],[title]').forEach(e => {
      if (!e.getClientRects().length || e.closest('.toast,.help-ex')) return; // the library's hidden header carries its own labels
      for (const a of ['placeholder', 'aria-label', 'title']) { const v = e.getAttribute(a); if (v) out.push(v); }
    });
    return out;
  }, only);
  const hits: string[] = [];
  for (const line of text) {
    if (SAMPLE_TEXT.test(line)) continue;
    const words = (line.match(ENGLISH) ?? []).filter(w => !OK_WORDS.has(w.toLowerCase()));
    if (words.length) hits.push(`${words.join(',')} ← ${line.slice(0, 110)}`);
  }
  return hits;
}

async function inFrench(page: Page) {
  await goTab(page, 'settings');
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.getByTestId('settings')).toContainText('Réglages');
}

test('the app in French has no English left: the tabs, the menu pages, the sheets, the flows and Settings', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 800 });
  await morningDate(page);
  await importSample(page);
  await inFrench(page);
  const seen: Record<string, string[]> = {};
  const scan = async (where: string, only = '') => { const h = await english(page, only); if (h.length) seen[where] = h; };

  await goTab(page, 'home'); await scan('home');
  await page.getByTestId('home-help').click(); await scan('home help'); await page.keyboard.press('Escape');
  for (const tab of ['today', 'matrix', 'projects', 'calendar'] as const) { await goTab(page, tab); await scan(tab); }
  await page.getByTestId('cal-log').click(); await scan('log');
  await page.getByTestId('cal-agenda').click(); await scan('calendar agenda');
  for (const item of ['places', 'memory', 'history', 'addresses', 'waiting'] as const) { await openMenu(page, item); await scan(item); await page.keyboard.press('Escape').catch(() => undefined); }
  await page.goto('/#notifications'); await scan('notifications');
  await page.goto('/#cemetery'); await scan('cemetery');
  await openMenu(page, 'settings'); await scan('settings');
  await openWeeklyReview(page);
  for (let i = 0; i < 14; i++) {
    await scan('review ' + i);
    const b = page.getByTestId('rv-next');
    if (!(await b.isVisible().catch(() => false))) break;
    await b.click();
  }
  await page.keyboard.press('Escape');
  await goTab(page, 'today');
  await page.getByTestId('stuck').click(); await scan('stuck'); await page.keyboard.press('Escape');
  await page.goto('/#task/t1'); await expandSheet(page); await scan('step sheet'); await page.keyboard.press('Escape');
  await goTab(page, 'projects');
  await openAllProjects(page);
  await page.getByTestId('edit-project').first().click(); await expandSheet(page); await scan('project sheet'); await page.keyboard.press('Escape');
  await goTab(page, 'today');
  await page.locator('main').getByRole('button', { name: 'Planifier la journée' }).first().click();
  await expect(page.getByTestId('carried-card').or(page.getByTestId('ci-shape'))).toBeVisible();
  await scan('ritual yesterday');
  await carryAll(page);
  for (let i = 0; i < 8; i++) { const b = page.getByTestId('ci-next'); if (await b.isVisible().catch(() => false)) { await b.click(); await scan('ritual ' + i); } }
  await page.keyboard.press('Escape');
  await page.goto('/#today');
  await page.locator('main').getByRole('button', { name: 'Clôturer la journée' }).click();
  await page.getByTestId('skip').click();
  await scan('close show');

  expect(seen, JSON.stringify(seen, null, 1)).toEqual({});
});

test('the first run in French has no English left, by myself and with an AI', async ({ browser }) => {
  test.setTimeout(90_000);
  for (const how of ['myself', 'ai'] as const) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByTestId('ob-lang-fr').click();
    const seen: Record<string, string[]> = {};
    const scan = async (where: string, only = '') => { const h = await english(page, only); if (h.length) seen[how + ': ' + where] = h; };
    await scan('first screen');
    await page.getByTestId('ob-next').click();
    await scan('categories');
    await noSideways(page, 'categories in French');
    await page.getByTestId('ob-next').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await scan('home');
    if (how === 'ai') {
      // An AI, later: the same screens in a sheet, from the Réglages.
      await goTab(page, 'settings');
      await expandSettings(page);
      await page.getByTestId('ai-guided').click();
      await scan('ways', '[data-testid=sheet]');
      await page.getByTestId('ob-way-key').click();
      await scan('key', '[data-testid=sheet]');
      await noSideways(page, 'key in French');
      await page.getByTestId('ob-key-paste').click();
      await scan('paste', '[data-testid=sheet]');
      await noSideways(page, 'paste in French');
      await page.getByTestId('ob-back').click();
      await page.getByTestId('ob-back').click();
      await page.getByTestId('ob-way-connector').click();
      await scan('connect Claude', '[data-testid=sheet]');
      await noSideways(page, 'connect Claude in French');
      await page.getByTestId('ob-link-on').click();
      await scan('recovery key', '[data-testid=sheet]');
      await page.getByTestId('ob-link-key-saved').click();
      await expect(page.getByTestId('ob-link-url')).toBeVisible();
      await scan('connect Claude, steps', '[data-testid=sheet]');
      await noSideways(page, 'connect Claude steps in French');
    }
    expect(seen, JSON.stringify(seen, null, 1)).toEqual({});
    await ctx.close();
  }
});
