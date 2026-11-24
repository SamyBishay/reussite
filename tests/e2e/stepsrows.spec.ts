import { test, expect, type Page } from '@playwright/test';
import { expandSettings, goTab, openProjectCard } from './helpers';

// A project's card list, wrapped over two and three lines at phone widths: no row sits on the next one (seen on an iPhone, 2026-11-24:
// the long Inbox's rows drew over each other, each as tall as one line). Measures every row's box against its text and its neighbour.
const title = (i: number) => ['Find a driver for Teta to Saint Mary’s, Garden City and ask Abouna Yohanna', 'Open Mail, find a UCA newsletter and click unsubscribe (or reply asking to be removed)', 'Sit with Mama, open Anghami on her phone and fix the bill', 'Print Teta’s file and buy a binder'][i % 4]! + ' ' + i;
const world = () => ({
  exported: '2026-10-31T00:00:00Z', source: 'reussite-v1',
  tasks: Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['t' + i, {
    title: title(i), project: 'inbox', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 15, estBy: 'samy', spent: 0, sessions: [], status: 'open',
    doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: i + 1, created: '2026-10-01T09:00:00Z', src: 'page',
  }])),
  projects: { inbox: { name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' } },
  days: {}, decisions: {}, meta: { settings: { here: 'home' } },
});

async function load(page: Page) {
  await page.goto('/#settings');
  await expandSettings(page);
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world())) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('sheet')).toBeHidden();
  await goTab(page, 'projects');
}

for (const w of [320, 390]) {
  test.describe(String(w), () => {
    test.use({ viewport: { width: w, height: 844 } });
    test(`a long project's rows do not overlap at ${w}px`, async ({ page }) => {
      await load(page);
      const whole = await openProjectCard(page, 'Inbox');
      const fold = whole.locator('details', { has: page.locator('ol.steps') }).first();
      if (!(await fold.evaluate(d => (d as HTMLDetailsElement).open))) await fold.locator('summary').first().click();
      const rows = whole.locator('ol.steps > li');
      await expect(rows.first()).toBeVisible();
      const bad = await rows.evaluateAll(els => {
        const out: string[] = [];
        els.forEach((li, i) => {
          const r = li.getBoundingClientRect(), t = li.querySelector('.stept')!.getBoundingClientRect();
          if (t.bottom > r.bottom + 1) out.push(`row ${i}: text ends ${Math.round(t.bottom - r.bottom)}px below its row`);
          const n = els[i + 1]?.getBoundingClientRect();
          if (n && n.top < r.bottom - 1) out.push(`row ${i}: overlaps the next by ${Math.round(r.bottom - n.top)}px`);
        });
        return out;
      });
      expect(bad).toEqual([]);
    });
  });
}
