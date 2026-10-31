// The morning ritual (brief §5, plan 2 Nov, METHOD "Morning check-in"), one question per screen: yesterday in a line and what is
// still open from it, today's shape (from when, until when), the four pillars, then the plan laid out in time against the room
// the day has (src/domain/dayOrder.ts), and the first step alone. Rule-based; with an AI on, "Plan my day" improves the plan.
import { More } from '../app/More';
import { useState } from 'preact/hooks';
import { today, settings, tasks, here, days, places, stays, decisions, createDoc } from '../app/store';
import { areaOfStep } from '../app/areas';
import { areaName, placeName } from '../app/sheets';
import { areasOnPage, HALF_DAY_AT, type Half, type HalfDay } from '../domain/areas';
import { T, rawPlan, dayDoc, candidates, isOpen, quad, blocked, inPlace, personal, planEst, lastDoneOf, cardsOn, minutesOn, timeOnDay, dayZone, dayOrderOf, carriedOn, missedOn, type T as Tk } from '../app/model';
import { dayPatch, cloneTemplate, addSession, newTaskDoc, startTask } from '../app/actions';
import { CarriedFlow, MissedFlow } from '../app/CarryUi';
import { openSheet, closeSheet } from '../app/sheet';
import { Title, Meta, Est, Suit, quadName, suitName } from '../app/ui';
import { flows } from '../app/sheets';
import { t, lang, fmtMin, type Key } from '../i18n';
import { addDays } from '../domain/dates';
import { rootOf } from '../domain/places';
import { fixedOnDay } from '../domain/agenda';
import { withTime, minutesBetween, shiftTime } from '../domain/calendar';
import { dayOrder, dayLoad, type FixedItem } from '../domain/dayOrder';
import { wallOf } from '../domain/zone';
import { plan as makePlan, totalOf, pillarsOf, PILLARS, type PStep, type Plan, type PlanItem, type Preset, type Role } from '../domain/planner';
import type { SuitId, Task } from '../data/schema';
import { ask } from '../ai/ask';
import { PlanReply, readAiPlan, planChangeSet, type PlanFault } from '../ai/features';
import { planPrompt } from '../ai/prompts';
import { useAi, AiAction } from '../ai/ui';
import { prepareReview, ReviewList } from '../ai/Review';
import type { Plan as ChangePlan } from '../ai/apply';
import { OfferChips, offerFieldsFor, type OfferChoice } from '../app/OfferChips';

export function openCheckin() {
  openSheet(<Checkin key={'ci' + Date.now()} />, true);
}

const ROLE_KEY: Record<Role, Key> = { fixed: 'roleFixed', carried: 'roleCarried', now: 'qNow', protect: 'qProtect', quick: 'qQuick', obligation: 'roleObligation', optional: 'ifRoom' };
const FAULT: Record<PlanFault, Key> = {
  empty: 'aiPlanEmpty', unknown: 'aiPlanUnknown', twice: 'aiPlanTwice', roles: 'aiPlanRoles', tooMany: 'aiPlanTooMany',
  twoProtect: 'aiPlanTwoProtect', noProtect: 'aiPlanNoProtect', twoObligations: 'aiPlanTwoObligations', noObligation: 'aiPlanNoObligation',
};
const PRESETS: [Preset, Key][] = [['normal', 'presetNormal'], ['afternoon', 'presetAfternoon'], ['hour', 'presetHour'], ['rest', 'presetRest']];
const step = (x: Tk): PStep => {
  const p = personal(x);
  return { id: x.id, quad: quad(x), due: x.due, blocked: blocked(x), est: planEst(x), lo: p?.lo ?? x.est, hi: p?.hi ?? x.est, starter: x.starter, area: areaOfStep(x) };
};

