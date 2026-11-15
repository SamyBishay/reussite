import { view } from './nav';
import { today } from './store';
import { addByHand } from './actions';
import { openNewTask } from './sheets';
import { openNewProject } from '../views/Projects';
import { dayView } from '../views/Today';
import { t } from '../i18n';

const VIEWS = ['home', 'today', 'matrix', 'projects'];


/**
 * The round plus on Home, Today and the Matrix: the task sheet for a new card. On Today the card joins the day shown (not a past one), and the
 * sheet also offers that day's From your deck and Leisure & people: the plus is Today's one way to add (15 Nov; the row of adders is gone).
 */
export function AddCard() {
  if (!VIEWS.includes(view.value)) return null;
  const add = () => {
    if (view.value === 'projects') return openNewProject();
    const k = view.value === 'today' && dayView.value ? dayView.value : today.value;
    const onDay = view.value === 'today' && k >= today.value;
    openNewTask({}, onDay ? id => void addByHand(id, false, k) : undefined, onDay ? k : undefined);
  };
  return (
    <button type="button" class="fab" onClick={add} aria-label={t('addCard')} title={t('addCard')} data-testid="add-card">
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
    </button>
  );
}
