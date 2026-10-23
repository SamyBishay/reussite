import { test, expect, type Page } from '@playwright/test';
import { importSample, noSideways, goTab, openMenu, expandSettings } from './helpers';

// The shell (phase 2b): five tabs at the bottom, Home's menu, the Log inside Calendar, decisions inside Projects.
const TABS = ['home', 'today', 'matrix', 'projects', 'calendar'] as const;
const current = (page: Page) => page.locator('.tabbar [aria-current=page]');

test('a fresh start lands on Home, with five tabs and no counts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(current(page)).toHaveAttribute('data-testid', 'tab-home');
  for (const v of TABS) await expect(page.getByTestId('tab-' + v)).toBeVisible();
  await expect(page.locator('.tabbar .tab')).toHaveCount(5);
  // Home has no masthead, suit piles or footer; the other screens keep them.
  await expect(page.locator('.mast, .side, .foot')).toHaveCount(0);
  await goTab(page, 'today');
  await expect(page.locator('.mast')).toBeVisible();
  await expect(page.locator('.foot')).toBeVisible();
  // Counts and badges would be a guilt trip: even with a full list, the bar shows only words.
  await importSample(page);
  await expect(page.locator('.tabbar')).not.toContainText(/\d/);
  await goTab(page, 'matrix');
  await expect(page.locator('.tabbar')).not.toContainText(/\d/);
});

for (const width of [320, 375, 430]) {
  test(`the tab bar sits at the bottom, fits, and nothing scrolls sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await importSample(page);
    for (const v of TABS) {
      await goTab(page, v);
      const bar = await page.getByTestId('tabbar').boundingBox();
      expect(bar!.y + bar!.height, v + ': the bar is at the bottom edge').toBeCloseTo(700, 0);
      expect(bar!.x).toBe(0);
      expect(bar!.width).toBeCloseTo(width, 0);
      // Every tab is a 44 px target and shows its whole label.
      const tabs = await page.locator('.tabbar .tab').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); const l = e.querySelector('span')!; return [r.width, r.height, l.scrollWidth, l.clientWidth]; }));
      for (const [w, h, sw, cw] of tabs) { expect(w).toBeGreaterThanOrEqual(44); expect(h).toBeGreaterThanOrEqual(44); expect(sw).toBeLessThanOrEqual(cw!); }
      await noSideways(page, v + ' with the bar');
    }
    // The last of a long page is not hidden behind the bar.
    await goTab(page, 'matrix');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const last = await page.locator('main').evaluate(el => el.getBoundingClientRect().bottom);
    expect(last).toBeLessThanOrEqual((await page.getByTestId('tabbar').boundingBox())!.y);
  });
}

// Brief §16: above 1024 px the content is a centred column of about 720 px, the suit piles beside it.
for (const [width, height] of [[1440, 900], [1280, 800]] as const) {
  test(`at ${width}×${height} the main column is centred and narrow, and nothing scrolls sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await importSample(page);
    for (const v of ['home', 'today', 'settings'] as const) {
      await goTab(page, v);
      await noSideways(page, v + ' at ' + width);
      const m = await page.locator('main').boundingBox();
      expect(m!.width, v + ': the column is narrow').toBeLessThanOrEqual(760);
      expect(m!.width, v + ': and not squeezed').toBeGreaterThanOrEqual(600);
      expect(Math.abs(m!.x + m!.width / 2 - width / 2), v + ': the column is centred').toBeLessThanOrEqual(2);
    }
    // The piles are a column of their own beside the list, not a strip above it.
    await goTab(page, 'today');
    const side = await page.locator('.side').boundingBox(), main = await page.locator('main').boundingBox();
    expect(side!.x).toBeGreaterThanOrEqual(main!.x + main!.width + 24);
  });
}

test('a sheet covers the tab bar', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('details').first().click();
  await expect(page.getByTestId('sheet')).toBeVisible();
  const covered = await page.getByTestId('tabbar').evaluate(el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + 4)?.closest('.tabbar') == null; });
  expect(covered).toBe(true);
});

