// Home's parser with no AI (15 Nov, docs/dev/home.md): a new card gets its suit and first move from its words; several things in one line open the review;
// a long sentence is a card at once; a note, the ticks, something waited for, the timer said in words, and a name that is only nearly right, offered as a pick.
// The default device: past set-up, no AI, an empty list and the default suits. At 320×568 and 390×844, in both languages.
import { test, expect, type Page } from '@playwright/test';
import { PHONES, LANGS, noSideways, morningClock, setLanguage, openMenu } from './helpers';

const input = (page: Page) => page.getByTestId('home-input');
const say = async (page: Page, text: string) => {
  await page.getByTestId('tab-home').click();
  await input(page).fill(text);
  await input(page).press('Enter');
};
const tasks = (page: Page) => page.evaluate(() => new Promise<Record<string, any>[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const all = open.result.transaction('tasks').objectStore('tasks').getAll(); all.onsuccess = () => res(all.result); };
}));
const find = async (page: Page, title: string) => (await tasks(page)).find(t => t.title === title && !t._del);
const made = async (page: Page, title: string) => { await expect.poll(async () => !!(await find(page, title)), title).toBe(true); return (await find(page, title))!; };

const W = {
  en: {
    rent: 'pay the rent tomorrow', rentTitle: 'Pay the rent', rentMove: 'Open the bank app',
    two: 'call the bank; buy bread friday', twoTitles: ['Call the bank', 'Buy bread'],
    long: 'I need to write to the agency about the heating that stopped working again in the flat', longTitle: 'Write to the agency about the heating that stopped working again in the flat',
    note: 'note on the rent: the landlord wants a transfer', noteText: 'The landlord wants a transfer',
    urgent: 'urgent: renew the passport', urgentTitle: 'Renew the passport',
    wait: 'waiting for the parcel', waitTitle: 'The parcel',
    start: 'start the rent', pause: 'pause', took: 'the rent took 40 min', saved: 'Time saved: 40 min',
    near: 'done the retn', created: 'Created: ', changed: 'Changed: ',
  },
  fr: {
    rent: 'payer le loyer demain', rentTitle: 'Payer le loyer', rentMove: 'Ouvrir l’appli de la banque',
    two: 'appeler la banque ; acheter du pain vendredi', twoTitles: ['Appeler la banque', 'Acheter du pain'],
    long: 'écrire à l’agence au sujet du chauffage qui s’est encore arrêté dans l’appartement du troisième', longTitle: 'Écrire à l’agence au sujet du chauffage qui s’est encore arrêté dans l’appartement du troisième',
    note: 'note sur le loyer : le propriétaire veut un virement', noteText: 'Le propriétaire veut un virement',
    urgent: 'urgent : renouveler le passeport', urgentTitle: 'Renouveler le passeport',
    wait: 'en attente du colis', waitTitle: 'Colis',
    start: 'démarrer le loyer', pause: 'pause', took: 'le loyer a pris 40 min', saved: 'Durée enregistrée : 40 min',
    near: 'fini le loyre', created: 'Créé : ', changed: 'Modifié : ',
  },
} as const;

for (const [w, h] of PHONES) for (const lang of LANGS) {
  test(`what Home reads with no AI (${w}×${h}, ${lang})`, async ({ page }) => {
    const L = W[lang];
    await morningClock(page);
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    await expect(page.getByTestId('home')).toBeVisible();
    if (lang === 'fr') await setLanguage(page, 'fr');

    // A new card: its suit and its first move come from its words, the day is read out of the title.
    await say(page, L.rent);
    const rent = await made(page, L.rentTitle);
    expect(rent.suit).toBe('D');
    expect(rent.starter).toBe(L.rentMove);
    expect(rent.due).toBeTruthy();
    await expect(page.getByTestId('home-line')).toHaveText(L.created + L.rentTitle);
    await noSideways(page, 'Home, a card made');

    // Two things in one line: the review, and both cards once applied.
    await say(page, L.two);
    const review = page.getByTestId('review');
    await expect(review).toBeVisible();
    await expect(review.getByTestId('chg')).toHaveCount(2);
    await noSideways(page, 'review of two cards');
    await page.getByTestId('apply-changes').click();
    await expect(review).toBeHidden();
    for (const t of L.twoTitles) await made(page, t);
    expect((await find(page, L.twoTitles[1]))!.due).toBeTruthy();

    // A long sentence is a card at once, with no AI.
    await say(page, L.long);
    await made(page, L.longTitle);
    await expect(page.getByTestId('home-line')).toHaveText(L.created + L.longTitle);
    await noSideways(page, 'Home, a long card made');

    // A note on a card goes in at once.
    await say(page, L.note);
    await expect(page.getByTestId('home-line')).toHaveText(L.changed + L.rentTitle);
    await expect.poll(async () => (await find(page, L.rentTitle))!.note ?? '').toContain(L.noteText);

    // "urgent:" ticks it.
    await say(page, L.urgent);
    expect((await made(page, L.urgentTitle)).urgent).toBe(true);

    // Something waited for is in the Waiting list.
    await say(page, L.wait);
    expect((await made(page, L.waitTitle)).kind).toBe('event');
    await openMenu(page, 'waiting');
    await expect(page.getByTestId('waiting-row').filter({ hasText: L.waitTitle })).toHaveCount(1);
    await noSideways(page, 'Waiting');

    // The timer in words: start goes to Today with the card running; "pause" on Home stops it; time said afterwards is saved.
    await say(page, L.start);
    await expect(page.getByTestId('todayview')).toBeVisible();
    await expect(page.getByTestId('pause-timer')).toBeVisible();
    expect((await find(page, L.rentTitle))!.started).toBeTruthy();
    await noSideways(page, 'Today, a card running');
    await say(page, L.pause);
    await expect.poll(async () => !!(await find(page, L.rentTitle))!.started).toBe(false);
    await say(page, L.took);
    await expect(page.locator('.toast')).toContainText(L.saved);

    // A name only nearly right is offered, never taken; Home takes the person to Today, where the pick is.
    await say(page, L.near);
    const pick = page.getByTestId('card-pick');
    await expect(pick).toBeVisible();
    await expect(page.getByTestId('todayview')).toBeVisible();
    expect((await find(page, L.rentTitle))!.status).toBe('open');
    await expect(pick.getByTestId('pick')).toHaveText([L.rentTitle]);
    await noSideways(page, 'Today, the pick');
    await pick.getByTestId('pick').click();
    await expect.poll(async () => (await find(page, L.rentTitle))!.status).toBe('done');
  });
}
