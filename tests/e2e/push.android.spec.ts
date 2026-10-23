import { expandSettings } from './helpers';
// The service worker's side of a push, in Chrome on Android emulation: the DevTools protocol can
// deliver a push message to a worker without any push service, so this checks that the worker
// shows a notification, always, even for a payload it cannot read. (A tap can't be sent over the protocol; the
// click handler is checked by hand on a phone.)
import { test, expect } from '@playwright/test';

// The headless shell never grants the notification permission; the full Chromium in headless mode does.
test.use({ channel: 'chromium' });
test.skip(({ browserName }) => browserName !== 'chromium', 'uses the Chrome DevTools protocol (ServiceWorker.deliverPushMessage)');

test('a delivered push always shows a notification, tagged by item id', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  await page.goto('/#settings'); await expandSettings(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const origin = new URL(page.url()).origin;
  const cdp = await context.newCDPSession(page);
  const registration = new Promise<string>(resolve => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e: { registrations: { registrationId: string; scopeURL: string }[] }) => {
      const r = e.registrations.find(x => x.scopeURL.startsWith(origin));
      if (r) resolve(r.registrationId);
    });
  });
  await cdp.send('ServiceWorker.enable');
  const registrationId = await registration;
  const deliver = (data: string) => cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data });
  const shown = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ title: n.title, body: n.body, tag: n.tag, url: (n.data as { url?: string } | null)?.url ?? null })));

  await deliver(JSON.stringify({ title: 'Réussite', body: 'Leave now · 18:30', tag: 'fixed:t1:2026-10-19', url: './#today' }));
  await expect.poll(shown).toEqual([{ title: 'Réussite', body: 'Leave now · 18:30', tag: 'fixed:t1:2026-10-19', url: origin + '/#today' }]);

  // The same tag replaces the notification instead of piling up
  await deliver(JSON.stringify({ title: 'Réussite', body: 'Leave now · 18:35', tag: 'fixed:t1:2026-10-19', url: './#today' }));
  await expect.poll(async () => (await shown()).map(n => n.body)).toEqual(['Leave now · 18:35']);

  // Something it can't read still shows the app's name (iOS withdraws permission from a worker that shows nothing)
  await deliver('not json at all');
  await expect.poll(async () => (await shown()).length).toBe(2);
  expect((await shown()).find(n => n.tag === '')).toMatchObject({ title: 'Réussite', body: 'not json at all' });
});
