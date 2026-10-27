// Settings → Calendar (brief §8): what Add to calendar does, and the subscribable feed.
import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { saveSettings, settings, toast, readOnly } from './store';
import { relayBase } from './sync';
import { More, Fold } from './More';
import { FEED_DETAILS, type FeedDetail } from '../domain/calItems';
import { feedBusy, feedError, feedHeld, feedId, feedLinks, feedOff, feedOn, regenerateFeed } from './feed';

const DETAIL_LABEL = { times: 'feedDetailTimes', labels: 'feedDetailLabels', full: 'feedDetailFull' } as const;
const DETAIL_HINT = { times: 'feedDetailTimesHint', labels: 'feedDetailLabelsHint', full: 'feedDetailFullHint' } as const;

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
          {feedHeld.value && <p class="warnline" role="status" data-testid="feed-held">{t('feedHeld')}</p>}
          {s.feedDetail !== 'times' && <p class="warnline" data-testid="feed-titles-warn">{t('feedDetailWarn')}</p>}
          <More n={s.feedDetail !== 'times' ? 1 : 0} testid="feed-more">
          <label class="field"><span>{t('feedDetailLabel')}</span>
            <select value={s.feedDetail} data-testid="feed-detail" disabled={readOnly.value}
              onChange={e => void saveSettings({ feedDetail: (e.target as HTMLSelectElement).value as FeedDetail })}>
              {FEED_DETAILS.map(d => <option value={d}>{t(DETAIL_LABEL[d])}</option>)}
            </select>
          </label>
          <p class="hint" data-testid="feed-detail-hint">{t(DETAIL_HINT[s.feedDetail] ?? 'feedDetailTimesHint')}</p>
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
          </More>
        </>
      )}
    </div>
  );
}

export function CalendarSettings() {
  return (
    <Fold title={t('calendarSection')} testid="calendar-settings">
      <p class="hint">{t('calendarExportHint')}</p>
      <Feed />
    </Fold>
  );
}
