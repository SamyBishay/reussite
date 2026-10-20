import { test, expect, type Page } from '@playwright/test';
import { noSideways, openMenu } from './helpers';

// Addresses and people (phase 4): paste a Maps link, the after-visit note, people, the module switch, the
// Google Takeout import. Every name, link and number here is invented.
const sheet = (page: Page) => page.getByTestId('sheet');
const GOOGLE = 'https://www.google.com/maps/place/Chez+Louise/@48.8566,2.3522,17z/data=!3m1!4b1';
const SHORT = 'https://maps.app.goo.gl/AbCdEf123456';

/** The clipboard the app reads: a stub, since a test browser has none to give. */
async function clipboard(page: Page, text: string | null) {
  await page.addInitScript(t => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: () => (t == null ? Promise.reject(new DOMException('denied', 'NotAllowedError')) : Promise.resolve(t)), writeText: () => Promise.resolve() } });
  }, text);
}
const store = (page: Page, name: string) => page.evaluate(n => new Promise<Record<string, unknown>[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const all = open.result.transaction(n).objectStore(n).getAll(); all.onsuccess = () => res(all.result); };
}), name);

/** Home menu, + Address, Paste (the clipboard says `link`), Save. */
async function addByPaste(page: Page, link: string, name?: string) {
  await clipboard(page, link);
  await page.goto('/');
  await openMenu(page, 'add-address');
  await page.getByTestId('addr-paste').click();
  if (name) await sheet(page).getByTestId('addr-name').fill(name);
  await sheet(page).getByTestId('addr-save').click();
  await expect(sheet(page)).toBeHidden();
}
async function openAddresses(page: Page) {
  await page.goto('/#addresses');
  await expect(page.getByTestId('addresses')).toBeVisible();
}
async function newStep(page: Page, title: string, feeds?: string) {
  await page.goto('/#today');
  await page.getByPlaceholder(/The app and the first action/).fill(title);
  await page.getByTestId('quick-details').click();
  if (feeds) await sheet(page).getByTestId('feeds-select').selectOption({ label: feeds });
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
}
/** A step on Today: the first card or a row. */
const card = (page: Page, title: string) => page.locator('[data-task]').filter({ hasText: title }).first();
async function markDone(page: Page, title: string) {
  const c = card(page, title);
  if (await c.getByTestId('row-done').count()) await c.getByTestId('row-done').click();
  else await c.getByRole('button', { name: 'Already done' }).click();
  await sheet(page).getByRole('button', { name: 'I didn’t time it' }).click();
}
async function openStep(page: Page, title: string) {
  const c = card(page, title);
  if (await c.getByTestId('details').count()) await c.getByTestId('details').click();
  else await c.getByRole('button', { name: 'Edit', exact: true }).click();
}
const dayKey = () => {
  const d = new Date();
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

test('a Maps link pasted from the Home menu is a saved address in a few taps', async ({ page }) => {
  const t0 = Date.now();
  await clipboard(page, GOOGLE);
  await page.goto('/');
  await openMenu(page, 'add-address');
  await expect(sheet(page).getByTestId('address-sheet')).toBeVisible();
  await page.getByTestId('addr-paste').click();
  await expect(sheet(page).getByTestId('addr-name')).toHaveValue('Chez Louise');
  await expect(sheet(page).getByTestId('addr-link')).toHaveValue(GOOGLE);
  await expect(sheet(page).getByTestId('addr-want')).toHaveAttribute('aria-pressed', 'true');
  await sheet(page).getByTestId('addr-save').click();
  await expect(sheet(page)).toBeHidden();
  expect(Date.now() - t0, 'under 15 seconds from the home screen').toBeLessThan(15_000);
  const rows = await store(page, 'addresses');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ state: 'want' });
  await openAddresses(page);
  const row = page.getByTestId('address-row').filter({ hasText: 'Chez Louise' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Want to go');
  await expect(row.getByTestId('address-maps')).toHaveAttribute('href', /google\.com\/maps\/place\/Chez\+Louise/);
});

test('a short link has no name: the name field is asked for and focused', async ({ page }) => {
  await clipboard(page, SHORT);
  await page.goto('/');
  await openMenu(page, 'add-address');
  await page.getByTestId('addr-paste').click();
  await expect(sheet(page).getByTestId('addr-paste-msg')).toContainText('no name');
  await expect(sheet(page).getByTestId('addr-name')).toBeFocused();
  await expect(sheet(page).getByTestId('addr-link')).toHaveValue(SHORT);
  await sheet(page).getByTestId('addr-save').click();
  await expect(sheet(page).locator('.err')).toContainText('name');
  await sheet(page).getByTestId('addr-name').fill('Le Petit Four');
  await sheet(page).getByTestId('addr-save').click();
  await expect(sheet(page)).toBeHidden();
  expect(await store(page, 'addresses')).toHaveLength(1);
});

test('when the clipboard is refused a plain paste field takes the link', async ({ page }) => {
  await clipboard(page, null);
  await page.goto('/');
  await openMenu(page, 'add-address');
  await page.getByTestId('addr-paste').click();
  await expect(sheet(page).getByTestId('addr-paste-field')).toBeVisible();
  await sheet(page).getByTestId('addr-paste-field').fill('Chez Louise\n' + SHORT);
  await expect(sheet(page).getByTestId('addr-name')).toHaveValue('Chez Louise');
  await sheet(page).getByTestId('addr-category').selectOption({ label: 'Food' });
  await sheet(page).getByTestId('addr-street').fill('1 Rue Exemple');
  await sheet(page).getByTestId('addr-save').click();
  await expect(sheet(page)).toBeHidden();
  await openAddresses(page);
  await page.getByTestId('address-open').click();
  await expect(sheet(page).getByTestId('addr-street')).toHaveValue('1 Rue Exemple');
  await expect(sheet(page).getByTestId('addr-category')).toHaveValue('food');
  await expect(sheet(page).getByTestId('addr-open-maps')).toBeVisible();
});

test('a link the app would not open is refused', async ({ page }) => {
  await clipboard(page, GOOGLE);
  await page.goto('/');
  await openMenu(page, 'add-address');
  await sheet(page).getByTestId('addr-name').fill('Somewhere');
  await sheet(page).getByTestId('addr-link').fill('javascript:alert(1)');
  await sheet(page).getByTestId('addr-save').click();
  await expect(sheet(page).locator('.err')).toContainText('can’t be opened');
  expect(await store(page, 'addresses')).toHaveLength(0);
});

test('marking a step that feeds an address done asks how it was; skipping writes nothing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await addByPaste(page, GOOGLE);
  await newStep(page, 'Lunch out', 'Chez Louise');
  await expect(card(page, 'Lunch out').getByTestId('feeds')).toContainText('at Chez Louise');
  await newStep(page, 'Coffee out', 'Chez Louise');

  // Skip: the step is done, the address has no visit.
  await markDone(page, 'Coffee out');
  await expect(sheet(page).getByTestId('visit-sheet')).toBeVisible();
  await sheet(page).getByTestId('visit-skip').click();
  await expect(sheet(page)).toBeHidden();
  expect(((await store(page, 'addresses'))[0]!.visits as unknown[])).toHaveLength(0);

  // Answer: a note and Again; the address is Been, with the visit on it.
  await markDone(page, 'Lunch out');
  await expect(sheet(page).getByTestId('visit-sheet')).toContainText('How was Chez Louise?');
  await noSideways(page, 'after-visit sheet');
  await sheet(page).getByTestId('visit-note').fill('Quiet at noon');
  await sheet(page).getByTestId('verdict-again').click();
  await expect(sheet(page)).toBeHidden();
  await openAddresses(page);
  const row = page.getByTestId('address-row').filter({ hasText: 'Chez Louise' });
  await expect(row).toContainText('Been');
  await expect(row).toContainText('Again');
  await page.getByTestId('address-open').click();
  await expect(sheet(page).getByTestId('addr-visits')).toContainText('Quiet at noon');

  // Edit the visit by hand, then add one by hand.
  await sheet(page).getByTestId('visit-edit').click();
  await sheet(page).getByTestId('visit-note').fill('Quiet at noon, loud at one');
  await sheet(page).getByTestId('verdict-maybe').click();
  await sheet(page).getByTestId('visit-save').click();
  await expect(sheet(page).getByTestId('addr-visits')).toContainText('loud at one');
  await expect(sheet(page).getByTestId('addr-visits')).toContainText('Maybe');
  await sheet(page).getByTestId('addr-visit').click();
  await sheet(page).getByTestId('verdict-not-again').click();
  await expect(sheet(page)).toBeHidden();
  const visits = (await store(page, 'addresses'))[0]!.visits as { verdict: string }[];
  expect(visits.map(v => v.verdict).sort()).toEqual(['maybe', 'not-again']);
});

