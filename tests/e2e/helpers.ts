import { expect, type Page } from '@playwright/test';
import './clock';
import { sampleExport } from './fixture';

/**
 * Fix the clock at 09:00 on the app's today (the day starts at 05:00; fixtures are dated from the real date). Evening items (a standing 18:30 or 19:00
 * item, the day's end) take over Start here and empty the plan later in the day, so a test that is not about the hour calls this before it loads the app.
 */
export async function morningClock(page: Page) {
  const x = new Date();
  if (x.getHours() < 5) x.setDate(x.getDate() - 1);
  x.setHours(9, 0, 0, 0);
  await page.clock.setFixedTime(x);
}

/**
 * The same 09:00 as `morningClock`, as a stub of Date and not `page.clock`, for a spec that opens the Calendar: its library loads the Temporal polyfill,
 * which wraps `Intl.DateTimeFormat`, and wrapping the fake clock's version of it breaks `formatToParts` (the app's day maths) in the browser.
 * Kept in localStorage so a reload keeps it; `stubNow` moves it. Call it before the first page load.
 */
export async function stubNow(page: Page, when: Date) {
  await page.addInitScript(() => {
    const Real = Date, key = 'e2e.now';
    const now = () => Number(localStorage.getItem(key)) || Real.now();
    class Fixed extends Real {
      constructor(...a: unknown[]) { if (a.length) super(...(a as [number])); else super(now()); }
      static override now() { return now(); }
    }
    (globalThis as { Date: unknown }).Date = Fixed;
  });
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k!, v!); } catch { /* none */ } }, ['e2e.now', String(when.getTime())] as const);
}
/** With E2E_CLOCK set (see clock.ts) the browser reads the same moment as the tests do; without it, nothing: the real clock. */
export async function followClock(page: Page) {
  if (process.env.E2E_CLOCK) await stubNow(page, new Date());
}
export async function morningDate(page: Page) {
  const x = new Date();
  if (x.getHours() < 5) x.setDate(x.getDate() - 1);
  x.setHours(9, 0, 0, 0);
  await stubNow(page, x);
}

