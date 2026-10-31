// The Sunday review's goals with an AI on (plan 2 Nov, "Sunday review", S7): one project at a time, the AI checks the goal against SMART
// (the outcome, the measure, the dates), says for each open step whether it belongs and whether it moves the goal, and proposes changes.
// The person keeps or skips each proposal and flips each step's answer with a tap; at the end every project's choices make one
// change-set, confirmed on the review screen. Nothing is written before that yes. The review by hand (src/flows/review.tsx) is one tap away.
import { useEffect, useRef, useState } from 'preact/hooks';
import { projects } from '../app/store';
import { byOrder, goalSteps } from '../app/model';
import { recordReview } from '../app/home';
import { openSheet, closeSheet } from '../app/sheet';
import { Title } from '../app/ui';
import { measureLabel } from '../app/smart';
import { measureOf, outcomeOf, startOf } from '../domain/goal';
import type { MeasureSet } from '../ai/changeset';
import { ask, aiOn } from '../ai/ask';
import {
  GoalReviewReply, readGoalReview, setPropSkipped, setDropSkipped, setAddSkipped, setMoves, goalReviewChangeSet,
  type GoalDraft, type GoalNow, type GoalProp,
} from '../ai/features';
import { goalReviewPrompt } from '../ai/prompts';
import { useAi, AiError } from '../ai/ui';
import { prepareReview, ReviewList } from '../ai/Review';
import type { Plan as ChangePlan } from '../ai/apply';
import type { ChangeSet } from '../ai/changeset';
import { openReview, openReviewRest, GoalBlock } from './review';
import { t, fmtDate, fmtMin, type Key } from '../i18n';

/** "Start the review": the goals with an AI when one is set up, else the review by hand. */
export function startReview() {
  if (aiOn.value) openGoalReview(); else openReview();
}
export function openGoalReview() {
  openSheet(<GoalReview key={'gr' + Date.now()} />, true);
}

const queueOf = () => [...projects.value.values()].filter(p => p.status === 'active' && p.id !== 'inbox').sort(byOrder).map(p => p.id);
/** A project as it stands now, for reading the AI's reply against it. */
function nowOf(id: string): GoalNow {
  const p = projects.value.get(id)!;
  return { id, outcome: outcomeOf(p), measure: measureOf(p), start: startOf(p), due: p.due ?? null, steps: goalSteps(id).map(x => ({ id: x.id, advances: x.advances === true })) };
}
/** The proposals left out, named for the next turn so the AI does not offer them again. */
const skippedOf = (d: GoalDraft): string[] => [
  ...d.props.filter(x => x.skipped).map(x => x.key),
  ...d.drops.filter(x => x.skipped).map(x => 'drop ' + x.id),
  ...d.adds.filter(x => x.skipped).map(x => 'add ' + x.step.title),
];
const answersOf = (d: GoalDraft): string[] => d.steps.map(x => `${x.id} ${x.moves ? 'moves it' : 'does not move it'}`);

const PROP_LABEL: Record<GoalProp['key'], Key> = { outcome: 'fOutcome', measure: 'fMeasure', start: 'fStart', due: 'fDue' };
const PART: Record<'outcome' | 'measure' | 'dates', Key> = { outcome: 'grPartOutcome', measure: 'grPartMeasure', dates: 'grPartDates' };
const dayText = (v: string | null) => (v ? fmtDate(v) : t('chgNone'));
function measureWords(m: MeasureSet): string {
  if (m.kind === 'count') return `${m.target}${m.unit ? ' ' + m.unit : ''}`;
  if (m.kind === 'milestones') return m.items.map(i => i.text).join(', ');
  return t('measureNone');
}

