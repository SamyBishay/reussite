// The card sheet's three fields (plan 10 Nov): Due / Pour le (a date and an optional time), At / À (a time and a length: an appointment) and
// Slot / Créneau (time set aside to work on it). Each writes its own fields and nothing else. At 320×568 and 390×844, in English and French.
import { test, expect, type Page } from '@playwright/test';
import { expandSettings, noSideways, PHONES, LANGS } from './helpers';

const NOW = new Date(2026, 10, 10, 8, 0, 0), TODAY = '2026-11-10';
const step = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'inbox', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 20, estBy: 'samy', spent: 0, sessions: [], status: 'open',
  doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-11-01T09:00:00Z', src: 'page',
  starter: 'Open the file', ...o,
});
const world = (language: string) => ({
  exported: '2026-11-09T00:00:00Z', source: 'reussite-v1',
  tasks: { rep: step('Write the report'), same: step('Tidy the desk', { slot: { day: TODAY, at: '09:00', dur: 30 } }) },
  projects: { inbox: { name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' } },
  days: { [TODAY]: { date: TODAY, plan: ['rep', 'same'], launches: [], first: null, checkin: null, closed: null, summary: null } }, decisions: {}, meta: { settings: { here: 'home', language } },
});
const tasks = (page: Page) => page.evaluate(() => new Promise<Record<string, any>[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const all = open.result.transaction('tasks').objectStore('tasks').getAll(); all.onsuccess = () => res(all.result); };
}));
const doc = async (page: Page, id: string) => (await tasks(page)).find(t => t.id === id)!;
const LABEL = { en: { due: 'Due', at: 'At', slot: 'Slot', save: 'Save' }, fr: { due: 'Pour le', at: 'À', slot: 'Créneau', save: 'Enregistrer' } } as const;

for (const language of LANGS) {
  for (const [w, h] of PHONES) {
    test(`${language} at ${w}×${h}: the sheet has Due, At and Slot, each writing only its own fields`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.clock.setFixedTime(NOW);
      await page.goto('/#settings');
      await expandSettings(page);
      await page.getByTestId('open-import').click();
      await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world(language))) });
      await page.getByRole('button', { name: /^(Import|Importer)$/ }).click();
      await expect(page.getByTestId('sheet')).toBeHidden();
      const L = LABEL[language];
      await page.goto('/#task/rep');
      const sheet = page.getByTestId('sheet');
      await expect(sheet).toBeVisible();
      for (const [g, name] of [['group-due', L.due], ['group-at', L.at], ['group-slot', L.slot]] as const) await expect(sheet.getByTestId(g).locator('legend')).toHaveText(name);
      await noSideways(page, `the card sheet at ${w}`);

      // A deadline with a time, and a slot; no appointment.
      await sheet.locator('input[name=due]').fill('2026-11-12');
      await sheet.getByTestId('due-at').fill('17:00');
      await sheet.getByTestId('slot-day').fill(TODAY);
      await sheet.getByTestId('slot-at').fill('14:00');
      await sheet.getByTestId('slot-dur').fill('45');
      await sheet.getByRole('button', { name: L.save, exact: true }).click();
      await expect(sheet).toBeHidden();
      await expect.poll(async () => (await doc(page, 'rep')).slot).toEqual({ day: TODAY, at: '14:00', dur: 45 });
      let rep = await doc(page, 'rep');
      expect(rep).toMatchObject({ due: '2026-11-12', dueAt: '17:00' });
      expect(rep.at ?? null).toBeNull();
      expect(rep.dur ?? null).toBeNull();
      expect(rep.slotLog).toHaveLength(1);
      expect(rep.slotLog[0]).toMatchObject({ from: null, why: 'set', by: 'me' });

      // Saving again with only the title changed leaves the slot and its log alone; taking the slot off is logged.
      await page.goto('/#task/rep');
      await expect(sheet.getByTestId('slot-log')).toBeVisible();
      await sheet.locator('input[name=title]').fill('Write the council report');
      await sheet.getByRole('button', { name: L.save, exact: true }).click();
      await expect(sheet).toBeHidden();
      await expect.poll(async () => (await doc(page, 'rep')).title).toBe('Write the council report');
      expect((await doc(page, 'rep')).slotLog).toHaveLength(1);
      await page.goto('/#task/rep');
      await sheet.getByTestId('slot-clear').click(); // a time input cannot always be emptied by hand
      await sheet.getByRole('button', { name: L.save, exact: true }).click();
      await expect.poll(async () => (await doc(page, 'rep')).slot ?? null).toBeNull();
      rep = await doc(page, 'rep');
      expect(rep.slotLog).toHaveLength(2);
      expect(rep.slotLog[1]).toMatchObject({ to: null, why: 'cleared' });
      expect(rep.dueAt).toBe('17:00'); // the deadline is untouched
    });
  }
}
