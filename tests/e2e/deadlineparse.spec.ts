// What is typed on Home (plan 10 Nov): "by / before / avant / d'ici / pour le" and a time is a deadline's time (`dueAt`), a bare time is an
// appointment (`at`), and a line never makes a slot. The clock is fixed to Monday 26 October, 11:00. At 320×568 and 390×844, in both languages.
import { test, expect, type Page } from '@playwright/test';
import { PHONES, LANGS, noSideways, expandSettings } from './helpers';

const input = (page: Page) => page.getByTestId('home-input');
const say = async (page: Page, text: string) => { await input(page).fill(text); await input(page).press('Enter'); await input(page).blur(); };
const tasks = (page: Page) => page.evaluate(() => new Promise<Record<string, any>[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const all = open.result.transaction('tasks').objectStore('tasks').getAll(); all.onsuccess = () => res(all.result); };
}));
const made = async (page: Page, title: string) => { await expect.poll(async () => (await tasks(page)).some(t => t.title === title && !t._del)).toBe(true); return (await tasks(page)).find(t => t.title === title && !t._del)!; };

const LINES = {
  en: [['Pay the rent by 17:00', 'Pay the rent', { due: '2026-10-26', dueAt: '17:00', at: null }], ['Send the form before 5pm Friday', 'Send the form', { due: '2026-10-30', dueAt: '17:00', at: null }], ['Lunch with Alex Tuesday 12:30', 'Lunch with Alex', { due: '2026-10-27', at: '12:30', dueAt: null }]],
  fr: [['Payer le loyer avant 17h', 'Payer le loyer', { due: '2026-10-26', dueAt: '17:00', at: null }], ['Envoyer le dossier pour le 30/10 à 17h', 'Envoyer le dossier', { due: '2026-10-30', dueAt: '17:00', at: null }], ['Déjeuner avec Alex mardi 12h30', 'Déjeuner avec Alex', { due: '2026-10-27', at: '12:30', dueAt: null }]],
} as const;

for (const language of LANGS) {
  for (const [w, h] of PHONES) {
    test(`${language} at ${w}×${h}: a deadline's time is dueAt, a bare time is at, and no line makes a slot`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.clock.setFixedTime(new Date(2026, 9, 26, 11, 0, 0));
      await page.goto('/');
      if (language === 'fr') {
        await page.goto('/#settings');
        await expandSettings(page);
        await page.getByRole('button', { name: 'Français', exact: true }).click();
        await page.goto('/');
      }
      for (const [line, title, want] of LINES[language]) {
        await say(page, line);
        const t = await made(page, title);
        for (const [k, v] of Object.entries(want)) expect(t[k] ?? null, `${line} → ${k}`).toBe(v);
        expect(t.slot ?? null, line).toBeNull();
      }
      await noSideways(page, `Home after the lines at ${w}`);
    });
  }
}
