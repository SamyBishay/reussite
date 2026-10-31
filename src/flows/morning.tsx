// The morning with an AI on (plan 2 Nov, "Morning" point 3, the owner's words of 31 Oct): the AI proposes, the person chooses. The first
// turn is a proposal in five sections worded and ranked by the AI from the candidates of `proposeDay` (src/domain/propose.ts); each item is
// kept, swapped or skipped with a tap; a short exchange adjusts it; it ends in one change-set on the existing review screen. The ritual
// (src/flows/checkin.tsx) is one tap away and unchanged.
import { useEffect, useRef, useState } from 'preact/hooks';
import { today, projects, here } from '../app/store';
import { placeName } from '../app/sheets';
import { T, proposalFor, rawPlan, personal, planEst } from '../app/model';
import { dayPatch } from '../app/actions';
import { recordPlanning } from '../app/home';
import { openSheet, closeSheet } from '../app/sheet';
import { Title, Suit, suitName } from '../app/ui';
import { withTime } from '../domain/calendar';
import { PILLARS } from '../domain/planner';
import type { MustWhy } from '../domain/propose';
import type { SuitId } from '../data/schema';
import { ask, aiOn } from '../ai/ask';
import {
  MorningReply, readMorning, setSkipped, swapOptions, swapItem, keptItems, firstKey, morningChangeSet,
  type Draft, type DraftItem, type Section,
} from '../ai/features';
import { morningPrompt } from '../ai/prompts';
import { useAi, AiError } from '../ai/ui';
import { prepareReview, ReviewList } from '../ai/Review';
import type { Plan as ChangePlan } from '../ai/apply';
import type { ChangeSet } from '../ai/changeset';
import { openCheckin } from './checkin';
import { t, fmtMin, lang, type Key } from '../i18n';

const WHY: Record<MustWhy, Key | null> = { fixed: null, overdue: 'mornWhyOverdue', dueToday: 'mornWhyDueToday', urgent: 'mornWhyUrgent', carried: 'mornWhyCarried', check: 'mornWhyCheck' };

/** The ritual (no AI), one tap from the planning screen. */
const ritual = () => { openCheckin(); };
export function openMorning() {
  openSheet(<Morning key={'mo' + Date.now()} />, true);
}
/** "Plan the day" on Home and the morning push: the conversation when an AI is set up, else the ritual. */
export function openPlanDay() {
  if (aiOn.value) openMorning(); else ritual();
}

