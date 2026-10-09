// The decision wizard (brief §9, METHOD "Decisions"), one question per screen:
// problem, options (then close the list), a balance per option, scores, the choice, the steps.
// Plus the decision page, the check on the review date, and re-weighing with a history.
import { useRef, useState } from 'preact/hooks';
import { decisions, projects, today, toast, createDoc, update, newId } from '../app/store';
import { T } from '../app/model';
import { createTask, newTaskDoc, addToday } from '../app/actions';
import { openSheet, closeSheet } from '../app/sheet';
import { openDone, showMoment } from '../app/sheets';
import { celebrate } from '../app/celebrate';
import { SmartEditor } from '../app/smart';
import { DayPick } from '../app/due';
import { t, fmtDate, fmtMin, type Key } from '../i18n';
import { addDays } from '../domain/dates';
import { COLUMNS, score, ranked, tooClose, type Column, type Item, type Option } from '../domain/decision';
import { normDecision } from '../data/normalize';
import type { Decision, Problem, Project } from '../data/schema';
import { ask, aiOn } from '../ai/ask';
import { DecisionReply, decisionChangeSet, estByOf, type DecisionAsk } from '../ai/features';
import { decisionPrompt } from '../ai/prompts';
import { useAi, AiAction } from '../ai/ui';
import { prepareReview, ReviewList } from '../ai/Review';
import type { Plan as ChangePlan } from '../ai/apply';

type D = Decision & { id: string };
const get = (id: string): D | undefined => decisions.value.get(id) as D | undefined;
const save = (id: string, p: Partial<Decision>) => update<Decision>('decisions', id, p);
const scoresOf = (d: Pick<Decision, 'options'>) => Object.fromEntries(d.options.filter(o => !o.screened).map(o => [o.id, score(o)]));

/** Open the wizard on a decision, or start a new one linked to a step or a project. */
export async function openDecision(id: string | null, link: { taskId?: string; projectId?: string } = {}, screen = 0) {
  let did = id;
  if (!did && link.taskId) did = [...decisions.value.values()].find(d => d.taskId === link.taskId && d.status !== 'closed')?.id ?? null;
  if (!did) {
    const tk = link.taskId ? T(link.taskId) : undefined;
    const fields = normDecision({ title: tk?.title ?? '', taskId: link.taskId ?? null, projectId: link.projectId ?? (tk && tk.project !== 'inbox' ? tk.project : null), status: 'draft' });
    did = await createDoc<Decision>('decisions', fields);
  }
  const d = get(did);
  const start = screen || (d && d.status !== 'draft' ? 0 : d?.listClosedAt ? 2 : d?.options.length ? 1 : 0);
  openSheet(<Wizard key={did + Date.now()} id={did} start={start} />, true);
}

const COL_KEY: Record<Column, Key> = { pros: 'colPros', cons: 'colCons', prosNot: 'colProsNot', consNot: 'colConsNot' };
const PROBLEM: [keyof Problem, Key, Key][] = [
  ['what', 'probWhat', 'probWhatPh'], ['should', 'probShould', 'probShouldPh'], ['gap', 'probGap', 'probGapPh'],
  ['constraints', 'probConstraints', 'probConstraintsPh'], ['deadline', 'probDeadline', 'probDeadlinePh'], ['control', 'probControl', 'probControlPh'],
];
const MISSING: Key[] = ['optNothing', 'optDelay', 'optSmaller', 'optCombine', 'optAsk', 'optHandOff', 'optOrder'];

function Wizard({ id, start }: { id: string; start: number }) {
  const [screen, setScreen] = useState(start);
  const [oi, setOi] = useState(0);
  const d = get(id);
  if (!d) return null;
  const titles: Key[] = ['dwProblem', 'dwOptions', 'dwBalances', 'dwScores', 'dwChoice', 'dwSteps'];
  const nav = (
    <p class="eyebrow">{t('dwStep', { n: screen + 1, of: 6 })} · {t(titles[screen]!)}</p>
  );
  const body = [
    <ProblemScreen d={d} next={() => setScreen(1)} />,
    <OptionsScreen d={d} back={() => setScreen(0)} next={() => setScreen(2)} />,
    <BalanceScreen d={d} oi={oi} setOi={setOi} back={() => setScreen(1)} next={() => setScreen(3)} />,
    <ScoresScreen d={d} back={() => setScreen(2)} next={() => setScreen(4)} />,
    <ChoiceScreen d={d} back={() => setScreen(3)} next={() => setScreen(5)} />,
    <StepsScreen d={d} back={() => setScreen(4)} />,
  ][screen];
  return <div class="flow" data-testid={'dw-' + screen}>{nav}{body}</div>;
}

