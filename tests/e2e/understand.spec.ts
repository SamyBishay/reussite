// Settings → How Réussite understands you (15 Nov): one place for the choice between On this device (the default) and A cloud AI, whose two ways are
// My own key and My AI chat app through the connector; one status list under it ("is it all linked?") whose lines open the piece that does each;
// On this device leaves the connector as it was. No copy and paste anywhere in set-up or Settings, and the Connect screen names the three chat
// apps in order with who can use each (DECISIONS.md 2026-11-15).
import { test, expect, type Page } from '@playwright/test';
import { noSideways, PHONES, LANGS, NO_SERVICE_WORKER } from './helpers';

const NEW_DEVICE = { cookies: [], origins: [] };

const WORDS = {
  en: {
    title: 'How Réussite understands you', device: 'On this device', cloud: 'A cloud AI', key: 'My own key', connector: 'My AI chat app, through the connector',
    syncOff: 'Sync is off.', noKey: 'No key on this device.', connOn: 'The connector is on.', appSeen: 'Your chat app last came in', stays: 'doesn’t switch the connector off',
    chatgpt: 'isn’t confirmed', gemini: '18 or over',
  },
  fr: {
    title: 'Comment Réussite vous comprend', device: 'Sur cet appareil', cloud: 'Une IA dans le cloud', key: 'Ma propre clé', connector: 'Mon appli de chat IA, par le connecteur',
    syncOff: 'La synchronisation est désactivée.', noKey: 'Pas de clé sur cet appareil.', connOn: 'Le connecteur est activé.', appSeen: 'Votre appli de chat est venue', stays: 'ne désactive pas le connecteur',
    chatgpt: 'pas confirmé', gemini: '18 ans ou plus',
  },
} as const;

/** Copy-and-paste wording, in either language. */
const PASTE = /paste|chatbot|copier-coller|\bcoll(?:e|er|ez)\b/i;

/** Every word under `selector`, folded parts included, with placeholders and labels; the changelog (the history of the app) is left out. */
const wordsOf = (page: Page, selector: string) => page.evaluate(sel => {
  const root = document.querySelector(sel);
  if (!root) return '';
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('pre.changelog').forEach(e => e.remove());
  const attrs = [...copy.querySelectorAll('[placeholder],[aria-label],[title]')].map(e => ['placeholder', 'aria-label', 'title'].map(a => e.getAttribute(a) ?? '').join(' '));
  return (copy.textContent ?? '') + ' ' + attrs.join(' ');
}, selector);

const pressed = (page: Page, id: string, on: boolean) => expect(page.getByTestId(id)).toHaveAttribute('aria-pressed', String(on));
const toTop = (page: Page) => page.evaluate(() => window.scrollTo(0, 0));
const openSection = async (page: Page) => {
  // Home's menu, as a person goes (goTab would open every fold).
  await page.getByTestId('tab-home').click();
  await page.getByTestId('home-menu').click();
  await page.getByTestId('menu-settings').click();
  const s = page.getByTestId('understand');
  await expect(s).not.toHaveAttribute('open', ''); // Settings opens folded, as before
  await s.locator('summary').first().click();
  await expect(page.getByTestId('understand-status')).toBeVisible();
};

// The connector's state is stubbed and read again after a reload (NO_SERVICE_WORKER says why).
test.use({ storageState: NEW_DEVICE, ...NO_SERVICE_WORKER });

