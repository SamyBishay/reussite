// Notifications: everything that is waiting, one row each with its button. Home shows only a bell with a dot
// when this list is not empty (no number, no red).
import { Rings } from '../app/Rings';
import { today, settings } from '../app/store';
import { dayDoc, decisionsToCheck, yesterdayOpen } from '../app/model';
import { carryOver } from '../app/actions';
import { KeyCard } from '../app/SyncSettings';
import { syncOn, keySaved } from '../app/sync';
import { openReview } from '../flows/review';
import { openDecisionPage } from '../flows/decision';
import { isoDow } from '../domain/repeat';
import { t } from '../i18n';
import type { ComponentChild } from 'preact';

/** What is waiting, most pressing first: the recovery key, decisions to check, yesterday's carry-over, the review day. */
export function notifications(): ComponentChild[] {
  const k = today.value, out: ComponentChild[] = [];
  if (syncOn.value && !keySaved.value) out.push(<KeyCard />);
  for (const dc of decisionsToCheck(k)) out.push(<div class="banner" data-testid="decision-check"><p>{t('checkDecision', { title: dc.title })}</p><button class="btn small" type="button" onClick={() => openDecisionPage(dc.id, true)}>{t('checkNow')}</button></div>);
  const y = yesterdayOpen(k);
  if (y.length) out.push(<div class="banner" data-testid="carry-nudge"><p>{t('carryText', { n: y.length })}</p><button class="btn small" type="button" onClick={carryOver}>{t('carryButton', { n: y.length })}</button></div>);
  if (isoDow(k) === settings.value.reviewDay && !dayDoc(k)?.review) out.push(<div class="banner" data-testid="review-card"><p>{t('reviewToday')}</p><button class="btn small" type="button" onClick={openReview}>{t('startReview')}</button></div>);
  return out;
}

export function Notifications() {
  const list = notifications();
  return (
    <div data-testid="notifications">
      <h2 class="sec" style="margin-top:0">{t('notifTitle')}</h2>
      {list.length ? list : <div class="empty"><Rings /><p class="hint" data-testid="notifications-empty">{t('notifEmpty')}</p></div>}
    </div>
  );
}
