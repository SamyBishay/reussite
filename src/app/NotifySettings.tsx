// Settings → Notifications (brief §8): the master switch for this device, what to notify about,
// generic or titled text, the lead time, and a test button. The permission prompt comes from
// the tap on the switch, never on load; on iPhone, outside the Home Screen app, it explains the
// install first.
import { useState } from 'preact/hooks';
import { saveSettings, settings, toast } from './store';
import { disablePush, enablePush, pushBusy, pushError, pushHeld, pushLastAt, pushOn, pushState, sendTest } from './push';
import { More, Fold, countSet } from './More';
import { NOTIFY_TYPES, DEFAULT_SETTINGS, type NotifyText, type NotifyType } from '../data/settings';
import { t, locale, type Key } from '../i18n';

const TYPE_LABEL: Record<NotifyType, Key> = {
  fixed: 'notifyTypeFixed', checkin: 'notifyTypeCheckin', close: 'notifyTypeClose',
  decision: 'notifyTypeDecision', review: 'notifyTypeReview',
};

const failure = (code: string) => (code === 'network' ? t('syncNetwork') : t('notifyFailed', { code }));

/**
 * The permission part: what this browser can do (install first on iPhone, unsupported, no relay, refused), the switch
 * and the last error. The prompt comes from the tap on the switch, never on load. Settings and onboarding both use it.
 */
export function NotifySwitch() {
  // What the switch shows while switching on or off is in progress (permission prompt, subscribing).
  const [pending, setPending] = useState<boolean | null>(null);
  const st = pushState.value;
  if (st === 'hidden') return null;
  const on = pushOn.value && st === 'granted';
  const ready = st === 'default' || st === 'granted';
  const flip = (e: Event) => {
    const want = (e.target as HTMLInputElement).checked;
    // Straight from the tap: the browser asks for permission only for a user gesture.
    setPending(want);
    void (want ? enablePush() : disablePush()).finally(() => setPending(null));
  };
  const err = pushError.value;
  return (
    <>
      {st === 'install' && <div data-testid="notify-install"><p><b>{t('notifyInstall')}</b></p><p>{t('notifyInstallBody')}</p></div>}
      {st === 'unsupported' && <p data-testid="notify-unsupported">{t('notifyUnsupported')}</p>}
      {st === 'norelay' && <p data-testid="notify-norelay">{t('notifyNoRelay')}</p>}
      {st === 'denied' && <p class="err" data-testid="notify-denied">{t('notifyDenied')}</p>}
      {ready && (
        <div class="toggles" style="margin-top:var(--s4)">
          <label class="tog"><input type="checkbox" checked={pending ?? on} disabled={pending !== null || pushBusy.value} onChange={flip} data-testid="notify-master" /> {t('notifyMaster')}</label>
        </div>
      )}
      {err && ready && <p class="err" role="alert" data-testid="notify-error">{failure(err)}</p>}
    </>
  );
}

export function NotifySettings() {
  const [testing, setTesting] = useState(false);
  const st = pushState.value;
  if (st === 'hidden') return null;
  const s = settings.value;
  const on = pushOn.value && st === 'granted';

  const setType = (k: NotifyType, v: boolean) => void saveSettings({ notify: { ...s.notify, [k]: v } });
  const test = async () => {
    setTesting(true);
    const r = await sendTest();
    setTesting(false);
    toast(r === 'sent' ? t('notifyTestSent') : t('notifyTestFailed', { code: pushError.value ?? 'error' }));
  };
  const when = pushLastAt.value ? new Date(pushLastAt.value).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '';
  return (
    <Fold title={t('notifySection')} testid="notify">
      <p class="hint">{t('notifyIntro')}</p>
      <NotifySwitch />
      {on && (
        <>
          <p class="hint" data-testid="notify-held">{t('notifyHeld', { n: pushHeld.value })}{when ? ' ' + t('notifyLastUpload', { when }) : ''}</p>
          <p class="field-label">{t('notifyTypes')}</p>
          <div class="toggles" role="group" aria-label={t('notifyTypes')} data-testid="notify-types">
            {NOTIFY_TYPES.map(k => (
              <label class="tog"><input type="checkbox" checked={s.notify[k]} onChange={e => setType(k, (e.target as HTMLInputElement).checked)} data-testid={'notify-' + k} /> {t(TYPE_LABEL[k])}</label>
            ))}
          </div>
          <More n={countSet(s.notifyText !== DEFAULT_SETTINGS.notifyText, s.notifyLead !== DEFAULT_SETTINGS.notifyLead)} testid="notify-more">
          <p class="field-label">{t('notifyTextLabel')}</p>
          <div class="seg" role="group" aria-label={t('notifyTextLabel')} style="flex-wrap:wrap">
            {(['generic', 'titles'] as NotifyText[]).map(v => (
              <button type="button" style="min-height:44px" aria-pressed={s.notifyText === v} data-testid={'notify-text-' + v} onClick={() => void saveSettings({ notifyText: v })}>{t(v === 'generic' ? 'notifyTextGeneric' : 'notifyTextTitles')}</button>
            ))}
          </div>
          <p class="hint">{t('notifyTextHint')}</p>
          <label class="field"><span>{t('notifyLeadLabel')}</span>
            <input type="number" inputmode="numeric" min="0" max="240" step="5" value={s.notifyLead} data-testid="notify-lead"
              onChange={e => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v) && v >= 0 && v <= 240) void saveSettings({ notifyLead: Math.round(v) }); }} />
          </label>
          <div class="actions">
            <button class="btn" type="button" disabled={testing || pushBusy.value} onClick={test} data-testid="notify-test">{t('notifySendTest')}</button>
          </div>
          </More>
        </>
      )}
    </Fold>
  );
}
