// Memory: what the app knows about the person's life, in notes they can read, edit and forget. Built in a later step.
import { t } from '../i18n';

export function Memory() {
  return (
    <div data-testid="memory">
      <h2 class="sec" style="margin-top:0">{t('memoryTitle')}</h2>
    </div>
  );
}
