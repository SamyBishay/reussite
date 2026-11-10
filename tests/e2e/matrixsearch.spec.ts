// The Matrix search (request of 10 Nov): a field at the top that filters the cards as you type, by title, short name, note, project and place, ignoring
// case and accents, keeping the four quadrants; a clear button and a calm empty state.
import { test, expect, type Page } from '@playwright/test';
import { expandSettings, goTab, noSideways, setLanguage, PHONES, LANGS } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');
const step = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'inbox', suit: 'S', kind: 'task', urgent: false, important: false, due: null, est: 20, estBy: 'samy', spent: 0, sessions: [], status: 'open',
  doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T09:00:00Z', src: 'page', ...o,
});
const world = () => ({
  exported: '2026-10-25T00:00:00Z', source: 'reussite-v1',
  tasks: {
    a: step('Call the dentist', { urgent: true, important: true, order: 1 }),
    b: step('Find a café near the library', { urgent: false, important: true, order: 2 }),
    c: step('Sort the receipts', { urgent: true, important: false, order: 3, note: 'The blue folder is under the Écrans pile' }),
    d: step('Water the tomatoes', { project: 'p1', suit: 'H', order: 4 }),
    e: step('Buy a spade', { where: 'home', order: 5, important: true }),
    f: step('Éplucher les légumes', { order: 6, label: 'Veg prep' }),
  },
  projects: {
    inbox: { name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' },
    p1: { name: 'Garden club', suit: 'H', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' },
  },
  days: {}, decisions: {}, meta: { settings: { here: 'home' } },
});

async function load(page: Page, w: number, h: number, lang: 'en' | 'fr') {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('/#settings');
  await expandSettings(page);
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world())) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  await setLanguage(page, lang);
  await goTab(page, 'matrix');
}
const shown = (page: Page) => page.getByTestId('matrix').locator('.items .t, .items .clamp');
const titles = async (page: Page) => (await page.getByTestId('matrix').locator('li').allInnerTexts()).map(x => x.replace(/\s+/g, ' ').trim());

for (const [w, h] of PHONES) for (const lang of LANGS) {
  test(`the search filters as you type, ignoring case and accents, by title, short name, note, project and place, and keeps the four boxes (${w}×${h}, ${lang})`, async ({ page }) => {
    await load(page, w, h, lang);
    const box = page.getByTestId('matrix-search');
    await expect(box).toBeVisible();
    // The field is at the top, above the command box, inside the screen.
    const b = (await box.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(w);
    expect((await page.getByTestId('matrix').boundingBox())!.y).toBeGreaterThan(b.y);
    await noSideways(page, 'matrix with search');
    const all = await titles(page);
    expect(all.length).toBeGreaterThanOrEqual(5);

    // As you type.
    await box.pressSequentially('dent');
    await expect.poll(async () => (await titles(page)).length).toBe(1);
    expect((await titles(page))[0]).toContain('dentist');
    // Case and accents, both ways: "CAFE" finds the café; "ecrans" finds the note's Écrans; "eplucher" finds Éplucher.
    for (const [q, want] of [['CAFE', 'café'], ['ecrans', 'receipts'], ['eplucher', 'Éplucher'], ['épluch', 'Éplucher'], ['Café', 'café']] as const) {
      await box.fill(q);
      await expect.poll(async () => (await titles(page)).length, { message: q }).toBe(1);
      expect((await titles(page))[0], q).toContain(want);
    }
    // Short name, project, place.
    for (const [q, want] of [['veg prep', 'Éplucher'], ['garden', 'tomatoes'], ['home', 'spade']] as const) {
      await box.fill(q);
      await expect.poll(async () => (await titles(page)).filter(x => x.includes(want)).length, { message: q }).toBe(1);
    }
    // The four boxes stay, with their own counts.
    await box.fill('spade');
    for (const k of [1, 2, 3, 4]) await expect(page.getByTestId('quad' + k)).toBeVisible();
    const counts = await Promise.all([1, 2, 3, 4].map(k => page.getByTestId('quad-count' + k).innerText()));
    expect(counts.map(Number).reduce((a, c) => a + c, 0)).toBe(1);

    // Clear.
    await expect(page.getByTestId('matrix-search-clear')).toBeVisible();
    await page.getByTestId('matrix-search-clear').click();
    await expect(box).toHaveValue('');
    await expect.poll(async () => (await titles(page)).length).toBe(all.length);
    await expect(page.getByTestId('matrix-search-clear')).toHaveCount(0);
    await noSideways(page, 'matrix after clear');
  });

  test(`a search that finds nothing says so calmly and keeps the boxes; Escape clears it (${w}×${h}, ${lang})`, async ({ page }) => {
    await load(page, w, h, lang);
    const box = page.getByTestId('matrix-search');
    await box.fill('zzzz');
    await expect(page.getByTestId('matrix-search-none')).toContainText('zzzz');
    await expect(page.getByTestId('matrix-search-none')).not.toHaveClass(/err/);
    for (const k of [1, 2, 3, 4]) { await expect(page.getByTestId('quad' + k)).toBeVisible(); await expect(page.getByTestId('quad-count' + k)).toHaveText('0'); }
    await noSideways(page, 'empty search');
    await box.press('Escape');
    await expect(box).toHaveValue('');
    await expect(page.getByTestId('matrix-search-none')).toHaveCount(0);
  });
}