/** The planner's input, from the list as it stands now. */
export function planInput(k: string, shape: { start: string; preset: Preset; fixed: { at: string; dur: number }[] }, skip: Set<string> = new Set(), forced: string[] = [], halves: Partial<Record<Half, string | null>> = {}) {
  const s = settings.value, place = here.value;
  // Every fixed-time item of the day, one-off or standing, comes first and is never skipped or swapped.
  const fixedEvents = fixedOnDay({ tasks: tasks.value, days: days.value, decisions: decisions.value, places: places.value, stays: stays.value }, s, k);
  const timed = fixedEvents.map(e => ({ id: e.taskId!, at: e.time, lead: e.lead ?? 0, template: e.template }));
  const timedIds = new Set(timed.map(x => x.id)), timedRoots = new Set(fixedEvents.map(e => e.rootId!));
  const inPlan = rawPlan(k).map(id => T(id)).filter(isOpen).filter(x => !skip.has(x.id) && !timedIds.has(x.id) && !blocked(x));
  const optionalIds = new Set(dayDoc(k)?.optional ?? []);
  // Steps already on today's list (carried, or added earlier), then any swapped in by hand.
  const carried = [...inPlan.filter(x => !optionalIds.has(x.id) && x.src !== 'plan'), ...forced.map(id => T(id)).filter(isOpen)];
  const cands = candidates(k, place).filter(x => !skip.has(x.id) && !x.at && !forced.includes(x.id) && !timedIds.has(x.id));
  const later = [...tasks.value.values()].filter(x => isOpen(x) && !blocked(x) && inPlace(x, place) && quad(x) === 4 && !skip.has(x.id) && !rawPlan(k).includes(x.id))
    .sort((a, b) => String(a.created).localeCompare(String(b.created)));
  // A standing item with weekdays belongs to those days only; one already on today's list isn't offered twice.
  const obligations = [...tasks.value.values()].filter(x => x.template && x.status !== 'dropped' && inPlace(x, place) && !skip.has(x.id) && !x.weekdays?.length && !timedRoots.has(x.id))
    .map(x => ({ id: x.id, lastDone: lastDoneOf(x.id), at: x.at ?? null, est: planEst(x) }));
  const loads = [...days.value.values()].filter(d => d.date < k && d.date >= addDays(k, -14) && typeof d.load === 'number').map(d => d.load as number).sort((a, b) => a - b);
  return {
    today: k, maxWorkSteps: s.maxWorkSteps, planningMin: s.planningMin, obligationAt: s.obligationAt, shape,
    carried: carried.map(step), candidates: cands.map(step), obligations, timed,
    optional: [...optionalIds].map(id => T(id)).filter(isOpen).map(step), laterPool: later.map(step),
    usualLoad: loads.length ? loads[Math.floor(loads.length / 2)]! : null, halves,
  };
}

type Screen = 'yesterday' | 'missed' | 'shape' | 'pillars' | 'plan' | 'first';
interface FixedIn { title: string; at: string; dur: number }

const STEPS = 4;
/** The default start: now, to the next five minutes, but not before the day starts. */
const startNow = (): string => {
  const d = new Date(), m = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 5) * 5;
  const hm = String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  return hm < settings.value.dayStart ? settings.value.dayStart : hm;
};
const endFor = (preset: Preset, start: string, dayEnd: string): string => (preset === 'hour' ? shiftTime(start, 60) : dayEnd);

/** Yesterday in one factual line: the cards played and the time logged. Nothing about what did not happen. */
function YesterdayLine({ y }: { y: string }) {
  const n = cardsOn(y).length, m = Math.round(minutesOn(y));
  if (!n) return null;
  const cards = t('cardsPlayed2', { n });
  return <p class="hint" data-testid="ci-yline">{m > 0 ? t('ciYLineTimed', { cards, t: fmtMin(m) }) : t('ciYLine', { cards })}</p>;
}

