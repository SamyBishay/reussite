// The goal editor (brief §5, Projects; METHOD rule 9; SMART goals v2): the outcome in one sentence, how the bar is
// measured (a count with a target and a unit, milestones, or no bar), the start and due dates. The five SMART questions
// are still stored and still editable, folded underneath. A goal an AI proposed shows "proposed" until confirmed or edited.
// After a step that moves the goal is done, `openGoalDone` asks for the amount (a count) or which milestone to tick.
import { useState } from 'preact/hooks';
import { projects, tasks, today, newId } from './store';
import { patchProject, patchTask, tickGoalMilestone } from './actions';
import { openSheet, closeSheet } from './sheet';
import { t, type Key } from '../i18n';
import type { Measure, Smart, Project } from '../data/schema';
import { MEASURE_KINDS, MILESTONES_MAX, addMilestone, amountOf, fmtAmount, measureOf, outcomeOf, progressOf, startOf, tickMilestone, UNIT_MAX, type Progress } from '../domain/goal';

const LETTERS: [keyof Smart, Key, Key][] = [
  ['specific', 'smartS', 'smartSHint'],
  ['measurable', 'smartM', 'smartMHint'],
  ['attainable', 'smartA', 'smartAHint'],
  ['relevant', 'smartR', 'smartRHint'],
  ['dated', 'smartT', 'smartTHint'],
];
export const EMPTY_SMART: Smart = { specific: '', measurable: '', attainable: '', relevant: '', dated: '' };
export const smartFilled = (s: Smart | null | undefined) => LETTERS.filter(([k]) => s?.[k]?.trim()).length;

/** "4 of 10 pages" / "2 of 5 milestones" for a project's bar. */
export function progressLine(pr: Progress): string {
  return pr.kind === 'count'
    ? t('goalCountLine', { v: fmtAmount(pr.value), n: fmtAmount(pr.max), unit: pr.unit ? ' ' + pr.unit : '' })
    : t('goalMilestonesLine', { v: pr.value, n: pr.max });
}

/** The bar of a project from the live steps, or null. */
export function projectProgress(p: Project & { id: string }): Progress | null {
  return progressOf(p, [...tasks.value.values()].filter(x => x.project === p.id && x.status !== 'dropped'));
}

/** A measure in words, for the review screen: "No bar", "10 pages", "Draft sent, Filed (1 ticked)". */
export function measureLabel(m: Measure): string {
  if (m.kind === 'count') return `${fmtAmount(m.target)}${m.unit ? ' ' + m.unit : ''}`;
  if (m.kind === 'milestones') return m.items.map(i => (i.done ? '✓ ' : '') + i.text).join(', ') || t('measureMilestones');
  return t('measureNone');
}

type Kind = (typeof MEASURE_KINDS)[number];
const KIND_KEY: Record<Kind, Key> = { none: 'measureNone', count: 'measureCount', milestones: 'measureMilestones' };

