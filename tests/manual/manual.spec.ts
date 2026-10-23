import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openMenu } from '../e2e/helpers';

// The manual's screenshots (docs/dev/manual.md). One run makes every picture the manual shows, in both languages and both
// themes, from invented data only: nothing here is read from the real list, and `private/` is never touched. Run with
// `npm run manual:shots`; it is not part of `npm run e2e`.
const OUT = process.env.MANUAL_SHOTS_DIR ?? join(process.cwd(), 'public/manual/shots');
const LANGS = ['en', 'fr'] as const;
const THEMES = ['light', 'dark'] as const;
type Lang = (typeof LANGS)[number];
const NEW_DEVICE = { cookies: [], origins: [] };

// ---------- the invented list ----------
const shift = new Date().getHours() < 5 ? -1 : 0;
const day = (n: number) => { const x = new Date(); x.setHours(12); x.setDate(x.getDate() + n + shift); return x.toISOString().slice(0, 10); };
const HLC = '0000000000001:0000:seed';
type Docs = Record<string, [string, Record<string, unknown>][]>;

function list(lang: Lang): Docs {
  const L = (en: string, fr: string) => (lang === 'fr' ? fr : en);
  const task = (title: string, o: Record<string, unknown> = {}) => ({
    title, project: 'inbox', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 15, est0: null, estBy: 'me', status: 'open', doneAt: null, doneDay: null,
    started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: day(-20) + 'T09:00:00.000Z', src: 'page', ...o,
  });
  // Steps finished in the last days, each timed a little over its estimate: the Log and the personal estimates have something to show.
  const done = (title: string, project: string, suit: string, est: number, real: number, ago: number) => task(title, {
    project, suit, est, est0: est, status: 'done', doneDay: day(-ago), doneAt: day(-ago) + 'T10:00:00.000Z', where: 'any',
  });
  const past = [
    ['Open the bank app and download the September statement', 'Ouvrir l’appli de la banque et télécharger le relevé de septembre', 'p1', 'D', 10, 14, 1],
    ['Open Mail and reply to the electrician', 'Ouvrir Mail et répondre à l’électricien', 'p1', 'D', 10, 12, 2],
    ['Open the thesis draft and fix the references', 'Ouvrir le mémoire et corriger les références', 'p3', 'S', 20, 26, 2],
    ['Open the supervisor’s email and propose two meeting slots', 'Ouvrir le mail de la directrice et proposer deux créneaux', 'p3', 'S', 10, 12, 3],
    ['Open Messages and text Noor about the weekend', 'Ouvrir Messages et écrire à Noor pour le week-end', 'p2', 'H', 5, 8, 4],
    ['Open Doctolib and book the eye test', 'Ouvrir Doctolib et prendre rendez-vous pour la vue', 'p2', 'H', 10, 11, 5],
    ['Open the thesis draft and write the introduction', 'Ouvrir le mémoire et écrire l’introduction', 'p3', 'S', 30, 38, 6],
  ] as const;
  const tasks: [string, Record<string, unknown>][] = [
    ['t1', task(L('Open Mail and send the signed lease to the agency', 'Ouvrir Mail et envoyer le bail signé à l’agence'), { project: 'p1', suit: 'D', due: day(2), urgent: true, est: 10, order: 1 })],
    ['t2', task(L('Open the thesis draft and write the second paragraph of the method section', 'Ouvrir le mémoire et écrire le deuxième paragraphe de la méthode'), { project: 'p3', suit: 'S', est: 30, order: 2, starter: L('Open the draft on the method section', 'Ouvrir le brouillon à la section méthode') })],
    ['t3', task(L('Open Doctolib and book the dentist', 'Ouvrir Doctolib et prendre rendez-vous chez le dentiste'), { project: 'p2', suit: 'H', due: day(5), est: 10, app: 'Doctolib', link: 'https://www.doctolib.fr/', order: 3 })],
    ['t4', task(L('Open Messages and text Alex about Sunday', 'Ouvrir Messages et écrire à Alex pour dimanche'), { project: 'p2', suit: 'H', due: day(3), important: false, est: 5, order: 4 })],
    ['t5', task(L('Open Files and sort the scanned receipts', 'Ouvrir Fichiers et trier les reçus scannés'), { project: 'p1', suit: 'D', important: false, est: 20, order: 5, where: 'oldtown' })],
    ['t6', task(L('Open Mail and answer the landlord about the boiler', 'Ouvrir Mail et répondre au propriétaire pour la chaudière'), { project: 'p1', suit: 'D', due: day(9), est: 10, order: 6 })],
    ['t7', task(L('Open the thesis draft and read the supervisor’s comments', 'Ouvrir le mémoire et lire les commentaires de la directrice'), { project: 'p3', suit: 'S', due: day(14), est: 25, order: 7 })],
    ['t12', task(L('Open Files and file the signed boiler form', 'Ouvrir Fichiers et classer le formulaire signé de la chaudière'), { project: 'p1', suit: 'D', est: 10, order: 12, after: 't6' })],
    ['t13', task(L('Open Mail and send the boiler form to the agency', 'Ouvrir Mail et envoyer le formulaire de la chaudière à l’agence'), { project: 'p1', suit: 'D', est: 10, order: 13, after: 't12' })],
    ['t8', task(L('See a friend or go out', 'Voir un proche ou sortir'), { project: 'p2', suit: 'H', template: true, offer: 'address', est: 60, order: 8, at: '18:00', dur: 90 })],
    ['t9', task(L('Choir rehearsal', 'Répétition de la chorale'), { project: 'p2', suit: 'H', template: true, est: 90, at: '19:30', dur: 90, lead: 30, weekdays: [3], order: 9 })],
    ['t10', task(L('Dentist', 'Dentiste'), { project: 'p2', suit: 'H', due: day(4), at: '14:30', dur: 45, est: 45, order: 10 })],
    ['t11', task(L('Open the buy-a-gift list and pick a gift for Mum', 'Ouvrir la liste de cadeaux et en choisir un pour maman'), { project: 'p2', suit: 'H', where: 'lisbon', est: 20, order: 11, dueRule: { beforeEndOf: 'stay1', daysBefore: 2 } })],
    ...past.map(([en, fr, p, s, est, real, ago], i) => [`d${i}`, done(L(en, fr), p, s, est, real, ago)] as [string, Record<string, unknown>]),
  ];
  const sessions: [string, Record<string, unknown>][] = past.map(([, , , , , real, ago], i) => [`s${i}`, { taskId: `d${i}`, d: day(-ago), m: real, why: 'done', at: day(-ago) + 'T10:00:00.000Z', source: 'timer' }]);
  const item = (id: string, text: string, w: number) => ({ id, text, w, by: 'me' });
  return {
    meta: [['settings', { language: lang, here: 'home', reduceMotion: true, celebrations: 'off', credit: { en: '', fr: '' } }]],
    places: [['home', { name: L('Home', 'Maison'), timeZone: 'Europe/Paris', order: 1 }], ['lisbon', { name: L('Lisbon', 'Lisbonne'), timeZone: 'Europe/Lisbon', order: 2 }], ['oldtown', { name: L('Old town', 'Vieille ville'), timeZone: 'Europe/Paris', order: 3, parentId: 'home' }]],
    stays: [['stay1', { placeId: 'lisbon', from: day(12), to: day(16), note: '' }]],
    projects: [
      ['p1', { name: L('Housing papers', 'Papiers du logement'), suit: 'D', where: 'any', goal: L('Lease signed and filed by the end of the month', 'Bail signé et classé avant la fin du mois'), goalBy: 'me', due: day(20), order: 1, status: 'active' }],
      ['p2', { name: L('Friends & outings', 'Amis et sorties'), suit: 'H', where: 'any', goal: L('See a friend every week', 'Voir un proche chaque semaine'), goalBy: 'me', due: null, order: 2, status: 'active' }],
      ['p3', { name: L('Thesis', 'Mémoire'), suit: 'S', where: 'home', goal: L('Method section drafted by the 30th', 'Section méthode rédigée avant le 30'), goalBy: 'me', due: day(7), order: 3, status: 'active' }],
      ['inbox', { name: L('Inbox', 'Boîte de réception'), suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' }],
    ],
    tasks, sessions,
    decisions: [['dec1', {
      title: L('Stay in the flat or move?', 'Rester dans l’appartement ou déménager ?'), projectId: 'p1', taskId: null,
      problem: { what: L('The rent goes up in January', 'Le loyer augmente en janvier'), should: L('A home I can afford and want to stay in', 'Un logement abordable où je veux rester'), gap: L('About 120 a month', 'Environ 120 par mois'), constraints: L('The lease ends in March', 'Le bail finit en mars'), deadline: day(30), control: L('Whether I look, and when', 'Chercher ou non, et quand') },
      options: [
        { id: 'o1', name: L('Stay one more year', 'Rester un an de plus'), screened: null, pros: [item('i1', L('No move to organise', 'Pas de déménagement à organiser'), 4), item('i2', L('I like the street', 'J’aime la rue'), 3)], cons: [item('i3', L('The rent is higher', 'Le loyer est plus élevé'), 3)], prosNot: [], consNot: [item('i4', L('Moving in winter is hard', 'Déménager en hiver est dur'), 3)] },
        { id: 'o2', name: L('Move in the spring', 'Déménager au printemps'), screened: null, pros: [item('i5', L('A cheaper place', 'Un logement moins cher'), 4)], cons: [item('i6', L('Weeks of searching and boxes', 'Des semaines de recherche et de cartons'), 4)], prosNot: [item('i7', L('Nothing to decide for a year', 'Rien à décider pendant un an'), 2)], consNot: [] },
      ],
      status: 'decided', listClosedAt: day(-12) + 'T10:00:00.000Z', chosen: L('Stay one more year', 'Rester un an de plus'), chosenId: 'o1',
      why: L('Cheaper overall once the move is counted', 'Moins cher au total une fois le déménagement compté'), mustBeTrue: L('The rent stays under the new level', 'Le loyer reste sous le nouveau niveau'),
      falsifier: L('The rent rises again', 'Le loyer augmente encore'), date: day(-12), reviewOn: day(40), taskIds: [], newFacts: [], reviews: [], history: [],
    }]],
    addresses: [
      ['a1', { name: 'Chez Louise', category: 'food', placeId: 'home', mapsUrl: 'https://maps.example/chez-louise', street: null, state: 'been', by: 'me', note: L('Cash only', 'Espèces seulement'), visits: [{ id: 'v1', day: day(-40), note: L('The soup was good and the room was quiet.', 'La soupe était bonne et la salle calme.'), verdict: 'again' }] }],
      ['a2', { name: 'Café Mokka', category: 'cafe', placeId: 'home', mapsUrl: 'https://maps.example/cafe-mokka', street: null, state: 'want', by: 'me', note: '', visits: [] }],
      ['a3', { name: 'Librairie Sol', category: 'shopping', placeId: 'home', mapsUrl: 'https://maps.example/librairie-sol', street: null, state: 'want', by: 'me', note: '', visits: [] }],
      ['a4', { name: L('Buttes park', 'Parc des Buttes'), category: 'park', placeId: 'home', mapsUrl: null, street: null, state: 'want', by: 'me', note: '', visits: [] }],
      ['a5', { name: 'Pastelaria Aurora', category: 'food', placeId: 'lisbon', mapsUrl: 'https://maps.example/aurora', street: null, state: 'want', by: 'me', note: '', visits: [] }],
      ['a6', { name: 'Miradouro da Graça', category: 'sight', placeId: 'lisbon', mapsUrl: 'https://maps.example/graca', street: null, state: 'want', by: 'me', note: '', visits: [] }],
    ],
    people: [
      ['pe1', { name: 'Alex', placeId: 'home', reach: 'https://wa.me/33600000000', note: '', lastSeen: day(-12) }],
      ['pe2', { name: 'Noor', placeId: 'home', reach: 'mailto:noor@example.com', note: '', lastSeen: day(-30) }],
      ['pe3', { name: 'Inês', placeId: 'lisbon', reach: null, note: '', lastSeen: null }],
    ],
    memory: [
      ['m1', { kind: 'profile', name: L('About me', 'À propos de moi'), aliases: [], private: false, updated: day(-9) + 'T09:00:00.000Z', lines: [
        { id: 'l1', text: L('I start better when there is a time attached.', 'Je démarre mieux quand il y a une heure.'), at: day(-9) + 'T09:00:00.000Z', by: 'me' },
        { id: 'l2', text: L('Mornings are my best hours.', 'Les matins sont mes meilleures heures.'), at: day(-9) + 'T09:00:00.000Z', by: 'me' }] }],
      ['m2', { kind: 'person', name: 'Alex', aliases: [], private: false, updated: day(-5) + 'T09:00:00.000Z', lines: [
        { id: 'l3', text: L('Plays the cello in the choir.', 'Joue du violoncelle dans la chorale.'), at: day(-5) + 'T09:00:00.000Z', by: 'me' },
        { id: 'l4', text: L('Prefers a message to a call.', 'Préfère un message à un appel.'), at: day(-5) + 'T09:00:00.000Z', by: 'me' }] }],
      ['m3', { kind: 'topic', name: L('The flat', 'L’appartement'), aliases: [L('rent', 'loyer')], private: false, updated: day(-3) + 'T09:00:00.000Z', lines: [
        { id: 'l5', text: L('The lease ends in March.', 'Le bail finit en mars.'), at: day(-3) + 'T09:00:00.000Z', by: 'me' }] }],
      ['m4', { kind: 'topic', name: L('Health', 'Santé'), aliases: [], private: true, updated: day(-2) + 'T09:00:00.000Z', lines: [
        { id: 'l6', text: L('Dentist every six months.', 'Dentiste tous les six mois.'), at: day(-2) + 'T09:00:00.000Z', by: 'me' }] }],
    ],
  };
}

/** Put the list in the app the way a restored backup does, then reload. */
async function seed(page: Page, docs: Docs) {
  const stamp = (id: string, f: Record<string, unknown>) => ({ id, _v: 5, _hlc: Object.fromEntries(Object.keys(f).map(k => [k, HLC])), ...f });
  const file = { format: 'reussite-backup', schema: 5, exported: new Date().toISOString(), data: Object.fromEntries(Object.entries(docs).map(([c, ds]) => [c, ds.map(([id, f]) => stamp(id, f))])) };
  await page.goto('/#settings');
  page.once('dialog', d => void d.accept());
  await page.getByTestId('data').locator('input[type=file]').first().setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.locator('.toast')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('about')).toBeVisible();
}

for (const lang of LANGS) for (const theme of THEMES) {
  test.describe(`${lang} ${theme}`, () => {
    test.use({ viewport: { width: 375, height: 720 }, deviceScaleFactor: 2, colorScheme: theme, locale: lang === 'fr' ? 'fr-FR' : 'en-US', timezoneId: 'Europe/Paris' });
    const dir = join(OUT, `${lang}-${theme}`);
    mkdirSync(dir, { recursive: true });

    /** The screen as it is, without the scrollbar a desktop browser draws and without a focused field. */
    async function shot(page: Page, name: string, keepScroll = false) {
      const update = page.locator('.banner[role=status] .ghost');
      if (await update.count()) await update.first().click();
      if (!keepScroll) await page.evaluate(() => window.scrollTo(0, 0));
      await page.addStyleTag({ content: 'html{scrollbar-width:none}' });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(dir, name + '.png') });
    }
    const sheet = (page: Page) => page.getByTestId('sheet');
    const closeSheet = async (page: Page) => { await page.keyboard.press('Escape'); await expect(sheet(page)).toBeHidden(); };
    const atTop = (page: Page, id: string) => page.getByTestId(id).evaluate(el => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -8); });

    test.describe('first run', () => {
      test.use({ storageState: NEW_DEVICE });
      test('onboarding', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('ob-language')).toBeVisible();
        if (lang === 'fr') await page.getByTestId('ob-lang-fr').click();
        await shot(page, 'onboarding');
      });
    });

    test('the app', async ({ page }) => {
      test.setTimeout(120_000);
      await seed(page, list(lang));

      // The morning check-in and its plan, then the list it made.
      await page.goto('/#home');
      await page.getByTestId('home-plan').click();
      await page.getByTestId('ci-next').click();
      await expect(page.getByTestId('plan-items')).toBeVisible();
      await shot(page, 'checkin');
      await page.getByTestId('go-with-this').click();
      await page.goto('/#today');
      await expect(page.getByTestId('first')).toBeVisible();
      await shot(page, 'today');

      await page.goto('/#matrix');
      await expect(page.getByTestId('quad1')).toBeVisible();
      await shot(page, 'matrix');
      await page.getByTestId('chain-toggle').first().click();
      await expect(page.getByTestId('chain').first()).toBeVisible();
      await page.getByTestId('chain').first().scrollIntoViewIfNeeded();
      await shot(page, 'chain', true);
      await page.goto('/#matrix');
      await page.getByTestId('area-chips').scrollIntoViewIfNeeded();
      await shot(page, 'areas', true);

      await page.goto('/#projects');
      await expect(page.getByTestId('decisions')).toBeVisible();
      await shot(page, 'projects');
      await page.getByTestId('decisions').locator('.linklike').first().click();
      await expect(page.getByTestId('decision-page')).toBeVisible();
      await shot(page, 'decision');
      await closeSheet(page);

      // Today's AI links (Ask any AI), with no key set up.
      await page.goto('/#today');
      await page.getByTestId('ask-any').click();
      await expect(page.getByTestId('ask-any-sheet')).toBeVisible();
      await shot(page, 'askany');
      await closeSheet(page);

      await page.goto('/#calendar');
      await expect(page.getByTestId('calendar')).toBeVisible();
      await shot(page, 'calendar');
      await page.getByTestId('cal-day').click();
      await page.waitForTimeout(300);
      await atTop(page, 'calendar');
      await shot(page, 'calendar-day', true);
      await page.getByTestId('cal-log').click();
      await expect(page.getByTestId('log')).toBeVisible();
      await shot(page, 'log');

      await openMenu(page, 'places');
      await expect(sheet(page)).toBeVisible();
      await shot(page, 'places');
      await closeSheet(page);

      await page.goto('/#settings');
      await shot(page, 'settings');
      await page.getByTestId('stays').getByTestId('plan-trip').click();
      await expect(sheet(page).getByTestId('trip-sheet')).toBeVisible();
      await shot(page, 'trip');
      await closeSheet(page);
      await atTop(page, 'sync');
      await shot(page, 'sync', true);
      await atTop(page, 'privacy');
      await shot(page, 'privacy', true);

      await page.goto('/#addresses');
      await expect(page.getByTestId('addresses')).toBeVisible();
      await shot(page, 'addresses');
      await page.getByTestId('address-row').filter({ hasText: 'Chez Louise' }).getByTestId('address-open').click();
      await sheet(page).getByTestId('addr-visit').click();
      await expect(sheet(page).getByTestId('visit-sheet')).toBeVisible();
      await sheet(page).getByTestId('visit-note').fill(lang === 'fr' ? 'Le fromage était bon, la salle un peu bruyante.' : 'The cheese was good, the room a little loud.');
      await shot(page, 'visit');
      await closeSheet(page);

      await page.goto('/#memory');
      await expect(page.getByTestId('memory')).toBeVisible();
      await shot(page, 'memory');

      await page.goto('/#notifications');
      await expect(page.getByTestId('notifications')).toBeVisible();
      await shot(page, 'notifications');

      // Home last: the line it takes adds a step to the Inbox.
      await page.goto('/#home');
      await page.getByTestId('home-input').fill(lang === 'fr' ? 'appeler la banque demain' : 'call the bank tomorrow');
      await page.getByTestId('home-send').click();
      await expect(page.getByTestId('receipt')).toBeVisible();
      await shot(page, 'home');
    });
  });
}
