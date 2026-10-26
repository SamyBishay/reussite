import { view } from './nav';
import { today } from './store';
import { addByHand } from './actions';
import { openNewTask } from './sheets';
import { dayView } from '../views/Today';
import { t } from '../i18n';

const VIEWS = ['home', 'today', 'matrix'];

/** The round plus on Home, Today and the Matrix: the task sheet for a new step. On Today the step joins the day shown (not a past one). */
export function AddCard() {
  if (!VIEWS.includes(view.value)) return null;
  const add = () => {
    const k = view.value === 'today' && dayView.value ? dayView.value : today.value;
    openNewTask({}, view.value === 'today' && k >= today.value ? id => void addByHand(id, false, k) : undefined);
  };
  return (
    <button type="button" class="fab" onClick={add} aria-label={t('addCard')} title={t('addCard')} data-testid="add-card">
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
    </button>
  );
}
