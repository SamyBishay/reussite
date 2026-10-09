// The one review screen (brief §10): every proposed change as before → after with a checkbox,
// for the command box, the AI features and "Paste the reply". Only ticked changes are written.
import { useState } from 'preact/hooks';
import { openSheet, closeSheet, suitName } from '../app/ui';
import { placeName } from '../app/sheets';
import { projects, tasks, toast, readOnly } from '../app/store';
import { t, fmtDate, fmtMin, type Key } from '../i18n';
import { planChanges, applyPlanned, isRef, type Plan, type Planned } from './apply';
import { appWriter, snapshot, gen } from './writer';
import type { ChangeSet } from './changeset';
import type { SuitId } from '../data/schema';

const FIELD: Record<string, Key> = {
  title: 'fTitle', project: 'project', suit: 'suit', urgent: 'fUrgent', important: 'fImportant', due: 'fDue', est: 'fEst', starter: 'fStarter',
  app: 'fApp', link: 'fLink', prompt: 'fPrompt', note: 'fNote', where: 'where', after: 'fAfter', kind: 'fKind', at: 'fAt', dur: 'fDur',
  doneDay: 'fDoneDay', order: 'fOrder', name: 'fName', goal: 'fGoal', smart: 'fSmart', status: 'fStatus', plan: 'fPlan', first: 'fFirst',
  launches: 'fLaunches', timeZone: 'timeZone', place: 'fPlace', from: 'stayFrom', to: 'stayTo', option: 'fOption', items: 'fItems', steps: 'fSteps',
  chosen: 'fChosen', why: 'fWhy', mustBeTrue: 'fMustBeTrue', falsifier: 'fFalsifier', reviewOn: 'fReviewOn', projectId: 'project', problem: 'fProblem',
};
const DATES = new Set(['due', 'doneDay', 'from', 'to', 'reviewOn']);
const IDS = new Set(['after', 'plan', 'order', 'steps', 'first']);

function fmt(field: string, v: unknown, refs: Plan['refTitles']): string {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return t('chgNone');
  const title = (id: string) => (isRef(id) ? refs.get(id) ?? '?' : tasks.value.get(id)?.title ?? id);
  if (DATES.has(field) && typeof v === 'string') return fmtDate(v);
  if ((field === 'est' || field === 'dur') && typeof v === 'number') return fmtMin(v);
  if (IDS.has(field)) return (Array.isArray(v) ? v : [v]).map(x => title(String(x))).join('; ');
  if (field === 'project' || field === 'projectId') { const s = String(v); return isRef(s) ? refs.get(s) ?? '?' : s === 'inbox' ? t('inbox') : projects.value.get(s)?.name ?? s; }
  if (field === 'where' || field === 'place') { const s = String(v); return isRef(s) ? refs.get(s) ?? '?' : placeName(s); }
  if (field === 'suit') return suitName(v as SuitId, true);
  if (typeof v === 'boolean') return v ? t('yes') : t('no');
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).filter(Boolean).join(' / ') || t('chgNone');
  const s = String(v);
  return s.length > 90 ? s.slice(0, 88) + '…' : s;
}

const TAG: Record<Planned['kind'], Key | null> = { create: 'chgNew', update: null, done: 'chgDone', drop: 'chgDrop', reorder: 'chgOrder' };
const TARGET: Record<Planned['target'], Key | null> = { task: null, project: 'project', day: 'chgDay', place: 'fPlace', stay: 'chgStay', decision: 'chgDecision' };

function Row({ it, on, toggle, refs }: { it: Planned; on: boolean; toggle: () => void; refs: Plan['refTitles'] }) {
  const tag = TAG[it.kind], target = TARGET[it.target];
  const title = it.target === 'day' ? fmtDate(it.title, { weekday: 'long', day: 'numeric', month: 'long' }) : it.kind === 'reorder' ? t('chgNewOrder') : it.title;
  return (
    <li data-testid="chg">
      <label class="chg">
        <input type="checkbox" checked={on} onChange={toggle} />
        <span>
          <span class="what">{target && <span class="tag">{t(target)}</span>} {tag && <span class="tag">{t(tag)}</span>} {title}</span>
          {it.diffs.map(d => {
            const f = d.field.startsWith('problem.') ? 'problem' : d.field;
            const label = (FIELD[f] ? t(FIELD[f]) : f) + (f === 'problem' ? ' · ' + d.field.slice(8) : '');
            return <span class="diff">{label}: {d.before !== undefined && it.kind !== 'create' ? <>{fmt(f, d.before, refs)} → </> : null}<b>{fmt(f, d.after, refs)}</b></span>;
          })}
        </span>
      </label>
    </li>
  );
}

/** The tick list. In a sheet it closes the sheet; inside a flow (`inline`) it hands back to it. */
export function ReviewList({ plan, note, request, onApplied, inline }: { plan: Plan; note: string; request?: string; onApplied?: (n: number) => void; inline?: boolean }) {
  const [on, setOn] = useState(() => plan.items.map(() => true));
  const [busy, setBusy] = useState(false);
  const n = on.filter(Boolean).length;
  const go = async () => {
    setBusy(true);
    const done = await applyPlanned(plan, i => !!on[i], appWriter);
    if (!inline) closeSheet();
    toast(done ? t('chgApplied', { n: done }) : t('chgNothing'));
    onApplied?.(done);
  };
  return (
    <div data-testid="review" class={inline ? 'review-inline' : undefined}>
      {inline ? <p class="field-label">{t('chgTitle', { n: plan.items.length })}</p> : <h3>{t('chgTitle', { n: plan.items.length })}</h3>}
      {request && <p class="hint">“{request}”</p>}
      {note && <p class="ai-note">{note}</p>}
      {plan.skipped > 0 && <p class="hint">{t('chgSkipped', { n: plan.skipped })}</p>}
      <ul class="picklist chglist">{plan.items.map((it, i) => <Row it={it} on={!!on[i]} refs={plan.refTitles} toggle={() => setOn(on.map((x, j) => (j === i ? !x : x)))} />)}</ul>
      <div class="actions">
        <button class="btn primary" type="button" disabled={busy || !n || readOnly.value} onClick={go} data-testid="apply-changes">{t('chgApply', { n })}</button>
        <button class="btn ghost" type="button" onClick={() => (inline ? onApplied?.(0) : closeSheet())}>{t('cancel')}</button>
      </div>
      <p class="hint" style="margin-top:10px">{t('chgUntick')}</p>
    </div>
  );
}

/**
 * Open the review screen for a change-set. Returns false (and says so) when nothing in it
 * would change anything. `request` is the person's words, shown as a reminder.
 */
export function openChangeReview(cs: ChangeSet, o: { request?: string; onApplied?: (n: number) => void } = {}): boolean {
  const plan = prepareReview(cs);
  if (!plan) return false;
  openSheet(<ReviewList key={'rv' + Date.now()} plan={plan} note={cs.note} request={o.request} onApplied={o.onApplied} />, true);
  return true;
}

/** Check a change-set against the data now; null (and a toast saying so) when it would change nothing. */
export function prepareReview(cs: ChangeSet): Plan | null {
  const plan = planChanges(cs, snapshot(), gen);
  if (!plan.items.length) { toast(cs.note || t('chgNoneLeft')); return null; }
  return plan;
}
