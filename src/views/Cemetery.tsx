// The Cemetery: dropped cards, folded at the bottom of the Matrix and absent while there are none. They are kept
// (never deleted, so a synced device cannot bring one back) but out of every list; Restore is the way back.
import { tasks, projects } from '../app/store';
import { byOrder } from '../app/model';
import { reopen } from '../app/actions';
import { Title } from '../app/ui';
import { t } from '../i18n';

export function Cemetery() {
  const list = [...tasks.value.values()].filter(x => x.status === 'dropped' && !x.template).sort(byOrder);
  if (!list.length) return null;
  return (
    <details class="more obligations" data-testid="cemetery">
      <summary>{t('cemeteryTitle')} · {list.length}</summary>
      <p class="hint">{t('cemeteryIntro')}</p>
      <ul class="picklist history">
        {list.map(x => (
          <li data-testid="cemetery-row">
            <div>
              <span class="h-text"><Title s={x.title} /></span>
              {x.project !== 'inbox' && projects.value.get(x.project) && <small class="hint">{projects.value.get(x.project)!.name}</small>}
            </div>
            <button class="btn small" type="button" onClick={() => void reopen(x.id)} data-testid="cemetery-restore">{t('cemeteryRestore')}</button>
          </li>
        ))}
      </ul>
    </details>
  );
}