function Morning() {
  const k = today.value;
  const [seed] = useState(() => proposalFor(k));
  const { proposal: p, known, loadFor } = seed;
  const ai = useAi();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [say, setSay] = useState('');
  const [review, setReview] = useState<{ plan: ChangePlan; cs: ChangeSet } | null>(null);
  const [empty, setEmpty] = useState(false);
  // Steps the person skipped on an earlier turn: not offered again.
  const gone = useRef(new Set<string>());
  const stop = ai.stop;
  useEffect(() => { void turn(); return () => stop(); }, []);

  /** One turn: the AI words and ranks the candidates (and, after the first, revises them as the person asks). */
  async function turn(message?: string) {
    const kept = draft ? keptItems(draft) : [];
    const skipped = draft ? [...gone.current] : [];
    const load = draft ? loadFor(kept.filter(i => i.id).map(i => i.id!), Object.fromEntries(kept.filter(i => !i.id).map(i => [i.key, i.step?.est ?? null]))) : undefined;
    const { system, user, notes } = morningPrompt(p, message === undefined ? {} : { message, kept: kept.map(i => i.id ?? 'new: ' + i.step?.title), skipped, load });
    const r = await ai.run(signal => ask('morning', 'thinking', system, user, MorningReply, { signal, notes }));
    // A failed or cancelled turn keeps what is on screen; the first one falls back on the candidates themselves, unworded.
    if (r) { setDraft(readMorning(r, p, known, gone.current)); setSwapping(null); setEmpty(false); }
    else if (!draft) setDraft(readMorning(null, p, known, gone.current));
  }

  const edit = (d: Draft) => { setDraft(d); setEmpty(false); };
  const skip = (it: DraftItem, on: boolean) => {
    if (it.id) { if (on) gone.current.add(it.id); else gone.current.delete(it.id); }
    edit(setSkipped(draft!, it.key, on));
  };
  const keptIds = (d: Draft) => keptItems(d).filter(i => i.id).map(i => i.id!);
  const loadOfDraft = (d: Draft) => loadFor(keptIds(d), Object.fromEntries(keptItems(d).filter(i => !i.id).map(i => [i.key, i.step?.est ?? null])));

  const make = () => {
    if (!draft) return;
    const kn = new Map([...known.keys()].map(id => [id, { project: T(id)?.project ?? 'inbox', where: T(id)?.where }]));
    const cs = morningChangeSet(draft, { date: k, existing: rawPlan(k), known: kn });
    if (!cs) { setEmpty(true); return; }
    const plan = prepareReview(cs);
    if (plan) setReview({ plan, cs });
  };
  /** Ticked: kept in History with its Undo; the day is marked as planned, as the ritual's Go does. */
  const applied = async (n: number, undo: Parameters<typeof recordPlanning>[2]) => {
    if (!n || !review) { setReview(null); return; }
    await recordPlanning(review.cs, n, undo);
    const kept = draft ? keptItems(draft) : [];
    const load = kept.reduce((a, i) => a + ((i.id ? (T(i.id) ? planEst(T(i.id)!) : null) : i.step?.est) ?? 0), 0);
    await dayPatch(k, { checkin: new Date().toISOString(), ...(load ? { load } : {}) });
    closeSheet();
  };

  if (review) return (
    <div class="flow" data-testid="morning-review">
      <h3>{t('planTheDay')}</h3>
      <ReviewList plan={review.plan} note={review.cs.note} inline record onApplied={(n, u) => void applied(n, u)} />
    </div>
  );

  const title = (it: DraftItem) => (it.id ? T(it.id)?.title ?? '' : it.step?.title ?? '');
  const starterOf = (it: DraftItem) => (it.id ? T(it.id)?.starter : it.step?.starter) ?? '';
  const estOf = (it: DraftItem) => {
    const x = it.id ? T(it.id) : undefined, pe = x && personal(x);
    const m = pe ? pe.value : x ? x.est : it.step?.est;
    return m ? (pe ? '~' : '') + fmtMin(m) : '';
  };

  const row = (it: DraftItem, section: Section) => {
    const why = it.why ? WHY[it.why] : null;
    const tk = it.id ? T(it.id) : undefined;
    const options = !it.locked && !it.skipped ? swapOptions(draft!, section, it, p) : [];
    const picking = swapping === it.key;
    return (
      <li data-testid="morning-item" data-key={it.key} data-state={it.locked ? 'fixed' : it.skipped ? 'skipped' : 'kept'} class={it.skipped ? 'morn-skipped' : undefined}>
        <div>
          {section === 'goals' && it.project && <p class="meta"><b>{projects.value.get(it.project)?.name ?? it.project}</b></p>}
          <p>
            {!it.skipped && starterOf(it) ? starterOf(it) + ' → ' : ''}
            <Title s={it.why === 'fixed' && tk?.at ? withTime(title(it), tk.at) : title(it)} />
            {it.step && <> <span class="tag" data-testid="morning-new">{t('mornNew')}</span></>}
          </p>
          <p class="meta">{[why ? t(why) : '', it.why === 'check' ? t('mornCheckQ') : estOf(it)].filter(Boolean).join(' · ')}</p>
          {it.line && !it.skipped && <p class="hint morn-line" data-testid="morning-line">{it.line}</p>}
          {picking && (
            <div data-testid="morning-swap">
              <p class="hint">{options.length ? t('mornSwapHint') : t('mornNoSwap')}</p>
              <ul class="picklist">{options.map(o => (
                <li><div><p><Title s={T(o.id)?.title ?? ''} />{o.project && o.project !== it.project && <span class="meta"> · {projects.value.get(o.project)?.name}</span>}</p></div>
                  <button class="btn small" type="button" onClick={() => edit(swapItem(draft!, it.key, o, known))} data-testid="morning-swap-choose">{t('choose')}</button></li>
              ))}</ul>
              <div class="actions"><button class="btn small ghost" type="button" onClick={() => setSwapping(null)}>{t('cancel')}</button></div>
            </div>
          )}
        </div>
        {!it.locked && (
          <div class="go">
            {it.skipped
              ? <button class="btn small ghost" type="button" onClick={() => skip(it, false)} data-testid="morning-keep">{t('keepIt')}</button>
              : <>
                {options.length > 0 && !picking && <button class="btn small ghost" type="button" onClick={() => setSwapping(it.key)} data-testid="morning-swap-btn">{t('swap')}</button>}
                <button class="btn small" type="button" onClick={() => skip(it, true)} data-testid="morning-skip">{t('skip')}</button>
              </>}
          </div>
        )}
      </li>
    );
  };

  const d = draft;
  const load = d ? loadOfDraft(d) : null;
  const first = d ? firstKey(d) : null;
  const firstItem = d && first ? keptItems(d).find(i => i.key === first) : undefined;
  const placeless = d && !d.here.length;
  return (
    <div class="flow morning" data-testid="morning">
      <p class="eyebrow">{t('planTheDay')}</p>
      <h3>{t('mornHint')}</h3>
      {ai.busy && <div class="go" data-testid="morning-busy"><span class="hint">{t('mornAsking')}</span><button class="btn small" type="button" onClick={ai.stop}>{t('stop')}</button></div>}
      {ai.err && !ai.busy && <AiError {...ai.err} manual={ritual} manualLabel={t('mornMyself')} />}
      {d && (
        <>
          {d.note && <p class="ai-note" data-testid="morning-note">{d.note}</p>}
          <section class="pillar" data-testid="morning-must">
            <h4>{t('mornSecMust')}</h4>
            <ul class="picklist">{d.must.map(i => row(i, 'must'))}</ul>
          </section>
          <section class="pillar" data-testid="morning-goals">
            <h4>{t('mornSecGoals')}</h4>
            <ul class="picklist">{d.goals.map(i => row(i, 'goals'))}</ul>
          </section>
          <section class="pillar" data-testid="morning-pillars">
            <h4>{t('mornSecPillars')}</h4>
            {PILLARS.map((sid: SuitId) => {
              const it = d.pillars[sid];
              return (
                <div class="morn-pillar" data-testid={'morning-pillar-' + sid}>
                  <p class="meta"><Suit s={sid} /> <b>{suitName(sid, true)}</b></p>
                  {it ? <ul class="picklist">{row(it, 'pillars')}</ul>
                    : <p class="hint pillar-empty">{t('pillarEmpty', { name: suitName(sid, true).toLocaleLowerCase(lang.value) })}</p>}
                </div>
              );
            })}
          </section>
          <section class="pillar" data-testid="morning-here">
            <h4>{t('mornSecHere')}</h4>
            {placeless ? <p class="hint" data-testid="morning-here-none">{here.value === 'any' ? t('mornHereAny') : t('mornHereNone', { place: placeName(here.value) })}</p> : <ul class="picklist">{d.here.map(i => row(i, 'here'))}</ul>}
          </section>
          <section class="pillar" data-testid="morning-total">
            <h4>{t('mornSecTotal')}</h4>
            {load && <p class="planmeta" data-testid="morning-free">{t('planFree', { planned: fmtMin(load.planned), free: fmtMin(load.free) })}</p>}
            {load && load.over > 0 && <p class="planmeta over" role="status" data-testid="morning-over">{t('planOver', { t: fmtMin(load.over) })}</p>}
            {firstItem && <p class="meta" data-testid="morning-first">{t('mornStartWith')}: <b>{starterOf(firstItem) ? starterOf(firstItem) + ' → ' : ''}{title(firstItem)}</b></p>}
            <div class="chips-pick small">
              <button type="button" onClick={() => void turn(t('mornTooMuchSays'))} disabled={ai.busy} data-testid="morning-toomuch">{t('mornTooMuch')}</button>
              <button type="button" onClick={() => void turn(t('mornRoomSays'))} disabled={ai.busy} data-testid="morning-room">{t('mornRoom')}</button>
            </div>
            <form class="morn-say" onSubmit={e => { e.preventDefault(); const m = say.trim(); if (m && !ai.busy) { setSay(''); void turn(m); } }}>
              <input type="text" value={say} onInput={e => setSay((e.target as HTMLInputElement).value)} placeholder={t('mornAdjustPh')} aria-label={t('mornAdjust')} autocomplete="off" data-testid="morning-say" />
              <button class="btn small" type="submit" disabled={ai.busy || !say.trim()} data-testid="morning-adjust">{t('mornAdjustBtn')}</button>
            </form>
          </section>
          {empty && <p class="hint" role="status" data-testid="morning-empty">{t('mornNothing')}</p>}
          <div class="actions">
            <button class="btn primary" type="button" onClick={make} disabled={ai.busy} data-testid="morning-make">{t('mornMake')}</button>
            <button class="btn ghost" type="button" onClick={ritual} data-testid="morning-ritual">{t('mornMyself')}</button>
          </div>
        </>
      )}
      {!d && !ai.busy && !ai.err && <div class="actions"><button class="btn ghost" type="button" onClick={ritual} data-testid="morning-ritual">{t('mornMyself')}</button></div>}
    </div>
  );
}
