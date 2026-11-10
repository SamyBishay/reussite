// Two-state buttons (request of 29 Oct, never verified until 10 Nov): "Drop it" → "Really?" and the other confirm buttons. When the button
// is armed its label never wraps and nothing beside it moves, at 320 and 390, in English and French. Every confirm button is measured here.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { expandSettings, goTab, openMenu, noSideways, setLanguage, PHONES, LANGS } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');
const NOW = new Date(2026, 9, 26, 15, 0, 0);
const YESTERDAY = '2026-10-25', TODAY = '2026-10-26';
const step = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'inbox', suit: 'S', kind: 'task', urgent: true, important: true, due: null, est: 20, estBy: 'samy', spent: 0, sessions: [], status: 'open',
  doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T09:00:00Z', src: 'page',
  starter: 'Open the file', ...o,
});
const day = (date: string, plan: string[]) => ({ date, plan, launches: [], first: null, checkin: null, closed: null, summary: null });
const world = (todayPlan: string[]) => ({
  exported: '2026-10-25T00:00:00Z', source: 'reussite-v1',
  tasks: {
    a: step('Answer the landlord'), b: step('Tidy the desk', { order: 2 }), c: step('Sort the receipts', { order: 3 }),
    r: step('Water the plants', { order: 4, repeat: { every: 1, unit: 'week', weekdays: [1], from: 'due' }, due: TODAY }),
    call: step('Call the dentist', { at: '14:00', dur: 30, due: YESTERDAY, order: 5 }),
    ev: step('Hear back from the agency', { kind: 'event', order: 6, urgent: false, important: false }),
  },
  projects: { inbox: { name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' } },
  days: { [YESTERDAY]: day(YESTERDAY, ['a', 'b', 'c', 'call']), [TODAY]: day(TODAY, todayPlan) }, decisions: {}, meta: { settings: { here: 'home' } },
});

async function load(page: Page, w: number, h: number, lang: 'en' | 'fr', todayPlan: string[]) {
  await page.setViewportSize({ width: w, height: h });
  await page.clock.setFixedTime(NOW);
  await page.goto('/#settings');
  await expandSettings(page);
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world(todayPlan))) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  await setLanguage(page, lang);
}

type Box = { x: number; y: number; w: number; h: number };
/** Every visible button and link in the row of `btn` (its parent), with its box; and how many lines of text `btn` shows. */
const measure = (btn: Locator) => btn.evaluate(el => {
  const row = el.parentElement!;
  // Boxes are taken from the row's own corner, so a scroll of the page or of the sheet (a tap scrolls the button into view) is not a move.
  const o = row.getBoundingClientRect();
  const box = (e: Element): Box => { const r = e.getBoundingClientRect(); return { x: Math.round((r.x - o.x) * 2) / 2, y: Math.round((r.y - o.y) * 2) / 2, w: Math.round(r.width * 2) / 2, h: Math.round(r.height * 2) / 2 }; };
  const others = [...row.querySelectorAll('button, a, input, select')].filter(x => x !== el && !el.contains(x) && (x as HTMLElement).getClientRects().length).map(box);
  // Lines of the visible text: the distinct tops of the text's client rects.
  const range = document.createRange();
  const tops = new Set<number>();
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const p = n.parentElement!;
    if (getComputedStyle(p).visibility === 'hidden' || p.closest('[aria-hidden=true]')) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
  }
  return { self: box(el), others, lines: tops.size, right: el.getBoundingClientRect().right, vw: document.documentElement.clientWidth, text: (el as HTMLElement).innerText };
});

/** First tap arms the button: label changed or not, it is still on one line, still inside the screen, and neither it nor its neighbours moved. */
async function armed(page: Page, btn: Locator, where: string) {
  await expect(btn, where).toBeVisible();
  await btn.scrollIntoViewIfNeeded();
  const before = await measure(btn);
  expect(before.lines, where + ': idle label on one line').toBe(1);
  await btn.click();
  await expect.poll(async () => (await measure(btn)).text, { message: where + ': the label changes when armed' }).not.toBe(before.text);
  const after = await measure(btn);
  expect(after.lines, where + ': confirm label wraps (' + after.text + ')').toBe(1);
  expect(after.right, where + ': confirm label past the screen').toBeLessThanOrEqual(after.vw + 0.5);
  expect(after.self, where + ': the button itself moved or changed size').toEqual(before.self);
  expect(after.others, where + ': a neighbouring button moved').toEqual(before.others);
  await noSideways(page, where);
}

for (const [w, h] of PHONES) for (const lang of LANGS) {
  const tag = `${w}×${h}, ${lang}`;

  test(`Drop on Start here, plain and as a series (${tag})`, async ({ page }) => {
    await load(page, w, h, lang, ['r']);
    await goTab(page, 'today');
    await expect(page.getByTestId('first')).toContainText('Water the plants');
    await armed(page, page.getByTestId('first').getByTestId('drop'), 'start here, series');
    await page.reload();
    await goTab(page, 'today');
    await armed(page, page.getByTestId('first').getByTestId('drop'), 'start here, series (again)');
  });

  test(`Drop in the card's sheet, plain and as a series (${tag})`, async ({ page }) => {
    await load(page, w, h, lang, ['a']);
    for (const id of ['a', 'r']) {
      await page.goto('/#task/' + id);
      await armed(page, sheet(page).getByTestId('drop'), 'sheet ' + id);
      await page.keyboard.press('Escape');
    }
  });

  test(`Drop on a step waited for (${tag})`, async ({ page }) => {
    await load(page, w, h, lang, ['a']);
    await openMenu(page, 'waiting');
    await armed(page, page.getByTestId('event-drop').first(), 'waiting for');
  });

  test(`Drop on a carried card and Remove on a missed item (${tag})`, async ({ page }) => {
    await load(page, w, h, lang, ['a']);
    await goTab(page, 'today');
    await page.locator('main').getByRole('button', { name: lang === 'fr' ? /Planifier la journée/ : 'Plan the day' }).first().click();
    await expect(page.getByTestId('ci-yesterday')).toBeVisible();
    await armed(page, page.getByTestId('carried-drop'), 'carried');
    // Answer the rest of the cards to reach the missed item.
    for (let i = 0; i < 6; i++) {
      if (await sheet(page).getByTestId('missed-remove').count()) break;
      const today = page.getByTestId('carried-today');
      if (await today.count()) await today.click(); else break;
    }
    await armed(page, sheet(page).getByTestId('missed-remove'), 'missed');
  });

  test(`Remove on an address and Delete on a visit use the same two taps (${tag})`, async ({ page }) => {
    await load(page, w, h, lang, ['a']);
    await page.goto('/#addresses');
    await page.getByTestId('addr-new').click();
    await sheet(page).getByTestId('addr-name').fill('Hill House');
    await sheet(page).getByTestId('addr-save').click();
    await expect(sheet(page)).toBeHidden();
    await page.getByTestId('address-open').first().click();
    await armed(page, sheet(page).getByTestId('addr-remove'), 'address');
  });
}
