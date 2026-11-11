// Home with the on-screen keyboard open (2026-11-11). On the owner's iPhone the keyboard and its accessory bar hid the input, the mark was dropped and the greeting ran into the date.
// An emulated engine has no keyboard, so this puts the page in the state the app sets while one is open (`body.kb`) and measures what the page controls: the input, the mark and
// the greeting are all in the upper part of the screen that a keyboard (and its accessory bar, together about half of a phone) never covers, in order, and the page does not scroll.
// Where the real keyboard puts things can only be seen on the phone (invariant 11: unverified on device).
import { test, expect } from '@playwright/test';
import { goTab, importSample, morningClock, noSideways, setLanguage, PHONES, LANGS } from './helpers';

for (const [w, h] of PHONES) for (const lang of LANGS) for (const withList of [false, true]) {
  test(`Home with the keyboard open shows the logo, the greeting and the input above it (${w}×${h}, ${lang}${withList ? ', with a list and its cards' : ''})`, async ({ page, isMobile }) => {
    await page.setViewportSize({ width: w, height: h });
    if (withList) { await morningClock(page); await importSample(page); } else await page.goto('/');
    await setLanguage(page, lang);
    await goTab(page, 'home');
    await expect(page.getByTestId('greeting')).toBeVisible();
    // On a phone engine the app's own handler sets the state when the field takes the focus; elsewhere the state is set by hand.
    if (isMobile) { await page.getByTestId('home-input').focus(); await expect(page.locator('body.kb')).toHaveCount(1); } else await page.evaluate(() => document.body.classList.add('kb'));
    const r = await page.evaluate(() => {
      const q = (s: string) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height, w: b.width }; };
      return { bar: q('.homebar'), mark: q('.hello .mark'), line: q('.hello .greetline') ?? q('.hello > :last-child'), input: q('[data-testid=home-input]'), ih: innerHeight, sy: scrollY, tab: getComputedStyle(document.querySelector('.tabbar')!).display };
    });
    expect(r.mark, 'the logo is shown').not.toBeNull();
    expect(r.mark!.h, 'the logo has a size').toBeGreaterThan(30);
    expect(r.line!.top, 'the greeting is below the bar (no overlap with the date)').toBeGreaterThanOrEqual(r.bar!.bottom - 1);
    expect(r.line!.top, 'the greeting is below the logo').toBeGreaterThanOrEqual(r.mark!.bottom - 1);
    expect(r.input!.top, 'the input is below the greeting').toBeGreaterThanOrEqual(r.line!.bottom - 1);
    expect(r.input!.bottom, 'the input is in the half of the screen the keyboard never covers').toBeLessThanOrEqual(r.ih * 0.5);
    expect(r.sy).toBe(0);
    expect(r.tab).toBe('none');
    await noSideways(page, 'home with the keyboard open');
    // And back: the input returns to the bottom.
    if (isMobile) { await page.getByTestId('home-input').blur(); await expect(page.locator('body.kb')).toHaveCount(0); } else await page.evaluate(() => document.body.classList.remove('kb'));
    const back = await page.evaluate(() => { const b = document.querySelector('[data-testid=home-input-bar]')!.getBoundingClientRect(); return { bottom: b.bottom, ih: innerHeight, pos: getComputedStyle(document.querySelector('[data-testid=home-input-bar]')!).position }; });
    expect(back.pos).toBe('fixed');
    expect(back.bottom).toBeLessThanOrEqual(back.ih);
  });
}

// A page that never scrolls is put back at the top if iOS scrolls it (touch engines only: the handler is for phones).
test('a locked page that gets scrolled goes back to the top', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the keyboard handler runs on touch devices');
  await page.goto('/#home');
  await expect(page.getByTestId('greeting')).toBeVisible();
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'tall'; d.style.cssText = 'height:3000px;width:1px;position:absolute;top:0;left:0'; document.body.appendChild(d); window.scrollTo(0, 400); });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
