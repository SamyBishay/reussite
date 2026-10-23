// History: what was typed on Home (or came by a link) in the last 90 days, newest first, one line each,
// with Undo where there is something left to undo.
import { exchanges, clockNow, type WithId } from '../app/store';
import type { Exchange as Ex } from '../data/schema';

type Exchange = WithId<Ex>;
import { KEEP_DAYS, OPEN_MS, canUndo, lastAt, receiptLine, undoExchange } from '../app/home';
import { t, locale } from '../i18n';

const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? '' : d.toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** Undo past Home's ten minutes asks first: by then it may take back something the person has built on. */
function undoOld(x: Exchange) {
  if (Date.now() - lastAt(x) >= OPEN_MS && !confirm(t('undoOldConfirm'))) return;
  void undoExchange(x.id);
}

export function History() {
  const cut = clockNow.value - KEEP_DAYS * 86_400_000;
  const list = [...exchanges.value.values()].filter(x => lastAt(x) >= cut).sort((a, b) => lastAt(b) - lastAt(a));
  return (
    <div data-testid="history">
      <h2 class="sec" style="margin-top:0">{t('historyTitle')}</h2>
      <p class="hint">{t('historyIntro')}</p>
      {list.length ? (
        <ul class="picklist history">
          {list.map(x => (
            <li data-testid="history-row">
              <div>
                <span class="h-text">{x.text || t('historyForgotten')}</span>
                <small class="hint">{when(x.turns[x.turns.length - 1]?.at ?? x.at)} · {receiptLine(x)}{x.src !== 'home' && <> · <span data-testid="history-src">{t(x.src === 'link' ? 'historyFromLink' : x.src === 'paste' ? 'historyFromPaste' : 'historyFromInbox')}</span></>}</small>
              </div>
              {canUndo(x)
                ? <button class="btn small" type="button" onClick={() => undoOld(x)} data-testid="history-undo">{t('undo')}</button>
                : x.changes.length ? <span class="tag">{t('undone')}</span> : null}
            </li>
          ))}
        </ul>
      ) : <p class="hint" data-testid="history-empty">{t('historyEmpty')}</p>}
    </div>
  );
}