/**
 * Decision help (brief §9): the AI drafts problem lines, suggests options or column items.
 * Each proposal is a line to tick; items start at weight 3, marked as suggestions. No weights.
 */
function DecisionAi({ d, what, option, label, onApplied }: { d: D; what: Exclude<DecisionAsk, 'steps'>; option?: string; label: string; onApplied?: () => void }) {
  const ai = useAi();
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [rv, setRv] = useState<{ plan: ChangePlan; note: string } | null>(null);
  if (!aiOn.value) return null;
  const go = async () => {
    const { system, user } = decisionPrompt(d, what, what === 'problem' ? descRef.current?.value ?? '' : option);
    const r = await ai.run(signal => ask('decision', 'quick', system, user, DecisionReply, { signal }));
    if (!r) return;
    const cs = decisionChangeSet(r, d, what, option);
    if (!cs) { toast(r.note || t('chgNoneLeft')); return; }
    const plan = prepareReview(cs);
    if (plan) setRv({ plan, note: cs.note });
  };
  if (rv) return <ReviewList plan={rv.plan} note={rv.note} inline onApplied={n => { setRv(null); if (n) onApplied?.(); }} />;
  return (
    <div class="ai-help">
      {what === 'problem' && (
        <label class="field"><span>{t('aiDescribe')}</span>
          <textarea rows={3} ref={descRef} placeholder={t('aiDescribePh')} data-testid="ai-dw-describe" />
        </label>
      )}
      <AiAction ai={ai} label={label} onClick={() => void go()} testid={'ai-dw-' + what} />
    </div>
  );
}

function ProblemScreen({ d, next }: { d: D; next: () => void }) {
  const [v, setV] = useState(0);
  const set = (k: keyof Problem, v: string) => void save(d.id, { problem: { ...d.problem, [k]: v } });
  const split = async () => {
    await createDoc<Decision>('decisions', normDecision({ title: '', projectId: d.projectId, taskId: null, status: 'draft' }));
    toast(t('splitDone'));
  };
  return (
    <div>
      <h3>{t('dwProblemQ')}</h3>
      <DecisionAi d={d} what="problem" label={t('aiDraftProblem')} onApplied={() => setV(v + 1)} />
      <div key={v}>
      <label class="field"><span>{t('decisionTitle')}</span><input type="text" defaultValue={d.title} placeholder={t('decisionTitlePh')} onChange={e => void save(d.id, { title: (e.target as HTMLInputElement).value.trim() })} data-testid="dw-title" /></label>
      {PROBLEM.map(([k, label, ph]) => (
        <label class="field"><span>{t(label)}</span><textarea rows={2} defaultValue={d.problem[k]} placeholder={t(ph)} onChange={e => set(k, (e.target as HTMLTextAreaElement).value)} data-testid={'dw-prob-' + k} /></label>
      ))}
      </div>
      <div class="actions">
        <button class="btn primary" type="button" onClick={next} data-testid="dw-next">{t('next_')}</button>
        <button class="btn ghost" type="button" onClick={() => void split()}>{t('twoProblems')}</button>
      </div>
    </div>
  );
}

