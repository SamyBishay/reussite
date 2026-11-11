// A new version is ready: say so, with a Reload button. Never reloads by itself, and the
// button waits while a timer runs (brief §11). `UpdateHost` (mounted once in App) holds the worker's state in signals; the banner
// shows on every screen but the Notifications page, where it is an entry (on Home too, above the greeting: 2026-11-11).
import { signal } from '@preact/signals';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { running } from './model';
import { t } from '../i18n';

export const updateReady = signal(false);
// Playwright cannot make Firefox fetch a changed worker script, so tests/e2e/homeupdate.spec.ts asks for the box with this event. It only shows the box.
if (typeof window !== 'undefined') window.addEventListener('reussite:update-ready', () => { updateReady.value = true; });
let apply: () => void = () => undefined;
let hide: () => void = () => undefined;

export function UpdateHost() {
  const { needRefresh: [need, setNeed], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Look for a new version when the app comes back to the foreground.
      if (reg) document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update(); });
    },
  });
  updateReady.value = !!need;
  apply = () => updateServiceWorker(true);
  hide = () => setNeed(false);
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
