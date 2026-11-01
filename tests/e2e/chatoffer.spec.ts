import { test, expect, type Page } from '@playwright/test';
import { expandSettings, goTab, noSideways } from './helpers';

// "Plan it in your AI chat" (S9 follow-up): with no AI key on the device but the connector on, Plan the day and the Sunday review banner also
// offer to do it in the person's AI chat app, with a sentence to copy. No vendor is named or linked. No AI call is made from the app. The relay on :8787 (playwright.config.ts) has the connector's throwaway wrap key.

/** A Sunday, 10:00: the default review day. */
const SUNDAY = (() => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); d.setHours(10, 0, 0, 0); return d; })();

async function connectorOn(page: Page) {
  await page.goto('/#settings'); await expandSettings(page);
  await page.getByTestId('sync-setup').click();
  await page.getByTestId('sync-make-key').click();
  await expect(page.locator('svg.qr')).toBeVisible();
  await page.getByTestId('sync-key-saved').click();
  await page.getByTestId('connector-on').click();
  await page.getByTestId('connector-on-confirm').click();
  await expect(page.getByTestId('connector-state')).toContainText('The connector is on');
}

test('connector on, no key: Plan the day and the review banner offer the chat, and it survives a restart', async ({ page }) => {
  test.slow();
  await page.clock.setFixedTime(SUNDAY);
  // The app makes no AI call of its own.
  const calls: string[] = [];
  page.on('request', r => { if (/openrouter|anthropic/.test(r.url())) calls.push(r.url()); });
  await page.goto('/');
  await goTab(page, 'home');
  await expect(page.getByTestId('home-plan')).toBeVisible();
  await expect(page.getByTestId('home-plan-chat')).toHaveCount(0); // the connector is off: only the ritual
  await connectorOn(page);

  await goTab(page, 'home');
  await expect(page.getByTestId('home-plan')).toBeVisible();
  const offer = page.getByTestId('home-plan-chat');
  await expect(offer).toBeVisible();
  await expect(offer).toHaveText('Plan it in your AI chat');
  // No app is named or linked: a button that copies the sentence to say in the person's own chat.
  await expect(page.locator('a[href*="claude"], a[href*="chatgpt"], a[href*="openai"]')).toHaveCount(0);
  await offer.click();
  await expect(page.locator('.toast')).toContainText('say “Plan my day with Réussite”');
  await noSideways(page, 'home with the offer');
  // The ritual is still what Plan the day opens.
  await page.getByTestId('home-plan').click();
  await expect(page.getByTestId('ci-shape')).toBeVisible();
  await page.getByTestId('sheet').getByRole('button', { name: 'Close' }).click();

  await goTab(page, 'today');
  // Today has no Plan-in-your-AI-chat button (2026-11-01): Home's card is where it is offered. The review banner keeps its own.
  await expect(page.getByTestId('today-plan-chat')).toHaveCount(0);
  await expect(page.getByTestId('today-adder-chat')).toHaveCount(0);
  const review = page.getByTestId('review-chat');
  await expect(review).toHaveText('Review in your AI chat');
  await review.click();
  await expect(page.locator('.toast')).toContainText('say “Do my weekly review with Réussite”');
  await noSideways(page, 'today with the offers');

  // A restart: the relay is not asked first, the app remembers.
  await page.reload();
  await goTab(page, 'home');
  await expect(page.getByTestId('home-plan-chat')).toBeVisible();
  expect(calls).toEqual([]);
});

test('with a key on the device, or with the connector off, the offer is not shown', async ({ page }) => {
  test.slow();
  await page.clock.setFixedTime(SUNDAY);
  await connectorOn(page);
  await page.getByTestId('ai-openai').click();
  await page.getByTestId('ai-key').fill('sk-or-test');
  await page.getByTestId('ai-key-save').click();
  await expect(page.getByTestId('ai-settings')).toContainText('A key is saved.');
  await goTab(page, 'home');
  await expect(page.getByTestId('home-plan')).toBeVisible();
  await expect(page.getByTestId('home-plan-chat')).toHaveCount(0);
  await goTab(page, 'today');
  await expect(page.getByTestId('review-card')).toBeVisible();
  await expect(page.getByTestId('review-chat')).toHaveCount(0);
});

test('in French the offer and its sentence are French, and fit at 320px', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 320, height: 700 });
  await page.clock.setFixedTime(SUNDAY);
  await connectorOn(page);
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.getByTestId('settings')).toContainText('Réglages');
  await goTab(page, 'home');
  const offer = page.getByTestId('home-plan-chat');
  await expect(offer).toHaveText('La planifier dans votre chat IA');
  await offer.click();
  await expect(page.locator('.toast')).toContainText('dites « Planifie ma journée avec Réussite »');
  await noSideways(page, 'home with the offer, 320px');
  await goTab(page, 'today');
  await expect(page.getByTestId('review-chat')).toHaveText('La faire dans votre chat IA');
  await noSideways(page, 'today with the offers, 320px');
});
