// The Sunday review (brief §5, METHOD "The weekly review"): the eight steps, one question per
// screen, plus the Later allotment, ending with how the week's estimates compared with reality.
import { useState } from 'preact/hooks';
import { tasks, projects, today, here, sessions, decisions } from '../app/store';
import { T, isOpen, quad, inPlace, byPriority, byOrder, rawPlan, dayDoc, estPoints, type T as Tk } from '../app/model';
import { patchTask, dropTask, planOn, cloneTemplate, dayPatch, dueOn } from '../app/actions';
import { openSheet, closeSheet } from '../app/sheet';
import { Title, quadName } from '../app/ui';
import { SmartEditor, smartFilled } from '../app/smart';
import { reviewDecision } from './decision';
import { t, fmtDate, type Key } from '../i18n';
import { addDays } from '../domain/dates';
import { moveTo, firstCalmDay } from '../domain/moves';
import { medianRatio } from '../domain/estimates';
import { settings } from '../app/store';
import type { Quadrant } from '../domain/tasks';
import type { Task } from '../data/schema';
import { ask } from '../ai/ask';
import { ReviewReply, reviewChangeSet } from '../ai/features';
import { reviewPrompt } from '../ai/prompts';
import { useAi, AiAction } from '../ai/ui';
import { prepareReview, ReviewList } from '../ai/Review';
import { OfferChips, offerFieldsFor, type OfferChoice } from '../app/OfferChips';
import type { Plan as ChangePlan } from '../ai/apply';

export function openReview() {
  openSheet(<Review key={'rv' + Date.now()} />, true);
}

const STEPS: Key[] = ['rv1', 'rv2', 'rv3', 'rv4', 'rv5', 'rv6', 'rv7', 'rv8', 'rvLater', 'rvEnd'];
const week = () => Array.from({ length: 7 }, (_, i) => addDays(today.value, i + 1));
const dayLabel = (k: string) => fmtDate(k, { weekday: 'short', day: 'numeric' });

function DaySelect({ value, onPick, label }: { value: string; onPick: (k: string) => void; label: string }) {
  return (
    <select value={value} aria-label={label} onChange={e => { const v = (e.target as HTMLSelectElement).value; if (v) onPick(v); }}>
      <option value="">{t('noDay')}</option>
      {week().map(k => <option value={k}>{dayLabel(k)}</option>)}
    </select>
  );
}
/** The first day this week a step is planned on, if any. */
const plannedDay = (id: string) => week().find(k => rawPlan(k).includes(id)) ?? '';

/** Move between quadrants inline: a date, or "it blocks", only when the move needs one. */
function Resort({ tk }: { tk: Tk }) {
  const [ask, setAsk] = useState<{ q: Quadrant; kind: 'dueOrBlocker' | 'newDue'; patch: Partial<Task> } | null>(null);
  const k = today.value, w = settings.value.urgencyDays;
  const go = (q: Quadrant) => {
    const m = moveTo(tk, q, k, w);
    if (m.ask) setAsk({ q, kind: m.ask, patch: m.patch });
    else void patchTask(tk.id, m.patch);
  };
  return (
    <li>
      <div><p><Title s={tk.title} /></p>
        <div class="seg small" role="group" aria-label={t('moveTo')}>
          {([1, 2, 3, 4] as Quadrant[]).map(q => <button type="button" aria-pressed={quad(tk) === q} onClick={() => go(q)}>{quadName(q)}</button>)}
        </div>
        {ask && (
          <div class="row-inline" style="margin-top:6px">
            <input type="date" aria-label={t('dueField')} defaultValue={ask.kind === 'newDue' ? firstCalmDay(k, w) : addDays(k, 7)} onChange={e => { const v = (e.target as HTMLInputElement).value; void patchTask(tk.id, { ...ask.patch, due: v || null, dueRule: null }); setAsk(null); }} />
            {ask.kind === 'dueOrBlocker' ? <button class="btn small" type="button" onClick={() => { void patchTask(tk.id, { ...ask.patch, urgent: true }); setAsk(null); }}>{t('itBlocks')}</button>
              : <button class="btn small" type="button" onClick={() => { void patchTask(tk.id, { ...ask.patch, due: null }); setAsk(null); }}>{t('pickClear')}</button>}
          </div>
        )}
      </div>
    </li>
  );
}