test('the on-screen keyboard hides the tab bar while Home’s input has focus, and the input stays in view', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'a phone-only rule: a desktop keeps the bar');
  await importSample(page);
  await goTab(page, 'home');
  await expect(page.getByTestId('tabbar')).toBeVisible();
  await page.getByTestId('home-input').focus();
  await expect(page.getByTestId('tabbar')).toBeHidden();
  await expect(page.locator('body')).toHaveClass(/kb/);
  await expect(page.getByTestId('home-input')).toBeInViewport();
  await page.getByTestId('home-input').blur();
  await expect(page.getByTestId('tabbar')).toBeVisible();
  // A button or a date field is not a keyboard.
  await goTab(page, 'today');
  await page.getByTestId('details').first().click();
  await expect(page.getByTestId('tabbar')).toBeVisible();
});

test('a desktop keeps the tab bar while typing', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await importSample(page);
  await goTab(page, 'home');
  await page.getByTestId('home-input').focus();
  await expect(page.getByTestId('tabbar')).toBeVisible();
});

test('#settings opens Settings, and Home’s menu reaches Settings, Places, Memory and History', async ({ page }) => {
  await page.goto('/#settings'); await expandSettings(page);
  await expandSettings(page);
  await expect(page.getByTestId('open-import')).toBeVisible();
  // Settings belongs to Home: the Home tab stays marked and leads back.
  await expect(current(page)).toHaveAttribute('data-testid', 'tab-home');
  await page.getByTestId('tab-home').click();
  await expect(page.getByTestId('home')).toBeVisible();

  await page.getByTestId('home-menu').click();
  await page.getByTestId('menu-places').click();
  await expect(page.getByTestId('places-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await openMenu(page, 'memory');
  await expect(page.getByTestId('memory')).toBeVisible();
  await expect(page.locator('main h2')).toHaveText('Memory');
  await expect(page.locator('.mast, .side, .foot')).toHaveCount(0);
  await openMenu(page, 'history');
  await expect(page.locator('main h2')).toHaveText('History');
  await openMenu(page, 'settings');
  await expandSettings(page);
  await expect(page.getByTestId('open-import')).toBeVisible();
  await expect(page.locator('.mast, .side, .foot')).toHaveCount(0); // Settings is a plain page now
});

test('the old #log and a stored log view open the Calendar’s Log', async ({ page }) => {
  await page.goto('/#log');
  await expect(page.getByTestId('log')).toBeVisible();
  await expect(current(page)).toHaveAttribute('data-testid', 'tab-calendar');
  await page.evaluate(() => { localStorage.setItem('reussite.view', 'log'); });
  await page.goto('/');
  await page.reload();
  await expect(page.getByTestId('log')).toBeVisible();
  await expect(current(page)).toHaveAttribute('data-testid', 'tab-calendar');
});

test('the Log is a mode of Calendar, next to Day, Week, Month and Agenda', async ({ page }) => {
  await importSample(page);
  await goTab(page, 'calendar');
  await page.getByTestId('cal-week').click();
  await expect(page.getByTestId('calendar-grid')).toHaveAttribute('data-mode', 'week');
  await page.getByTestId('cal-log').click();
  await expect(page.getByTestId('log')).toContainText('Timed sessions');
  await expect(page.getByTestId('log')).not.toContainText('Decisions');
  const view = page.getByRole('group', { name: 'Calendar view' });
  await view.getByRole('button', { name: 'Month' }).click();
  await expect(page.getByTestId('calendar-grid')).toHaveAttribute('data-mode', 'month');
  await expect(page.locator('.sx__month-grid-wrapper')).toBeVisible();
  await page.getByTestId('cal-week').click();
  await expect(page.locator('.sx__week-grid')).toBeVisible();
  // Leaving the Log for a tab and coming back keeps week or month, not the Log.
  await page.getByTestId('cal-log').click();
  await goTab(page, 'today');
  await goTab(page, 'calendar');
  await page.reload();
  await expect(page.getByTestId('log')).toHaveCount(0);
  await expect(page.locator('.sx__week-grid')).toBeVisible();
});

test('decisions live in Projects, and a decision step in the Matrix opens its decision', async ({ page }) => {
  await importSample(page);
  await goTab(page, 'projects');
  await expect(page.getByTestId('decisions')).toContainText('Stay in the flat or move?');
  await page.getByTestId('decisions').getByRole('button', { name: 'Stay in the flat or move?' }).click();
  await expect(page.getByTestId('sheet')).toContainText('Stay one more year');
  await page.keyboard.press('Escape');
  await page.getByTestId('new-decision').click();
  await expect(page.getByTestId('dw-0')).toBeVisible();
  await page.keyboard.press('Escape');

  await goTab(page, 'matrix');
  await expect(page.getByTestId('matrix-decision')).toHaveCount(1);
  await page.getByTestId('matrix-decision').click();
  await expect(page.getByTestId('dw-title')).toHaveValue(/Open a new Claude chat/);
});

test('a decision\'s deadline that is a day is shown like other dates, not as 2026-11-22', async ({ page }) => {
  const hlc = '0000000000001:0000:seed';
  const f = {
    title: 'Stay in the flat or move?', projectId: null, taskId: null, status: 'decided', chosen: 'Stay', chosenId: 'o1', why: 'Cheaper', mustBeTrue: '', falsifier: '', date: '2026-10-01', reviewOn: null,
    problem: { what: 'Rent goes up', should: '', gap: '', constraints: '', deadline: '2026-11-22', control: '' },
    options: [{ id: 'o1', name: 'Stay', screened: null, pros: [], cons: [], prosNot: [], consNot: [] }], taskIds: [], newFacts: [], reviews: [], history: [],
  };
  const doc = { id: 'dec1', _v: 4, _hlc: Object.fromEntries(Object.keys(f).map(k => [k, hlc])), ...f };
  const file = { format: 'reussite-backup', schema: 4, exported: new Date().toISOString(), data: { decisions: [doc] } };
  await page.goto('/#settings'); await expandSettings(page);
  page.once('dialog', d => void d.accept());
  await page.getByTestId('data').locator('input[type=file]').first().setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.locator('.toast')).toBeVisible();
  await page.reload();
  await goTab(page, 'projects');
  await page.getByTestId('decisions').getByRole('button', { name: 'Stay in the flat or move?' }).click();
  const problem = page.getByTestId('sheet').locator('dl.problem');
  await expect(problem).toContainText('Deadline');
  await expect(problem).toContainText('22 Nov');
  await expect(problem).not.toContainText('2026-11-22');
});

test('the manifest starts at Home; the gentle banner shows on every tab but Home, Today and Settings', async ({ page, request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m.start_url).toBe('./#home');
  await importSample(page);
  await goTab(page, 'matrix');
  await expect(page.getByTestId('insist')).toBeVisible();
  await goTab(page, 'home');
  await expect(page.getByTestId('insist')).toHaveCount(0);
  await goTab(page, 'settings');
  await expect(page.getByTestId('insist')).toHaveCount(0);
});

test('every tab label fits at 320px in French', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/#settings'); await expandSettings(page);
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.getByTestId('tab-today')).toContainText('Aujourd’hui');
  const fit = await page.locator('.tabbar .tab span').evaluateAll(els => els.map(l => [l.textContent, l.scrollWidth, l.clientWidth]));
  for (const [name, sw, cw] of fit) expect(sw, String(name)).toBeLessThanOrEqual(cw as number);
});

test('Home, Memory and History do not scroll sideways at 320px in French', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await importSample(page);
  await goTab(page, 'settings');
  await page.getByRole('button', { name: 'Français' }).click();
  await goTab(page, 'home');
  await expect(page.getByTestId('tab-home')).toContainText('Accueil');
  await noSideways(page, 'Accueil');
  await openMenu(page, 'memory');
  await expect(page.getByTestId('memory')).toBeVisible();
  await noSideways(page, 'Mémoire');
  await page.getByTestId('memory-import').click();
  await noSideways(page, 'Mémoire, importer');
  await page.keyboard.press('Escape');
  await openMenu(page, 'history');
  await noSideways(page, 'Historique');
});
