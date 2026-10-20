// The service worker (vite-plugin-pwa, injectManifest). It precaches the build and serves the app
// shell for every navigation, so the app works offline; a new version waits until the person taps
// Reload in the update banner, which sends SKIP_WAITING (src/app/UpdateBanner.tsx).
/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('message', (e) => {
  if (e.data && (e.data as { type?: unknown }).type === 'SKIP_WAITING') void self.skipWaiting();
});

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
