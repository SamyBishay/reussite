// Deadlines, events and slots apart (plan 10 Nov), on Today: a deadline whose time has passed stays, plain, never red; a past one is "carried over",
// not "late"; an appointment that passed stays marked missed; a slot that passed shows as passed and is only moved when the person confirms.
// The clock is fixed to Tuesday 10 November, 15:00. Measured at 320×568 and 390×844, in English and French.
import { test, expect, type Page } from '@playwright/test';
import { expandSettings, noSideways, PHONES, LANGS } from './helpers';

const NOW = new Date(2026, 10, 10, 15, 0, 0);
const YESTERDAY = '2026-11-09', TODAY = '2026-11-10';
const step = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'inbox', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 20, estBy: 'samy', spent: 0, sessions: [], status: 'open',
  doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-11-01T09:00:00Z', src: 'page',
  starter: 'Open the file', ...o,
});
const slotPassed = { day: TODAY, at: '09:00', dur: 45 }, slotAhead = { day: TODAY, at: '16:00', dur: 30 };
const world = (language: string) => ({
  exported: '2026-11-09T00:00:00Z', source: 'reussite-v1',
  tasks: {
    rent: step('Pay the rent', { due: TODAY, dueAt: '10:00', order: 1 }),
    form: step('Send the form', { due: TODAY, dueAt: '18:00', order: 2 }),
    tax: step('File the taxes', { due: YESTERDAY, order: 3 }),
    bank: step('Call the bank', { at: '10:00', dur: 30, due: TODAY, order: 4 }),
    rep: step('Write the report', { slot: slotPassed, order: 5 }),
    desk: step('Tidy the desk', { slot: slotAhead, order: 6 }),
  },
  projects: { inbox: { name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' } },
  days: { [TODAY]: { date: TODAY, plan: ['rent', 'form', 'tax', 'bank', 'rep', 'desk'], launches: [], first: null, checkin: null, closed: null, summary: null } },
  decisions: {}, meta: { settings: { here: 'home', language } },
});
const store = (page: Page, name: string) => page.evaluate(n => new Promise<Record<string, unknown>[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const all = open.result.transaction(n).objectStore(n).getAll(); all.onsuccess = () => res(all.result); };
}), name);
const doc = async (page: Page, id: string) => (await store(page, 'tasks')).find(d => d.id === id) as Record<string, any>;

async function load(page: Page, language: string) {
  await page.clock.setFixedTime(NOW);
  await page.goto('/#settings');
  await expandSettings(page);
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world(language))) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('sheet')).toBeHidden();
  await page.getByTestId('tab-today').click();
}

const TEXT = {
  en: { passed: 'was due 10:00', ahead: /due today 18:00/, carried: /carried over · 9 Nov/, missed: 'missed', slotPassed: /slot passed 09:00–09:45/, slotAhead: /slot 16:00–16:30/, late: /\d d late|overdue/i },
  fr: { passed: 'était pour 10:00', ahead: /pour aujourd’hui à 18:00/, carried: /reporté · 9 nov/, missed: 'manqué', slotPassed: /créneau passé 09:00–09:45/, slotAhead: /créneau 16:00–16:30/, late: /de retard/i },
} as const;

for (const language of LANGS) {
  for (const [w, h] of PHONES) {
    test(`${language} at ${w}×${h}: a passed deadline stays plain, a past one is carried over, a missed appointment and a passed slot stay marked`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await load(page, language);
      const x = TEXT[language], main = page.locator('main');
      // The deadline whose time passed: still on Today, "was due 10:00", not red.
      const passed = main.locator('.due', { hasText: x.passed }).first();
      await expect(passed).toBeVisible();
      await expect(passed).not.toHaveClass(/soon/);
      expect(await passed.evaluate(el => getComputedStyle(el).color)).not.toBe(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--red').trim() && (() => { const s = document.createElement('span'); s.style.color = getComputedStyle(document.documentElement).getPropertyValue('--red'); document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; })()));
      // One still ahead keeps its time.
      await expect(main.locator('.due', { hasText: x.ahead }).first()).toBeVisible();
      // Past due: carried over, never "late".
      await expect(main.locator('.due', { hasText: x.carried }).first()).toBeVisible();
      await expect(main).not.toContainText(x.late);
      // The appointment that passed is still on the list, marked.
      await expect(main.getByTestId('missed-tag').first()).toHaveText(x.missed);
      // Slots: ahead as a chip, passed as "slot passed" with Re-slot.
      await expect(main.getByTestId('slot-chip').first()).toHaveText(x.slotAhead);
      await expect(main.getByTestId('slot-passed').first()).toHaveText(x.slotPassed);
      await noSideways(page, `Today with all three at ${w}`);
    });
  }
}