test('ticking a linked step done from Home\'s line asks how it was too', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await addByPaste(page, GOOGLE);
  await newStep(page, 'Lunch out', 'Chez Louise');
  await page.goto('/');
  await page.getByTestId('home-input').fill('done lunch out');
  await page.getByTestId('home-send').click();
  await expect(sheet(page).getByTestId('visit-sheet')).toContainText('How was Chez Louise?');
  await sheet(page).getByTestId('verdict-maybe').click();
  await expect(sheet(page)).toBeHidden();
  const visits = (await store(page, 'addresses'))[0]!.visits as { verdict: string }[];
  expect(visits.map(v => v.verdict)).toEqual(['maybe']);
});

test('a person: a number becomes a WhatsApp link, and a step done sets last seen', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAddresses(page);
  await page.getByTestId('person-new').click();
  await sheet(page).getByTestId('person-name').fill('Alex');
  await sheet(page).getByTestId('person-reach').fill('+33 6 12 34 56 78');
  await sheet(page).getByTestId('person-save').click();
  await expect(sheet(page).locator('.err')).toContainText('Choose how');
  await sheet(page).getByTestId('reach-whatsapp').click();
  await expect(sheet(page).getByTestId('person-reach')).toHaveValue('https://wa.me/33612345678');
  await sheet(page).getByTestId('person-save').click();
  await expect(sheet(page)).toBeHidden();
  const row = page.getByTestId('person-row').filter({ hasText: 'Alex' });
  await expect(row).toContainText('No date yet');
  await expect(row.getByTestId('person-reach-open')).toHaveAttribute('href', /wa\.me\/33612345678/);
  await noSideways(page, 'people list');

  await newStep(page, 'Coffee with Alex', 'Alex');
  await expect(card(page, 'Coffee with Alex').getByTestId('feeds')).toContainText('with Alex');
  await markDone(page, 'Coffee with Alex');
  await expect(sheet(page)).toBeHidden(); // no visit screen for a person
  await openAddresses(page);
  await expect(page.getByTestId('person-row').filter({ hasText: 'Alex' })).toContainText('Last seen');
  await page.getByTestId('person-open-sheet').click();
  await expect(sheet(page).getByTestId('person-seen')).toHaveValue(dayKey());
  // By hand: change it, then clear it.
  await sheet(page).getByTestId('person-seen').fill('2026-01-05');
  await sheet(page).getByTestId('person-save').click();
  await expect(page.getByTestId('person-row').filter({ hasText: 'Alex' })).toContainText('5 Jan 2026');
  await expect(page.getByTestId('person-row').filter({ hasText: 'Alex' })).not.toContainText(/overdue|late/i);
});