function OptionsScreen({ d, back, next }: { d: D; back: () => void; next: () => void }) {
  const [name, setName] = useState('');
  const [fact, setFact] = useState('');
  const [needFact, setNeedFact] = useState(false);
  const [screening, setScreening] = useState<string | null>(null);
  const closed = !!d.listClosedAt;
  const addOpt = (n: string) => {
    if (!n.trim()) return;
    if (closed && !needFact) { setNeedFact(true); setName(n); return; }
    const o: Option = { id: newId('o'), name: n.trim(), screened: null, pros: [], cons: [], prosNot: [], consNot: [] };
    const p: Partial<Decision> = { options: [...d.options, o] };
    if (closed) p.newFacts = [...d.newFacts, { at: new Date().toISOString(), text: fact.trim() }];
    void save(d.id, p);
    setName(''); setFact(''); setNeedFact(false);
  };
  const setOpt = (oid: string, p: Partial<Option>) => void save(d.id, { options: d.options.map(o => (o.id === oid ? { ...o, ...p } : o)) });
  const have = new Set(d.options.map(o => o.name));
  return (
    <div>
      <h3>{closed ? t('dwOptionsClosed') : t('dwOptionsQ')}</h3>
      <p class="hint">{closed ? t('dwOptionsClosedHint') : t('dwOptionsHint')}</p>
      <ul class="mini">{d.options.map(o => (
        <li class={o.screened ? 'screened' : ''}>
          <span>{o.name}{o.screened && <small class="muted"> · {t('screenedOut', { why: o.screened })}</small>}</span>
          {o.screened ? <button type="button" class="btn small ghost" onClick={() => setOpt(o.id, { screened: null })}>{t('bringBack')}</button>
            : screening === o.id ? (
              <form class="row-inline" onSubmit={e => { e.preventDefault(); const v = ((e.currentTarget as HTMLFormElement).elements.namedItem('why') as HTMLInputElement).value.trim(); if (v) { setOpt(o.id, { screened: v }); setScreening(null); } }}>
                <input type="text" name="why" placeholder={t('impossibleWhy')} aria-label={t('impossibleWhy')} autoFocus /><button class="btn small" type="submit">{t('ok')}</button>
              </form>
            ) : <button type="button" class="btn small ghost" onClick={() => setScreening(o.id)}>{t('screenOut')}</button>}
        </li>
      ))}</ul>
      {needFact ? (
        <div class="field"><span>{t('newFactQ')}</span>
          <div class="row-inline"><input type="text" value={fact} onInput={e => setFact((e.target as HTMLInputElement).value)} placeholder={t('newFactPh')} autoFocus />
            <button class="btn small" type="button" disabled={!fact.trim()} onClick={() => addOpt(name)}>{t('add')}</button></div>
        </div>
      ) : (
        <form class="row-inline" style="margin-top:10px" onSubmit={e => { e.preventDefault(); addOpt(name); }}>
          <input type="text" value={name} onInput={e => setName((e.target as HTMLInputElement).value)} placeholder={t('optionPh')} aria-label={t('optionPh')} data-testid="dw-option" />
          <button class="btn small" type="submit">{t('add')}</button>
        </form>
      )}
      {!closed && (
        <div class="field"><span>{t('usualMissing')}</span>
          <div class="chips-pick">{MISSING.map(k => <button type="button" disabled={have.has(t(k))} onClick={() => addOpt(t(k))}>+ {t(k)}</button>)}</div>
        </div>
      )}
      {!closed && <DecisionAi d={d} what="options" label={t('aiSuggestOptions')} />}
      <div class="actions">
        <button class="btn ghost" type="button" onClick={back}>{t('back')}</button>
        {closed ? <button class="btn primary" type="button" onClick={next}>{t('next_')}</button>
          : <button class="btn primary" type="button" disabled={d.options.filter(o => !o.screened).length < 2} onClick={() => { void save(d.id, { listClosedAt: new Date().toISOString() }); next(); }} data-testid="dw-close-list">{t('closeList')}</button>}
      </div>
    </div>
  );
}

function Weight({ w, onChange, label }: { w: number; onChange: (w: number) => void; label: string }) {
  return (
    <span class="weights" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map(n => <button type="button" aria-pressed={w === n} onClick={() => onChange(n)} aria-label={t('weightN', { n })}>{n}</button>)}
    </span>
  );
}

/** Re-weighing writes a score snapshot, so the person sees how the balance moved. */
function saveOptions(d: D, options: Option[], snapshot: boolean) {
  const p: Partial<Decision> = { options };
  if (snapshot && d.listClosedAt) p.history = [...d.history, { at: new Date().toISOString(), scores: scoresOf({ options }) }];
  return save(d.id, p);
}

