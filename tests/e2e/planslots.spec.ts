// Plan my day writes slots, never a time (plan 10 Nov): once the morning ritual's plan is accepted, each planned step has a slot at the time
// the plan showed for it, a log entry "planned", and no `at`; an appointment is not given a slot. The clock is fixed to a Monday, 08:00.
import { test, expect, type Page } from '@playwright/test';
import { expandSettings, noSideways, PHONES, LANGS } from './helpers';

const at = (hh: number, mm: number) => new Date(2026, 9, 26, hh, mm, 0); // Monday 26 October
const DAY = '2026-10-26';
const step = (title: string, suit: string, o: Record<string, unknown> = {}) => ({
  title, project: 'inbox', suit, kind: 'task', urgent: true, important: true, due: null, est: 20, estBy: 'samy', spent: 0, sessions: [], status: 'open',
  doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T09:00:00Z', src: 'page',
  starter: 'Open the file', ...o,
});
const world = (language: string) => ({
  exported: '2026-10-25T00:00:00Z', source: 'reussite-v1',
  tasks: {
    a: step('Open the thesis draft and write the method section', 'S', { est: 30 }),
    b: step('Open Mail and send the signed lease', 'D', { est: 15, order: 2 }),
    c: step('Open Messages and text mum about Sunday', 'C', { urgent: true, important: false, est: 10, order: 3 }),
    call: step('Call the dentist', 'C', { at: '12:00', dur: 30, due: DAY, order: 4 }),
  },
  projects: { inbox: { name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' } },
  days: {}, decisions: {}, meta: { settings: { here: 'home', language } },
});
const tasks = (page: Page) => page.evaluate(() => new Promise<Record<string, any>[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const all = open.result.transaction('tasks').objectStore('tasks').getAll(); all.onsuccess = () => res(all.result); };
}));

for (const language of LANGS) {
  for (const [w, h] of PHONES) {
    test(`${language} at ${w}×${h}: accepting the plan writes a slot for each planned step, the plan's own times, and no at`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.clock.setFixedTime(at(8, 0));
      await page.goto('/#settings');
      await expandSettings(page);
      await page.getByTestId('open-import').click();
      await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world(language))) });
      await page.getByRole('button', { name: /^(Import|Importer)$/ }).click();
      await expect(page.getByTestId('sheet')).toBeHidden();
      await page.getByTestId('tab-today').click();
      await page.locator('main').getByRole('button', { name: language === 'fr' ? 'Planifier la journée' : 'Plan the day' }).click();
      await expect(page.getByTestId('ci-shape')).toBeVisible();
      await page.getByTestId('ci-next').click();
      await page.getByTestId('ci-next').click();
      // The times the plan shows for each step.
      const shown = await page.getByTestId('plan-items').locator('li[class^=role-]:not(.role-plan)').allInnerTexts();
      expect(shown.length).toBeGreaterThanOrEqual(2);
      await noSideways(page, `the plan at ${w}`);
      await page.getByTestId('go-with-this').click();
      await expect(page.getByTestId('ci-first')).toBeVisible();

      await expect.poll(async () => (await tasks(page)).filter(t => t.slot).length).toBeGreaterThanOrEqual(2);
      const all = await tasks(page);
      const planned = all.filter(t => t.slot);
      for (const t of planned) {
        expect(t.slot.day, t.title).toBe(DAY);
        expect(t.slot.at, t.title).toMatch(/^\d\d:\d\d$/);
        expect(t.slot.dur, t.title).toBeGreaterThanOrEqual(5);
        expect(t.at ?? null, t.title + ' got no at').toBeNull();
        expect(t.slotLog).toHaveLength(1);
        expect(t.slotLog[0]).toMatchObject({ from: null, why: 'planned', by: 'me' });
        // The time the plan showed for this step is its slot's start.
        expect(shown.some(s => s.includes(t.slot.at)), `${t.title}: plan showed ${t.slot.at}`).toBe(true);
      }
      // The appointment keeps its own time and gets no slot.
      const call = all.find(t => t.title === 'Call the dentist')!;
      expect(call.slot ?? null).toBeNull();
      expect(call.at).toBe('12:00');
    });
  }
}
