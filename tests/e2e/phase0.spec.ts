import { test, expect, type Page } from '@playwright/test';
import { sampleExport } from './fixture';

async function importSample(page: Page) {
  await page.goto('/#settings');
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sampleExport())) });
  await expect(page.getByTestId('import-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('sheet')).toBeHidden();
  await page.getByTestId('tab-today').click();
  await expect(page.getByTestId('first')).toContainText('Doctolib');
}

async function noSideways(page: Page, where: string) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const sheet = document.querySelector('[data-testid=sheet]') as HTMLElement | null;
    // The page clips sideways overflow, which would hide it from scrollWidth; so also look for
    // any element sticking out past the screen (or the sheet) that isn't inside a scroller.
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if ((o === 'auto' || o === 'scroll') && p !== sheet) return true;
      }
      return false;
    };
    const vw = doc.clientWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll('.app *, [data-testid=sheet] *')) {
      const b = el.getBoundingClientRect();
      if (!b.width || inScroller(el)) continue;
      const right = sheet && sheet.contains(el) ? sheet.getBoundingClientRect().right : vw;
      if (b.right > right + 0.5 || b.left < -0.5) out.push(el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + ' ' + Math.round(b.left) + '→' + Math.round(b.right));
    }
    return { page: [doc.scrollWidth, doc.clientWidth], sheet: sheet ? [sheet.scrollWidth, sheet.clientWidth] : null, out: out.slice(0, 5) };
  });
  expect(r.page[0], where + ': page scrolls sideways').toBeLessThanOrEqual(r.page[1]!);
  if (r.sheet) expect(r.sheet[0], where + ': sheet scrolls sideways').toBeLessThanOrEqual(r.sheet[1]!);
  expect(r.out, where + ': elements past the edge').toEqual([]);
}

test('imports a v1 export, with a summary first', async ({ page }) => {
  await page.goto('/#settings');
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sampleExport())) });
  const summary = page.getByTestId('import-summary');
  await expect(summary).toContainText('Steps');
  await expect(summary).toContainText('11');
  await expect(page.getByTestId('import')).toContainText('Nothing skipped');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByTestId('tab-projects').click();
  await expect(page.locator('main')).toContainText('Housing papers');
  await page.getByTestId('tab-log').click();
  await expect(page.locator('main')).toContainText('Stay one more year');
});

for (const width of [320, 375, 430]) {
  test(`nothing scrolls sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await importSample(page);
    for (const v of ['today', 'matrix', 'projects', 'log', 'settings']) {
      await page.getByTestId('tab-' + v).click();
      await noSideways(page, v);
    }
    await page.getByTestId('tab-today').click();
    const sheets: [string, () => Promise<void>][] = [
      ['task details', () => page.getByTestId('details').first().click()],
      ['how long', () => page.getByTestId('first').getByRole('button', { name: 'Already done' }).click()],
      ['swap', () => page.getByTestId('first').getByRole('button', { name: 'Swap' }).click()],
      ['from your list', () => page.getByRole('button', { name: '+ From your list' }).click()],
      ['leisure', () => page.getByRole('button', { name: '+ Leisure & people' }).click()],
      ['close the day', () => page.locator('main').getByRole('button', { name: 'Close the day' }).click()],
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
    await page.getByTestId('tab-settings').click();
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
  await page.getByTestId('tab-log').click();
  await expect(page.locator('table.sess')).toContainText('Doctolib');
});

test('the wheel and "didn’t time it" also finish the step', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('first').getByRole('button', { name: 'Already done' }).click();
  await page.getByRole('button', { name: 'I didn’t time it' }).click();
  await expect(page.getByTestId('first')).not.toContainText('Doctolib');
});

test('theme and accent colour change and persist', async ({ page }) => {
  await page.goto('/#settings');
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

test('footer shows the not-therapy line and no credit until it is decided', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.foot')).toContainText('doesn’t replace therapy');
  await expect(page.locator('.foot span')).toHaveCount(2);
});

test('French uses French typography', async ({ page }) => {
  await importSample(page);
  await page.getByTestId('tab-settings').click();
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