test('Re-slot proposes and writes nothing until the person confirms; the old slot stays in the log; the step never gets an `at`', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, 'en');
  await page.getByTestId('slot-passed').first().click();
  const sheet = page.getByTestId('slot-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('slot-dur')).toHaveValue('45'); // the old length is kept
  expect((await doc(page, 'rep')).slot).toEqual(slotPassed); // opening it wrote nothing
  await sheet.getByTestId('slot-at').fill('16:30');
  await sheet.getByTestId('slot-save').click();
  await expect.poll(async () => (await doc(page, 'rep')).slot).toEqual({ day: TODAY, at: '16:30', dur: 45 });
  const rep = await doc(page, 'rep');
  expect(rep.at ?? null).toBeNull();
  expect(rep.slotLog).toHaveLength(1);
  expect(rep.slotLog[0]).toMatchObject({ from: slotPassed, to: { day: TODAY, at: '16:30', dur: 45 }, why: 'reslotted', by: 'me' });
  await expect(page.locator('main').getByTestId('slot-chip').filter({ hasText: '16:30–17:15' }).first()).toBeVisible();
});

test('a due time is set from the due chip and never reaches the calendar or an `at`', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, 'en');
  await page.locator('main .duechip', { hasText: '18:00' }).first().click();
  await page.getByTestId('due-time').fill('19:30');
  await page.getByTestId('sheet').getByRole('button', { name: 'Today', exact: true }).click();
  await expect.poll(async () => (await doc(page, 'form')).dueAt).toBe('19:30');
  const form = await doc(page, 'form');
  expect(form.due).toBe(TODAY);
  expect(form.at ?? null).toBeNull();
  await expect(page.locator('main .due', { hasText: 'due today 19:30' }).first()).toBeVisible();
});

// Slots in the Calendar tab: every view shows them, set apart from the appointment by style (a dashed outline and the word "slot"); the
// appointment stays solid. At 320 and 390, in both languages.
for (const language of LANGS) {
  for (const [w, h] of PHONES) {
    test(`${language} at ${w}×${h}: the Calendar draws a slot in Day, week, Month and Agenda, set apart from the appointment`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await load(page, language);
      await page.getByTestId('tab-calendar').click();
      const word = language === 'fr' ? 'créneau' : 'slot';
      for (const mode of ['day', 'week', 'month', 'agenda']) {
        await page.getByTestId('cal-' + mode).click();
        await expect(page.getByTestId('calendar-grid')).toHaveAttribute('data-mode', mode);
        const grid = page.getByTestId('calendar-grid');
        const slot = grid.locator('.sx__event.k-slot', { hasText: word + ' · ' }).first();
        await expect(slot, mode).toBeVisible();
        const bank = grid.locator('.sx__event.k-fixed').first();
        await expect(bank, mode).toBeVisible();
        await expect(bank, mode).not.toHaveClass(/k-slot/);
        // A slot is dashed; an appointment is not.
        await expect.poll(() => slot.evaluate(el => getComputedStyle(el).borderStyle), mode).toMatch(/dashed/);
        await expect.poll(() => bank.evaluate(el => getComputedStyle(el).borderStyle), mode).not.toMatch(/dashed/);
      }
      await noSideways(page, `Calendar with a slot at ${w}`);
    });
  }
}
