// The tap budget of the quick changes (fewer buttons on the cards' faces, 15 Nov). Each of the six quick changes (mark urgent, mark important,
// reorder, move: to another box, off today or to another day, drop, add a note) is made as a person would on a phone, by taps only (no keyboard,
// no long press, no drag), from each place a card shows: Start here on Today, a row of today's hand, a small card in a Matrix box, and a card in
// the Matrix's View all sheet. The spec counts the taps and whether the person left the screen (a sheet over the same screen is not leaving
// it; a change of tab, or of the day Today shows, is). BUDGET is what it cost before the faces were simplified (2dbe737); NOW is what it costs
// with them: no number may be above its budget, and no change that was made on the same screen may need another one.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { expandSettings } from './helpers';

const NOW = new Date(2026, 10, 10, 9, 0, 0), TODAY = '2026-11-10', TOMORROW = '2026-11-11';
const step = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'inbox', suit: 'S', kind: 'task', urgent: false, important: false, due: null, est: 20, estBy: 'samy', spent: 0, sessions: [], status: 'open',
  doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-11-01T09:00:00Z', src: 'page',
  starter: 'Open the file', ...o,
});
// Five cards on today's hand, all in the fourth box (neither urgent nor important): `a` is Start here, `b` a row and a small card, `d` only in View all.
const world = () => ({
  exported: '2026-11-09T00:00:00Z', source: 'reussite-v1',
  tasks: {
    a: step('Answer the landlord'), b: step('Call the bank', { order: 2 }), c: step('Tidy the desk', { order: 3 }),
    d: step('Sort the receipts', { order: 4 }), e: step('Water the plants', { order: 5 }),
  },
  projects: { inbox: { name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' } },
  days: { [TODAY]: { date: TODAY, plan: ['a', 'b', 'c', 'd', 'e'], launches: [], first: null, checkin: null, closed: null, summary: null } },
  decisions: {}, meta: { settings: { here: 'home' } },
});

type Place = 'start' | 'row' | 'mini' | 'all';
type Change = 'urgent' | 'important' | 'reorder' | 'box' | 'offToday' | 'otherDay' | 'drop' | 'note';
type Cost = { taps: number; leaves: boolean };
const c = (taps: number, leaves = false): Cost => ({ taps, leaves });

/** Before (read from the code at 2dbe737, confirmed by a run of this spec's first version, 15d9c22): what each quick change cost from each place. */
const BUDGET: Record<Place, Record<Change, Cost>> = {
  // Edit, then the form's ticks and Save; Edit, Later; Edit, Move to…, a box; Edit, Take off today; another day through the day navigator
  // and From your deck; Drop it, Yes; Edit, the note, Save.
  start: { urgent: c(3), important: c(3), reorder: c(2), box: c(3), offToday: c(2), otherDay: c(3, true), drop: c(2), note: c(3) },
  // The same from ⋯; Drop is in the form.
  row: { urgent: c(3), important: c(3), reorder: c(2), box: c(3), offToday: c(2), otherDay: c(3, true), drop: c(3), note: c(3) },
  // A tap opens the form; another day needs the Today tab.
  mini: { urgent: c(3), important: c(3), reorder: c(2), box: c(3), offToday: c(2), otherDay: c(4, true), drop: c(3), note: c(3) },
  // ⇄ and a box; the title opens the form; another day: close the sheet, the Today tab, and the navigator.
  all: { urgent: c(2), important: c(2), reorder: c(2), box: c(2), offToday: c(2), otherDay: c(5, true), drop: c(3), note: c(3) },
};

/** Now: what each quick change costs with the simpler faces. */
const COST: Record<Place, Record<Change, Cost>> = {
  // Move, then a box, a day or Off today; a tap on the card, Later; Drop it, Yes; Note, the note, Save.
  start: { urgent: c(2), important: c(2), reorder: c(2), box: c(2), offToday: c(2), otherDay: c(2), drop: c(2), note: c(3) },
  // A row is as it was; its sheet's Move to… now also has the days.
  row: { urgent: c(3), important: c(3), reorder: c(2), box: c(3), offToday: c(2), otherDay: c(3), drop: c(3), note: c(3) },
  // ⇄ on the small card, then a box, a day or Off today; a tap opens the form.
  mini: { urgent: c(2), important: c(2), reorder: c(2), box: c(2), offToday: c(2), otherDay: c(2), drop: c(3), note: c(3) },
  all: { urgent: c(2), important: c(2), reorder: c(2), box: c(2), offToday: c(2), otherDay: c(2), drop: c(3), note: c(3) },
};

const NOTE = 'Ring before ten';
const sheet = (page: Page) => page.getByTestId('sheet');

/** What the person is looking at: the tab, and on Today the day shown. */
const screen = (page: Page) => page.evaluate(() => (document.querySelector('.app') as HTMLElement | null)?.dataset.view + '|' + (document.querySelector('[data-testid=day-label]')?.textContent ?? ''));

const read = (page: Page, store: string) => page.evaluate(s => new Promise<Record<string, any>[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const all = open.result.transaction(s).objectStore(s).getAll(); all.onsuccess = () => res(all.result); };
}), store);
const task = async (page: Page, id: string) => (await read(page, 'tasks')).find(x => x.id === id)!;
const plan = async (page: Page, k: string): Promise<string[]> => (await read(page, 'days')).find(x => x.id === k || x.date === k)?.plan ?? [];

