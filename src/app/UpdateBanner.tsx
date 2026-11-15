// A new version is ready: say so, with a Reload button. Never reloads by itself, and the
// button waits while a timer runs (brief §11). `UpdateHost` (mounted once in App) holds the worker's state in signals; the banner
// shows on every screen but the Notifications page, where it is an entry (on Home too, above the greeting: 2026-11-11).
import { computed, signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { registerSW } from 'virtual:pwa-register';
import { running } from './model';
import { t } from '../i18n';

const need = signal(false);
const asked = signal(false);
export const updateReady = computed(() => need.value || asked.value);
// Playwright cannot make Firefox fetch a changed worker script, so tests/e2e/homeupdate.spec.ts asks for the box with this event. It only shows the box.
if (typeof window !== 'undefined') window.addEventListener('reussite:update-ready', () => { asked.value = true; });
let apply: () => void = () => undefined;
const hide = () => { need.value = false; };

/**
 * The worker is registered once per page, however often this mounts. App renders it only outside first-run set-up, so on a new device it mounted,
 * went with set-up and came back: each mount registered the worker again, and a second registration that finds the first install still going
 * takes it for someone else's worker (workbox-window's `isExternal`) and says a new version is ready (seen 1 run in 24 of firstcard.spec.ts, 15 Nov).
 */
let registered = false;
export function registerOnce(): void {
  if (registered) return;
  registered = true;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() { need.value = true; },
    onRegisteredSW(_url, reg) {
      // Look for a new version when the app comes back to the foreground.
      if (reg) document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update(); });
    },
  });
  apply = () => void update(true);
}

export function UpdateHost() {
  useEffect(registerOnce, []);
  return null;
}

export function UpdateBanner() {
  if (!updateReady.value) return null;
  const timing = !!running();
  return (
    <div class="banner" role="status" data-testid="update-banner">
      <p>{t('updateReady')}{timing ? ' ' + t('updateAfterTimer') : ''}</p>
      <div class="go">
        <button class="btn small primary" type="button" disabled={timing} onClick={() => apply()}>{t('reload')}</button>
        <button class="btn small ghost" type="button" onClick={() => hide()}>{t('later_')}</button>
      </div>
    </div>
  );
}
