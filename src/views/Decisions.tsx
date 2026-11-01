// Decisions, on the Matrix tab under the four boxes: those to check, open and decided as compact rows, "+ New decision" in the heading, the closed ones
// folded under "Closed (n)". Steps that are decisions open theirs from the Matrix's boxes.
import { openDecision, openDecisionPage, decisionGroups } from '../flows/decision';
import { DoneFold } from '../app/DoneFold';
import { t, fmtDate, type Key } from '../i18n';

const GROUP_KEY = { check: 'decToCheck', open: 'decOpen', decided: 'decDecided', closed: 'decClosed' } as const;

export function Decisions() {
  const groups = decisionGroups();
  const decList = (g: keyof typeof groups) => (
    <ul class="decs">{groups[g].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))).map(d => (
      <li>
        <button type="button" class="linklike" onClick={() => openDecisionPage(d.id, g === 'check')}><b>{d.title || t('untitledDecision')}</b></button>
        <p class="meta">{d.date && fmtDate(d.date, { day: 'numeric', month: 'short', year: 'numeric' }) + ' · '}{d.chosen ? t('chosen', { what: d.chosen }) : t('dst_' + d.status as Key)}</p>
        {d.falsifier && <p class="meta">{t('revisitIf', { what: d.falsifier })}{d.reviewOn && ' · ' + t('checkOn', { date: fmtDate(d.reviewOn) })}</p>}
      </li>
    ))}</ul>
  );
  return (
    <section class="decisions" data-testid="decisions">
      <h2 class="sec">{t('decisions')} <button type="button" class="btn small" onClick={() => void openDecision(null)} data-testid="new-decision">{t('newDecision')}</button></h2>
      {(['check', 'open', 'decided', 'closed'] as const).map(g => groups[g].length > 0 && (
        g === 'closed'
          ? <DoneFold n={groups.closed.length} label={t('decClosedFold', { n: groups.closed.length })} testid="decisions-closed">{decList(g)}</DoneFold>
          : <>
            <h3 class="subsec">{t(GROUP_KEY[g])}</h3>
            {decList(g)}
          </>
      ))}
      {!Object.values(groups).some(g => g.length) && <p class="hint">{t('noDecisions')}</p>}
    </section>
  );
}