export function SmartEditor({ projectId }: { projectId: string }) {
  const p = projects.value.get(projectId);
  const [kind, setKind] = useState<Kind>(() => measureOf(projects.value.get(projectId)).kind);
  const [newMs, setNewMs] = useState('');
  if (!p) return null;
  const smart = { ...EMPTY_SMART, ...(p.smart ?? {}) };
  const proposed = p.goalBy === 'ai' || p.smartBy === 'ai';
  const m = measureOf(p);
  const setSmart = (k: keyof Smart, v: string) => void patchProject(projectId, { smart: { ...smart, [k]: v }, smartBy: 'me' });
  const setMeasure = (next: Measure) => void patchProject(projectId, { measure: next });
  // Changing the kind keeps what the old kind held (in `measurePrev`) and gives it back if the person returns to it.
  const pick = (k: Kind) => {
    setKind(k);
    if (k === m.kind) return;
    const prev = p.measurePrev ? measureOf({ measure: p.measurePrev }) : null;
    // A count waits for its target: until it is typed the project has no bar.
    const next: Measure = k === 'none' ? { kind: 'none' } : prev?.kind === k ? prev : k === 'milestones' ? { kind: 'milestones', items: [] } : { kind: 'none' };
    if (m.kind === 'none' && next.kind === 'none') return;
    void patchProject(projectId, { measure: next, ...(m.kind !== 'none' ? { measurePrev: m } : {}) });
  };
  const count = m.kind === 'count' ? m : null;
  const saveCount = (target: string, unit: string) => {
    const n = Number(target.replace(',', '.'));
    if (Number.isFinite(n) && n > 0) setMeasure({ kind: 'count', target: n, unit: unit.trim().slice(0, UNIT_MAX) });
  };
  const addMs = () => {
    if (!newMs.trim()) return;
    setMeasure(addMilestone(m.kind === 'milestones' ? m : { kind: 'milestones', items: [] }, 'm' + newId(''), newMs));
    setNewMs('');
  };
  const out = outcomeOf(p);
  return (
    <div class="smart" data-testid="smart">
      <label class="field"><span>{t('goalSentence')}{proposed && <span class="proposed" title={t('proposedHint')}>{t('proposed')}</span>}</span>
        <input type="text" name="outcome" defaultValue={out} placeholder={t('goalPh')} data-testid="goal-outcome" onChange={e => void patchProject(projectId, { outcome: (e.target as HTMLInputElement).value.trim() || null, goalBy: 'me' })} />
      </label>
      <div class="field" data-testid="measure"><span>{t('measureField')}</span>
        <div class="seg small" role="group" aria-label={t('measureField')}>
          {MEASURE_KINDS.map(k => <button type="button" aria-pressed={kind === k} data-testid={'measure-' + k} onClick={() => pick(k)}>{t(KIND_KEY[k])}</button>)}
        </div>
        <small class="hint">{t(kind === 'none' ? 'measureNoneHint' : kind === 'count' ? 'measureCountHint' : 'measureMilestonesHint')}</small>
      </div>
      {kind === 'count' && (
        <div class="row2">
          <label class="field"><span>{t('measureTarget')}</span>
            <input type="number" name="target" min="0" step="any" inputMode="decimal" defaultValue={count ? String(count.target) : ''} data-testid="measure-target"
              onChange={e => saveCount((e.target as HTMLInputElement).value, count?.unit ?? '')} />
          </label>
          <label class="field"><span>{t('measureUnit')}</span>
            <input type="text" name="unit" maxLength={UNIT_MAX} defaultValue={count?.unit ?? ''} placeholder={t('measureUnitPh')} data-testid="measure-unit" autocomplete="off"
              onChange={e => saveCount(String(count?.target ?? ''), (e.target as HTMLInputElement).value)} />
          </label>
        </div>
      )}
      {kind === 'milestones' && (
        <div class="field" data-testid="milestones"><span>{t('measureMilestones')}</span>
          {m.kind === 'milestones' && m.items.length > 0 && (
            <ul class="mini milestones">{m.items.map(i => (
              <li key={i.id}>
                <label class="tog small"><input type="checkbox" checked={!!i.done} aria-label={t('milestoneTick', { what: i.text })} data-testid="milestone-tick"
                  onChange={e => setMeasure(tickMilestone(m, i.id, (e.target as HTMLInputElement).checked ? today.value : null))} /></label>
                <input type="text" defaultValue={i.text} aria-label={t('milestoneText')} onChange={e => { const v = (e.target as HTMLInputElement).value.trim(); if (v) setMeasure({ kind: 'milestones', items: m.items.map(x => (x.id === i.id ? { ...x, text: v } : x)) }); }} />
                <button type="button" class="chip-x" onClick={() => setMeasure({ kind: 'milestones', items: m.items.filter(x => x.id !== i.id) })} aria-label={t('remove', { what: i.text })}>×</button>
              </li>
            ))}</ul>
          )}
          {(m.kind !== 'milestones' || m.items.length < MILESTONES_MAX) && (
            <div class="row-inline">
              <input type="text" value={newMs} placeholder={t('milestonePh')} aria-label={t('milestonePh')} data-testid="milestone-new" autocomplete="off"
                onInput={e => setNewMs((e.target as HTMLInputElement).value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addMs(); } }} />
              <button class="btn small" type="button" data-testid="milestone-add" onClick={addMs}>{t('add')}</button>
            </div>
          )}
        </div>
      )}
      <div class="row2">
        <label class="field"><span>{t('goalStart')}</span><input type="date" defaultValue={startOf(p) ?? ''} data-testid="goal-start" onChange={e => void patchProject(projectId, { start: (e.target as HTMLInputElement).value || null })} /></label>
        <label class="field"><span>{t('dueField')}</span><input type="date" defaultValue={p.due ?? ''} data-testid="goal-due" onChange={e => void patchProject(projectId, { due: (e.target as HTMLInputElement).value || null })} /></label>
      </div>
      <details class="more" data-testid="smart-five">
        <summary>{t('smartFive')}<span class="more-n"> · {t('smartN', { n: smartFilled(p.smart) })}</span></summary>
        <p class="hint">{t('smartHint')}</p>
        {LETTERS.map(([k, label, hint]) => (
          <label class="field"><span><b class="letter">{t(label).slice(0, 1)}</b> {t(label)} <small class="muted">{t(hint)}</small></span>
            <input type="text" defaultValue={smart[k]} onChange={e => setSmart(k, (e.target as HTMLInputElement).value.trim())} />
          </label>
        ))}
      </details>
      {proposed && <div class="actions"><button class="btn small" type="button" onClick={() => void patchProject(projectId, { goalBy: 'me', smartBy: 'me' })}>{t('confirm')}</button></div>}
    </div>
  );
}