function BalanceScreen({ d, oi, setOi, back, next }: { d: D; oi: number; setOi: (n: number) => void; back: () => void; next: () => void }) {
  const live = d.options.filter(o => !o.screened);
  const o = live[Math.min(oi, live.length - 1)];
  if (!o) return <div><p class="hint">{t('noOptions')}</p><div class="actions"><button class="btn" type="button" onClick={back}>{t('back')}</button></div></div>;
  const all = live.flatMap(x => COLUMNS.flatMap(c => x[c].map(i => ({ ...i, opt: x.name }))));
  const put = (c: Column, items: Item[], snap = true) => void saveOptions(d, d.options.map(x => (x.id === o.id ? { ...x, [c]: items } : x)), snap);
  const idx = live.indexOf(o);
  return (
    <div>
      <h3>{t('balanceFor', { name: o.name })}</h3>
      <p class="hint">{t('balanceHint')} <b>{t('scoreIs', { n: score(o) })}</b></p>
      {COLUMNS.map(c => (
        <section class="col" data-col={c}>
          <h4>{t(COL_KEY[c])}</h4>
          {c === 'prosNot' && <p class="hint">{t('prosNotHint')}</p>}
          <ul class="items-w">{o[c].map(i => (
            <li>
              <span class={i.mirrorOf ? 'muted' : ''}>{i.text}{i.mirrorOf && <small> · {t('mirrorOfShort')}</small>}{i.by === 'ai' && <small class="suggested" title={t('aiSuggestedHint')}>{t('aiSuggested')}</small>}</span>
              <Weight w={i.w} label={t('weightOf', { what: i.text })} onChange={w => put(c, o[c].map(x => (x.id === i.id ? { ...x, w, by: 'me' } : x)))} />
              <select aria-label={t('mirrorOf')} value={i.mirrorOf ?? ''} onChange={e => put(c, o[c].map(x => (x.id === i.id ? { ...x, mirrorOf: (e.target as HTMLSelectElement).value || null } : x)))}>
                <option value="">{t('notAMirror')}</option>
                {all.filter(x => x.id !== i.id).map(x => <option value={x.id}>{t('mirrorOfItem', { what: x.text.slice(0, 30), opt: x.opt })}</option>)}
              </select>
              <button type="button" class="chip-x" onClick={() => put(c, o[c].filter(x => x.id !== i.id))} aria-label={t('remove', { what: i.text })}>×</button>
            </li>
          ))}</ul>
          <form class="row-inline" onSubmit={e => {
            e.preventDefault();
            const f = e.currentTarget as HTMLFormElement;
            const v = (f.elements.namedItem('text') as HTMLInputElement).value.trim();
            if (!v) return;
            put(c, [...o[c], { id: newId('i'), text: v, w: 3, by: 'me' }], false);
            f.reset();
          }}>
            <input type="text" name="text" placeholder={t('addItemPh')} aria-label={t('addItemTo', { col: t(COL_KEY[c]) })} autocomplete="off" />
            <button class="btn small" type="submit">{t('add')}</button>
          </form>
        </section>
      ))}
      <DecisionAi key={o.id} d={d} what="items" option={o.name} label={t('aiSuggestItems')} />
      <div class="actions">
        <button class="btn ghost" type="button" onClick={() => (idx > 0 ? setOi(idx - 1) : back())}>{t('back')}</button>
        {idx < live.length - 1 ? <button class="btn primary" type="button" onClick={() => setOi(idx + 1)} data-testid="dw-next-option">{t('nextOption', { name: live[idx + 1]!.name })}</button>
          : <button class="btn primary" type="button" onClick={next} data-testid="dw-next">{t('seeScores')}</button>}
      </div>
    </div>
  );
}

