// The weekly review's banner (Today and the Matrix): shown on the review day until that day's review is done. Start the review, or take it to a chat.
import { settings } from './store';
import { dayDoc } from './model';
import { startReview } from '../flows/reviewai';
import { ChatOffer } from './ChatOffer';
import { isoDow } from '../domain/repeat';
import { t } from '../i18n';

/** Is `day` the review day, with the review not yet done? */
export const reviewDue = (day: string) => isoDow(day) === settings.value.reviewDay && !dayDoc(day)?.review;

export function ReviewBanner({ day, testid = 'review-card', chatTestid = 'review-chat' }: { day: string; testid?: string; chatTestid?: string }) {
  if (!reviewDue(day)) return null;
  return <div class="banner" data-testid={testid}><p>{t('reviewToday')}</p><button class="btn small" type="button" onClick={startReview}>{t('startReview')}</button><ChatOffer what="review" small testid={chatTestid} /></div>;
}
