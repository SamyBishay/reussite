// Fewer buttons on the cards' faces (15 Nov), at 320×568 and 390×844, in English and French, with nothing scrolling sideways:
// Start here shows Start and Played, then Note, Move and Drop (I'm stuck only once a card was paused or carried over), and a tap on it opens
// its sheet with Swap, I started earlier and I'm stuck; the form starts with the title, the first move, the note, the due date, the estimate
// and the suit, and asks the place only when there is one; Today has no row of adders, the round plus offers the deck and Leisure & people;
// a small Matrix card has ⇄, a 44px target, which opens the one move sheet (boxes, days, Off today).
import { test, expect, type Page } from '@playwright/test';
import { expandSettings, noSideways, PHONES, LANGS } from './helpers';

const NOW = new Date(2026, 10, 10, 9, 0, 0), TODAY = '2026-11-10';
const step = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'inbox', suit: 'S', kind: 'task', urgent: false, important: false, due: null, est: 20, estBy: 'samy', spent: 0, sessions: [], status: 'open',
  doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-11-01T09:00:00Z', src: 'page',
  starter: 'Open the file', ...o,
});
const world = (language: string, first: Record<string, unknown> = {}) => ({
  exported: '2026-11-09T00:00:00Z', source: 'reussite-v1',
  tasks: {
    a: step('Answer the landlord about the repair quote for the kitchen', { link: 'https://example.org/quote', ...first }),
    b: step('Call the bank', { order: 2 }), c: step('Tidy the desk', { order: 3 }), d: step('Sort the receipts', { order: 4 }),
  },
  projects: { inbox: { name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' } },
  days: { [TODAY]: { date: TODAY, plan: ['a', 'b', 'c', 'd'], launches: [], first: null, checkin: null, closed: null, summary: null } },
  decisions: {}, meta: { settings: { language } }, // no `here`: the importer would make it a place, and the form would ask for one
});
const sheet = (page: Page) => page.getByTestId('sheet');

async function load(page: Page, w: number, h: number, language: string, first: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: w, height: h });
  await page.clock.setFixedTime(NOW);
  await page.goto('/#settings');
  await expandSettings(page);
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world(language, first))) });
  await page.getByRole('button', { name: /^(Import|Importer)$/ }).click();
  await expect(sheet(page)).toBeHidden();
  await page.getByTestId('tab-today').click();
  await expect(page.getByTestId('first')).toContainText('Answer the landlord');
}

/** The test ids of the buttons in a row of Start here, in order (a link, the Go button, has none and is left out). */
const ids = (page: Page, row: string) => page.getByTestId('first').locator(row).locator('button').evaluateAll(bs => bs.map(b => (b as HTMLElement).dataset.testid ?? (b as HTMLElement).innerText));