function Bars({ d }: { d: Pick<Decision, 'options'> }) {
  const r = ranked(d.options);
  const max = Math.max(1, ...r.map(x => Math.abs(x.score)));
  return (
    <ul class="bars" data-testid="dw-bars">{r.map(x => (
      <li><span>{x.option.name}</span><span class="bar-track"><i class={x.score < 0 ? 'neg' : ''} style={{ width: Math.round((Math.abs(x.score) / max) * 100) + '%' }} /></span><b>{x.score}</b></li>
    ))}</ul>
  );
}

function ScoresScreen({ d, back, next }: { d: D; back: () => void; next: () => void }) {
  const r = ranked(d.options);
  const close = tooClose(r.map(x => x.score));
  const pick = (o: Option) => { void save(d.id, { chosenId: o.id, chosen: o.name }); next(); };
  return (
    <div>
      <h3>{t('dwScoresQ')}</h3>
      <p class="hint">{t('scoreFormula')}</p>
      <Bars d={d} />
      {close && r.length >= 2 ? (
        <div class="notice" data-testid="dw-regret">
          <p><b>{t('regretQ')}</b></p>
          <div class="actions">{r.slice(0, 2).map(x => <button class="btn" type="button" onClick={() => pick(x.option)}>{x.option.name}</button>)}</div>
        </div>
      ) : null}
      <div class="actions">
        <button class="btn ghost" type="button" onClick={back}>{t('back')}</button>
        {r[0] && <button class="btn primary" type="button" onClick={() => pick(r[0]!.option)} data-testid="dw-next">{t('chooseTop', { name: r[0].option.name })}</button>}
      </div>
    </div>
  );
}

function ChoiceScreen({ d, back, next }: { d: D; back: () => void; next: () => void }) {
  const live = d.options.filter(o => !o.screened);
  const [chosen, setChosen] = useState(d.chosenId ?? ranked(d.options)[0]?.option.id ?? '');
  const [review, setReview] = useState(d.reviewOn ?? addDays(today.value, 30));
  const submit = async (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const v = (n: string) => (f.elements.namedItem(n) as HTMLTextAreaElement).value.trim();
    const o = live.find(x => x.id === chosen);
    if (!o) return;
    const first = d.status === 'draft' || d.status === 'reviewing';
    await save(d.id, { chosenId: o.id, chosen: o.name, why: v('why'), mustBeTrue: v('must'), falsifier: v('falsifier'), reviewOn: review, date: d.date ?? today.value, status: 'decided' });
    if (first) { celebrate('decision', null, 'S', 0); showMoment('decision', d.title || o.name); }
    next();
  };
  return (
    <form onSubmit={e => void submit(e)}>
      <h3>{t('dwChoiceQ')}</h3>
      <label class="field"><span>{t('chosenOption')}</span>
        <select value={chosen} onChange={e => setChosen((e.target as HTMLSelectElement).value)}>{live.map(o => <option value={o.id}>{o.name} ({score(o)})</option>)}</select>
      </label>
      <label class="field"><span>{t('whyField')}</span><textarea name="why" rows={2} defaultValue={d.why} /></label>
      <label class="field"><span>{t('mustBeTrue')}</span><textarea name="must" rows={2} defaultValue={d.mustBeTrue} /></label>
      <label class="field"><span>{t('falsifierField')}</span><textarea name="falsifier" rows={2} defaultValue={d.falsifier} /></label>
      <div class="field"><span>{t('checkOnField')}</span>
        <DayPick value={review} onPick={k => k && setReview(k)} extra={[[t('inWeeks', { n: 2 }), addDays(today.value, 14)], [t('inMonths', { n: 1 }), addDays(today.value, 30)], [t('inMonths', { n: 3 }), addDays(today.value, 91)]]} />
        <p class="hint">{t('checkOn', { date: fmtDate(review) })}</p>
      </div>
      <div class="actions">
        <button class="btn ghost" type="button" onClick={back}>{t('back')}</button>
        <button class="btn primary" type="submit" data-testid="dw-decide">{t('decide')}</button>
      </div>
    </form>
  );
}