function GoalReview() {
  const [queue] = useState(queueOf);
  const [i, setI] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, GoalDraft>>({});
  const [phase, setPhase] = useState<'talk' | 'done'>('talk');
  const [review, setReview] = useState<{ plan: ChangePlan; cs: ChangeSet } | null>(null);
  const [say, setSay] = useState('');
  const [none, setNone] = useState(false);
  const ai = useAi();
  const stop = ai.stop;
  const seen = useRef(new Set<string>());
  const id = queue[i];
  const d = id ? drafts[id] : undefined;

  /** One turn for the project on screen: the AI checks and proposes (and, after the first, revises as the person asks). */
  async function turn(message?: string) {
    if (!id || !projects.value.get(id)) return;
    const pid = id, now = nowOf(pid), cur = drafts[pid];
    const { system, user, notes } = goalReviewPrompt(pid, message === undefined ? {} : { message, skipped: cur ? skippedOf(cur) : [], answers: cur ? answersOf(cur) : [] });
    const r = await ai.run(signal => ask('goalreview', 'thinking', system, user, GoalReviewReply, { signal, notes }));
    // A failed or cancelled turn keeps what is on screen; the first one leaves the steps to answer by hand.
    if (r) setDrafts(ds => ({ ...ds, [pid]: readGoalReview(r, now) }));
    else if (!cur) setDrafts(ds => ({ ...ds, [pid]: readGoalReview(null, now) }));
  }
  useEffect(() => {
    if (id && !seen.current.has(id)) { seen.current.add(id); void turn(); }
  }, [i]);
  useEffect(() => () => stop(), []);

  const edit = (f: (x: GoalDraft) => GoalDraft) => { if (id && d) setDrafts({ ...drafts, [id]: f(d) }); };
  const stored = () => new Map(queue.flatMap(q => goalSteps(q).map(x => [x.id, x.advances === true] as const)));
  const make = () => {
    const cs = goalReviewChangeSet(queue.flatMap(q => (drafts[q] ? [drafts[q]!] : [])), stored());
    if (!cs) { setNone(true); setPhase('done'); return; }
    const plan = prepareReview(cs);
    if (plan) setReview({ plan, cs });
  };
  const applied = async (n: number, undo: Parameters<typeof recordReview>[2]) => {
    if (!n || !review) { setReview(null); return; }
    await recordReview(review.cs, n, undo);
    setReview(null); setNone(false); setPhase('done');
  };

  if (review) return (
    <div class="flow" data-testid="goalai-review">
      <h3>{t('grTitle')}</h3>
      <ReviewList plan={review.plan} note={review.cs.note} inline record onApplied={(n, u) => void applied(n, u)} />
    </div>
  );

  if (phase === 'done' || !queue.length) return (
    <div class="flow" data-testid="goalai-done">
      <h3>{queue.length ? t('grDoneTitle') : t('grNoProjects')}</h3>
      {none && <p class="hint" data-testid="goalai-nothing">{t('grNothing')}</p>}
      <p class="hint">{t('grDoneHint')}</p>
      <div class="actions">
        <button class="btn primary" type="button" onClick={() => openReviewRest()} data-testid="goalai-rest">{t('grRest')}</button>
        <button class="btn ghost" type="button" onClick={() => closeSheet()} data-testid="goalai-close">{t('close')}</button>
      </div>
    </div>
  );

  const p = projects.value.get(id!);
  if (!p) return null;
  const last = i === queue.length - 1;
  const steps = new Map(goalSteps(id!).map(x => [x.id, x]));
  const myself = () => openReview();

  const propRow = (x: GoalProp) => {
    const before = x.key === 'outcome' ? outcomeOf(p) || t('chgNone') : x.key === 'measure' ? measureLabel(measureOf(p)) : dayText(x.key === 'start' ? startOf(p) : p.due ?? null);
    const after = x.key === 'outcome' ? x.to : x.key === 'measure' ? measureWords(x.to) : dayText(x.to);
    return (
      <li data-testid="goalai-prop" data-key={x.key} data-state={x.skipped ? 'skipped' : 'kept'} class={x.skipped ? 'morn-skipped' : undefined}>
        <div>
          <p class="meta"><b>{t(PROP_LABEL[x.key])}</b></p>
          <p>{before} → <b>{after}</b></p>
        </div>
        <div class="go"><button class="btn small" type="button" onClick={() => edit(y => setPropSkipped(y, x.key, !x.skipped))} data-testid={x.skipped ? 'goalai-use' : 'goalai-skip'}>{x.skipped ? t('grUse') : t('skip')}</button></div>
      </li>
    );
  };
  const moves = (on: boolean, key: string, testid: string) => (
    <div class="seg small" role="group" aria-label={t('movesGoal')} data-testid={testid}>
      <button type="button" aria-pressed={on} onClick={() => edit(y => setMoves(y, key, true))} data-testid="goalai-moves-yes">{t('movesYes')}</button>
      <button type="button" aria-pressed={!on} onClick={() => edit(y => setMoves(y, key, false))} data-testid="goalai-moves-no">{t('movesNo')}</button>
    </div>
  );
  const proposals = d ? d.props.length + d.drops.length + d.adds.length : 0;

  return (
    <div class="flow goalai" data-testid="goalai" data-project={id}>
      <p class="eyebrow">{t('grStep', { n: i + 1, of: queue.length })}</p>
      <h3>{t('grTitle')}</h3>
      <GoalBlock id={id!} />
      {ai.busy && <div class="go" data-testid="goalai-busy"><span class="hint">{t('grAsking')}</span><button class="btn small" type="button" onClick={ai.stop}>{t('stop')}</button></div>}
      {ai.err && !ai.busy && <AiError {...ai.err} manual={myself} manualLabel={t('grMyself')} />}
      {d && (
        <>
          {d.note && <p class="ai-note" data-testid="goalai-note">{d.note}</p>}
          {d.check.length > 0 && (
            <section class="pillar" data-testid="goalai-check">
              <h4>{t('grCheck')}</h4>
              <ul class="picklist">{d.check.map(c => (
                <li data-testid={'goalai-check-' + c.part} data-ok={c.ok ? 'yes' : 'no'}>
                  <div><p><b>{t(PART[c.part])}</b> · {c.ok ? t('grHolds') : t('grVague')}</p>{c.line && <p class="hint">{c.line}</p>}</div>
                </li>
              ))}</ul>
            </section>
          )}
          {proposals > 0 && (
            <section class="pillar" data-testid="goalai-props">
              <h4>{t('grProposals')}</h4>
              <ul class="picklist">
                {d.props.map(propRow)}
                {d.drops.map(x => (
                  <li data-testid="goalai-prop" data-key={'drop:' + x.id} data-state={x.skipped ? 'skipped' : 'kept'} class={x.skipped ? 'morn-skipped' : undefined}>
                    <div><p class="meta"><b>{t('grDrop')}</b></p><p><Title s={steps.get(x.id)?.title ?? x.id} /></p>{x.line && !x.skipped && <p class="hint">{x.line}</p>}</div>
                    <div class="go"><button class="btn small" type="button" onClick={() => edit(y => setDropSkipped(y, x.id, !x.skipped))} data-testid={x.skipped ? 'goalai-use' : 'goalai-skip'}>{x.skipped ? t('grUse') : t('skip')}</button></div>
                  </li>
                ))}
                {d.adds.map(x => (
                  <li data-testid="goalai-prop" data-key={x.key} data-state={x.skipped ? 'skipped' : 'kept'} class={x.skipped ? 'morn-skipped' : undefined}>
                    <div>
                      <p class="meta"><b>{t('grAddStep')}</b></p>
                      <p>{x.step.starter ? x.step.starter + ' → ' : ''}<Title s={x.step.title} /> <span class="tag">{t('chgNew')}</span></p>
                      {x.step.est ? <p class="meta">{fmtMin(x.step.est)}</p> : null}
                      {x.line && !x.skipped && <p class="hint">{x.line}</p>}
                      {!x.skipped && <><p class="meta">{t('movesGoal')}</p>{moves(x.moves, x.key, 'goalai-add-moves')}</>}
                    </div>
                    <div class="go"><button class="btn small" type="button" onClick={() => edit(y => setAddSkipped(y, x.key, !x.skipped))} data-testid={x.skipped ? 'goalai-use' : 'goalai-skip'}>{x.skipped ? t('grUse') : t('skip')}</button></div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section class="pillar" data-testid="goalai-steps">
            <h4>{t('grSteps')}</h4>
            {!d.steps.length && <p class="hint">{t('grNoSteps')}</p>}
            <ul class="picklist">{d.steps.map(x => {
              const tk = steps.get(x.id);
              if (!tk) return null;
              const dropping = d.drops.some(y => y.id === x.id && !y.skipped);
              const was = tk.advances;
              return (
                <li data-testid="goalai-step" data-task={x.id} data-moves={x.moves ? 'yes' : 'no'}>
                  <div>
                    <p><Title s={tk.title} /></p>
                    {(x.belongs === false || dropping) && <p class="meta">{[x.belongs === false ? t('grNotInGoal') : '', dropping ? t('grWillDrop') : ''].filter(Boolean).join(' · ')}</p>}
                    {x.line && <p class="hint">{x.line}</p>}
                    {x.moves !== (was === true) && <p class="meta">{t('grNow')}: {was == null ? t('movesNotSaid') : was ? t('movesYes') : t('movesNo')}</p>}
                  </div>
                  {moves(x.moves, x.id, 'goalai-moves')}
                </li>
              );
            })}</ul>
          </section>
          <form class="morn-say" onSubmit={e => { e.preventDefault(); const m = say.trim(); if (m && !ai.busy) { setSay(''); void turn(m); } }}>
            <input type="text" value={say} onInput={e => setSay((e.target as HTMLInputElement).value)} placeholder={t('grSayPh')} aria-label={t('grSayLabel')} autocomplete="off" data-testid="goalai-say" />
            <button class="btn small" type="submit" disabled={ai.busy || !say.trim()} data-testid="goalai-adjust">{t('grAdjust')}</button>
          </form>
        </>
      )}
      <div class="actions">
        {i > 0 && <button class="btn ghost" type="button" onClick={() => setI(i - 1)} disabled={ai.busy} data-testid="goalai-prev">{t('grBackBtn')}</button>}
        {last
          ? <button class="btn primary" type="button" onClick={make} disabled={ai.busy || !d} data-testid="goalai-make">{t('grSee')}</button>
          : <button class="btn primary" type="button" onClick={() => setI(i + 1)} disabled={ai.busy} data-testid="goalai-next">{t('grNext')}</button>}
        <button class="btn ghost" type="button" onClick={myself} data-testid="goalai-myself">{t('grMyself')}</button>
      </div>
    </div>
  );
}

