// Notes in the card sheet (request of 29 Oct, never run until 10 Nov): the note sits outside the folded More and is shown in full when the sheet
// opens, wherever it opens (Today's ⋯, a Matrix card, a link to the card).
import { test, expect } from '@playwright/test';
import { importSample, goTab, noSideways, setLanguage, PHONES, LANGS } from './helpers';

const NOTE = Array.from({ length: 9 }, (_, i) => `Line ${i + 1} of a long note, kept whole.`).join('\n');

for (const [w, h] of PHONES) for (const lang of LANGS) {
  test(`the note is outside More and shown in full when the sheet opens, from a link and from the Matrix (${w}×${h}, ${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await importSample(page);
    await setLanguage(page, lang);
    const sheet = page.getByTestId('sheet');
    await page.goto('/#task/t3');
    await sheet.locator('textarea[name=note]').fill(NOTE);
    await sheet.locator('button[type=submit]').click();
    await expect(sheet).toBeHidden();

    const check = async (where: string) => {
      const note = sheet.locator('textarea[name=note]');
      await expect(note, where).toBeVisible();
      await expect(sheet.getByTestId('task-more'), where).not.toHaveAttribute('open', '');
      await expect(note, where).toHaveValue(NOTE);
      // In full: the box is as tall as its text, nothing to scroll inside it.
      await expect.poll(() => note.evaluate(el => el.scrollHeight - el.clientHeight), { message: where }).toBeLessThanOrEqual(2);
      await noSideways(page, where);
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
    };

    await page.goto('/#task/t3');
    await check('link');
    await goTab(page, 'matrix');
    await page.getByTestId('matrix').locator('.t', { hasText: /second paragraph|deuxième|second/ }).first().click();
    await check('matrix');
  });
}