class Taps {
  n = 0;
  left = false;
  constructor(private page: Page, private from: string) {}
  async tap(l: Locator) {
    await l.click();
    this.n++;
    if ((await screen(this.page)) !== this.from) this.left = true;
  }
}

const TARGET: Record<Place, string> = { start: 'a', row: 'b', mini: 'b', all: 'd' };

/** Where each place starts: Today for Start here and a row; the Matrix; the Matrix with the fourth box's View all open. */
async function goTo(page: Page, place: Place) {
  if (place === 'start' || place === 'row') return;
  await page.getByTestId('tab-matrix').click();
  await expect(page.getByTestId('quad4')).toBeVisible();
  if (place === 'all') {
    await page.getByTestId('quad-all4').click();
    await expect(sheet(page).getByTestId('quad-sheet')).toBeVisible();
  }
}

/** The card, at its place. */
const card = (page: Page, place: Place): Locator => place === 'start' ? page.getByTestId('first')
  : place === 'row' ? page.locator('[data-row=b]')
  : place === 'mini' ? page.getByTestId('quad4').locator('.item.mini[data-task=b]')
  : sheet(page).locator('.item[data-task=d]');

/** Opens the card's form from its place: a tap on Start here's title, a row's ⋯, a Matrix card's title. */
async function openForm(t: Taps, page: Page, place: Place) {
  const k = card(page, place);
  if (place === 'start') await t.tap(k.locator('p.t'));
  else if (place === 'row') await t.tap(k.getByTestId('details'));
  else await t.tap(k.locator('button.t'));
  await expect(sheet(page).getByTestId('task-sheet')).toBeVisible();
}

/** Opens the move sheet: Start here's Move, ⇄ on a small card or in View all, Move to… in a row's sheet. */
async function openMoveSheet(t: Taps, page: Page, place: Place) {
  const k = card(page, place);
  if (place === 'start') await t.tap(k.getByTestId('first-move'));
  else if (place === 'mini') await t.tap(k.getByTestId('mini-move'));
  else if (place === 'all') await t.tap(k.getByTestId('move-btn'));
  else { await openForm(t, page, place); await t.tap(sheet(page).getByRole('button', { name: 'Move to…' })); }
  await expect(sheet(page).getByTestId('move')).toBeVisible();
}