function StepsScreen({ d, back }: { d: D; back: () => void }) {
  const [steps, setSteps] = useState<{ title: string; starter: string; est: string; est0?: number | null }[]>([]);
  const ai = useAi();
  const [smartRv, setSmartRv] = useState<{ plan: ChangePlan; note: string } | null>(null);
  const [sv, setSv] = useState(0);
  const [draft, setDraft] = useState({ title: '', starter: '', est: '' });
  const [when, setWhen] = useState<'today' | 'tomorrow' | 'none'>('today');
  const [pid, setPid] = useState(d.projectId ?? '');
  const projs = [...projects.value.values()].filter(p => p.status !== 'done' && p.status !== 'dropped' && p.id !== 'inbox');
  const task = d.taskId ? T(d.taskId) : undefined;
  const newProject = async () => {
    const id = await createDoc<Project>('projects', { name: d.title || d.chosen || t('decisions'), suit: task?.suit ?? 'S', where: task?.where ?? 'any', goal: null, goalBy: null, due: null, order: Date.now(), status: 'active', created: new Date().toISOString() });
    setPid(id);
    void save(d.id, { projectId: id });
  };
  const finish = async () => {
    const project = pid || 'inbox';
    const ids: string[] = [];
    let prev: string | null = null;
    for (const s of steps) {
      const id: string = await createTask(newTaskDoc(s.title, task?.suit ?? projects.value.get(project)?.suit ?? null, project, {
        starter: s.starter || null, est: Number(s.est) || null, estBy: estByOf(s.est, s.est0 ?? null), after: prev, important: true, order: Date.now() + ids.length,
      }));
      ids.push(id);
      prev = id;
    }
    await save(d.id, { taskIds: [...d.taskIds, ...ids], projectId: pid || d.projectId });
    if (ids[0] && when !== 'none') await addToday(ids[0], true, when === 'today' ? today.value : addDays(today.value, 1));
    closeSheet();
    if (task && task.status === 'open') openDone(task.id);
    else toast(t('decisionSaved'));
  };
  // Decision help: steps join the draft list (to edit or remove); a SMART goal is ticked.
  const draft_ = async () => {
    const { system, user } = decisionPrompt(d, 'steps');
    const r = await ai.run(signal => ask('decision', 'quick', system, user, DecisionReply, { signal }));
    if (!r) return;
    setSteps([...steps, ...(r.steps ?? []).map(x => ({ title: x.title, starter: x.starter ?? '', est: x.est ? String(x.est) : '', est0: x.est ?? null }))]);
    const cs = decisionChangeSet(r, { ...d, projectId: pid || null }, 'steps');
    const plan = cs && prepareReview(cs);
    if (plan) setSmartRv({ plan, note: '' });
  };
  return (
    <div>
      <h3>{t('dwStepsQ')}</h3>
      <p class="hint">{t('dwStepsHint', { chosen: d.chosen ?? '' })}</p>
      <label class="field"><span>{t('project')}</span>
        <div class="row-inline">
          <select value={pid} onChange={e => { const v = (e.target as HTMLSelectElement).value; setPid(v); void save(d.id, { projectId: v || null }); }}>
            <option value="">{t('inbox')}</option>{projs.map(p => <option value={p.id}>{p.name}</option>)}
          </select>
          <button class="btn small" type="button" onClick={() => void newProject()}>{t('newProject')}</button>
        </div>
      </label>
      <ol class="mini" data-testid="dw-steps">{steps.map((s, i) => <li><span>{s.title}{Number(s.est) ? ' · ' + fmtMin(Number(s.est)) : ''}{s.starter ? ' · ' + s.starter : ''}{s.est0 != null && <small class="suggested">{t('aiSuggested')}</small>}</span><button type="button" class="chip-x" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label={t('remove', { what: s.title })}>×</button></li>)}</ol>
      <form class="stepform" onSubmit={e => { e.preventDefault(); if (draft.title.trim()) { setSteps([...steps, { ...draft, title: draft.title.trim() }]); setDraft({ title: '', starter: '', est: '' }); } }}>
        <input type="text" value={draft.title} onInput={e => setDraft({ ...draft, title: (e.target as HTMLInputElement).value })} placeholder={t('newStepPlaceholder')} aria-label={t('newStep')} data-testid="dw-step" />
        <input type="text" value={draft.starter} onInput={e => setDraft({ ...draft, starter: (e.target as HTMLInputElement).value })} placeholder={t('starterPh')} aria-label={t('starterField')} />
        <input type="number" min="1" max="600" value={draft.est} onInput={e => setDraft({ ...draft, est: (e.target as HTMLInputElement).value })} placeholder={t('minShort')} aria-label={t('estimateMin')} />
        <button class="btn small" type="submit">{t('add')}</button>
      </form>
      {smartRv ? <ReviewList plan={smartRv.plan} note={smartRv.note} inline onApplied={() => { setSmartRv(null); setSv(sv + 1); }} />
        : <AiAction ai={ai} label={t('aiDraftSteps')} onClick={() => void draft_()} testid="ai-dw-steps" />}
      {pid && <details class="more" open={sv > 0}><summary>{t('smartGoalFor', { name: projects.value.get(pid)?.name ?? '' })}</summary><SmartEditor key={sv} projectId={pid} /></details>}
      <div class="field"><span>{t('firstStepWhen')}</span>
        <div class="seg" role="group" style="flex-wrap:wrap">
          {(['today', 'tomorrow', 'none'] as const).map(w => <button type="button" aria-pressed={when === w} onClick={() => setWhen(w)}>{t(w === 'today' ? 'pickToday' : w === 'tomorrow' ? 'pickTomorrow' : 'notYet')}</button>)}
        </div>
      </div>
      <div class="actions">
        <button class="btn ghost" type="button" onClick={back}>{t('back')}</button>
        <button class="btn primary" type="button" onClick={() => void finish()} data-testid="dw-finish">{task?.status === 'open' ? t('finishAndDone') : t('finish')}</button>
      </div>
    </div>
  );
}

