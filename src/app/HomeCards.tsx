// The question card of Home's input (which one? how long? an AI's answer, a change-set to review). Home never asks: the card is shown at the top of Today.
import { T, planEst } from './model';
import { DurationPicker } from './sheets';
import { cardNow, choose, dismissCard, reviewAgain, saveDuration, type HomeCard } from './home';
import { t } from '../i18n';

function CardBody({ c }: { c: HomeCard }) {
  if (c.kind === 'pick') {
    return (
      <div class="homecard" data-testid="card-pick">
        <p class="eyebrow">{t('homePick')}</p>
        <div class="picks">{c.candidates.map(x => <button class="btn pickbtn" type="button" onClick={() => void choose(c, x)} data-testid="pick">{x.name}</button>)}</div>
        <div class="actions"><button class="btn small ghost" type="button" onClick={dismissCard}>{t('cancel')}</button></div>
      </div>
    );
  }
  if (c.kind === 'duration') {
    const tk = T(c.task);
    if (!tk) return null;
    return (
      <div class="homecard" data-testid="card-duration">
        <p class="eyebrow">{t('howLong')}</p>
        <p class="t2">{t('homeHowLong', { title: tk.title })}</p>
        <DurationPicker base={planEst(tk)} onPick={m => void saveDuration(c, m)} />
        <div class="actions"><button class="btn small ghost" type="button" onClick={dismissCard} data-testid="not-timed">{t('didntTime')}</button></div>
        <p class="hint">{t('homeHowLongHint')}</p>
      </div>
    );
  }
  if (c.kind === 'review') {
    return (
      <div class="homecard row" data-testid="card-review">
        <p><b>{t('receiptChanges', { n: c.cs.changes.length })}</b></p>
        <div class="actions"><button class="btn small primary" type="button" onClick={() => reviewAgain(c)} data-testid="card-review-open">{t('homeReviewBtn')}</button><button class="btn small ghost" type="button" onClick={dismissCard}>{t('cancel')}</button></div>
      </div>
    );
  }
  return (
    <div class="homecard" data-testid="card-answer">
      <p class="ai-note">{c.text}</p>
      <div class="actions">{c.action && <button class="btn small" type="button" onClick={c.action.run}>{c.action.label}</button>}<button class="btn small ghost" type="button" onClick={dismissCard}>{t('ok')}</button></div>
    </div>
  );
}

export function HomeCardNow() {
  const c = cardNow.value;
  return c ? <div data-testid="home-card" data-kind={c.kind}><CardBody c={c} /></div> : null;
}

