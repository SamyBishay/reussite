import { test, expect, type Page } from '@playwright/test';
import { morningClock, noSideways, openMenu, expandSettings, goNotifications, NO_SERVICE_WORKER } from './helpers';

// The AI and the connector's state are stubbed after a reload (NO_SERVICE_WORKER says why).
test.use(NO_SERVICE_WORKER);

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
  await page.goto('/#settings'); await expandSettings(page);
  page.once('dialog', d => void d.accept());
  await page.getByTestId('data').locator('input[type=file]').first().setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.locator('.toast')).toContainText('Backup restored');
  await page.reload();
  await expandSettings(page);
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
  await morningClock(page);
  await page.goto('/');
  await goNotifications(page);
  await page.locator('main').getByRole('button', { name: /Deal the day|Distribuer la journée/ }).click();
  await page.getByTestId('ci-next').click(); // nothing was planned yesterday, so the first screen is the day's shape
  await page.getByTestId('ci-next').click(); // the pillars
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
    await page.getByTestId('ci-later').click(); // the first step alone
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
    await page.getByTestId('ci-later').click(); // the first step alone
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
    await page.getByTestId('ci-later').click(); // the first step alone
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
  await page.getByTestId('ci-later').click(); // the first step alone
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
  await page.goto('/#settings'); await expandSettings(page);
  await page.getByTestId('stays').getByTestId('plan-trip').click();
  await expect(sheet(page).getByTestId('trip-sheet')).toBeVisible();
}

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
/** My own key (Anthropic), and an AI that answers whatever `answer.text` holds; returns it and the requests seen. Plan this trip asks it directly. */
async function withKey(page: Page) {
  await page.goto('/#settings'); await expandSettings(page);
  await page.getByTestId('ai-anthropic').click();
  await page.getByTestId('ai-key').fill('sk-ant-test');
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-settings')).toContainText(/A key is saved\.|Une clé est enregistrée\./);
  const answer = { text: '' };
  const seen: { system: string; user: string }[] = [];
  await page.route(ANTHROPIC, async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = route.request().postDataJSON() as { system: { text: string }[] | string; messages: { content: string | { text: string }[] }[] };
    const flat = (c: string | { text: string }[]) => (typeof c === 'string' ? c : c.map(x => x.text).join(''));
    seen.push({ system: flat(body.system), user: body.messages.map(m => flat(m.content)).join('\n') });
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ content: [{ type: 'text', text: answer.text }], stop_reason: 'end_turn' }) });
  });
  return { answer, seen };
}
/** Plan this trip's one button, and "Show me what's sent" the first time: what goes to the AI, read before it leaves. */
async function askTrip(page: Page, send = true): Promise<string> {
  await sheet(page).getByTestId('trip-go').click();
  await expect(page.getByTestId('ai-preview')).toBeVisible();
  const user = await page.getByTestId('ai-user').innerText();
  if (send) await page.getByTestId('ai-send').click();
  else await page.getByTestId('ai-preview').getByRole('button', { name: /Cancel|Annuler/ }).click();
  return user;
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

test('Plan this trip with a key: the request, then the AI\'s reply comes back as day lists, a train and want-to-go addresses, and Undo takes it all back', async ({ page }) => {
  await seed(page, tripSeed());
  const ai = await withKey(page);
  ai.answer.text = reply();
  await openTrip(page);
  // No pack to copy, share or paste: one button that asks the AI.
  for (const id of ['pack', 'copy-pack', 'pack-paste']) await expect(sheet(page).getByTestId(id)).toHaveCount(0);
  await sheet(page).getByTestId('trip-question').fill('Three slow days, one museum, a good dinner on the first night.');
  // People only when ticked, and never how to reach them: read in "Show me what's sent", then cancelled.
  await expect(sheet(page).getByTestId('trip-people')).not.toBeChecked();
  let sent = await askTrip(page, false);
  expect(sent).toContain('The trip: Lyon (place id lyon)');
  expect(sent).toContain('Chez Louise | Food | been | 5 rue des Lilas | 2026-03-02 again, "Lovely quenelles" | Cash only');
  expect(sent).toContain('Buy a gift for Mum');
  expect(sent).not.toContain('Pay the rent');
  expect(sent).not.toContain('Paris bakery');
  expect(sent).toContain('Request:\nThree slow days, one museum, a good dinner on the first night.');
  expect(sent).not.toContain('Théophile');
  expect(ai.seen).toHaveLength(0); // nothing left before Send
  await sheet(page).getByTestId('trip-people').check();
  sent = await askTrip(page, false);
  expect(sent).toContain('Théophile Marchand | 2026-09-01 | Allergic to hazelnuts');
  expect(sent).not.toContain('33699999999');
  await sheet(page).getByTestId('trip-people').uncheck();
  await noSideways(page, 'trip sheet');

  sent = await askTrip(page);
  expect(sent).not.toContain('Théophile');
  await expect(page.getByTestId('chg')).toHaveCount(8);
  expect(ai.seen).toHaveLength(1);
  expect(ai.seen[0]!.system).toContain('check opening hours');
  expect(ai.seen[0]!.system).toContain('address.create');
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

  // Kept in History, with Undo.
  await openMenu(page, 'history');
  const row = page.getByTestId('history-row').first();
  await expect(row).toContainText('Three slow days, one museum');
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
  const ai = await withKey(page);
  ai.answer.text = reply();
  await openTrip(page);
  await askTrip(page);
  await page.getByTestId('chg').filter({ hasText: 'Musée des Confluences' }).getByRole('checkbox').uncheck();
  await page.getByTestId('apply-changes').click();
  await expect(sheet(page)).toBeHidden();
  expect((await live(page, 'addresses')).filter(a => a.by === 'ai').map(a => a.name)).toEqual(['Café Mokka']);
});

test('a reply with a mistake in it writes nothing', async ({ page }) => {
  await seed(page, tripSeed());
  const ai = await withKey(page);
  ai.answer.text = '{"v": 1, "changes": [{"op": "address.create", "set": {"category": "food"}}]}';
  await openTrip(page);
  await askTrip(page);
  await expect(page.getByTestId('ai-error')).toBeVisible();
  await expect(page.getByTestId('review')).toHaveCount(0);
  expect((await live(page, 'addresses')).map(a => a.name).sort()).toEqual(['Chez Louise', 'Paris bakery']);
});

test('Plan this trip is not offered with the module off, nor with no cloud AI', async ({ page }) => {
  await seed(page, tripSeed());
  // On this device (no key, no connector): no button.
  await expect(page.getByTestId('stays')).toContainText('Lyon');
  await expect(page.getByTestId('plan-trip')).toHaveCount(0);
  await withKey(page);
  await expect(page.getByTestId('plan-trip')).toBeVisible();
  await page.getByTestId('addresses-switch').uncheck();
  await expect(page.getByTestId('plan-trip')).toHaveCount(0);
});

test('with the connector and no key, Plan this trip gives the sentence to say in the chat app', async ({ page }) => {
  test.slow();
  await seed(page, tripSeed());
  // The relay says the connector is on (sync is real, the connector's state is stubbed).
  await page.route('**/v1/spaces/*/connector', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ on: true, lastUsed: null, url: 'http://localhost:8787/mcp' }) });
  });
  await page.getByTestId('sync-setup').click();
  await page.getByTestId('sync-make-key').click();
  await page.getByTestId('sync-key-saved').click();
  await expandSettings(page);
  await expect(page.getByTestId('connector-state')).toContainText('The connector is on');
  await openTrip(page);
  await expect(sheet(page).getByTestId('trip-say')).toContainText('Plan my trip to Lyon');
  for (const id of ['trip-go', 'trip-question', 'pack', 'pack-paste']) await expect(sheet(page).getByTestId(id)).toHaveCount(0);
  await expect(sheet(page)).not.toContainText(/paste/i);
  await noSideways(page, 'trip sheet, connector');
});

for (const [width, french] of [[320, false], [375, false], [430, false], [320, true]] as const) {
  test(`no sideways scroll on the trip sheet, its review and the offers at ${width}px${french ? ' in French' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seed(page, { ...tripSeed(), tasks: [...tripSeed().tasks!, ['ob1', task('Go out somewhere in the city with a very long name', { template: true, offer: 'address', est: 60 })]],
      addresses: [...tripSeed().addresses!, ['a9', address('A very long name for a place that someone saved from Maps one rainy afternoon in the old town')]] });
    if (french) {
      await page.goto('/#settings'); await expandSettings(page);
      await page.getByRole('button', { name: 'Français' }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    }
    await openPlan(page);
    await noSideways(page, 'offers in the plan');
    await page.keyboard.press('Escape');
    const ai = await withKey(page);
    ai.answer.text = reply();
    await openTrip(page);
    await sheet(page).getByTestId('trip-people').check();
    await noSideways(page, 'trip sheet');
    await askTrip(page);
    await expect(page.getByTestId('chg')).toHaveCount(8);
    await noSideways(page, 'trip review');
  });
}