/**
 * After a step that moves a goal is done: a count asks how much it added (1 unless said), milestones ask which to tick.
 * Closing the sheet keeps what is there: 1 for a count, nothing ticked.
 */
export function openGoalDone(projectId: string, stepId: string, kind: 'count' | 'milestones') {
  openSheet(<GoalDone key={'goal' + stepId} projectId={projectId} stepId={stepId} kind={kind} />);
}

const AMOUNTS = [1, 2, 3, 5, 10];

function GoalDone({ projectId, stepId, kind }: { projectId: string; stepId: string; kind: 'count' | 'milestones' }) {
  const p = projects.value.get(projectId);
  const tk = tasks.value.get(stepId);
  const [typed, setTyped] = useState('');
  if (!p || !tk) return null;
  const pr = projectProgress(p);
  if (!pr) return null;
  if (kind === 'milestones') {
    const m = measureOf(p);
    const open = m.kind === 'milestones' ? m.items.filter(i => !i.done) : [];
    return (
      <div data-testid="goal-done">
        <h3>{t('milestoneAsk')}</h3>
        <p class="hint">{progressLine(pr)}</p>
        <ul class="picklist">{open.map(i => <li key={i.id}><button type="button" class="btn" data-testid="milestone-pick" onClick={() => { void tickGoalMilestone(projectId, i.id); closeSheet(); }}>{i.text}</button></li>)}</ul>
        <div class="actions"><button class="btn ghost" type="button" onClick={closeSheet}>{t('milestoneNone')}</button></div>
      </div>
    );
  }
  const cur = amountOf(tk);
  const set = (n: number) => { if (Number.isFinite(n) && n > 0) void patchTask(stepId, { advanceBy: n }); closeSheet(); };
  return (
    <div data-testid="goal-done">
      <h3>{t('goalAddsTitle', { name: p.name })}</h3>
      <p class="hint">{progressLine(pr)}</p>
      <div class="chips-pick">{AMOUNTS.map(n => <button type="button" aria-pressed={cur === n} data-testid="goal-amount" onClick={() => set(n)}>{'+' + n}</button>)}</div>
      <div class="field"><span>{t('goalAddsOther')}</span>
        <div class="row-inline">
          <input type="number" min="0" step="any" inputMode="decimal" value={typed} aria-label={t('goalAddsOther')} data-testid="goal-amount-input" onInput={e => setTyped((e.target as HTMLInputElement).value)} />
          <button class="btn small" type="button" disabled={!(Number(typed) > 0)} onClick={() => set(Number(typed.replace(',', '.')))}>{t('save')}</button>
        </div>
      </div>
      <div class="actions"><button class="btn primary" type="button" onClick={closeSheet}>{t('goalKeepAmount', { n: fmtAmount(cur) })}</button></div>
    </div>
  );
}
