// The calendar feed says short names by default (request of 21 and 23 Oct, still "times" until 10 Nov); a person who chose "times" keeps it.
import { test, expect } from '@playwright/test';
import { importSample, expandSettings, noSideways, setLanguage, PHONES, LANGS } from './helpers';

for (const [w, h] of PHONES) for (const lang of LANGS) {
  test(`a new install's feed says short names; a chosen "times" stays after a reload (${w}×${h}, ${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await importSample(page);
    await setLanguage(page, lang);
    await page.goto('/#settings'); await expandSettings(page);
    const feed = page.getByTestId('calendar-feed');
    await feed.getByTestId('feed-switch').check();
    await page.getByTestId('feed-more').evaluate(d => { (d as HTMLDetailsElement).open = true; });
    await expect(feed.getByTestId('feed-detail')).toHaveValue('labels');
    await noSideways(page, 'feed settings');
    await feed.getByTestId('feed-detail').selectOption('times');
    await page.reload();
    await page.goto('/#settings'); await expandSettings(page);
    await page.getByTestId('feed-more').evaluate(d => { (d as HTMLDetailsElement).open = true; });
    await expect(page.getByTestId('calendar-feed').getByTestId('feed-detail')).toHaveValue('times');
  });
}
