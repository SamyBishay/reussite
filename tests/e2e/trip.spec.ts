import { test, expect, type Page } from '@playwright/test';
import { noSideways, openMenu } from './helpers';

// Phase 4, step 3: the planner's offers (address or person) and "Plan this trip". Every name, link and number here is invented.
const sheet = (page: Page) => page.getByTestId('sheet');
const iso = (n: number) => { const x = new Date(); x.setHours(12); x.setDate(x.getDate() + n - (new Date().getHours() < 5 ? 1 : 0)); return x.toISOString().slice(0, 10); };
const store = (page: Page, name: string) => page.evaluate(n => new Promise<Record<string, unknown>[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const all = open.result.transaction(n).objectStore(n).getAll(); all.onsuccess = () => res(all.result); };
}), name);
const live = async (page: Page, name: string) => (await store(page, name)).filter(d => !d._del);

const HLC = '0000000000001:0000:seed';
type Seed = Record<string, [string, Record<string, unknown>][]>;
/** Put documents in the app the way a restored backup does: no UI to build them, and the same code path as a person's file. */
async function seed(page: Page, data: Seed) {
  const stamp = (id: string, f: Record<string, unknown>) => ({ id, _v: 4, _hlc: Object.fromEntries(Object.keys(f).map(k => [k, HLC])), ...f });
  const file = { format: 'reussite-backup', schema: 4, exported: new Date().toISOString(), data: Object.fromEntries(Object.entries(data).map(([c, ds]) => [c, ds.map(([id, f]) => stamp(id, f))])) };
  await page.goto('/#settings');
  page.once('dialog', d => void d.accept());
  await page.getByTestId('data').locator('input[type=file]').first().setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.locator('.toast')).toContainText('Backup restored');
  await page.reload();
}
const task = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'p1', suit: 'H', kind: 'task', urgent: false, important: true, due: null, est: 30, est0: null, estBy: 'me', status: 'open', doneDay: null, doneAt: null,
  started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z', src: 'page', ...o,
});
const project = { name: 'Life', suit: 'H', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' };
const visit = (day: string, verdict: string) => ({ id: 'v' + day, day, note: '', verdict });
const address = (name: string, o: Record<string, unknown> = {}) => ({ name, category: 'food', placeId: 'any', mapsUrl: 'https://maps.example/' + name.replace(/\W+/g, '-').toLowerCase(), street: null, state: 'want', visits: [], by: 'me', note: '', ...o });
const person = (name: string, o: Record<string, unknown> = {}) => ({ name, placeId: 'any', reach: null, note: '', lastSeen: null, ...o });

async function openPlan(page: Page) {
  await page.goto('/');
  await page.locator('main').getByRole('button', { name: /Plan the day|Planifier la journée/ }).click();
  await page.getByTestId('ci-next').click(); // nothing was planned yesterday, so the first screen is the day's shape
  await expect(page.getByTestId('plan-items')).toBeVisible();
}

test.describe('the check-in offers an address for a leisure obligation', () => {
  const data: Seed = {
    projects: [['p1', project]],
    tasks: [['ob1', task('Go out somewhere', { template: true, offer: 'address', est: 60 })]],
    addresses: [
      ['a1', address('Chez Louise', { state: 'been', visits: [visit('2026-03-01', 'again')] })],
      ['a2', address('Bar Zéphyr')],
      ['a3', address('Café Mokka')],
      ['a4', address('Librairie Sol')],
      ['a5', address('Bad Place', { state: 'been', visits: [visit('2026-02-01', 'not-again')] })],
    ],
  };

  test('up to three, again first then want to go; picking one sets the step\'s title, starter, link and address', async ({ page }) => {
    await seed(page, data);
    await openPlan(page);
    const offers = page.getByTestId('offers');
    await expect(offers).toBeVisible();
    await expect(offers.getByRole('button')).toHaveText(['Chez Louise', 'Bar Zéphyr', 'Café Mokka', 'Keep it as it is']);
    await noSideways(page, 'plan with offers');
    await offers.getByTestId('offer').filter({ hasText: 'Bar Zéphyr' }).click();
    await expect(offers.getByTestId('offer').filter({ hasText: 'Bar Zéphyr' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('go-with-this').click();
    await expect(sheet(page)).toBeHidden();
    const made = (await live(page, 'tasks')).find(x => x.from === 'ob1')!;
    expect(made).toMatchObject({ title: 'Go to Bar Zéphyr', starter: 'Open the front door', link: 'https://maps.example/bar-z-phyr', addressId: 'a2' });
    // The standing obligation itself is not touched.
    expect((await live(page, 'tasks')).find(x => x.id === 'ob1')).toMatchObject({ title: 'Go out somewhere', offer: 'address' });
    expect((await live(page, 'tasks')).find(x => x.id === 'ob1')!.addressId ?? null).toBeNull();
    await page.getByTestId('tab-today').click();
    await expect(page.locator('[data-task]').filter({ hasText: 'Go to Bar Zéphyr' }).first().getByTestId('feeds')).toContainText('at Bar Zéphyr');
  });

  test('skipping keeps the obligation as it is', async ({ page }) => {
    await seed(page, data);
    await openPlan(page);
    await expect(page.getByTestId('offer-keep')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('offer').first().click();
    await page.getByTestId('offer-keep').click(); // changed my mind
    await page.getByTestId('go-with-this').click();
    await expect(sheet(page)).toBeHidden();
    const made = (await live(page, 'tasks')).find(x => x.from === 'ob1')!;
    expect(made).toMatchObject({ title: 'Go out somewhere' });
    expect(made.addressId ?? null).toBeNull();
  });

  test('nothing is offered with the module off', async ({ page }) => {
    await seed(page, data);
    await page.getByTestId('addresses-switch').uncheck();
    await openPlan(page);
    await expect(page.getByTestId('offers')).toHaveCount(0);
    await page.getByTestId('go-with-this').click();
    await expect(sheet(page)).toBeHidden();
    expect((await live(page, 'tasks')).find(x => x.from === 'ob1')).toMatchObject({ title: 'Go out somewhere' });
  });

  test('nothing is offered when no address fits the place', async ({ page }) => {
    await seed(page, { ...data, addresses: [['a1', address('Elsewhere', { placeId: 'nowhere' })]] });
    await openPlan(page);
    await expect(page.getByTestId('offers')).toHaveCount(0);
  });
});

test('a people obligation offers those seen least recently, and picking one sets the message, its link and the person', async ({ page }) => {
  await seed(page, {
    projects: [['p1', project]],
    tasks: [['ob2', task('See someone', { template: true, offer: 'person', est: 60 })]],
    people: [
      ['pe1', person('Alex', { reach: 'https://wa.me/33612345678', lastSeen: '2026-09-01' })],
      ['pe2', person('Bea')],
      ['pe3', person('Cy', { lastSeen: '2026-01-01', reach: 'tel:+33612345600' })],
      ['pe4', person('Dee', { lastSeen: '2026-10-01' })],
    ],
  });
  await openPlan(page);
  await expect(page.getByTestId('offers').getByRole('button')).toHaveText(['Bea', 'Cy', 'Alex', 'Keep it as it is']);
  await page.getByTestId('offer').filter({ hasText: 'Alex' }).click();
  await page.getByTestId('go-with-this').click();
  await expect(sheet(page)).toBeHidden();
  expect((await live(page, 'tasks')).find(x => x.from === 'ob2')).toMatchObject({ title: 'Message Alex', starter: 'Open a message to Alex', link: 'https://wa.me/33612345678', personId: 'pe1' });
});

test('the Sunday review and the day\'s "Leisure & people" list offer too', async ({ page }) => {
  await seed(page, {
    projects: [['p1', project]],
    tasks: [['ob1', task('Go out somewhere', { template: true, offer: 'address', est: 60 })]],
    addresses: [['a2', address('Bar Zéphyr')], ['a3', address('Café Mokka')]],
  });
  // Another day's "Leisure & people": choose, then Add.
  await page.goto('/#today');
  await page.getByTestId('next-day').click();
  await page.getByRole('button', { name: 'Leisure & people' }).click();
  await sheet(page).getByTestId('offer').filter({ hasText: 'Café Mokka' }).click();
  await sheet(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(sheet(page).getByTestId('offers')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('other-day')).toContainText('Go to Café Mokka');
  expect((await live(page, 'tasks')).find(x => x.from === 'ob1')).toMatchObject({ addressId: 'a3', due: null });
});

// ---------- Plan this trip ----------
const PLACE = 'lyon';
const tripSeed = (): Seed => ({
  projects: [['p1', project]],
  places: [[PLACE, { name: 'Lyon', timeZone: 'Europe/Paris', order: 0 }], ['paris', { name: 'Paris', timeZone: 'Europe/Paris', order: 1 }]],
  stays: [['s1', { placeId: PLACE, from: iso(1), to: iso(3), note: 'Long weekend with a friend' }]],
  tasks: [
    ['t-gift', task('Buy a gift for Mum', { where: PLACE })],
    ['t-rent', task('Pay the rent', { where: 'paris' })],
  ],
  addresses: [
    ['a1', address('Chez Louise', { placeId: PLACE, state: 'been', street: '5 rue des Lilas', note: 'Cash only', visits: [{ id: 'v1', day: '2026-03-02', note: 'Lovely quenelles', verdict: 'again' }] })],
    ['a2', address('Paris bakery', { placeId: 'paris' })],
  ],
  people: [['pe1', person('Théophile Marchand', { placeId: PLACE, note: 'Allergic to hazelnuts', lastSeen: '2026-09-01', reach: 'whatsapp://send?phone=33699999999' })]],
});

async function openTrip(page: Page) {
  await page.goto('/#settings');
  await page.getByTestId('stays').getByTestId('plan-trip').click();
  await expect(sheet(page).getByTestId('trip-sheet')).toBeVisible();
}

const reply = () => JSON.stringify({ v: 1, note: 'Hours checked on the venues\' sites; the museum is closed on Mondays.', changes: [
  { op: 'task.create', ref: 'walk', set: { title: 'Open Maps and walk through the old town', where: PLACE, est: 45 } },
  { op: 'task.create', ref: 'lunch', set: { title: 'Go to Café Mokka for lunch', where: PLACE, est: 60 } },
  { op: 'task.create', ref: 'ticket', set: { title: 'Open the museum site and book a ticket', where: PLACE, est: 10 } },
  { op: 'task.create', ref: 'train', set: { title: 'Train home from Lyon Part-Dieu', at: '17:40', dur: 120, due: iso(3), where: PLACE } },
  { op: 'day.update', date: iso(1), add: ['walk', 'lunch'] },
  { op: 'day.update', date: iso(2), add: ['ticket', 't-gift'] },
  { op: 'address.create', set: { name: 'Café Mokka', category: 'food', place: PLACE, note: 'Open Tuesday to Saturday 8:00 to 17:00, closed Sunday (checked on their site)' } },
  { op: 'address.create', set: { name: 'Musée des Confluences', category: 'museum', place: PLACE, mapsUrl: 'https://maps.apple.com/?q=Mus%C3%A9e%20des%20Confluences', street: '86 Quai Perrache', note: 'Closed Monday' } },
] });

test('Plan this trip: the pack, then a pasted reply comes back as day lists, a train and want-to-go addresses, and Undo takes it all back', async ({ page }) => {
  await seed(page, tripSeed());
  await openTrip(page);
  const pack = sheet(page).getByTestId('pack');
  await sheet(page).locator('summary', { hasText: 'See the text' }).click();
  await sheet(page).getByTestId('trip-question').fill('Three slow days, one museum, a good dinner on the first night.');
  await expect(pack).toContainText('The trip: Lyon (place id lyon)');
  await expect(pack).toContainText('Chez Louise | Food | been | 5 rue des Lilas | 2026-03-02 again, "Lovely quenelles" | Cash only');
  await expect(pack).toContainText('Buy a gift for Mum');
  await expect(pack).not.toContainText('Pay the rent');
  await expect(pack).not.toContainText('Paris bakery');
  await expect(pack).toContainText('check opening hours');
  await expect(pack).toContainText('## My question\n\nThree slow days, one museum, a good dinner on the first night.');
  // People only when ticked, and never how to reach them.
  await expect(sheet(page).getByTestId('trip-people')).not.toBeChecked();
  await expect(pack).not.toContainText('Théophile');
  await sheet(page).getByTestId('trip-people').check();
  await expect(pack).toContainText('Théophile Marchand | 2026-09-01 | Allergic to hazelnuts');
  await expect(pack).not.toContainText('33699999999');
  await sheet(page).getByTestId('trip-people').uncheck();
  await expect(pack).not.toContainText('Théophile');
  await noSideways(page, 'trip sheet');

  await sheet(page).getByTestId('pack-paste').click();
  await page.getByTestId('paste-text').fill('Here is a plan for your three days.\n\n```reussite\n' + reply() + '\n```\n');
  await page.getByTestId('paste-go').click();
  await expect(page.getByTestId('chg')).toHaveCount(8);
  await expect(page.getByTestId('review')).toContainText('Café Mokka');
  await expect(page.getByTestId('review')).toContainText('Closed Monday');
  await noSideways(page, 'trip review');
  await page.getByTestId('apply-changes').click();
  await expect(sheet(page)).toBeHidden();

  // The addresses: want to go, from the AI, in Lyon, with its reason.
  const made = (await live(page, 'addresses')).filter(a => a.by === 'ai');
  expect(made.map(a => a.name).sort()).toEqual(['Café Mokka', 'Musée des Confluences']);
  for (const a of made) expect(a).toMatchObject({ state: 'want', placeId: PLACE, visits: [] });
  expect(made.find(a => a.name === 'Café Mokka')).toMatchObject({ category: 'food', note: expect.stringContaining('closed Sunday') });
  expect(made.find(a => a.name === 'Musée des Confluences')).toMatchObject({ category: 'museum', mapsUrl: expect.stringContaining('maps.apple.com'), street: '86 Quai Perrache' });
  await page.goto('/#addresses');
  await page.getByTestId('addr-scope').selectOption('*'); // Lyon is not where I am today
  await expect(page.getByTestId('address-row').filter({ hasText: 'Café Mokka' }).getByTestId('address-ai')).toBeVisible();

  // The days: two lists, and the train at its time on the third.
  await page.goto('/#today');
  await page.getByTestId('next-day').click();
  await expect(page.getByTestId('other-day')).toContainText('Open Maps and walk through the old town');
  await expect(page.getByTestId('other-day')).toContainText('Go to Café Mokka for lunch');
  await page.getByTestId('next-day').click();
  await expect(page.getByTestId('other-day')).toContainText('Open the museum site and book a ticket');
  await expect(page.getByTestId('other-day')).toContainText('Buy a gift for Mum');
  await page.getByTestId('next-day').click();
  await expect(page.getByTestId('other-day')).toContainText('Train home from Lyon Part-Dieu');
  await expect(page.getByTestId('other-day')).toContainText('17:40');
  expect((await live(page, 'tasks')).find(x => x.title === 'Train home from Lyon Part-Dieu')).toMatchObject({ at: '17:40', dur: 120, due: iso(3), where: PLACE });
  const plan = async (k: string) => ((await live(page, 'days')).find(d => d.id === k)?.plan as string[] | undefined)?.length ?? 0;
  expect(await plan(iso(1))).toBe(2);
  expect(await plan(iso(2))).toBe(2);

  // Kept in History as a pasted reply, with Undo.
  await openMenu(page, 'history');
  const row = page.getByTestId('history-row').first();
  await expect(row).toContainText('Hours checked on the venues');
  await expect(row.getByTestId('history-src')).toHaveText('Pasted reply');
  await row.getByTestId('history-undo').click();
  await expect.poll(async () => (await live(page, 'addresses')).filter(a => a.by === 'ai').length).toBe(0);
  expect((await live(page, 'addresses')).map(a => a.name).sort()).toEqual(['Chez Louise', 'Paris bakery']);
  expect((await live(page, 'tasks')).map(x => x.title).sort()).toEqual(['Buy a gift for Mum', 'Pay the rent']);
  expect(await plan(iso(1))).toBe(0);
  expect(await plan(iso(2))).toBe(0);
  await expect(row).toContainText('Undone');
});

test('an address in a trip reply can be unticked, and then it is not saved', async ({ page }) => {
  await seed(page, tripSeed());
  await openTrip(page);
  await sheet(page).getByTestId('pack-paste').click();
  await page.getByTestId('paste-text').fill('```reussite\n' + reply() + '\n```');
  await page.getByTestId('paste-go').click();
  await page.getByTestId('chg').filter({ hasText: 'Musée des Confluences' }).getByRole('checkbox').uncheck();
  await page.getByTestId('apply-changes').click();
  await expect(sheet(page)).toBeHidden();
  expect((await live(page, 'addresses')).filter(a => a.by === 'ai').map(a => a.name)).toEqual(['Café Mokka']);
});

test('a reply with a mistake in it writes nothing', async ({ page }) => {
  await seed(page, tripSeed());
  await openTrip(page);
  await sheet(page).getByTestId('pack-paste').click();
  await page.getByTestId('paste-text').fill('```reussite\n{"v": 1, "changes": [{"op": "address.create", "set": {"category": "food"}}]}\n```');
  await page.getByTestId('paste-go').click();
  await expect(page.getByTestId('paste-error')).toBeVisible();
  await expect(page.getByTestId('review')).toHaveCount(0);
  expect((await live(page, 'addresses')).map(a => a.name).sort()).toEqual(['Chez Louise', 'Paris bakery']);
});

test('Plan this trip is not offered with the module off', async ({ page }) => {
  await seed(page, tripSeed());
  await expect(page.getByTestId('plan-trip')).toBeVisible();
  await page.getByTestId('addresses-switch').uncheck();
  await expect(page.getByTestId('plan-trip')).toHaveCount(0);
});

for (const [width, french] of [[320, false], [375, false], [430, false], [320, true]] as const) {
  test(`no sideways scroll on the trip sheet, its review and the offers at ${width}px${french ? ' in French' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seed(page, { ...tripSeed(), tasks: [...tripSeed().tasks!, ['ob1', task('Go out somewhere in the city with a very long name', { template: true, offer: 'address', est: 60 })]],
      addresses: [...tripSeed().addresses!, ['a9', address('A very long name for a place that someone saved from Maps one rainy afternoon in the old town')]] });
    if (french) {
      await page.goto('/#settings');
      await page.getByRole('button', { name: 'Français' }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    }
    await openPlan(page);
    await noSideways(page, 'offers in the plan');
    await page.keyboard.press('Escape');
    await openTrip(page);
    await sheet(page).locator('summary', { hasText: /See the text|Voir le texte/ }).click();
    await sheet(page).getByTestId('trip-people').check();
    await noSideways(page, 'trip sheet');
    await sheet(page).getByTestId('pack-paste').click();
    await page.getByTestId('paste-text').fill('```reussite\n' + reply() + '\n```');
    await page.getByTestId('paste-go').click();
    await expect(page.getByTestId('chg')).toHaveCount(8);
    await noSideways(page, 'trip review');
  });
}
