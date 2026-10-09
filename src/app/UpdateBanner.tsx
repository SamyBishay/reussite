// A new version is ready: say so, with a Reload button. Never reloads by itself, and the
// button waits while a timer runs (brief §11).
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { running } from './model';
import { t } from '../i18n';

export function UpdateBanner() {
  const { needRefresh: [need, setNeed], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Look for a new version when the app comes back to the foreground.
      if (reg) document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update(); });
    },
  });
  if (!need) return null;
  const timing = !!running();
  return (
    <div class="banner" role="status">
      <p>{t('updateReady')}{timing ? ' ' + t('updateAfterTimer') : ''}</p>
      <div class="go">
        <button class="btn small primary" type="button" disabled={timing} onClick={() => updateServiceWorker(true)}>{t('reload')}</button>
        <button class="btn small ghost" type="button" onClick={() => setNeed(false)}>{t('later_')}</button>
      </div>
    </div>
  );
}
