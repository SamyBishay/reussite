// The morning ritual (plan 2 Nov, S2): shape with a start and an end, the four pillars, the plan laid out against the room the day
// has, the overcommitment line, and the first step alone. The clock is fixed to a Monday morning so nothing depends on the hour.
import { test, expect, type Page } from '@playwright/test';
import { expandSettings, noSideways } from './helpers';

const sheet = (page: Page) => page.getByTestId('sheet');
const at = (hh: number, mm: number) => new Date(2026, 9, 26, hh, mm, 0); // Monday 26 October, this computer's clock
const step = (title: string, suit: string, o: Record<string, unknown> = {}) => ({
  title, project: 'inbox', suit, kind: 'task', urgent: true, important: true, due: null, est: 20, estBy: 'samy', spent: 0, sessions: [], status: 'open',
  doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T09:00:00Z', src: 'page',
  starter: 'Open the file', ...o,
});
const world = () => ({
  exported: '2026-10-25T00:00:00Z', source: 'reussite-v1',
  tasks: {
    a: step('Open the thesis draft and write the method section', 'S', { est: 30 }),
    b: step('Open Mail and send the signed lease', 'D', { est: 15, order: 2 }),
    c: step('Open Messages and text mum about Sunday', 'C', { urgent: true, important: false, est: 10, order: 3 }),
    d: step('Open the thesis draft and fix the references', 'S', { urgent: false, est: 25, order: 4 }),
  },
  projects: { inbox: { name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' } },
  days: {}, decisions: {}, meta: { settings: { here: 'home' } },
});

async function start(page: Page) {
  await page.clock.setFixedTime(at(8, 0));
  await page.goto('/#settings');
  await expandSettings(page);
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world())) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  await page.getByTestId('tab-today').click();
  await page.locator('main').getByRole('button', { name: 'Plan the day' }).click();
  await expect(page.getByTestId('ci-shape')).toBeVisible();
}

test('the morning: Afternoon, pillars kept and one skipped, "x of y free", cut a step, Go, and the first step alone', async ({ page }) => {
  await start(page);
  // Afternoon starts at 14:00 and the day ends at the setting's 19:00.
  await page.getByRole('button', { name: 'Afternoon only' }).click();
  await expect(page.getByTestId('ci-start-at')).toHaveValue('14:00');
  await expect(page.getByTestId('ci-until')).toHaveValue('19:00');
  await page.getByTestId('ci-next').click();

  // One row for each suit; the one with nothing in it says so in one line.
  await expect(page.getByTestId('ci-pillars')).toBeVisible();
  for (const s of ['S', 'D', 'C', 'H']) await expect(page.getByTestId('pillar-' + s)).toBeVisible();
  await expect(page.getByTestId('pillar-H')).toContainText('No life step today. Fine, or add one?');
  const steps = page.getByTestId('pillar-step');
  expect(await steps.count()).toBeGreaterThanOrEqual(2); // Afternoon allows one work step fewer
  await steps.first().getByTestId('pillar-skip').click();
  await expect(page.getByRole('button', { name: 'Keep it' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Keep it' }).click();
  await expect(page.getByRole('button', { name: 'Keep it' })).toHaveCount(0);
  await page.getByTestId('ci-next').click();

  // The plan: steps with projected times from 14:00, and the room the day has.
  await expect(page.getByTestId('plan-items')).toBeVisible();
  await expect(page.getByTestId('plan-items').locator('li[class^=role-]:not(.role-plan)').first()).toContainText('14:00');
  await expect(page.getByTestId('plan-free')).toHaveText(/^.+ of 5 h free\.$/);
  await expect(page.getByTestId('plan-over')).toHaveCount(0);
  const total = await page.getByTestId('plan-free').innerText();

  // Cut one: the free time stays, the planned time drops.
  await page.getByRole('button', { name: 'Too much, cut it' }).click();
  await page.getByRole('button', { name: 'Cut', exact: true }).first().click();
  await page.getByRole('button', { name: 'Done cutting' }).click();
  expect(await page.getByTestId('plan-free').innerText()).not.toBe(total);

  await page.getByTestId('go-with-this').click();
  // The first step alone, with its starter and Start.
  await expect(page.getByTestId('ci-first')).toBeVisible();
  await expect(page.getByTestId('ci-first-title')).toContainText('Open the file →');
  await page.getByTestId('ci-start').click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByTestId('first')).toContainText('Running'); // the timer is on the first step
});

test('a day with less room than steps says by how much, and cutting brings it back', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Afternoon only' }).click();
  await page.getByTestId('ci-until').fill('14:30');
  await page.getByTestId('ci-next').click();
  await page.getByTestId('ci-next').click();
  await expect(page.getByTestId('plan-free')).toContainText('of 30 min free');
  await expect(page.getByTestId('plan-over')).toContainText(/About .+ more than the time you have\./);
  await page.getByTestId('plan-cut-one').click();
  for (let i = 0; i < 6 && await page.getByTestId('plan-over').count(); i++) await page.getByRole('button', { name: 'Cut', exact: true }).first().click();
  await expect(page.getByTestId('plan-over')).toHaveCount(0);
});

test('the day ends when this morning said: the plan keeps it for Today', async ({ page }) => {
  await start(page);
  await page.getByTestId('ci-until').fill('17:30');
  await page.getByTestId('ci-next').click();
  await page.getByTestId('ci-next').click();
  await page.getByTestId('go-with-this').click();
  await page.getByTestId('ci-later').click();
  await expect(sheet(page)).toBeHidden();
  const shape = await page.evaluate(() => new Promise<unknown>(res => {
    const r = indexedDB.open('reussite');
    r.onsuccess = () => { const q = r.result.transaction('days').objectStore('days').getAll(); q.onsuccess = () => res((q.result as { shape?: unknown }[]).map(d => d.shape).find(Boolean)); };
  }));
  expect(shape).toMatchObject({ end: '17:30', preset: 'normal' });
});

for (const width of [320, 375, 430]) {
  test(`the ritual doesn’t scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await start(page);
    await noSideways(page, 'shape with until');
    await page.getByTestId('ci-until').fill('14:30');
    await page.getByTestId('ci-next').click();
    await noSideways(page, 'pillars');
    await page.getByTestId('ci-next').click();
    await noSideways(page, 'plan with the over line');
    await page.getByTestId('go-with-this').click();
    await noSideways(page, 'first step');
  });
}
