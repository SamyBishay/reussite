// A new version is ready: say so, with a Reload button. Never reloads by itself, and the
// button waits while a timer runs (brief §11). `UpdateHost` (mounted once in App) holds the worker's state in signals; the banner
// shows on every tab but Home, whose entry is on the Notifications page.
import { signal } from '@preact/signals';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { running } from './model';
import { t } from '../i18n';

export const updateReady = signal(false);
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
