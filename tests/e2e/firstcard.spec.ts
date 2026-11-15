// The welcome and the first card (14 Nov): a new device opens on what Réussite is, in the solitaire's words, with one button; after the suits the person
// writes the one thing they have been putting off, gives it a first move and a suit, and lands on Today with that card under Start here. Played, it leaves
// one small card behind (and the offer of a morning reminder where this device can have one), put away for good with one tap.
import { test, expect, type Page } from '@playwright/test';
import { noSideways, PHONES, LANGS, morningClock } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

const WORDS = {
  en: { pitch: /card game patience/, play: 'Play your first card', suits: 'The four suits', what: 'call the bank tomorrow', title: 'Call the bank', move: 'Open the Phone app', moveLabel: 'First move: ', coach: 'This is your first card', played: 'First card played', remind: 'Yes, remind me' },
  fr: { pitch: /jeu de cartes/, play: 'Jouer ma première carte', suits: 'Les quatre couleurs', what: 'appeler la banque demain', title: 'Appeler la banque', move: 'Ouvrir l’appli Téléphone', moveLabel: 'Premier geste : ', coach: 'Voici votre première carte', played: 'Première carte jouée', remind: 'Oui, rappelez-moi' },
} as const;

async function toFirst(page: Page, lang: 'en' | 'fr') {
  await page.goto('/');
  await expect(page.getByTestId('ob-language')).toBeVisible();
  await page.getByTestId('ob-lang-' + lang).click();
  await page.getByTestId('ob-next').click();
  await expect(page.getByTestId('ob-pillars')).toBeVisible();
  await page.getByTestId('ob-next').click();
  await expect(page.getByTestId('ob-first')).toBeVisible();
}

for (const [w, h] of PHONES) for (const lang of LANGS) {
  test(`welcome, the first card and its first play (${w}×${h}, ${lang})`, async ({ page }) => {
    const W = WORDS[lang];
    await morningClock(page);
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');

    // The welcome says what this is, in the solitaire's words, and has one main button; the rest are quiet links.
    const welcome = page.getByTestId('ob-language');
    await expect(welcome).toBeVisible();
    await page.getByTestId('ob-lang-' + lang).click();
    await expect(page.getByTestId('ob-pitch')).toContainText(W.pitch);
    await expect(page.getByTestId('ob-next')).toHaveText(W.play);
    await expect(welcome.locator('.btn.primary')).toHaveCount(1);
    await expect(page.getByTestId('ob-more')).toHaveAttribute('href', lang === 'fr' ? '/hello/fr/' : '/hello/');
    await expect(page.getByTestId('ob-pair-link')).toBeVisible();
    await expect(page.getByTestId('ob-skip')).toBeVisible();
    await expect(welcome).not.toContainText(/recovery key.*AI|sync|synchronisation/i);
    await noSideways(page, 'welcome');

    await page.getByTestId('ob-next').click();
    await expect(page.getByTestId('ob-pillars')).toContainText(W.suits);
    await noSideways(page, 'suits');
    await page.getByTestId('ob-next').click();

    // What have you been putting off: an example can be tapped; nothing goes on with an empty box.
    await expect(page.getByTestId('ob-first')).toBeVisible();
    await expect(page.getByTestId('ob-next')).toBeDisabled();
    await page.getByTestId('ob-first-ex').first().click();
    await expect(page.getByTestId('ob-first-input')).not.toHaveValue('');
    await page.getByTestId('ob-first-input').fill(W.what);
    await noSideways(page, 'first');
    await page.getByTestId('ob-next').click();

    // Its first move is suggested from the verb, and the day in the line was read (the title has no "tomorrow").
    await expect(page.getByTestId('ob-move')).toBeVisible();
    await expect(page.getByTestId('ob-first-title')).toContainText(W.title);
    await expect(page.getByTestId('ob-first-title')).not.toContainText(/tomorrow|demain/);
    await expect(page.getByTestId('ob-move-input')).toHaveValue(W.move);
    await page.getByTestId('ob-suit-C').click();
    await expect(page.getByTestId('ob-suit-C')).toHaveAttribute('aria-pressed', 'true');
    await noSideways(page, 'move');
    await page.getByTestId('ob-next').click();

    // Today: the card is Start here, with its first move and one line above it.
    await expect(page.getByTestId('todayview')).toBeVisible();
    const first = page.getByTestId('first');
    await expect(first).toContainText(W.title);
    await expect(first).toContainText(W.moveLabel + W.move);
    await expect(page.getByTestId('first-coach')).toContainText(W.coach);
    await noSideways(page, 'today');
    // The coach line is above the card, and both are on the first screen.
    const coach = await page.getByTestId('first-coach').boundingBox(), card = await first.boundingBox();
    expect(coach!.y + coach!.height).toBeLessThanOrEqual(card!.y + 1);

    // Start it: the line goes. Done: the card is played and its small card shows.
    await page.getByTestId('go-timer').click();
    await expect(page.getByTestId('first-coach')).toHaveCount(0);
    await first.getByRole('button', { name: lang === 'fr' ? 'Jouée' : 'Played', exact: true }).click();
    const played = page.getByTestId('first-played');
    await expect(played).toBeVisible({ timeout: 15_000 });
    await expect(played).toContainText(W.played);
    await expect(page.locator('.pile[data-suit=C] .pc')).not.toHaveClass(/empty/);
    await noSideways(page, 'played');

    // It survives a reload, and one tap puts it away for good.
    await page.reload();
    await page.getByTestId('tab-today').click();
    await expect(page.getByTestId('first-played')).toBeVisible();
    await page.getByTestId('first-done').click();
    await expect(page.getByTestId('first-played')).toHaveCount(0);
    await page.reload();
    await page.getByTestId('tab-today').click();
    await expect(page.getByTestId('todayview')).toBeVisible();
    await expect(page.getByTestId('first-played')).toHaveCount(0);
  });
}

