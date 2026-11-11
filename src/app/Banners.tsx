// The banners that say something is off or waiting at the app level: a forgotten timer, a newer copy of the data, a stale sync, the lists viewing another place.
// They show above the view on every tab but Home; on Home they are entries of the Notifications page (src/views/Notifications.tsx), so Home stays quiet.
import { clockNow, readOnly, viewingElsewhere, pagePlace, setView, places, here } from './store';
import { running } from './model';
import { isLong, openStillOn, placeName } from './sheets';
import { patchTask } from './actions';
import { reloadNewest } from './reload';
import { lastSyncAt, syncNow, syncStale } from './sync';
import { go } from './nav';
import { regionOf } from '../domain/view';
import { t, locale } from '../i18n';

/** "Still on …?" (brief §5): a forgotten timer is fixed in two taps. */
export const stillRunning = () => { void clockNow.value; const r = running(); return r && isLong(r) ? r : undefined; };
export function StillBanner() {
  const r = stillRunning();
  if (!r) return null;
  return (
    <div class="banner warn" data-testid="still-banner"><p>{t('stillOn', { title: r.title })}</p>
      <div class="go"><button class="btn small" type="button" onClick={() => openStillOn(r.id, 'ask')} data-testid="still-fix">{t('stoppedAt')}</button>
        <button class="btn small ghost" type="button" onClick={() => void patchTask(r.id, { stillAt: new Date().toISOString() })}>{t('stillGoing')}</button></div></div>
  );
}

export function ReadOnlyBanner() {
  if (!readOnly.value) return null;
  return <div class="banner warn" data-testid="readonly-banner"><p>{t('newerData')}</p><button class="btn small" type="button" onClick={() => void reloadNewest()}>{t('reload')}</button></div>;
}

/** This device's copy is old and sync is not bringing it up to date: say what that means here and offer the fixes. */
export const syncIsStale = () => syncStale(clockNow.value);
export function SyncStaleBanner() {
  if (!syncIsStale()) return null;
  const at = lastSyncAt.value;
  const msg = at ? t('syncStale', { when: new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) }) : t('syncStaleNever');
  return (
    <div class="banner warn" role="status" data-testid="sync-stale">
      <p>{msg}</p>
      <div class="actions">
        <button class="btn small" type="button" data-testid="sync-stale-now" onClick={() => void syncNow()}>{t('syncNow')}</button>
        <button class="btn small" type="button" onClick={() => go('settings')}>{t('syncStaleSettings')}</button>
      </div>
    </div>
  );
}

export function ViewingBanner() {
  if (!viewingElsewhere.value) return null;
  return (
    <div class="banner" data-testid="viewing-banner"><p>{t('viewingPage', { place: placeName(pagePlace.value) })}</p>
      <button class="btn small" type="button" onClick={() => setView(null)}>{t('backTo', { place: placeName(regionOf(places.value, here.value)) })}</button></div>
  );
}