// ---------- the decision page, the check, re-weighing ----------
export function openDecisionPage(id: string, check = false) {
  openSheet(<Page key={'dp' + id + Date.now()} id={id} check={check} />, true);
}

/** The check on the review date. Yes: reopen from the options with the new fact, keeping the old version. No: next check, or close. */
export async function reviewDecision(id: string, happened: true, fact: string): Promise<void>;
export async function reviewDecision(id: string, happened: false, next: string | null): Promise<void>;
export async function reviewDecision(id: string, happened: boolean, arg: string | null): Promise<void> {
  const d = get(id);
  if (!d) return;
  if (happened) {
    const { id: _id, previous, ...snap } = d;
    await save(id, {
      previous: [...(previous ?? []), snap], status: 'reviewing', newFacts: [...d.newFacts, { at: new Date().toISOString(), text: (arg ?? '').trim() }],
      reviews: [...d.reviews, { on: today.value, falsifierHappened: true, note: (arg ?? '').trim() }], listClosedAt: null,
    });
  } else await save(id, { reviews: [...d.reviews, { on: today.value, falsifierHappened: false, note: '' }], ...(arg ? { reviewOn: arg } : { status: 'closed' }) });
}

function Page({ id, check }: { id: string; check: boolean }) {
  const d = get(id);
  const [mode, setMode] = useState<'view' | 'yes' | 'no'>('view');
  const [fact, setFact] = useState('');
  if (!d) return null;
  const due = d.status === 'decided' && !!d.reviewOn && d.reviewOn <= today.value;
  const yes = async () => {
    await reviewDecision(id, true, fact);
    void openDecision(id, {}, 1);
  };
  const no = async (next: string | null) => {
    await reviewDecision(id, false, next);
    closeSheet();
    toast(next ? t('nextCheck', { date: fmtDate(next) }) : t('decisionClosed'));
  };
  return (
    <div data-testid="decision-page">
      <p class="eyebrow">{t(('dst_' + d.status) as Key)}</p>
      <h3>{d.title || t('untitledDecision')}</h3>
      {(check || due) && d.status === 'decided' && (
        <div class="notice" data-testid="dp-check">
          <p><b>{t('falsifierQ')}</b></p>
          {d.falsifier && <p class="quote">{d.falsifier}</p>}
          {mode === 'view' && <div class="actions"><button class="btn" type="button" onClick={() => setMode('yes')}>{t('yesItHappened')}</button><button class="btn" type="button" onClick={() => setMode('no')}>{t('noItDidnt')}</button></div>}
          {mode === 'yes' && <div class="field"><span>{t('newFactQ')}</span><div class="row-inline"><input type="text" value={fact} onInput={e => setFact((e.target as HTMLInputElement).value)} autoFocus /><button class="btn small" type="button" disabled={!fact.trim()} onClick={() => void yes()}>{t('reopenDecision')}</button></div></div>}
          {mode === 'no' && <div class="field"><span>{t('nextCheckQ')}</span><DayPick value={null} extra={[[t('inMonths', { n: 1 }), addDays(today.value, 30)], [t('inMonths', { n: 3 }), addDays(today.value, 91)]]} onPick={k => k && void no(k)} />
            <div class="actions"><button class="btn ghost" type="button" onClick={() => void no(null)}>{t('closeDecision')}</button></div></div>}
        </div>
      )}
      {d.chosen && <p class="chosen">{t('chosen', { what: d.chosen })}{d.reviewOn ? ' · ' + t('checkOn', { date: fmtDate(d.reviewOn) }) : ''}</p>}
      {d.why && <p class="meta">{t('whyField')}: {d.why}</p>}
      {d.mustBeTrue && <p class="meta">{t('mustBeTrue')}: {d.mustBeTrue}</p>}
      {d.falsifier && <p class="meta">{t('revisitIf', { what: d.falsifier })}</p>}
      {Object.values(d.problem).some(Boolean) && (
        <dl class="problem">{PROBLEM.filter(([k]) => d.problem[k]).map(([k, label]) => <><dt>{t(label)}</dt><dd>{d.problem[k]}</dd></>)}</dl>
      )}
      <h2 class="sec">{t('dwScores')}</h2>
      <Bars d={d} />
      {d.options.map(o => (
        <details class="optdetail" open={o.id === d.chosenId}>
          <summary>{o.name} · {o.screened ? t('screenedOut', { why: o.screened }) : score(o)}</summary>
          <div class="cols4">{COLUMNS.map(c => (
            <div><h4>{t(COL_KEY[c])}</h4><ul>{o[c].map(i => <li class={i.mirrorOf ? 'muted' : ''}>{i.text} <b>{i.w}</b></li>)}</ul></div>
          ))}</div>
        </details>
      ))}
      {d.history.length > 0 && (
        <>
          <h2 class="sec">{t('howBalanceMoved')}</h2>
          <ul class="mini">{d.history.slice(-8).map(h => <li><span>{fmtDate(h.at.slice(0, 10))} · {d.options.filter(o => o.id in h.scores).map(o => o.name + ' ' + h.scores[o.id]).join(' · ')}</span></li>)}</ul>
        </>
      )}
      {d.newFacts.length > 0 && <><h2 class="sec">{t('newFacts')}</h2><ul class="mini">{d.newFacts.map(f => <li><span>{fmtDate(f.at.slice(0, 10))} · {f.text}</span></li>)}</ul></>}
      <div class="actions">
        <button class="btn" type="button" onClick={() => void openDecision(id, {}, 2)}>{t('reweigh')}</button>
        <button class="btn" type="button" onClick={() => void openDecision(id, {}, d.status === 'draft' ? 0 : 4)}>{d.status === 'draft' ? t('continueDecision') : t('editChoice')}</button>
        {d.status !== 'closed' && <button class="btn ghost" type="button" onClick={() => void save(id, { status: 'closed' }).then(closeSheet)}>{t('closeDecision')}</button>}
      </div>
    </div>
  );
}

/** Decisions, grouped: open, to check, decided, closed. */
export function decisionGroups() {
  const all = [...decisions.value.values()] as D[];
  const k = today.value;
  return {
    open: all.filter(d => d.status === 'draft' || d.status === 'reviewing'),
    check: all.filter(d => d.status === 'decided' && d.reviewOn && d.reviewOn <= k),
    decided: all.filter(d => d.status === 'decided' && !(d.reviewOn && d.reviewOn <= k)),
    closed: all.filter(d => d.status === 'closed'),
  };
}