type Path = (t: Taps, page: Page, place: Place) => Promise<void>;
const tick = (name: 'urgent' | 'important'): Path => async (t, page, place) => {
  await openForm(t, page, place);
  await t.tap(sheet(page).locator(`input[name=${name}]`));
  await t.tap(sheet(page).getByRole('button', { name: 'Save', exact: true }));
};
const moveBox = (q: number): Path => async (t, page, place) => {
  await openMoveSheet(t, page, place);
  await t.tap(sheet(page).getByTestId('to-q' + q));
};
const PATHS: Record<Change, Path> = {
  // A row keeps the form's ticks (as cheap as its Move to…); everywhere else the box with the tick is one tap in the move sheet.
  urgent: async (t, page, place) => (place === 'row' ? tick('urgent') : moveBox(3))(t, page, place),
  important: async (t, page, place) => (place === 'row' ? tick('important') : moveBox(2))(t, page, place),
  // Start here one later; every other card one earlier.
  reorder: async (t, page, place) => {
    await openForm(t, page, place);
    await t.tap(sheet(page).getByRole('button', { name: place === 'start' ? '↓ Later' : '↑ Earlier', exact: true }));
  },
  box: moveBox(1),
  offToday: async (t, page, place) => {
    if (place === 'row') {
      await openForm(t, page, place);
      await t.tap(sheet(page).getByRole('button', { name: 'Take off today', exact: true }));
    } else {
      await openMoveSheet(t, page, place);
      await t.tap(sheet(page).getByTestId('move-off-today'));
    }
  },
  otherDay: async (t, page, place) => {
    await openMoveSheet(t, page, place);
    await t.tap(sheet(page).getByTestId('move-days').locator(`[data-day="${TOMORROW}"]`));
  },
  drop: async (t, page, place) => {
    if (place !== 'start') await openForm(t, page, place);
    const drop = (place === 'start' ? card(page, place) : sheet(page)).getByTestId('drop');
    await t.tap(drop);
    await t.tap(drop);
  },
  note: async (t, page, place) => {
    if (place === 'start') await t.tap(card(page, place).getByTestId('first-note'));
    else await openForm(t, page, place);
    const note = sheet(page).getByTestId('note');
    await t.tap(note);
    await note.fill(NOTE);
    await t.tap(sheet(page).getByRole('button', { name: 'Save', exact: true }));
  },
};

/** What each change writes, checked in the database. */
const CHECKS: Record<Change, (page: Page, id: string) => Promise<void>> = {
  urgent: async (page, id) => { await expect.poll(async () => (await task(page, id)).urgent).toBe(true); },
  important: async (page, id) => { await expect.poll(async () => (await task(page, id)).important).toBe(true); },
  reorder: async (page, id) => {
    const was = world().days[TODAY]!.plan.indexOf(id);
    await expect.poll(async () => (await plan(page, TODAY)).indexOf(id)).toBe(id === 'a' ? was + 1 : was - 1);
  },
  box: async (page, id) => { await expect.poll(async () => { const x = await task(page, id); return [x.urgent, x.important]; }).toEqual([true, true]); },
  offToday: async (page, id) => { await expect.poll(async () => (await plan(page, TODAY)).includes(id)).toBe(false); },
  // On tomorrow's hand, and so off today's.
  otherDay: async (page, id) => {
    await expect.poll(async () => (await plan(page, TOMORROW)).includes(id)).toBe(true);
    expect((await plan(page, TODAY)).includes(id)).toBe(false);
  },
  drop: async (page, id) => { await expect.poll(async () => (await task(page, id)).status).toBe('dropped'); },
  note: async (page, id) => { await expect.poll(async () => (await task(page, id)).note).toBe(NOTE); },
};

async function load(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(NOW);
  await page.goto('/#settings');
  await expandSettings(page);
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(world())) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  await page.getByTestId('tab-today').click();
  await expect(page.getByTestId('first')).toContainText('Answer the landlord');
}

test('the costs now are within the budget, and nothing made on the same screen leaves it', () => {
  for (const place of Object.keys(BUDGET) as Place[]) for (const change of Object.keys(BUDGET[place]) as Change[]) {
    const b = BUDGET[place][change], n = COST[place][change];
    expect(n.taps, `${place} ${change}`).toBeLessThanOrEqual(b.taps);
    if (!b.leaves) expect(n.leaves, `${place} ${change}`).toBe(false);
  }
});

for (const place of Object.keys(COST) as Place[]) {
  for (const change of Object.keys(COST[place]) as Change[]) {
    test(`${place}: ${change} within its budget`, async ({ page }) => {
      await load(page);
      await goTo(page, place);
      const t = new Taps(page, await screen(page));
      await PATHS[change](t, page, place);
      await CHECKS[change](page, TARGET[place]);
      const want = COST[place][change];
      test.info().annotations.push({ type: 'taps', description: `${place} ${change}: ${t.n}${t.left ? ' (leaves the screen)' : ''}` });
      expect(t.n, `${place} ${change}: taps`).toBe(want.taps);
      expect(t.left, `${place} ${change}: leaves the screen`).toBe(want.leaves);
    });
  }
}