test('Not now on the first card goes Home with nothing made, and Today has no coach line', async ({ page }) => {
  await toFirst(page, 'en');
  await page.getByTestId('ob-first-skip').click();
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('tab-today').click();
  await expect(page.getByTestId('todayview')).toBeVisible();
  await expect(page.getByTestId('first-coach')).toHaveCount(0);
  await expect(page.getByTestId('first-played')).toHaveCount(0);
  const tasks = await page.evaluate(() => new Promise<number>(res => { const r = indexedDB.open('reussite'); r.onsuccess = () => { const q = r.result.transaction('tasks').objectStore('tasks').count(); q.onsuccess = () => res(q.result); }; }));
  expect(tasks).toBe(0);
});

test('a line with no verb the list knows leaves the first move empty; a typed one is kept, and Back keeps the line', async ({ page }) => {
  await toFirst(page, 'en');
  await page.getByTestId('ob-first-input').fill('the thesis');
  await page.getByTestId('ob-first-input').press('Enter');
  await expect(page.getByTestId('ob-move-input')).toHaveValue('');
  await page.getByTestId('ob-back').click();
  await expect(page.getByTestId('ob-first-input')).toHaveValue('the thesis');
  await page.getByTestId('ob-next').click();
  await page.getByTestId('ob-move-input').fill('Open the draft at chapter 2');
  await page.getByTestId('ob-next').click();
  await expect(page.getByTestId('first')).toContainText('The thesis');
  await expect(page.getByTestId('first')).toContainText('First move: Open the draft at chapter 2');
});

test('the played card offers a reminder for the morning where this device can have one, and the Home Screen steps on an iPhone in the browser', async ({ page }, info) => {
  await morningClock(page);
  await toFirst(page, 'en');
  await page.getByTestId('ob-first-input').fill('do the dishes');
  await page.getByTestId('ob-next').click();
  await page.getByTestId('ob-next').click();
  await page.getByTestId('first').getByRole('button', { name: 'Already played', exact: true }).click();
  // No timer ran: it asks how long it took.
  await page.getByTestId('dur').first().click();
  const played = page.getByTestId('first-played');
  await expect(played).toBeVisible({ timeout: 15_000 });
  if (info.project.name === 'iphone') {
    // An iPhone in Safari has no reminders until Réussite is on the Home Screen: the card says how, and asks nothing it cannot do.
    await expect(page.getByTestId('first-install')).toContainText('Add Réussite to your Home Screen first');
    await expect(page.getByTestId('first-remind')).toHaveCount(0);
  } else {
    // This browser can have reminders (the test build has a key and a relay): the question and its button show.
    await expect(played).toContainText('A reminder tomorrow morning to deal your hand?');
    await expect(page.getByTestId('first-remind')).toBeVisible();
  }
  await page.getByTestId('first-done').click();
  await expect(played).toHaveCount(0);
});
