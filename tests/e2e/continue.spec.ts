// Resume (request of 28 Oct, never run until 10 Nov): a card with logged time offers Continue / Reprendre, never Start; the running display starts
// from the card's logged total and each run stays its own session; finishing a card with logged time never asks for a duration.
import { test, expect } from '@playwright/test';
import { importSample, goTab, noSideways, setLanguage, PHONES, LANGS } from './helpers';

const START = { en: /start/i, fr: /lancer/i } as const;
const CONTINUE = { en: 'Continue', fr: 'Reprendre' } as const;

for (const [w, h] of PHONES) for (const lang of LANGS) {
  test(`a card with logged time says Continue, resumes from its total, keeps one session per run and finishes without asking how long (${w}×${h}, ${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await importSample(page);
    await setLanguage(page, lang);
    await goTab(page, 'today');
    const first = page.getByTestId('first');
    const id = (await first.getAttribute('data-task'))!;
    // No time logged yet: it is offered as a start.
    await expect(first.getByTestId('go-timer')).toHaveText(START[lang]);
    await first.getByTestId('go-timer').click();
    await first.getByTestId('pause-timer').click();
    // Logged now: Continue, never Start.
    await expect(first.getByTestId('go-timer')).toHaveText(CONTINUE[lang]);
    await noSideways(page, 'continue button');
    await first.getByTestId('go-timer').click();
    // The clock starts from the logged total (one minute at least), not from zero.
    const clock = first.locator('.clock');
    await expect(clock).toBeVisible();
    const secs = async () => { const [a, b] = (await clock.innerText()).trim().split(':').map(Number); return (a ?? 0) * 60 + (b ?? 0); };
    expect(await secs()).toBeGreaterThanOrEqual(60);
    await first.getByTestId('pause-timer').click();
    // Each run is its own session.
    await page.goto('/#task/' + id);
    await expect(page.getByTestId('sheet').locator('.sesslist li')).toHaveCount(2);
    await page.keyboard.press('Escape');
    // Finishing a card with logged time uses that total and never asks how long.
    await goTab(page, 'today');
    await expect(page.getByTestId('first').getByTestId('go-timer')).toHaveText(CONTINUE[lang]);
    await page.getByTestId('first').getByRole('button', { name: lang === 'fr' ? 'Déjà fait' : 'Already done' }).click();
    await expect(page.getByTestId('sheet')).toBeHidden();
    await page.goto('/#task/' + id);
    await expect(page.getByTestId('done-day')).toBeVisible();
    await expect(page.getByTestId('sheet').locator('.sesslist li')).toHaveCount(2); // no third session was invented
  });
}

for (const lang of LANGS) {
  test(`on Home, ticking a card with logged time done does not ask how long (${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await importSample(page);
    await setLanguage(page, lang);
    await goTab(page, 'today');
    const first = page.getByTestId('first');
    await first.getByTestId('go-timer').click();
    await first.getByTestId('pause-timer').click();
    await goTab(page, 'home');
    const input = page.getByTestId('home-input').or(page.locator('.homein textarea')).first();
    await input.fill((lang === 'fr' ? 'fait ' : 'done ') + 'book the dentist');
    await input.press('Enter');
    await expect(page.getByTestId('home-line')).toBeVisible();
    await expect(page.getByTestId('card-duration')).toHaveCount(0);
  });
}