/** The app's day key, `offset` days from today: the day starts at 05:00, so before that it is still yesterday. */
export function appDay(offset = 0): string {
  const x = new Date(Date.now() - 5 * 3_600_000 + offset * 86_400_000);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

/** Settings sections are folded (only the first is open); most tests want them all open. */
export async function expandSettings(page: Page) {
  const root = page.getByTestId('settings');
  await root.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
  await root.locator('details').evaluateAll(ds => ds.forEach(d => { (d as HTMLDetailsElement).open = true; })).catch(() => undefined);
}

/** Open every fold (More, a section) inside the topmost sheet. */
export async function expandSheet(page: Page) {
  await page.getByTestId('sheet').locator('details').evaluateAll(ds => ds.forEach(d => { (d as HTMLDetailsElement).open = true; }));
}

/** Settings, Places, Addresses, Memory and History sit behind the menu icon at the top of Home. */
export async function openMenu(page: Page, item: 'settings' | 'places' | 'memory' | 'history' | 'addresses' | 'add-address' | 'waiting') {
  await page.getByTestId('tab-home').click();
  await page.getByTestId('home-menu').click();
  await page.getByTestId('menu-' + item).click();
  if (item === 'settings') await expandSettings(page);
}

/** Undo the newest exchange from History (Home has no Undo: its line only says what happened and opens the card), and come back to Home. */
export async function undoLast(page: Page) {
  await openMenu(page, 'history');
  await page.getByTestId('history-undo').first().click();
  await page.getByTestId('tab-home').click();
}

/** A tab of the bottom bar, or what lives behind one: the Log is a mode of Calendar, Settings is in Home's menu. */
/** The Notifications page, from the bell on Home: Plan the day, the missed step, Next steps and the banners wait there (Home itself is only the greeting and the input). */
export async function goNotifications(page: Page) {
  await page.getByTestId('tab-home').click();
  await page.getByTestId('home-bell').click();
  await expect(page.getByTestId('notifications')).toBeVisible();
}

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
  await expandSettings(page);
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sampleExport())) });
  await expect(page.getByTestId('import-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('sheet')).toBeHidden();
  await goTab(page, 'today');
  await expect(page.getByTestId('first')).toContainText('Doctolib');
}

/** The ritual's first screens: each step left open yesterday is carried to today, one tap on its own card (nothing moves by itself now), until the shape screen. */
export async function carryAll(page: Page) {
  const card = page.getByTestId('carried-card'), shape = page.getByTestId('ci-shape');
  for (;;) {
    await expect(card.or(shape)).toBeVisible();
    if (await shape.isVisible()) return;
    const title = await card.innerText();
    await page.getByTestId('carried-today').click();
    await expect(card.filter({ hasText: title })).toHaveCount(0);
  }
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

/** The round plus: opens the task sheet for a new step, with the title typed. */
export async function newCardSheet(page: Page, title = '') {
  await page.getByTestId('add-card').click();
  const input = page.getByTestId('sheet').locator('input[name=title]');
  if (title) await input.fill(title);
  return input;
}
/** On Projects, the round plus: a new project with a name and a suit ('S' work, 'D' money, 'C', 'H'). It opens in place, whole. */
export async function addProject(page: Page, name: string, suit: 'S' | 'D' | 'C' | 'H' = 'S') {
  await goTab(page, 'projects');
  await page.getByTestId('add-card').click();
  const sh = page.getByTestId('sheet');
  await sh.locator('input[name=name]').fill(name);
  await sh.locator('select[name=suit]').selectOption(suit);
  await sh.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(sh).toBeHidden();
}

/** Opens every condensed project card in place (tests that read or edit whole cards). */
export async function openAllProjects(page: Page) {
  const o = page.getByTestId('project-open');
  while (await o.count()) await o.first().click();
}

/** A project's condensed card on Projects is tapped open in place; this opens it if it is still condensed, and returns its whole card. */
export async function openProjectCard(page: Page, name: string) {
  const mini = page.locator('article.proj.mini', { hasText: name });
  if (await mini.count()) await mini.getByTestId('project-open').click();
  const card = page.locator('article.proj:not(.mini)', { hasText: name });
  await expect(card).toBeVisible();
  return card;
}

/** The round plus, the title, Save. */
export async function addCard(page: Page, title: string) {
  await newCardSheet(page, title);
  await page.getByTestId('sheet').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('sheet')).toBeHidden();
}

/**
 * The Paste the reply sheet is reached from Plan this trip (and from set-up), no longer from a button on Today. This restores one place and
 * one upcoming stay on top of what the app holds (a backup merges), then opens the trip sheet from Settings. Tests tap `pack-paste` in it.
 */
export async function openTripSheet(page: Page) {
  const HLC = '0000000000001:0000:seed';
  const stamp = (id: string, f: Record<string, unknown>) => ({ id, _v: 4, _hlc: Object.fromEntries(Object.keys(f).map(k => [k, HLC])), ...f });
  const data: Record<string, [string, Record<string, unknown>][]> = {
    places: [['tripa', { name: 'Lyon', timeZone: 'Europe/Paris', order: 8 }], ['tripb', { name: 'Paris', timeZone: 'Europe/Paris', order: 9 }]],
    stays: [['trips', { placeId: 'tripa', from: appDay(1), to: appDay(3), note: 'A long weekend' }]],
  };
  const file = { format: 'reussite-backup', schema: 4, exported: new Date().toISOString(), data: Object.fromEntries(Object.entries(data).map(([c, ds]) => [c, ds.map(([id, f]) => stamp(id, f))])) };
  await page.goto('/#settings'); await expandSettings(page);
  page.once('dialog', d => void d.accept());
  await page.getByTestId('data').locator('input[type=file]').first().setInputFiles({ name: 'trip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.locator('.toast')).toContainText('Backup restored');
  await page.reload();
  await expandSettings(page);
  await page.getByTestId('stays').getByTestId('plan-trip').click();
  await expect(page.getByTestId('sheet').getByTestId('trip-sheet')).toBeVisible();
}

/** Switch the app's language from Settings (the choice is kept, so later pages are in it). */
export async function setLanguage(page: Page, lang: 'en' | 'fr') {
  await goTab(page, 'settings');
  await page.getByRole('button', { name: lang === 'fr' ? 'Français' : 'English', exact: true }).click();
}
/** The two phone sizes every layout fix is measured at, with the two languages (invariant 10). */
export const PHONES: [number, number][] = [[320, 568], [390, 844]];
export const LANGS = ['en', 'fr'] as const;
