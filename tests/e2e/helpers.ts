import { expect, type Page } from '@playwright/test';
import { sampleExport } from './fixture';

/** Settings, Places, Addresses, Memory and History sit behind the menu icon at the top of Home. */
export async function openMenu(page: Page, item: 'settings' | 'places' | 'memory' | 'history' | 'addresses' | 'add-address') {
  await page.getByTestId('tab-home').click();
  await page.getByTestId('home-menu').click();
  await page.getByTestId('menu-' + item).click();
}

/** A tab of the bottom bar, or what lives behind one: the Log is a mode of Calendar, Settings is in Home's menu. */
export async function goTab(page: Page, tab: 'home' | 'today' | 'matrix' | 'projects' | 'calendar' | 'log' | 'settings') {
  if (tab === 'settings') return openMenu(page, 'settings');
  if (tab === 'log') {
    await page.getByTestId('tab-calendar').click();
    return page.getByTestId('cal-log').click();
  }
  await page.getByTestId('tab-' + tab).click();
}

/** The weekly review is started from Settings (Method) on any day; Today and the bell offer it on its day. */
export async function openWeeklyReview(page: Page) {
  await goTab(page, 'settings');
  await page.getByTestId('start-review-now').click();
}

export async function importSample(page: Page) {
  await page.goto('/#settings');
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sampleExport())) });
  await expect(page.getByTestId('import-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('sheet')).toBeHidden();
  await goTab(page, 'today');
  await expect(page.getByTestId('first')).toContainText('Doctolib');
}

export async function noSideways(page: Page, where: string) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    // The topmost sheet: the AI request preview sits above any other.
    const sheet = (document.querySelector('[data-testid=ai-preview]') ?? document.querySelector('[data-testid=sheet]')) as HTMLElement | null;
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
    for (const el of document.querySelectorAll('.app *, [data-testid=sheet] *, [data-testid=ai-preview] *')) {
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


/** A calendar event (the library's own element) by its words, in the Calendar tab's grid. */
export const calEvent = (page: Page, text: string | RegExp) => page.getByTestId('calendar-grid').locator('.sx__event', { hasText: text });
