// The running card (request of 29 Oct, unverified until 10 Nov): tapping its body opens the card's sheet and the timer keeps running; the sheet shows
// the timer, Pause and Done; nothing but Pause pauses.
import { test, expect, type Page } from '@playwright/test';
import { importSample, goTab, noSideways, setLanguage, PHONES, LANGS } from './helpers';

const started = (page: Page, id: string) => page.evaluate(i => new Promise<string | null>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const g = open.result.transaction('tasks').objectStore('tasks').get(i); g.onsuccess = () => res((g.result?.started as string | undefined) ?? null); };
}), id);

for (const [w, h] of PHONES) for (const lang of LANGS) {
  test(`tapping the running card opens its sheet, the timer keeps running, and only Pause pauses (${w}×${h}, ${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await importSample(page);
    await setLanguage(page, lang);
    await goTab(page, 'today');
    const first = page.getByTestId('first');
    const id = (await first.getAttribute('data-task'))!;
    await first.getByTestId('go-timer').click();
    await expect(first.getByTestId('pause-timer')).toBeVisible();
    const t0 = await started(page, id);
    expect(t0).not.toBeNull();

    // Tap the body of the card (its title).
    await first.locator('.t').click();
    const sheet = page.getByTestId('sheet');
    await expect(sheet).toBeVisible();
    // The timer, Pause and Done are in the sheet, in the screen.
    const strip = sheet.getByTestId('run-strip');
    await expect(strip.locator('.clock')).toBeVisible();
    await expect(strip.getByTestId('run-pause')).toBeVisible();
    await expect(strip.getByTestId('run-done')).toBeVisible();
    for (const b of [strip.locator('.clock'), strip.getByTestId('run-pause'), strip.getByTestId('run-done')]) await expect(b).toBeInViewport({ ratio: 1 });
    await noSideways(page, 'running sheet');
    // The clock keeps ticking, and nothing else in the sheet paused it.
    const c1 = await strip.locator('.clock').innerText();
    await expect.poll(() => strip.locator('.clock').innerText()).not.toBe(c1);
    await sheet.locator('input[name=title]').click();
    await sheet.locator('textarea[name=note]').click();
    expect(await started(page, id)).toBe(t0);
    // Closing the sheet without Pause leaves it running too.
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    expect(await started(page, id)).toBe(t0);
    await expect(first.getByTestId('pause-timer')).toBeVisible();

    // The running step's row in the list opens it the same way.
    const row = page.locator('[data-row="' + id + '"] .t');
    if (await row.count()) {
      await row.first().click();
      await expect(sheet).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      expect(await started(page, id)).toBe(t0);
    }

    // Only Pause pauses.
    await first.locator('.t').click();
    await sheet.getByTestId('run-strip').getByTestId('run-pause').click();
    await expect(sheet).toBeHidden();
    expect(await started(page, id)).toBeNull();
    await expect(first.getByTestId('go-timer')).toBeVisible();
  });
}
