// The service worker (vite-plugin-pwa, injectManifest). It precaches the build and serves the app
// shell for every navigation, so the app works offline; a new version waits until the person taps
// Reload in the update banner, which sends SKIP_WAITING (src/app/UpdateBanner.tsx).
/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { OPEN_URL, pushToNotification } from './push/notification';

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('message', (e) => {
  if (e.data && (e.data as { type?: unknown }).type === 'SKIP_WAITING') void self.skipWaiting();
});

// A push: the browser has already decrypted the payload (the app encrypted it for this
// subscription, src/push/encrypt.ts). Always show a notification, whatever arrives: iOS withdraws
// the permission from a worker that receives a push and shows nothing.
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let raw: unknown = null;
    try { raw = e.data ? await e.data.json() : null; } catch { try { raw = e.data?.text() ?? null; } catch { raw = null; } }
    const n = pushToNotification(raw, self.registration.scope);
    await self.registration.showNotification(n.title, n.options);
  })());
});

// A tap: bring the open app forward, or open it on Today.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data as { url?: string } | null)?.url ?? new URL(OPEN_URL, self.registration.scope).href;
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = open.find((c) => c.url.startsWith(self.registration.scope));
    if (mine) {
      try { await mine.focus(); } catch { /* the browser may refuse; the page is still there */ }
      // The morning's notification asks the open window to plan the day; every other tap only brings it forward.
      if (new URL(url).hash === '#plan') mine.postMessage({ type: 'OPEN_URL', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});

// The manual's screenshots (public/manual/shots) stay out of the precache: one is kept the first time it is shown, and served from
// there afterwards (and refreshed in the background), so a page read once has its pictures offline.
const SHOTS = 'manual-shots';
registerRoute(
  ({ url, request }) => request.destination === 'image' && url.origin === self.location.origin && url.pathname.startsWith(new URL('manual/shots/', self.registration.scope).pathname),
  async ({ request }) => {
    const cache = await caches.open(SHOTS);
    const hit = await cache.match(request);
    const fresh = fetch(request).then((r) => { if (r.ok) void cache.put(request, r.clone()); return r; });
    if (hit) { void fresh.catch(() => undefined); return hit; }
    return fresh;
  },
);

// The Dove's cut-outs (src/assets/dove, WebP, not in the precache's patterns): fetched the first time St George plays
// or the onboarding mark shows, then always served from here (their names carry a hash, so a hit is never stale). A
// new version of a picture replaces the old one.
const DOVE = 'dove';
const doveName = (p: string) => p.replace(/-[\w-]{8}\.webp$/, ''); // Vite's hash: 8 characters
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith(new URL('assets/', self.registration.scope).pathname) && url.pathname.endsWith('.webp'),
  async ({ request, url }) => {
    const cache = await caches.open(DOVE);
    const hit = await cache.match(request);
    if (hit) return hit;
    const r = await fetch(request);
    if (r.ok) {
      for (const old of await cache.keys()) {
        const p = new URL(old.url).pathname;
        if (p !== url.pathname && doveName(p) === doveName(url.pathname)) void cache.delete(old);
      }
      void cache.put(request, r.clone());
    }
    return r;
  },
);

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// /manual/… are the public manual's own pages (src/manual/site.ts), not the app: they go to the network.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/manual(\/|$)/] }));