for (const [w, h] of PHONES) for (const lang of LANGS) {
  test(`one place for the choice, the status list and its links, no copy and paste, the three chat apps (${w}×${h}, ${lang})`, async ({ page }) => {
    test.slow();
    const W = WORDS[lang];
    await page.setViewportSize({ width: w, height: h });

    // Set-up says nothing of pasting.
    await page.goto('/');
    await expect(page.getByTestId('ob-language')).toBeVisible();
    await page.getByTestId('ob-lang-' + lang).click();
    expect(await wordsOf(page, '.ob'), 'welcome').not.toMatch(PASTE);
    await page.getByTestId('ob-next').click();
    await expect(page.getByTestId('ob-pillars')).toBeVisible();
    expect(await wordsOf(page, '.ob'), 'suits').not.toMatch(PASTE);
    await page.getByTestId('ob-skip').click();
    await expect(page.getByTestId('home')).toBeVisible();

    // The section, and its three options: On this device (chosen on a new install), and A cloud AI with its two ways.
    await openSection(page);
    const s = page.getByTestId('understand');
    await expect(s.locator('summary').first()).toContainText(W.title);
    await expect(page.getByTestId('ai-none')).toContainText(W.device);
    await expect(page.getByTestId('understand-cloud')).toContainText(W.cloud);
    await pressed(page, 'ai-none', true);
    await pressed(page, 'understand-cloud', false);
    await expect(page.getByTestId('way-key')).toContainText(W.key);
    await expect(page.getByTestId('way-connector')).toContainText(W.connector);
    await pressed(page, 'ai-openai', false);
    await pressed(page, 'ai-anthropic', false);
    await expect(page.getByTestId('understand-connector-stays')).toHaveCount(0); // nothing to say: the connector is off
    await noSideways(page, 'the section');

    // The status list: five lines, none done on a new install.
    const lines = page.getByTestId('understand-status').locator('li');
    await expect(lines).toHaveCount(5);
    for (const id of ['sync', 'recovery', 'connector', 'chatApp', 'key']) await expect(page.getByTestId('ust-' + id)).toHaveAttribute('data-done', 'no');
    await expect(page.getByTestId('ust-sync')).toContainText(W.syncOff);
    await expect(page.getByTestId('ust-key')).toContainText(W.noKey);

    // Each line opens its piece, on this screen.
    await toTop(page);
    await page.getByTestId('ust-go-key').click();
    await expect(page.getByTestId('ai-openai')).toBeFocused();
    await expect(page.getByTestId('ai-settings')).toBeInViewport();
    await toTop(page);
    await page.getByTestId('ust-go-connector').click();
    await expect(page.getByTestId('connector')).toBeInViewport();
    await expect(page.getByTestId('connector-guided')).toBeFocused();
    await toTop(page);
    await page.getByTestId('ust-go-chatApp').click();
    await expect(page.getByTestId('connector')).toBeInViewport();
    await toTop(page);
    await page.getByTestId('ust-go-sync').click();
    await expect(page.getByTestId('sync')).toHaveJSProperty('open', true);
    await expect(page.getByTestId('sync-setup')).toBeFocused();
    await toTop(page);
    await page.getByTestId('ust-go-recovery').click();
    await expect(page.getByTestId('sync-setup')).toBeFocused();
    await noSideways(page, 'the status list opened its pieces');

    // A cloud AI, then a provider; On this device sets the provider back to none.
    await page.getByTestId('understand-cloud').click();
    await pressed(page, 'understand-cloud', true);
    await pressed(page, 'ai-none', false);
    await page.getByTestId('ai-anthropic').click();
    await expect(page.getByTestId('ai-key')).toBeVisible();
    await page.getByTestId('ai-none').click();
    await pressed(page, 'ai-none', true);
    await pressed(page, 'ai-anthropic', false);
    await expect(page.getByTestId('ai-key')).toHaveCount(0);

    // No copy and paste anywhere in Settings, folded parts included.
    await page.getByTestId('settings').locator('details').evaluateAll(ds => ds.forEach(d => { (d as HTMLDetailsElement).open = true; }));
    expect(await wordsOf(page, '[data-testid=settings]'), 'Settings').not.toMatch(PASTE);
    await noSideways(page, 'Settings, all open');

    // My own key, step by step: no paste either.
    await page.getByTestId('ai-guided').click();
    await expect(page.getByTestId('ob-key')).toBeVisible();
    expect(await wordsOf(page, '.ob'), 'get a key').not.toMatch(PASTE);
    await noSideways(page, 'get a key');
    await page.getByTestId('ob-back').click();
    await expect(page.getByTestId('sheet')).toBeHidden();

    // The Connect screen: who can use it, in each app, before starting: ChatGPT, Claude, Gemini, then any app that takes MCP connectors.
    await page.getByTestId('connector-guided').click();
    await expect(page.getByTestId('ob-link')).toBeVisible();
    const who = page.getByTestId('ob-link').getByTestId('conn-apps-who').locator('li');
    await expect(who).toHaveCount(4);
    for (const [i, name] of ['ChatGPT', 'Claude', 'Gemini'].entries()) await expect(who.nth(i)).toContainText(new RegExp('^' + name));
    await expect(page.getByTestId('ob-link').getByTestId('conn-app-chatgpt')).toContainText(W.chatgpt);
    await expect(page.getByTestId('ob-link').getByTestId('conn-app-gemini')).toContainText(W.gemini);
    await expect(page.getByTestId('ob-link').getByTestId('conn-app-other')).toContainText('MCP');
    expect(await wordsOf(page, '.ob'), 'connect').not.toMatch(PASTE);
    await noSideways(page, 'connect: who can use it');
    await page.getByTestId('ob-back').click();
    await expect(page.getByTestId('sheet')).toBeHidden();
  });

  test(`On this device leaves the connector as it was; the status list follows sync, the recovery key and the chat app (${w}×${h}, ${lang})`, async ({ page }) => {
    test.slow();
    const W = WORDS[lang];
    await page.setViewportSize({ width: w, height: h });
    // The relay says the connector is on and a chat app came in (sync is real; the connector's state is stubbed). Anything but a read is counted.
    const writes: string[] = [];
    await page.route('**/v1/spaces/*/connector**', async route => {
      if (route.request().method() !== 'GET') { writes.push(route.request().method()); return route.fallback(); }
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ on: true, lastUsed: Date.now() - 60_000, url: 'http://localhost:8787/mcp' }) });
    });
    await page.goto('/');
    await page.getByTestId('ob-lang-' + lang).click();
    await page.getByTestId('ob-skip').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await openSection(page);

    // Sync on, its key not saved yet: the recovery line opens the key.
    await page.getByTestId('ust-go-sync').click();
    await page.getByTestId('sync-setup').click();
    await page.getByTestId('sync-make-key').click();
    await expect(page.getByTestId('recovery-key')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sheet')).toBeHidden();
    await expect(page.getByTestId('ust-sync')).toHaveAttribute('data-done', 'yes');
    await expect(page.getByTestId('ust-recovery')).toHaveAttribute('data-done', 'no');
    await page.getByTestId('ust-go-recovery').click();
    await expect(page.getByTestId('sync-show-key')).toBeVisible();
    await noSideways(page, 'the recovery key from the status list');
    await page.getByTestId('sync-show-key').locator('.btn.primary').click();
    await expect(page.getByTestId('ust-recovery')).toHaveAttribute('data-done', 'yes');

    // The connector is on and the chat app came in: a cloud AI shows as chosen.
    await expect(page.getByTestId('ust-connector')).toContainText(W.connOn);
    await expect(page.getByTestId('ust-connector')).toHaveAttribute('data-done', 'yes');
    await expect(page.getByTestId('ust-chatApp')).toContainText(W.appSeen);
    await expect(page.getByTestId('ust-chatApp')).toHaveAttribute('data-done', 'yes');
    await pressed(page, 'understand-cloud', true);
    await expect(page.getByTestId('connector-state')).toBeVisible();
    await noSideways(page, 'all linked but the key');

    // On this device: the provider is none, and the connector stays on with its own switch, said in one line.
    await page.getByTestId('ai-none').click();
    await pressed(page, 'ai-none', true);
    await expect(page.getByTestId('understand-connector-stays')).toContainText(W.stays);
    await expect(page.getByTestId('connector-state')).toBeVisible();
    await expect(page.getByTestId('ust-connector')).toHaveAttribute('data-done', 'yes');
    await expect(page.getByTestId('sync-status')).toBeAttached();
    expect(writes).toEqual([]);
    await noSideways(page, 'on this device, the connector still on');
    // Its switch is the connector's own: it asks first, and nothing is switched off until confirmed.
    await page.getByTestId('understand-connector-off').click();
    await expect(page.getByTestId('connector-off-sheet')).toBeVisible();
    await noSideways(page, 'the connector switch');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sheet')).toBeHidden();
    expect(writes).toEqual([]);
    await page.reload();
    await openSection(page);
    await expect(page.getByTestId('ust-connector')).toHaveAttribute('data-done', 'yes');
  });
}