for (const [w, h] of PHONES) for (const lang of LANGS) {
  const tag = `${w}×${h}, ${lang}`;

  test(`Start here: Start and Played, then Note, Move and Drop; the rest is behind a tap on the card (${tag})`, async ({ page }) => {
    await load(page, w, h, lang);
    expect(await ids(page, '.go:not(.quiet)')).toEqual(['go-timer', 'start-played']);
    expect(await ids(page, '.go.quiet')).toEqual(['first-note', 'first-move', 'drop']);
    await expect(page.getByTestId('first').getByTestId('stuck')).toHaveCount(0);
    await expect(page.getByTestId('first').locator('.edits')).toHaveCount(0);
    for (const b of await page.getByTestId('first').getByRole('button').all()) {
      await b.scrollIntoViewIfNeeded();
      await expect(b).toBeInViewport({ ratio: 1 });
    }
    await noSideways(page, `Start here (${tag})`);

    // A tap on the card: its sheet, with Swap, I started earlier and I'm stuck.
    await page.getByTestId('first').locator('p.t').click();
    const s = sheet(page);
    await expect(s.getByTestId('task-sheet')).toBeVisible();
    for (const id of ['task-swap', 'task-started-earlier', 'stuck']) await expect(s.getByTestId(id)).toBeVisible();
    // The form's first fields, in order; no place field with no place but Anywhere.
    const order = await s.locator('form').evaluate(f => [...f.querySelectorAll('input[name=title], input[name=starter], textarea[name=note], input[name=due], input[name=est], select[name=suit], input[name=urgent]')].map(e => e.getAttribute('name')));
    expect(order).toEqual(['title', 'starter', 'note', 'due', 'est', 'suit', 'urgent']);
    await expect(s.getByTestId('where-field')).toHaveCount(0);
    await noSideways(page, `Start here's sheet (${tag})`);
    await s.getByTestId('task-swap').click();
    await expect(s.getByText(lang === 'fr' ? 'Échanger la première carte' : 'Swap the first card')).toBeVisible();
  });

  test(`Start here: I'm stuck on the face once the card was paused or carried over (${tag})`, async ({ page }) => {
    await load(page, w, h, lang, { spent: 25, sessions: [{ d: '2026-11-09', m: 25, why: 'paused', at: '2026-11-09T10:00:00.000Z' }], carried: 1 });
    await expect(page.getByTestId('go-timer')).toHaveText(lang === 'fr' ? 'Reprendre' : 'Continue');
    expect(await ids(page, '.go.quiet')).toEqual(['first-note', 'first-move', 'drop', 'stuck']);
    for (const b of await page.getByTestId('first').getByRole('button').all()) {
      await b.scrollIntoViewIfNeeded();
      await expect(b).toBeInViewport({ ratio: 1 });
    }
    await noSideways(page, `Start here, paused (${tag})`);
  });

  test(`Today: no row of adders; the round plus offers the deck and Leisure & people (${tag})`, async ({ page }) => {
    await load(page, w, h, lang);
    await expect(page.locator('.todayview .adders')).toHaveCount(0);
    await page.getByTestId('add-card').click();
    const s = sheet(page);
    await expect(s.getByTestId('task-sheet')).toBeVisible();
    await expect(s.getByTestId('add-from-deck')).toBeVisible();
    await expect(s.getByTestId('add-from-standing')).toBeVisible();
    await noSideways(page, `the new card's sheet on Today (${tag})`);
    await s.getByTestId('add-from-deck').click();
    await expect(s.locator('.picklist')).toBeVisible();
    await noSideways(page, `From your deck (${tag})`);
  });

  test(`Matrix: every small card has ⇄ with a 44px target, opening the move sheet with the boxes and the days (${tag})`, async ({ page }) => {
    await load(page, w, h, lang);
    await page.getByTestId('tab-matrix').click();
    const minis = page.getByTestId('quad4').locator('.item.mini');
    await expect(minis).toHaveCount(3);
    for (const m of await minis.all()) {
      const btn = m.getByTestId('mini-move');
      await expect(btn).toBeVisible();
      // In the middle of the screen, as a person scrolls a card to look at it: at the bottom the round plus floats over the fourth box.
      await btn.evaluate(el => el.scrollIntoView({ block: 'center' }));
      // The target: every point of a 44×44 square around the mark's centre reaches the button (its ::after reaches past the mark).
      const r = await btn.evaluate(el => {
        const b = el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        const miss: string[] = [];
        for (const dx of [-21.5, 0, 21.5]) for (const dy of [-21.5, 0, 21.5]) {
          const hit = document.elementFromPoint(cx + dx, cy + dy);
          if (!hit || !el.contains(hit)) miss.push(`${dx},${dy}: ${hit?.className}`);
        }
        return { miss, h: b.height };
      });
      expect(r.miss, 'points of the 44px target that miss ⇄').toEqual([]);
    }
    await noSideways(page, `the Matrix (${tag})`);
    await minis.first().getByTestId('mini-move').click();
    const s = sheet(page);
    await expect(s.getByTestId('move')).toBeVisible();
    for (const q of [1, 2, 3]) await expect(s.getByTestId('to-q' + q)).toBeVisible();
    await expect(s.getByTestId('move-days').locator('[data-day]')).toHaveCount(6);
    await expect(s.getByTestId('move-off-today')).toBeVisible();
    await noSideways(page, `the move sheet (${tag})`);
    // A tap on the card itself still opens its form.
    await page.keyboard.press('Escape');
    await minis.first().locator('button.t').click();
    await expect(s.getByTestId('task-sheet')).toBeVisible();
  });
}
