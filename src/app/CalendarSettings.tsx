// Settings → Calendar (brief §8): what Add to calendar does, and the subscribable feed.
import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { saveSettings, settings, toast, readOnly } from './store';
import { relayBase } from './sync';
import { feedBusy, feedError, feedId, feedLinks, feedOff, feedOn, regenerateFeed } from './feed';

function Feed() {
  const [ask, setAsk] = useState(false);
  const s = settings.value;
  const base = relayBase();
  const links = feedLinks();
  const on = !!feedId.value;
  const copy = (text: string) => {
    if (!navigator.clipboard) return toast(t('feedCopyBlocked'));
    navigator.clipboard.writeText(text).then(() => toast(t('feedCopied')), () => toast(t('feedCopyBlocked')));
  };
  return (
    <div data-testid="calendar-feed">
      <label class="tog">
        <input type="checkbox" checked={on} disabled={(!base && !on) || feedBusy.value} data-testid="feed-switch"
          onChange={e => { setAsk(false); void ((e.target as HTMLInputElement).checked ? feedOn() : feedOff()); }} /> {t('feedSwitch')}
      </label>
      {!on && <p class="hint">{base ? t('feedIntro') : t('feedNoRelay')}</p>}
      {on && (
        <>
          <p class="hint">{t('feedIntro')}</p>
          {links && (
            <div class="field"><span>{t('feedHttpsLabel')}</span>
              <p class="urlbox mono" data-testid="feed-url">{links.https}</p>
              <div class="actions">
                <a class="btn primary" href={links.webcal} data-testid="feed-webcal">{t('feedOpenLink')}</a>
                <button class="btn" type="button" data-testid="feed-copy" onClick={() => copy(links.https)}>{t('feedCopyLink')}</button>
              </div>
            </div>
          )}
          {feedError.value && <p class="err" role="status" data-testid="feed-error">{feedError.value}</p>}
          <label class="tog">
            <input type="checkbox" checked={s.feedTitles} data-testid="feed-titles" disabled={readOnly.value}
              onChange={e => void saveSettings({ feedTitles: (e.target as HTMLInputElement).checked })} /> {t('feedTitlesSwitch')}
          </label>
          <p class="warnline" data-testid="feed-titles-warn">{t('feedTitlesWarn')}</p>
          <p class="hint">{t('feedRefresh')}</p>
          {ask ? (
            <div role="group">
              <p class="warnline" role="status">{t('feedRegenerateAsk')}</p>
              <div class="actions">
                <button class="btn primary" type="button" data-testid="feed-regenerate-confirm"
                  onClick={async () => { setAsk(false); await regenerateFeed(); toast(t('feedRegenerated')); }}>{t('feedRegenerateConfirm')}</button>
                <button class="btn" type="button" onClick={() => setAsk(false)}>{t('feedRegenerateCancel')}</button>
              </div>
            </div>
          ) : (
            <div class="actions"><button class="btn" type="button" data-testid="feed-regenerate" onClick={() => setAsk(true)}>{t('feedRegenerate')}</button></div>
          )}
        </>
      )}
    </div>
  );
}

export function CalendarSettings() {
  return (
    <section class="set" data-testid="calendar-settings">
      <h2>{t('calendarSection')}</h2>
      <p class="hint">{t('calendarExportHint')}</p>
      <Feed />
    </section>
  );
}