function Checkin() {
  const k = today.value, y = addDays(k, -1);
  const [started] = useState(() => Date.now());
  // Yesterday's open steps and timed items that passed, decided one at a time; fixed when the ritual opens, so the lists don't shift under the cards.
  const [carriedIds] = useState(() => carriedOn(k));
  const [missedIds] = useState(() => missedOn(y));
  const [first] = useState<Screen>(carriedIds.length ? 'yesterday' : missedIds.length ? 'missed' : 'shape');
  const [screen, setScreen] = useState<Screen>(first);
  const afterCarried = () => setScreen(missedIds.length ? 'missed' : 'shape');
  const [start, setStart] = useState(dayDoc(k)?.shape?.start ?? startNow());
  const [preset, setPreset] = useState<Preset>('normal');
  // Until when: this morning's end of the day, which stands in for the `dayEnd` setting.
  const [until, setUntil] = useState(dayDoc(k)?.shape?.end ?? settings.value.dayEnd);
  const [cutIds, setCutIds] = useState<string[]>([]);
  const [firstId, setFirstId] = useState<string | null>(null);
  const [fixed, setFixed] = useState<FixedIn[]>([]);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [cutting, setCutting] = useState(false);
  // A step to swap for one of the same weight, or a pillar to add one to (`add:<suit>`).
  const [swapping, setSwapping] = useState<string | null>(null);
  const [forced, setForced] = useState<string[]>([]);
  const [extra, setExtra] = useState<string[]>([]);
  // Where the morning and the afternoon are spent, when the place has areas: an area, or none (the place itself).
  const [halves, setHalves] = useState<Partial<Record<Half, string | null>>>(() => Object.fromEntries((dayDoc(k)?.areas ?? []).map(a => [a.half, a.placeId])));
  // The address or person picked for a placed standing obligation, by its id; none keeps the step as the obligation has it.
  const [offers, setOffers] = useState<Record<string, OfferChoice>>({});
  const [busy, setBusy] = useState(false);
  // Plan my day (AI): its plan replaces the rule-based one only if it keeps the rules.
  const ai = useAi();
  const [aiPlan, setAiPlan] = useState<{ items: PlanItem[]; note: string } | null>(null);
  const [fault, setFault] = useState('');
  const [proposed, setProposed] = useState<ChangePlan | null>(null);
  const [reviewing, setReviewing] = useState(false);

  if (screen === 'yesterday') return (
    <div class="flow" data-testid="ci-yesterday">
      <p class="eyebrow">{t('ciStep', { n: 1, of: STEPS })}</p>
      <h3>{t('ciCarriedTitle')}</h3>
      <YesterdayLine y={y} />
      <p class="hint">{t('ciCarriedHint')}</p>
      <CarriedFlow ids={carriedIds} k={k} release={false} onDone={afterCarried} />
    </div>
  );

  if (screen === 'missed') return (
    <div class="flow" data-testid="ci-missed">
      <p class="eyebrow">{t('ciStep', { n: 1, of: STEPS })}</p>
      <h3>{t('ciMissedTitle')}</h3>
      {first === 'missed' && <YesterdayLine y={y} />}
      <MissedFlow ids={missedIds} on={y} onDone={() => setScreen('shape')} />
    </div>
  );

  const shape = { start, preset, fixed: fixed.map(f => ({ at: f.at, dur: f.dur })) };
  const areaChoices = areasOnPage(places.value, here.value);
  const placeRoot = rootOf(places.value, here.value);
  // The morning means nothing on a day that starts in the afternoon.
  const dayHalves: HalfDay[] = (['am', 'pm'] as Half[]).filter(h => halves[h] && areaChoices.includes(halves[h]!) && (h === 'pm' || start < HALF_DAY_AT)).map(h => ({ half: h, placeId: halves[h]! }));

  if (screen === 'shape') {
    const addFixed = (e: Event) => {
      e.preventDefault();
      const f = e.currentTarget as HTMLFormElement;
      const v = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
      if (!v('title').trim() || !v('at')) return;
      setFixed([...fixed, { title: v('title').trim(), at: v('at'), dur: v('end') && v('end') !== v('at') ? minutesBetween(v('at'), v('end')) : 60 }].sort((a, b) => a.at.localeCompare(b.at)));
      f.reset();
    };
    const pick = (p: Preset) => {
      const st = p === 'afternoon' && start < '13:00' ? '14:00' : start;
      setPreset(p); setStart(st); setUntil(endFor(p, st, settings.value.dayEnd));
    };
    return (
      <div class="flow" data-testid="ci-shape">
        <p class="eyebrow">{t('ciStep', { n: 2, of: STEPS })}</p>
        <h3>{t('ciShape')}</h3>
        {first === 'shape' && <YesterdayLine y={y} />}
        <div class="field"><span>{t('ciKindOfDay')}</span>
          <div class="chips-pick">{PRESETS.map(([p, key]) => <button type="button" aria-pressed={preset === p} onClick={() => pick(p)}>{t(key)}</button>)}</div>
        </div>
        <div class="row2">
          <label class="field"><span>{t('ciStartAt')}</span><input type="time" value={start} data-testid="ci-start-at" onInput={e => { const v = (e.target as HTMLInputElement).value || start; setStart(v); if (preset === 'hour') setUntil(shiftTime(v, 60)); }} /></label>
          <label class="field"><span>{t('ciUntil')}</span><input type="time" value={until} data-testid="ci-until" onInput={e => setUntil((e.target as HTMLInputElement).value || until)} /></label>
        </div>
        <More n={fixed.length + dayHalves.length} testid="ci-more">
        {areaChoices.length > 0 && (
          <div class="field" data-testid="ci-halves"><span>{t('halfWhere')}</span>
            <p class="hint">{t('halfHint')}</p>
            {(['am', 'pm'] as Half[]).filter(h => h === 'pm' || start < HALF_DAY_AT).map(h => (
              <div class="chips-pick small" role="group" aria-label={t(h === 'am' ? 'halfMorningIn' : 'halfAfternoonIn')} data-half={h}>
                <b class="halflabel">{t(h === 'am' ? 'halfAm' : 'halfPm')}</b>
                <button type="button" aria-pressed={!halves[h]} onClick={() => setHalves({ ...halves, [h]: null })}>{placeName(placeRoot)}</button>
                {areaChoices.map(a => <button type="button" aria-pressed={halves[h] === a} data-area={a} onClick={() => setHalves({ ...halves, [h]: a })}>{areaName(a)}</button>)}
              </div>
            ))}
          </div>
        )}
        <div class="field"><span>{t('ciFixed')}</span>
          {fixed.length > 0 && <ul class="mini">{fixed.map((f, i) => <li><span><b>{f.at}–{shiftTime(f.at, f.dur)}</b> {f.title}</span><button type="button" class="chip-x" onClick={() => setFixed(fixed.filter((_, j) => j !== i))} aria-label={t('remove', { what: f.title })}>×</button></li>)}</ul>}
          <form class="fixed-add" onSubmit={addFixed}>
            <input type="text" name="title" placeholder={t('ciFixedPh')} aria-label={t('ciFixedPh')} autocomplete="off" />
            <input type="time" name="at" aria-label={t('atField')} />
            <input type="time" name="end" aria-label={t('endField')} title={t('endField')} />
            <button class="btn small" type="submit">{t('add')}</button>
          </form>
        </div>
        </More>
        <div class="actions"><button class="btn primary" type="button" onClick={() => setScreen('pillars')} data-testid="ci-next">{t('next_')}</button></div>
      </div>
    );
  }

  if (screen === 'first') {
    // The first item of the day's order now it is written: a fixed-time item that has taken over comes before the first step.
    const fo = firstId ? dayOrderOf(k).order.find(o => o.id === firstId) : undefined;
    const x = firstId ? T(firstId) : undefined;
    return (
      <div class="flow" data-testid="ci-first">
        <p class="eyebrow">{t('ciFirstEyebrow')}</p>
        {x ? (
          <>
            <h3 data-testid="ci-first-title">{x.starter ? x.starter + ' → ' : ''}<Title s={fo?.kind === 'fixed' && fo.at ? withTime(x.title, wallOf(fo.at, dayZone(k))) : x.title} /></h3>
            {fo?.kind === 'fixed' && <p class="hint">{t('leaveAtLine', { t: wallOf(fo.start, dayZone(k)) })}</p>}
            <p class="meta"><Est tk={x} /></p>
            <div class="actions">
              {!x.template && <button class="btn primary" type="button" onClick={() => { void startTask(x.id); closeSheet(); }} data-testid="ci-start">{t('start')}</button>}
              <button class="btn ghost" type="button" onClick={closeSheet} data-testid="ci-later">{t('notYet')}</button>
            </div>
          </>
        ) : (
          <>
            <h3>{t('ciNoFirst')}</h3>
            <div class="actions"><button class="btn primary" type="button" onClick={closeSheet} data-testid="ci-later">{t('close')}</button></div>
          </>
        )}
      </div>
    );
  }

  // ---------- the plan, laid out against the day ----------
  const inp = planInput(k, shape, skip, forced, { am: dayHalves.find(h => h.half === 'am')?.placeId, pm: dayHalves.find(h => h.half === 'pm')?.placeId });
  const rule: Plan = makePlan(inp);
  // The AI's plan never drops a fixed-time item: they come first in either plan.
  const ruleFixed = rule.items.filter(i => i.role === 'fixed');
  const aiItems = aiPlan?.items.filter(i => !skip.has(i.id));
  const p: Plan = aiItems ? { ...rule, items: [...ruleFixed, ...aiItems], total: totalOf(aiItems, inp) } : rule;
  const improve = async () => {
    setFault(''); setProposed(null);
    const { system, user, notes } = planPrompt(inp, rule, [...fixed, ...rule.items.filter(i => i.role === 'fixed').map(i => ({ title: T(i.id)?.title ?? '', at: i.at!, dur: T(i.id)?.dur ?? 60 }))]);
    const r = await ai.run(signal => ask('plan', 'thinking', system, user, PlanReply, { signal, notes }));
    if (!r) return;
    const v = readAiPlan(r, inp, rule);
    if (!v.ok) { setAiPlan(null); setFault(t(FAULT[v.why])); return; }
    setAiPlan({ items: v.items, note: r.note });
    const known = new Map([...inp.carried, ...inp.candidates, ...inp.optional].map(s => T(s.id)).filter(isOpen).map(x => [x.id, { project: x.project, where: x.where }]));
    const cs = planChangeSet(r, known);
    setProposed(cs ? prepareReview(cs) : null);
  };
  const items: PlanItem[] = [...p.items, ...extra.filter(id => !p.items.some(i => i.id === id)).map(id => ({ id, role: 'optional' as Role }))];
  const adding = swapping?.startsWith('add:') ? swapping.slice(4) : null;
  const swapFor = (id: string) => {
    if (adding) return candidates(k, here.value).filter(x => x.suit === adding && !items.some(i => i.id === x.id) && !x.at && !skip.has(x.id)).slice(0, 8);
    const it = items.find(i => i.id === id)!;
    const cur = T(id)!;
    const sameRole = it.role === 'obligation'
      ? [...tasks.value.values()].filter(x => x.template && x.status !== 'dropped' && x.id !== id && inPlace(x, here.value))
      : candidates(k, here.value).filter(x => x.id !== id && !items.some(i => i.id === x.id) && !x.at && (it.role === 'carried' || quad(x) === quad(cur)));
    return sameRole.slice(0, 8);
  };
  const swapIn = (out: string, x: Tk) => {
    if (adding) { setForced([...forced, x.id]); setSwapping(null); return; }
    const next = new Set([...skip, out]);
    // An obligation is chosen by leaving out the others; a step is placed by hand.
    if (aiPlan) setAiPlan({ ...aiPlan, items: aiPlan.items.map(i => (i.id === out ? { ...i, id: x.id } : i)) });
    else if (x.template) {
      for (const o of inp.obligations) if (o.id !== x.id) next.add(o.id);
    } else setForced([...forced.filter(f => f !== out), x.id]);
    setSkip(next);
    setSwapping(null);
  };
  const cutOut = (id: string) => { setSkip(new Set([...skip, id])); setForced(forced.filter(f => f !== id)); setCutIds([...cutIds.filter(c => c !== id), id]); };
  const keepBack = (id: string) => { const n = new Set(skip); n.delete(id); setSkip(n); setCutIds(cutIds.filter(c => c !== id)); };

  // The day's order against the clock and the room it has: fixed-time items at the time to leave, the steps between them in order.
  const zone = dayZone(k);
  const fixedIn: FixedItem[] = [];
  for (const it of items) {
    const x = T(it.id);
    if (it.role === 'fixed' && it.at) fixedIn.push({ id: it.id, at: timeOnDay(k, it.at), dur: x?.dur ?? x?.est ?? null, lead: it.leave ? minutesBetween(it.leave, it.at) : 0 });
    else if (it.role === 'obligation' && it.at) fixedIn.push({ id: it.id, at: timeOnDay(k, it.at), dur: x ? planEst(x) : null, lead: 0 });
  }
  fixed.forEach((f, i) => fixedIn.push({ id: 'new:' + i, at: timeOnDay(k, f.at), dur: f.dur, lead: 0 }));
  const layoutIn = {
    now: Math.max(Date.now(), timeOnDay(k, settings.value.dayStart)), floor: timeOnDay(k, start), end: timeOnDay(k, until),
    cards: items.filter(i => i.role !== 'fixed' && i.role !== 'obligation').map(i => i.id),
    est: (id: string) => { const x = T(id); return x ? planEst(x) : null; },
    fixed: fixedIn, optional: new Set(items.filter(i => i.role === 'optional').map(i => i.id)),
  };
  const ord = dayOrder(layoutIn), load = dayLoad(layoutIn);
  const when = new Map(ord.order.map(o => [o.id, o]));

  const picker = swapping && (
    <>
      <p class="hint">{adding ? t('pillarPickHint', { name: suitName(adding as SuitId, true) }) : t('ciSwapHint')}</p>
      <ul class="picklist">{swapFor(swapping).map(x => (
        <li><div><p><Title s={x.title} /></p><p class="meta"><Meta tk={x} withQuad /></p></div>
          <button class="btn small" type="button" onClick={() => swapIn(swapping, x)}>{t('choose')}</button></li>
      ))}</ul>
      {swapFor(swapping).length === 0 && <p class="hint">{t('pillarNothingToAdd')}</p>}
      <div class="actions"><button class="btn ghost" type="button" onClick={() => setSwapping(null)}>{t('cancel')}</button></div>
    </>
  );

  if (screen === 'pillars') {
    const by = pillarsOf(items, id => T(id)?.suit);
    return (
      <div class="flow" data-testid="ci-pillars">
        <p class="eyebrow">{t('ciStep', { n: 3, of: STEPS })}</p>
        <h3>{t('ciPillars')}</h3>
        {swapping ? picker : (
          <>
            <p class="hint">{t('ciPillarsHint')}</p>
            {PILLARS.map(sid => {
              const rows = by[sid], skipped = cutIds.filter(id => skip.has(id) && T(id)?.suit === sid);
              return (
                <section class="pillar" data-testid={'pillar-' + sid}>
                  <h4><Suit s={sid} /> {suitName(sid, true)}</h4>
                  {rows.length > 0 && (
                    <ul class="picklist">{rows.map(it => {
                      const x = T(it.id)!, pe = personal(x);
                      return (
                        <li data-testid="pillar-step"><div><p><Title s={x.title} /></p><p class="meta">{pe ? '~' + fmtMin(pe.value) : x.est ? fmtMin(x.est) : '—'}{it.at ? ' · ' + it.at : ''}</p></div>
                          <div class="go">
                            <button class="btn small ghost" type="button" onClick={() => setSwapping(it.id)}>{t('swap')}</button>
                            <button class="btn small" type="button" onClick={() => cutOut(it.id)} data-testid="pillar-skip">{t('skip')}</button>
                          </div></li>
                      );
                    })}</ul>
                  )}
                  {skipped.map(id => <p class="meta pillar-skipped"><s><Title s={T(id)?.title ?? ''} /></s> <button class="btn small ghost" type="button" onClick={() => keepBack(id)}>{t('keepIt')}</button></p>)}
                  {rows.length === 0 && (
                    <p class="hint pillar-empty" data-testid="pillar-empty">{t('pillarEmpty', { name: suitName(sid, true).toLocaleLowerCase(lang.value) })}{' '}
                      <button class="btn small ghost" type="button" onClick={() => setSwapping('add:' + sid)} data-testid="pillar-add">{t('pillarAdd')}</button></p>
                  )}
                </section>
              );
            })}
            <div class="actions"><button class="btn primary" type="button" onClick={() => setScreen('plan')} data-testid="ci-next">{t('ciSeePlan')}</button></div>
          </>
        )}
      </div>
    );
  }

  const accept = async () => {
    setBusy(true);
    const s = settings.value;
    const plan: string[] = [];
    // The timed "Plan the day" card: planning is real work, really done.
    const minutes = Math.max(1, Math.round((Date.now() - started) / 60000));
    const pid = await createDoc<Task>('tasks', newTaskDoc(t('planTheDay'), 'S', 'inbox', {
      src: 'plan', est: s.planningMin, est0: s.planningMin, estBy: 'me', status: 'done', doneDay: k, doneAt: new Date().toISOString(), important: true,
    }));
    await addSession(pid, minutes, 'done', 'timer', k);
    plan.push(pid);
    for (const f of fixed) await createDoc<Task>('tasks', newTaskDoc(f.title, 'C', 'inbox', { at: f.at, dur: f.dur, due: k, fixed: true, src: 'checkin', important: false }));
    const optional: string[] = [];
    let first: string | null = null;
    for (const it of items) {
      if (it.role === 'obligation' || (it.role === 'fixed' && T(it.id)?.template)) {
        const nid = await cloneTemplate(it.id, k, it.at, offerFieldsFor(offers[it.id]));
        if (nid) plan.push(nid);
      } else if (it.role === 'fixed') {
        // A one-off with its time: it keeps its place on the day's list if it had one.
        if (rawPlan(k).includes(it.id)) plan.push(it.id);
      } else {
        plan.push(it.id);
        if (it.role === 'optional') optional.push(it.id);
        else first ??= it.id;
      }
    }
    const done = rawPlan(k).filter(id => T(id)?.status === 'done');
    const finalPlan = [...done.filter(id => !plan.includes(id)), ...plan];
    await dayPatch(k, {
      plan: finalPlan, checkin: new Date().toISOString(), shape: { start, end: until, preset }, optional,
      ...(dayHalves.length || dayDoc(k)?.areas?.length ? { areas: dayHalves } : {}),
      first: first ? { id: first, title: T(first)?.title ?? '' } : null, load: p.total.est,
    }, plan); // what the plan puts on the day leaves any other day's list (a card is on one list)
    // The first step alone: the one the day's order puts first now, which a fixed-time item close at hand may be.
    setFirstId(dayOrderOf(k).order[0]?.id ?? first);
    setBusy(false);
    setScreen('first');
  };

  const rows = ord.order.filter(o => o.id.startsWith('new:') || items.some(i => i.id === o.id));
  const clock = (ms: number) => wallOf(ms, zone);
  return (
    <div class="flow" data-testid="ci-plan">
      <p class="eyebrow">{t('ciStep', { n: 4, of: STEPS })}</p>
      <h3>{t('ciPlan')}</h3>
      <p class="hint">{cutting ? t('ciCutHint') : swapping ? t('ciSwapHint') : t('ciPlanHint')}{!cutting && !swapping && items.some(i => i.role === 'fixed') ? ' ' + t('fixedHint') : ''}</p>
      {reviewing && proposed ? (
        <ReviewList plan={proposed} note="" inline onApplied={n => { setReviewing(false); if (n) setProposed(null); }} />
      ) : swapping ? picker : (
        <>
          {fault && <p class="ai-note" role="status" data-testid="ai-plan-rejected">{t('aiPlanRejected', { why: fault })}</p>}
          {aiPlan && <p class="ai-note" data-testid="ai-plan-note">{aiPlan.note || t('aiPlanUsed')}</p>}
          <ol class="planlist" data-testid="plan-items">
            <li class="role-plan"><span class="tag">{t('rolePlanning')}</span><span>{t('planTheDay')}</span><span class="due">{fmtMin(settings.value.planningMin)}</span></li>
            {rows.map(o => {
              if (o.id.startsWith('new:')) {
                const f = fixed[Number(o.id.slice(4))]!;
                return (
                  <li class="role-fixed" data-testid="plan-fixed">
                    <span class="tag">{t(ROLE_KEY.fixed)}</span>
                    <span><Title s={withTime(f.title, f.at)} /></span>
                    <span class="due">{fmtMin(f.dur)}</span>
                  </li>
                );
              }
              const it = items.find(i => i.id === o.id)!;
              const x = T(it.id)!;
              const pe = personal(x);
              // A standing obligation that offers an address or a person: up to three to choose from, optional.
              const offerRow = x.template && x.offer ? <OfferChips offer={x.offer} value={offers[it.id]} onChange={c => setOffers({ ...offers, [it.id]: c })} /> : null;
              if (it.role === 'fixed') return (
                <>
                  <li class="role-fixed" data-testid="plan-fixed">
                    <span class="tag">{t(ROLE_KEY.fixed)}</span>
                    <span><Title s={withTime(x.title, it.at ?? '')} />{it.leave && <> <span class="leave" data-testid="plan-leave">{t('leaveAt', { t: it.leave })}</span></>}</span>
                    <span class="due">{x.dur ? fmtMin(x.dur) : '—'}</span>
                  </li>
                  {offerRow && <li class="offerrow">{offerRow}</li>}
                </>
              );
              return (
                <>
                <li class={'role-' + it.role}>
                  <span class="tag">{forced.includes(it.id) ? quadName(quad(x)) : t(ROLE_KEY[it.role])} · {it.at ?? clock(o.start)}</span>
                  <span><Title s={x.title} />{it.half && areaOfStep(x) && <> <span class="tag area" data-testid="plan-half">{t('planHalf', { half: t(it.half === 'am' ? 'halfAm' : 'halfPm'), area: areaName(areaOfStep(x)!) })}</span></>}{it.breakDown && <> <button type="button" class="tag warn linkish" onClick={() => flows.breakDown(x.id)}>{t('breakDownFirst')}</button></>}</span>
                  <span class="due">{pe ? '~' + fmtMin(pe.value) : x.est ? fmtMin(x.est) : '—'}</span>
                  {cutting && <button class="btn small" type="button" onClick={() => cutOut(it.id)}>{t('cut')}</button>}
                  {!cutting && <button class="btn small ghost" type="button" onClick={() => setSwapping(it.id)}>{t('swap')}</button>}
                </li>
                {offerRow && <li class="offerrow">{offerRow}</li>}
                </>
              );
            })}
          </ol>
          <p class="planmeta" data-testid="plan-free">{t('planFree', { planned: fmtMin(load.planned), free: fmtMin(load.free) })}</p>
          {load.over > 0 && (
            <p class="planmeta over" role="status" data-testid="plan-over">{t('planOver', { t: fmtMin(load.over) })}{' '}
              {!cutting && <button class="btn small" type="button" onClick={() => setCutting(true)} data-testid="plan-cut-one">{t('cutOne')}</button>}</p>
          )}
          <p class="planmeta" data-testid="plan-total">{p.total.lo !== p.total.hi ? t('planTotalRange', { t: fmtMin(p.total.est), lo: fmtMin(p.total.lo), hi: fmtMin(p.total.hi) }) : t('planTotal', { t: fmtMin(p.total.est) })}</p>
          {p.offerLater && !extra.includes(p.offerLater) && (
            <div class="banner" style="margin-top:var(--s3)"><p>{t('roomFor', { title: T(p.offerLater)?.title ?? '' })}</p><button class="btn small" type="button" onClick={() => setExtra([...extra, p.offerLater!])}>{t('add')}</button></div>
          )}
          <div class="actions">
            <button class="btn primary" type="button" disabled={busy} onClick={() => void accept()} data-testid="go-with-this">{t('goWithThis')}</button>
            <button class="btn" type="button" onClick={() => setCutting(!cutting)}>{cutting ? t('doneCutting') : t('tooMuch')}</button>
          </div>
          {proposed && (
            <div class="banner" style="margin-top:var(--s3)"><p>{t('aiPlanChanges', { n: proposed.items.length })}</p><button class="btn small" type="button" onClick={() => setReviewing(true)} data-testid="ai-plan-review">{t('aiReview')}</button></div>
          )}
          {aiPlan ? <div class="actions"><button class="btn small ghost" type="button" onClick={() => { setAiPlan(null); setProposed(null); }} data-testid="ai-plan-undo">{t('aiPlanUndo')}</button></div>
            : <AiAction ai={ai} label={t('aiImprovePlan')} onClick={() => void improve()} testid="ai-improve" />}
          <p class="hint" style="margin-top:var(--s2)">{quadName(2)}: {t('protectRule')}</p>
        </>
      )}
    </div>
  );
}
