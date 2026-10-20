// History: the past exchanges typed on Home, each with its Undo. Built in a later step.
import { t } from '../i18n';

export function History() {
  return (
    <div data-testid="history">
      <h2 class="sec" style="margin-top:0">{t('historyTitle')}</h2>
    </div>
  );
}