function Review() {
  const [i, setI] = useState(0);
  const [later, setLater] = useState<Record<string, string>>({});
  // The offer picked for each standing obligation before it is given a day (brief §5, Feeding the plan).
  const [offers, setOffers] = useState<Record<string, OfferChoice>>({});
  const place = here.value;
  const open = [...tasks.value.values()].filter(x => isOpen(x) && inPlace(x, place)).sort(byPriority);
  const next = () => setI(Math.min(STEPS.length - 1, i + 1));
  const back = () => setI(Math.max(0, i - 1));
  const nav = (last = false) => (
    <div class="actions">
      {i > 0 && <button class="btn ghost" type="button" onClick={back}>{t('back')}</button>}
      {!last && <button class="btn primary" type="button" onClick={next} data-testid="rv-next">{t('next_')}</button>}
    </div>
  );
  let body;
  switch (STEPS[i]) {
    case 'rv1':
      body = <><p class="hint">{t('rv1Hint')}</p><ul class="picklist">{open.slice(0, 40).map(x => <Resort key={x.id} tk={x} />)}</ul></>;
      break;
    case 'rv2': {
      const cands = open.filter(x => quad(x) >= 3);
      body = <><p class="hint">{t('rv2Hint')}</p><ul class="picklist">{cands.map(x => <li><div><p><Title s={x.title} /></p><p class="meta">{quadName(quad(x))}</p></div><button class="btn small" type="button" onClick={() => void dropTask(x.id)}>{t('dropIt')}</button></li>)}</ul>{!cands.length && <p class="hint">{t('nothingHere')}</p>}</>;
      break;
    }
    case 'rv3': {
      const inbox = [...tasks.value.values()].filter(x => isOpen(x) && x.project === 'inbox');
      const projs = [...projects.value.values()].filter(p => p.status === 'active' && p.id !== 'inbox').sort(byOrder);
      body = <><p class="hint">{t('rv3Hint')}</p><ul class="picklist">{inbox.map(x => (
        <li><div><p><Title s={x.title} /></p></div>
          <select aria-label={t('project')} value="inbox" onChange={e => void patchTask(x.id, { project: (e.target as HTMLSelectElement).value })}>
            <option value="inbox">{t('inbox')}</option>{projs.map(p => <option value={p.id}>{p.name}</option>)}
          </select></li>
      ))}</ul>{!inbox.length && <p class="hint">{t('inboxEmpty')}</p>}</>;
      break;
    }
    case 'rv4': {
      const projs = [...projects.value.values()].filter(p => p.status === 'active' && p.id !== 'inbox').sort(byOrder);
      body = <><p class="hint">{t('rv4Hint')}</p>{projs.map(p => {
        const nx = [...tasks.value.values()].filter(x => x.project === p.id && isOpen(x)).sort(byOrder)[0];
        return (
          <details class="proj-rv">
            <summary><b>{p.name}</b> · {t('smartN', { n: smartFilled(p.smart) })}</summary>
            {nx ? <label class="field"><span>{t('nextStepField')}</span><input type="text" defaultValue={nx.title} onChange={e => void patchTask(nx.id, { title: (e.target as HTMLInputElement).value.trim() || nx.title })} /></label>
              : <p class="hint">{t('noNextStep')}</p>}
            <ProjectAi id={p.id} />
          </details>
        );
      })}</>;
      break;
    }
    case 'rv5': {
      const prot = open.filter(x => quad(x) === 2);
      body = <><p class="hint">{t('rv5Hint')}</p><WeekStrip /><ul class="picklist">{prot.slice(0, 20).map(x => (
        <li><div><p><Title s={x.title} /></p></div><DaySelect label={t('planItOn')} value={plannedDay(x.id)} onPick={k => void planOn(x.id, k)} /></li>
      ))}</ul></>;
      break;
    }
    case 'rv6': {
      const obl = [...tasks.value.values()].filter(x => x.template && x.status !== 'dropped' && inPlace(x, place)).sort(byOrder);
      body = <><p class="hint">{t('rv6Hint')}</p><WeekStrip /><ul class="picklist">{obl.map(x => (
        <li><div><p><Title s={x.title} /></p><OfferChips offer={x.offer} value={offers[x.id]} onChange={c => setOffers({ ...offers, [x.id]: c })} place={place} /></div>
          <DaySelect label={t('planItOn')} value="" onPick={k => void cloneTemplate(x.id, k, x.at ?? settings.value.obligationAt, offerFieldsFor(offers[x.id]))} /></li>
      ))}</ul>{!obl.length && <p class="hint">{t('noObligations')}</p>}</>;
      break;
    }
    case 'rv7': {
      const decs = open.filter(x => x.kind === 'decision');
      body = <><p class="hint">{t('rv7Hint')}</p><ul class="picklist">{decs.map(x => (
        <li><div><p><Title s={x.title} /></p>{x.due && <p class="meta">{fmtDate(x.due)}</p>}</div><DaySelect label={t('dueField')} value={week().includes(x.due ?? '') ? x.due! : ''} onPick={k => void dueOn(x.id, k)} /></li>
      ))}</ul>{!decs.length && <p class="hint">{t('noDecisionSteps')}</p>}</>;
      break;
    }
    case 'rv8': {
      const due = [...decisions.value.values()].filter(d => d.status === 'decided' && d.reviewOn && d.reviewOn <= addDays(today.value, 7));
      body = <><p class="hint">{t('rv8Hint')}</p><ul class="picklist">{due.map(d => <DecisionCheck key={d.id} id={d.id} />)}</ul>{!due.length && <p class="hint">{t('noChecks')}</p>}</>;
      break;
    }
    case 'rvLater': {
      const pool = open.filter(x => quad(x) === 4).sort((a, b) => String(a.created).localeCompare(String(b.created)));
      const picked = Object.entries(later).filter(([, k]) => k);
      const stale = pool.filter(x => (x.laterOffers || 0) >= 4);
      body = <>
        <p class="hint">{t('rvLaterHint')}</p>
        {stale.length > 0 && <div class="notice"><p><b>{t('laterStale')}</b></p><ul class="picklist">{stale.map(x => (
          <li><div><p><Title s={x.title} /></p>
            <div class="go" style="margin-top:6px">
              <button class="btn small" type="button" onClick={() => void patchTask(x.id, { important: true, laterOffers: 0 })}>{t('makeImportant')}</button>
              <button class="btn small" type="button" onClick={() => void patchTask(x.id, { template: true, laterOffers: 0 })}>{t('makeObligation')}</button>
              <button class="btn small ghost" type="button" onClick={() => void dropTask(x.id)}>{t('dropIt')}</button>
            </div></div></li>
        ))}</ul></div>}
        <ul class="picklist">{pool.filter(x => !stale.includes(x)).slice(0, 12).map(x => (
          <li><div><p><Title s={x.title} /></p></div>
            <DaySelect label={t('laterDay')} value={later[x.id] ?? ''} onPick={k => { if (picked.length < 2 || later[x.id]) setLater({ ...later, [x.id]: k }); }} /></li>
        ))}</ul>
        <p class="hint">{t('laterPicked', { n: picked.length })}</p>
      </>;
      break;
    }
    default:
      body = <WeekNumbers onFinish={async () => {
        const pool = open.filter(x => quad(x) === 4);
        for (const [id, k] of Object.entries(later)) {
          if (!k) continue;
          const d = dayDoc(k);
          await dayPatch(k, { optional: [...new Set([...(d?.optional ?? []), id])], plan: [...new Set([...(d?.plan ?? []), id])] });
        }
        for (const x of pool.slice(0, 12)) if (!later[x.id]) await patchTask(x.id, { laterOffers: (x.laterOffers || 0) + 1 });
        await dayPatch(today.value, { review: new Date().toISOString() });
        closeSheet();
      }} />;
  }
  return (
    <div class="flow" data-testid={'rv-' + i}>
      <p class="eyebrow">{t('rvStep', { n: i + 1, of: STEPS.length })}</p>
      <h3>{t(STEPS[i]!)}</h3>
      {body}
      {nav(i === STEPS.length - 1)}
    </div>
  );
}