test('the module switch hides every screen, button and offer, and keeps the data', async ({ page }) => {
  await addByPaste(page, GOOGLE);
  await newStep(page, 'Lunch out', 'Chez Louise');
  await page.goto('/#settings');
  await expect(page.getByTestId('addresses-switch')).toBeChecked();
  await page.getByTestId('addresses-switch').uncheck();
  await expect(page.getByTestId('categories')).toHaveCount(0);

  await page.goto('/#today');
  await expect(card(page, 'Lunch out')).toBeVisible();
  await expect(page.getByTestId('feeds')).toHaveCount(0);
  await openStep(page, 'Lunch out');
  await expect(sheet(page).getByTestId('task-sheet')).toBeVisible();
  await expect(sheet(page).getByTestId('feeds-select')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('tab-home').click();
  await page.getByTestId('home-menu').click();
  await expect(page.getByTestId('menu-places')).toBeVisible();
  await expect(page.getByTestId('menu-addresses')).toHaveCount(0);
  await expect(page.getByTestId('menu-add-address')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Done with the module off: no after-visit screen.
  await page.goto('/#today');
  await markDone(page, 'Lunch out');
  await expect(sheet(page)).toBeHidden();
  await page.goto('/#addresses');
  await expect(page.getByTestId('addresses-off')).toBeVisible();
  await expect(page.getByTestId('addr-new')).toHaveCount(0);

  // On again: everything is back.
  await page.goto('/#settings');
  await page.getByTestId('addresses-switch').check();
  await openAddresses(page);
  await expect(page.getByTestId('address-row').filter({ hasText: 'Chez Louise' })).toHaveCount(1);
});

test('categories: rename, add, reorder and remove; an address whose category goes shows as uncategorised', async ({ page }) => {
  await addByPaste(page, GOOGLE);
  await page.goto('/#settings');
  const names = () => page.getByTestId('category-name').evaluateAll(els => els.map(e => (e as HTMLInputElement).value));
  expect(await names()).toEqual(['Food', 'Café & bar', 'Shopping', 'Sight', 'Museum', 'Park & public space', 'Outing', 'Other']);
  await page.getByTestId('category-name').first().fill('Eating out');
  await page.getByTestId('category-name').first().blur();
  await page.getByPlaceholder('New category').fill('Bookshops');
  await page.getByTestId('category-add').click();
  await expect.poll(names).toEqual(['Eating out', 'Café & bar', 'Shopping', 'Sight', 'Museum', 'Park & public space', 'Outing', 'Other', 'Bookshops']);
  await page.getByRole('button', { name: 'Move Bookshops up' }).click();
  await expect.poll(names).toContain('Bookshops');
  expect((await names()).indexOf('Bookshops')).toBe(7);

  // The address is "Other" (the default) until its category goes.
  await openAddresses(page);
  await expect(page.getByTestId('address-row')).toContainText('Other');
  await page.goto('/#settings');
  await page.getByRole('button', { name: 'Remove Other' }).click();
  await openAddresses(page);
  await expect(page.getByTestId('address-row')).toContainText('Uncategorised');
  expect(await store(page, 'addresses')).toHaveLength(1);
});

const CSV = [
  'Title,Note,URL,Comment',
  'Chez Louise,Good soup,https://www.google.com/maps/place/Chez+Louise/@48.85,2.35,17z,',
  ',,https://maps.app.goo.gl/AbCdEf123456,',
  ',,,',
  'Musée Exemple,Closed Mondays,,Go early',
].join('\n');

test('the Google Takeout import shows its summary first, adds what is new, and a second import adds nothing', async ({ page }) => {
  await openAddresses(page);
  await page.getByTestId('addr-import').click();
  await expect(sheet(page).getByTestId('takeout-sheet')).toBeVisible();
  await expect(sheet(page).getByTestId('takeout-go')).toBeDisabled();
  await sheet(page).getByTestId('takeout-file').setInputFiles({ name: 'Want to go.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(sheet(page).getByTestId('takeout-summary')).toBeVisible();
  await expect(sheet(page).getByTestId('takeout-rows')).toHaveText('3');
  await expect(sheet(page).getByTestId('takeout-added')).toHaveText('2'); // the short link has no name yet
  await expect(sheet(page).getByTestId('takeout-dups')).toHaveText('0');
  // Nothing is written before the person confirms.
  expect(await store(page, 'addresses')).toHaveLength(0);
  await sheet(page).getByTestId('takeout-name').fill('Le Petit Four');
  await expect(sheet(page).getByTestId('takeout-added')).toHaveText('3');
  await noSideways(page, 'takeout summary');
  await sheet(page).getByTestId('takeout-go').click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByTestId('address-row')).toHaveCount(3);
  const rows = await store(page, 'addresses');
  expect(rows).toHaveLength(3);
  expect(JSON.stringify(rows)).toContain('Closed Mondays');

  await page.getByTestId('addr-import').click();
  await sheet(page).getByTestId('takeout-file').setInputFiles({ name: 'Want to go.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(sheet(page).getByTestId('takeout-summary')).toBeVisible();
  await expect(sheet(page).getByTestId('takeout-added')).toHaveText('0');
  await expect(sheet(page).getByTestId('takeout-dups')).toHaveText('3');
  await expect(sheet(page).getByTestId('takeout-nothing')).toBeVisible();
  await expect(sheet(page).getByTestId('takeout-go')).toBeDisabled();
  await page.keyboard.press('Escape');
  expect(await store(page, 'addresses')).toHaveLength(3);
});

test('a standing obligation chooses what the planner offers', async ({ page }) => {
  await newStep(page, 'See a friend');
  await openStep(page, 'See a friend');
  await sheet(page).locator('details.more summary').click();
  await expect(sheet(page).getByTestId('offer')).toHaveCount(0); // only a standing obligation offers
  await sheet(page).locator('input[name=template]').check();
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  const standing = async () => (await store(page, 'tasks')).find(x => x.template === true)!;
  expect((await standing()).offer ?? null).toBeNull();

  // Reopened from Projects, where standing obligations live.
  await page.goto('/#projects');
  await page.getByText('Standing items').click();
  await page.locator('[data-task]').filter({ hasText: 'See a friend' }).first().getByRole('button').first().click();
  await sheet(page).locator('details.more summary').click();
  await expect(sheet(page).getByTestId('feeds-select')).toHaveCount(0);
  await sheet(page).getByTestId('offer').selectOption('person');
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  expect((await standing()).offer).toBe('person');
});

for (const [width, french] of [[320, false], [375, false], [430, false], [320, true]] as const) {
  test(`no sideways scroll on the addresses screen and its sheets at ${width}px${french ? ' in French' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await clipboard(page, SHORT);
    if (french) {
      await page.goto('/#settings');
      await page.getByRole('button', { name: 'Français' }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    }
    await page.goto('/#addresses');
    await expect(page.getByTestId('addr-empty')).toBeVisible();
    await noSideways(page, 'empty addresses');

    await page.getByTestId('addr-new').click();
    await sheet(page).getByTestId('addr-paste').click();
    await noSideways(page, 'new address, asked for the name');
    await sheet(page).getByTestId('addr-name').fill('A very long name for a place that someone saved from Maps one rainy afternoon');
    await sheet(page).getByTestId('addr-street').fill('1 Rue de la Longue Adresse Exemple, 75000 Ville-Avec-Un-Nom-Tres-Long');
    await sheet(page).getByTestId('addr-save').click();
    await expect(sheet(page)).toBeHidden();
    await page.getByTestId('person-new').click();
    await sheet(page).getByTestId('person-name').fill('Alexandrine-Marie de Montmorency-Longuenom');
    await sheet(page).getByTestId('person-reach').fill('+33 6 12 34 56 78');
    await noSideways(page, 'new person with the reach options');
    await sheet(page).getByTestId('reach-whatsapp').click();
    await sheet(page).getByTestId('person-seen').fill('2026-02-03');
    await sheet(page).getByTestId('person-save').click();
    await expect(sheet(page)).toBeHidden();
    await noSideways(page, 'addresses and people lists');

    await page.getByTestId('address-open').click();
    await sheet(page).getByTestId('addr-visit').click();
    await sheet(page).getByTestId('visit-note').fill('A long note, '.repeat(12));
    await noSideways(page, 'visit sheet');
    await sheet(page).getByTestId('verdict-again').click();
    await expect(sheet(page)).toBeHidden();
    await page.getByTestId('address-open').click();
    await noSideways(page, 'address sheet with a visit');
    await sheet(page).getByTestId('visit-edit').click();
    await noSideways(page, 'visit edit');
    await page.keyboard.press('Escape');

    await page.getByTestId('addr-import').click();
    await sheet(page).getByTestId('takeout-file').setInputFiles({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
    await expect(sheet(page).getByTestId('takeout-summary')).toBeVisible();
    await noSideways(page, 'takeout');
    await page.keyboard.press('Escape');

    await page.goto('/#settings');
    await expect(page.getByTestId('categories')).toBeVisible();
    await noSideways(page, 'settings with categories');
  });
}
