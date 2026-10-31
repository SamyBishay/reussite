import { useState } from 'preact/hooks';
import { chainOfHead, isEvent, T as taskById, type T } from './model';
import { openTask } from './sheets';
import { Title } from './ui';
import { t, fmtDate } from '../i18n';

/**
 * A chain's head says how many steps wait after it ("+4 after"); tapping unfolds them inside the card, in order,
 * greyed until their turn. Nothing for a step that heads no chain.
 */
export function ChainFold({ tk }: { tk: T }) {
  const [shown, setShown] = useState(false);
  const c = chainOfHead(tk.id);
  if (!c) return null;
  return (
    <div class="chain" data-testid="chain">
      <button type="button" class="linklike chain-toggle" aria-expanded={shown} data-testid="chain-toggle"
        onClick={e => { e.stopPropagation(); setShown(!shown); }}>{(shown ? '▾ ' : '▸ ') + t('chainAfter', { n: c.after })}</button>
      {c.due && c.due !== tk.due && <span class="chain-due" data-testid="chain-due">{t('chainDue', { date: fmtDate(c.due) })}</span>}
      {shown && (
        <ol class="chain-list" aria-label={t('chainSteps')}>
          {c.members.slice(1).map(id => { const m = taskById(id); return m && (
            <li key={id} style={{ marginLeft: Math.max(0, (c.depth.get(id) ?? 1) - 1) * 14 + 'px' }} data-task={id} {...(isEvent(m) ? { 'data-event': '' } : {})}>
              <button type="button" class="linklike" onClick={e => { e.stopPropagation(); openTask(id); }}>{isEvent(m) ? <>{t('waitingForCard', { what: '' })}<Title s={m.title} /></> : <Title s={m.title} />}</button>
              {m.due && !isEvent(m) && <small class="muted"> · {fmtDate(m.due)}</small>}
            </li>
          ); })}
        </ol>
      )}
    </div>
  );
}