/** Sunday review help: a goal, SMART lines and next steps, each ticked; goals stay "proposed" until confirmed. */
function ProjectAi({ id }: { id: string }) {
  const ai = useAi();
  const [rv, setRv] = useState<{ plan: ChangePlan; note: string } | null>(null);
  const [v, setV] = useState(0);
  const go = async () => {
    const { system, user, notes } = reviewPrompt(id);
    const r = await ai.run(signal => ask('review', 'thinking', system, user, ReviewReply, { signal, notes }));
    if (!r) return;
    const p = projects.value.get(id);
    const cs = reviewChangeSet(r, { id, where: p?.where });
    if (!cs) { ai.setErr({ error: 'empty', message: r.note || t('aiNoChanges') }); return; }
    const plan = prepareReview(cs);
    if (plan) setRv({ plan, note: cs.note });
  };
  return (
    <>
      {rv ? <ReviewList plan={rv.plan} note={rv.note} inline onApplied={() => { setRv(null); setV(v + 1); }} />
        : <AiAction ai={ai} label={t('aiProposeGoal')} onClick={() => void go()} testid="ai-review" />}
      <SmartEditor key={v} projectId={id} />
    </>
  );
}

function DecisionCheck({ id }: { id: string }) {
  const d = decisions.value.get(id);
  const [fact, setFact] = useState<string | null>(null);
  if (!d) return null;
  return (
    <li><div><p><b>{d.title}</b></p>{d.falsifier && <p class="meta">{t('revisitIf', { what: d.falsifier })}</p>}
      {fact == null ? (
        <div class="go" style="margin-top:6px">
          <button class="btn small" type="button" onClick={() => setFact('')}>{t('yesItHappened')}</button>
          <button class="btn small" type="button" onClick={() => void reviewDecision(id, false, addDays(today.value, 30))}>{t('noCheckMonth')}</button>
          <button class="btn small ghost" type="button" onClick={() => void reviewDecision(id, false, null)}>{t('closeDecision')}</button>
        </div>
      ) : (
        <div class="row-inline" style="margin-top:6px"><input type="text" value={fact} placeholder={t('newFactQ')} aria-label={t('newFactQ')} onInput={e => setFact((e.target as HTMLInputElement).value)} />
          <button class="btn small" type="button" disabled={!fact.trim()} onClick={() => void reviewDecision(id, true, fact)}>{t('reopenDecision')}</button></div>
      )}
    </div></li>
  );
}

