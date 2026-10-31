// Waiting for: the things the person waits for (event steps, schema 6), behind Home's menu. One row each: what, how long it
// has been, when it will be asked about, and the steps it holds back. Nothing here is a step to do; the three answers are the
// same as on the nudge row (It happened, Still waiting, Drop). Nothing counts or nags.
import { Rings } from '../app/Rings';
import { T, waiting } from '../app/model';
import { openTask } from '../app/sheets';
import { EventActions } from '../app/EventUi';
import { Title } from '../app/ui';
import { t, fmtDate } from '../i18n';

export function Waiting() {
  const list = waiting.value;
  return (
    <div data-testid="waiting">
      <h2 class="sec" style="margin-top:0">{t('waitingTitle')}</h2>
      <p class="hint">{t('waitingIntro')}</p>
      {list.length ? (
        <ul class="picklist waitlist">
          {list.map(w => {
            const tk = T(w.id);
            return tk && (
              <li key={w.id} data-testid="waiting-row">
                <div>
                  <button type="button" class="linklike h-text" onClick={() => openTask(w.id)}><Title s={w.title} /></button>
                  <small class="hint" data-testid="waiting-days">{w.days === 0 ? t('waitingDaysZero') : t('waitingDays', { n: w.days })}{w.nudge ? ' · ' + t('nudgeOn', { date: fmtDate(w.nudge) }) : ''}</small>
                  <small class="hint" data-testid="waiting-unlocks">{w.unlocks.length ? t('waitingUnlocks', { what: w.unlocks.map(u => u.title).join(', ') }) : t('waitingUnlocksNone')}</small>
                  <EventActions tk={tk} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : <div class="emptystate"><Rings /><p class="hint" data-testid="waiting-empty">{t('waitingEmpty')}</p></div>}
    </div>
  );
}
