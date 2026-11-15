// What Today says about the first card (src/app/firstCard.ts): one line above Start here while it is the card to play,
// and one small card once it is played, with the offer of a morning reminder. Then it is put away for good.
import { useEffect, useState } from 'preact/hooks';
import { firstCard, dismissFirstCard } from './firstCard';
import { T } from './model';
import { enablePush, pushOn, pushState, refreshPushState } from './push';
import { t } from '../i18n';

/** Above Start here, while the first card is the one it shows and its timer has not run. */
export function FirstCoach({ first }: { first?: string }) {
  const id = firstCard.value, tk = id ? T(id) : undefined;
  if (!tk || tk.status !== 'open' || id !== first || tk.started) return null;
  return <p class="coach" data-testid="first-coach">{t('firstCoach')}</p>;
}

/** Once the first card is played: what happened, what tomorrow is, and a reminder for the morning where this device can have one. */
export function FirstPlayed() {
  const id = firstCard.value, tk = id ? T(id) : undefined;
  const played = tk?.status === 'done';
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (played) refreshPushState(); }, [played]);
  // A first card that was dropped has nothing to say. One the store does not hold is not put away: right after set-up the store has not yet
  // caught up with the database (it follows it a moment later), and putting it away then lost the played card for good; a card that is
  // gone shows nothing anyway.
  useEffect(() => { if (id && tk?.status === 'dropped') dismissFirstCard(); }, [id, tk?.status]);
  if (!played) return null;
  const st = pushState.value;
  const ask = st === 'default' || (st === 'granted' && !pushOn.value);
  const remind = () => { setBusy(true); void enablePush().finally(dismissFirstCard); };
  return (
    <section class="first firstplayed" data-testid="first-played">
      <p class="eyebrow">{t('firstPlayedTitle')}</p>
      <p>{t('firstPlayedBody')}</p>
      {ask && <p><b>{t('firstRemindQ')}</b></p>}
      {st === 'install' && <div data-testid="first-install"><p><b>{t('notifyInstall')}</b></p><p class="hint">{t('notifyInstallBody')}</p></div>}
      <div class="go">
        {ask && <button class="btn primary" type="button" disabled={busy} onClick={remind} data-testid="first-remind">{t('firstRemindYes')}</button>}
        <button class="btn" type="button" disabled={busy} onClick={dismissFirstCard} data-testid="first-done">{ask ? t('obFirstNot') : t('firstDone')}</button>
      </div>
    </section>
  );
}