/** The coming week, as day columns: what's planned and what's due (steps 5 and 6 happen here). */
function WeekStrip() {
  return (
    <div class="weekstrip">{week().map(k => {
      const plan = rawPlan(k).map(id => T(id)).filter(Boolean) as Tk[];
      return <div><b>{dayLabel(k)}</b>{plan.map(x => <span class={'suit-' + x.suit}>{x.title}</span>)}</div>;
    })}</div>
  );
}

/** This week's estimates against reality, overall and by app, and why the timer stopped early. */
function WeekNumbers({ onFinish }: { onFinish: () => Promise<void> }) {
  const from = addDays(today.value, -7);
  const pts = estPoints.value.filter(p => p.doneDay > from);
  const overall = medianRatio(pts);
  const apps = new Map<string, { est0: number; real: number }[]>();
  for (const p of pts) if (p.app) { const k = p.app.trim(); apps.set(k, [...(apps.get(k) ?? []), p]); }
  const why: Record<string, number> = {};
  for (const s of sessions.value.values()) if (s.d > from && s.why && !['done', 'switched', 'close'].includes(s.why)) why[s.why] = (why[s.why] ?? 0) + 1;
  const WHY: Record<string, Key> = { later: 'whyLater', focus: 'whyFocus', blocked: 'whyBlocked', interrupted: 'whyInterrupted', tired: 'whyTired' };
  const x = (r: number | null) => (r == null ? '—' : '×' + r.toFixed(1));
  return (
    <div data-testid="rv-end">
      <p class="hint">{t('rvEndHint')}</p>
      <div class="stats">
        <div class="stat"><b>{pts.length}</b><span>{t('timedThisWeek')}</span></div>
        <div class="stat"><b>{x(overall)}</b><span>{t('realOverEst')}</span></div>
      </div>
      {apps.size > 0 && <ul class="mini">{[...apps].map(([a, xs]) => <li><span>{a}: {x(medianRatio(xs))} ({xs.length})</span></li>)}</ul>}
      {Object.keys(why).length > 0 && <p class="friction" style="margin-top:10px">{t('stoppedEarly', { list: Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, n]) => (WHY[k] ? t(WHY[k]!) : k) + ' ' + n).join(' · ') })}</p>}
      <div class="actions"><button class="btn primary" type="button" onClick={() => void onFinish()} data-testid="rv-finish">{t('finishReview')}</button></div>
    </div>
  );
}
