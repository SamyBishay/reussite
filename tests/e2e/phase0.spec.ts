import { test, expect } from '@playwright/test';
import { sampleExport } from './fixture';
import { importSample, noSideways, goTab, openMenu, expandSettings } from './helpers';

test('imports a v1 export, with a summary first', async ({ page }) => {
  await page.goto('/#settings'); await expandSettings(page);
  await expandSettings(page);
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sampleExport())) });
  const summary = page.getByTestId('import-summary');
  await expect(summary).toContainText('Steps');
  await expect(summary).toContainText('11');
  await expect(page.getByTestId('import')).toContainText('Nothing skipped');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByTestId('tab-projects').click();
  await expect(page.locator('main')).toContainText('Housing papers');
  await expect(page.locator('main')).toContainText('Stay in the flat or move?');
  await goTab(page, 'log');
  await expect(page.locator('main')).toContainText('Timed sessions');
});

for (const width of [320, 375, 430]) {
  test(`nothing scrolls sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await importSample(page);
    for (const v of ['home', 'today', 'matrix', 'projects', 'calendar', 'log', 'settings'] as const) {
      await goTab(page, v);
      await noSideways(page, v);
    }
    for (const v of ['memory', 'history'] as const) {
      await openMenu(page, v);
      await noSideways(page, v);
    }
    await goTab(page, 'today');
    const sheets: [string, () => Promise<void>][] = [
      ['task details', () => page.getByTestId('details').first().click()],
      ['how long', () => page.getByTestId('first').getByRole('button', { name: 'Already done' }).click()],
      ['swap', () => page.getByTestId('first').getByRole('button', { name: 'Swap' }).click()],
      ['from your list', () => page.getByRole('button', { name: '+ From your list' }).click()],
      ['leisure', () => page.getByRole('button', { name: '+ Leisure & people' }).click()],
      ['place', () => page.locator('.here').click()],
    ];
    for (const [name, open] of sheets) {
      await open();
      await expect(page.getByTestId('sheet')).toBeVisible();
      await noSideways(page, name);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('sheet')).toBeHidden();
    }
    await page.getByTestId('first').getByRole('button', { name: 'Just start the timer' }).click();
    await page.getByTestId('first').getByRole('button', { name: 'Pause' }).click();
    await noSideways(page, 'pause');
    await page.keyboard.press('Escape');
    await goTab(page, 'settings');
    await expandSettings(page);
    await page.getByTestId('open-import').click();
    await noSideways(page, 'import');
  });
}

test('marking an untimed step done asks how long it took', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('first').getByRole('button', { name: 'Already done' }).click();
  await expect(page.getByTestId('sheet')).toContainText('How long did it take?');
  // Estimate 10 min: ¼× 2.5 → 5, ½× → 5, 1× 10, 1½× 15, 2× 20
  await expect(page.getByTestId('dur')).toHaveText(['5 min', '10 min', '15 min', '20 min']);
  await page.getByTestId('dur').nth(1).click();
  await expect(page.getByTestId('first')).not.toContainText('Doctolib');
  await goTab(page, 'log');
  await expect(page.locator('main')).toContainText('Doctolib');
});

test('the wheel and "didn’t time it" also finish the step', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('first').getByRole('button', { name: 'Already done' }).click();
  await page.getByRole('button', { name: 'I didn’t time it' }).click();
  await expect(page.getByTestId('first')).not.toContainText('Doctolib');
});

test('theme and accent colour change and persist', async ({ page }) => {
  await page.goto('/#settings'); await expandSettings(page);
  await page.getByTestId('appearance').getByRole('button', { name: 'Dark', exact: true }).click();
  await page.getByTestId('appearance').locator('input[type=color]').first().evaluate((el: HTMLInputElement) => {
    el.value = '#225588';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const accent = await page.evaluate(() => document.getElementById('theme-vars')?.textContent ?? '');
  expect(accent).toContain('--accent:#225588');
});

test('a step’s link opens the website outside Réussite', async ({ page }) => {
  await importSample(page);
  const go = page.getByTestId('first').getByTestId('go');
  await expect(go).toHaveAttribute('href', 'https://www.doctolib.fr/');
  await expect(go).toHaveAttribute('target', '_blank');
});

test('footer shows the credit line and the not-therapy line', async ({ page }) => {
  await page.goto('/#today');
  await expect(page.locator('.foot')).toContainText('doesn’t replace therapy');
  await expect(page.locator('.foot')).toContainText('Special thanks to Nelly Darmon, psychologist.');
});

test('French uses French typography', async ({ page }) => {
  await importSample(page);
  await goTab(page, 'settings');
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.getByTestId('tab-today')).toContainText('Aujourd’hui');
  await page.getByTestId('tab-today').click();
  await expect(page.locator('main')).toContainText('Reprendre : write the second paragraph');
});

test('works offline once loaded', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright’s WebKit does not run service workers offline; checked by hand on iPhone');
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('tab-today')).toBeVisible();
  await context.setOffline(false);
});

test('the sideways check itself catches overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('tab-today')).toBeVisible();
  await page.evaluate(() => { const d = document.createElement('div'); d.style.width = '600px'; d.textContent = 'wide'; document.querySelector('main')!.appendChild(d); });
  await expect(noSideways(page, 'planted')).rejects.toThrow(/past the edge|scrolls sideways/);
});
