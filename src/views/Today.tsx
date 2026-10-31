// Today: the "Start here" card, the day's cards (its list and its fixed-time items, the same steps the Calendar shows) and launch points, and the day navigator,
// which edits any day's plan, launch points and first step (brief §5, Days).
import { signal } from '@preact/signals';
import { today, settings, currentStay, places, hereZone } from '../app/store';
import { T, dayCards, dayDoc, whereOf, candidates, yesterdayOpen, cardsOn, minutesOn, isOpen, decisionsToCheck, personal, planEst, isWaiting, dayOrderOf, nudges, type T as Tk } from '../app/model';
import { startTask, addLaunch, delLaunch, carryOver, addToday, setPlanOrder, reopen, removeToday, movePlan, setFirst } from '../app/actions';
import { openTask, openDone, openPause, openSwap, openPick, openStartedEarlier, flows, DropButton } from '../app/sheets';
import { Title, Meta, GoLink } from '../app/ui';
import { ChainFold } from '../app/ChainFold';
import { DoneFold } from '../app/DoneFold';
import { Clock } from '../app/Clock';
import { NudgeRow } from '../app/EventUi';
import { Rings, TimerRings } from '../app/Rings';
import { openCheckin } from '../flows/checkin';
import { openClose } from '../flows/close';
import { openReview } from '../flows/review';
import { openDecisionPage } from '../flows/decision';
import { t, fmtMin, fmtDate } from '../i18n';
import { groupPlan, inArea, type PlanGroup } from '../domain/areas';
import { splitDone } from '../domain/lists';
import { withTime } from '../domain/calendar';
import { wallOf } from '../domain/zone';
import { areaFilter, areaOfStep } from '../app/areas';
import { AreaChips } from '../app/AreaUi';
import { areaName } from '../app/sheets';
import { addDays, daysBetween } from '../domain/dates';
import { isoDow } from '../domain/repeat';
import { SUIT_ORDER } from '../data/settings';
import { suitName } from '../app/ui';
import type { Launch, Task } from '../data/schema';
import { useSortable, GRIP } from '../app/sortable';
import { CommandBox } from '../ai/ui';
import { SyncCards } from '../app/SyncSettings';

export { openClose };

/** The day being looked at; null is today. Device-local. */
export const dayView = signal<string | null>(null);
/** A day's cards as shown: its list and its fixed-time items; a step that waits for another is inside its head's card, not a row of its own. */
const shownPlan = (k: string) => dayCards(k).filter(id => !isWaiting(id));
/** When each floating step is projected to start today (HH:MM by id), from the day's order. */
type Projected = ReadonlyMap<string, string>;
/** A day's list under headings: a half spent in an area reads "Afternoon · Heliopolis", other areas by name; the steps with no area need none (unless they come after one). */
function PlanLists({ ids, k, optional, from, testid, proj, seq }: { ids: string[]; k: string; optional: Set<string>; from: number; testid?: string; proj?: Projected; seq?: string[] }) {
  const groups = groupPlan(ids, id => areaOfStep(T(id)!), dayDoc(k)?.areas);
  let n = from;
  return <>{groups.map((g, i) => {
    const start = n;
    n += g.ids.filter(id => T(id)!.status === 'open').length;
    return <PlanGroupList key={g.area ?? ''} g={g} k={k} optional={optional} from={start} first={i === 0} many={groups.length > 1} testid={testid} proj={proj} shown={seq ?? ids} />;
  })}</>;
}
function PlanGroupList({ g, k, optional, from, first, many, testid, proj, shown }: { g: PlanGroup; k: string; optional: Set<string>; from: number; first: boolean; many: boolean; testid?: string; proj?: Projected; shown: string[] }) {
  const listRef = useSortable<HTMLOListElement>(ids => void setPlanOrder(ids, k));
  let n = from;
  // An area's heading shows when there are several groups, or when a half of the day is spent in it (the heading names the half).
  const head = g.area ? (many || g.half ? (g.half ? t('halfIn', { half: t(g.half === 'am' ? 'halfAm' : 'halfPm'), area: areaName(g.area) }) : areaName(g.area)) : null) : !many || first ? null : t('areaOther');
  return (
    <>
      {head && <h3 class="areahead" data-testid="area-head">{head}</h3>}
      <ol class="tableau" ref={listRef} {...(testid ? { 'data-testid': testid } : {})}>{g.ids.map(id => { const tk = T(id)!; if (tk.status === 'open') n++; return <Row key={id} tk={tk} n={n} k={k} optional={optional.has(id)} at={proj?.get(id)} shown={shown} />; })}</ol>
    </>
  );
}
const hmNow = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

function FirstCard({ tk }: { tk: Tk }) {
  const run = !!tk.started;
  const hasGo = !!tk.link || !!tk.prompt || !!tk.app;
  return (
    <section class={'first' + (run ? ' running' : ' focus')} data-testid="first" data-task={tk.id}>
      <div class="top">
        <p class="eyebrow">{run ? t('running') : t('startHere')}</p>
        {!run && <div class="edits"><button class="btn" type="button" onClick={() => openSwap()}>{t('swap')}</button><button class="btn" type="button" onClick={() => openTask(tk.id)}>{t('edit')}</button></div>}
      </div>
      <p class="t"><Title s={tk.title} /></p>
      {tk.starter && !run && <p class="starter">{t('starterIs', { s: tk.starter })}</p>}
      <p class="meta"><Meta tk={tk} /></p>
      <ChainFold tk={tk} />
      {tk.resume && <p class="resume">{t('resume', { text: tk.resume })}</p>}
      <div class="go">
        {run ? (
          <>
            <span class="timerbox"><TimerRings tk={tk} /><Clock tk={tk} big /></span>
            <button class="btn" type="button" onClick={() => openPause(tk.id)}>{t('pause')}</button>
            <button class="btn primary" type="button" onClick={() => openDone(tk.id)}>{t('done')}</button>
            <GoLink tk={tk} variant="small" />
          </>
        ) : (
          <>
            {hasGo && <GoLink tk={tk} variant="big" />}
            <button class={'btn' + (hasGo ? '' : ' primary')} type="button" onClick={() => startTask(tk.id)}>{hasGo ? t('justStartTimer') : t('startTimer')}</button>
            <button class="btn" type="button" onClick={() => openDone(tk.id)}>{t('alreadyDone')}</button>
          </>
        )}
      </div>
      <div class="go quiet">
        {!run && <button class="btn small ghost" type="button" onClick={() => openStartedEarlier(tk.id)}>{t('startedEarlier')}</button>}
        <button class="btn small ghost" type="button" onClick={() => flows.stuck(tk.id)} data-testid="stuck">{t('imStuck')}</button>
        {!run && <DropButton key={tk.id} tk={tk} />}
      </div>
      {!run && hasGo && <p class="hint">{t('openingStartsTimer')}</p>}
    </section>
  );
}

/** Start here when a fixed-time item has taken over (src/domain/dayOrder.ts): its time, when to leave, and what can be done with it. A standing item not yet placed on the day has a card to edit only. */
function FixedFirst({ tk, time, leave }: { tk: Tk; time: string; leave: string }) {
  return (
    <section class="first focus" data-testid="first" data-task={tk.id} data-fixed="1">
      <div class="top">
        <p class="eyebrow">{t('startHere')}</p>
        <div class="edits"><button class="btn" type="button" onClick={() => openTask(tk.id)}>{t('edit')}</button></div>
      </div>
      <p class="t" data-testid="first-fixed-line"><Title s={withTime(tk.title, time)} /> · {t('leaveAtLine', { t: leave })}</p>
      <p class="meta"><Meta tk={tk} /></p>
      {!tk.template && (
        <div class="go">
          <button class="btn primary" type="button" onClick={() => startTask(tk.id)}>{t('startTimer')}</button>
          <button class="btn" type="button" onClick={() => openDone(tk.id)}>{t('alreadyDone')}</button>
        </div>
      )}
    </section>
  );
}

/** Start here when nothing on the list is open: the step the list would pick next, one tap from started. */
function SuggestCard({ tk, played }: { tk: Tk; played: boolean }) {
  const start = async () => { await addToday(tk.id, true); await startTask(tk.id); };
  return (
    <section class="first focus" data-testid="first" data-task={tk.id}>
      {played && <Rings />}
      <div class="top"><p class="eyebrow">{t('startHere')}</p></div>
      {played && <p class="hint" style="margin:0"><b>{t('listPlayed')}</b> {t('allDone')}</p>}
      <p class="t"><Title s={tk.title} /></p>
      {tk.starter && <p class="starter">{t('starterIs', { s: tk.starter })}</p>}
      <p class="meta"><Meta tk={tk} /></p>
      <div class="go">
        <button class="btn primary" type="button" onClick={() => void start()} data-testid="suggest-start">{t('startTimer')}</button>
        <button class="btn" type="button" onClick={() => addToday(tk.id)}>{t('putFirst')}</button>
        <button class="btn" type="button" onClick={() => openPick('list')}>{t('chooseFromList')}</button>
      </div>
      <div class="go quiet">
        {!played && <button class="btn small ghost" type="button" onClick={openCheckin} data-testid="checkin">{t('planTheDay')}</button>}
        <DropButton key={tk.id} tk={tk} />
      </div>
    </section>
  );
}

function Row({ tk, n, k, optional, at, shown }: { tk: Tk; n: number; k: string; optional?: boolean; at?: string; shown?: readonly string[] }) {
  const done = tk.status === 'done', run = !!tk.started;
  const isToday = k === today.value;
  return (
    <li {...(done ? {} : { 'data-sort': '' })} class={'row' + (done ? ' done' : '') + (run ? ' running' : '') + (optional ? ' optional' : '')} data-row={tk.id} data-task={tk.id}>
      <span class={'num' + (done ? ' suit-' + tk.suit : '')} aria-hidden="true">{done ? settings.value.suits[tk.suit]?.glyph : n}</span>
      <div class="body">
        <p class="t"><Title s={tk.title} />{optional && <> <span class="tag">{t('ifRoom')}</span></>}</p>
        <p class="meta"><Meta tk={tk} />{run && <><span aria-hidden="true">·</span><Clock tk={tk} /></>}{at && !run && !done && !tk.at && <><span aria-hidden="true">·</span><span class="proj-at" data-testid="proj-at" title={t('projectedAt', { t: at })}>{t('projectedAt', { t: at })}</span></>}{!done && (tk.link || tk.prompt || tk.app) && <><span aria-hidden="true">·</span><GoLink tk={tk} variant="inline" /></>}</p>
        {!done && <ChainFold tk={tk} />}
        {tk.resume && !done && <p class="resume">{t('resume', { text: tk.resume })}</p>}
      </div>
      <div class="ctrls">
        {!done && <>
          <span class="grip" aria-hidden="true" data-testid="grip">{GRIP}</span>
          <button class="icon-btn kbd-only" type="button" onClick={() => movePlan(tk.id, -1, k, shown)} aria-label={t('earlier')}>↑</button>
          <button class="icon-btn kbd-only" type="button" onClick={() => movePlan(tk.id, 1, k, shown)} aria-label={t('later')}>↓</button>
        </>}
        {done ? <button class="icon-btn" type="button" onClick={() => reopen(tk.id)} aria-label={t('reopen')}>↺</button>
          : !isToday ? <>
            <button class="icon-btn" type="button" onClick={() => removeToday(tk.id, k)} aria-label={t('takeOff')}>×</button>
          </>
          : run ? <><button class="icon-btn" type="button" onClick={() => openPause(tk.id)} aria-label={t('pause')}>❚❚</button><button class="icon-btn ok" type="button" onClick={() => openDone(tk.id)} aria-label={t('done')}>✓</button></>
            : <><button class="icon-btn" type="button" onClick={() => startTask(tk.id)} aria-label={t('startTimer')}>▶</button><button class="icon-btn ok" type="button" onClick={() => openDone(tk.id)} aria-label={t('done')} data-testid="row-done">✓</button></>}
        <button class="icon-btn" type="button" onClick={() => openTask(tk.id)} aria-label={t('details')} data-testid="details">⋯</button>
      </div>
    </li>
  );
}

/** Whether the Launch points block is open: kept for the session, so it stays as the person left it. */
const launchesOpen = signal(false);

function Launches({ k }: { k: string }) {
  const d = dayDoc(k);
  const L: Launch[] = d?.launches ?? [];
  const hm = k === today.value ? hmNow() : '';
  const nextIdx = hm ? L.findIndex(l => l.t >= hm) : -1;
  const submit = (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const time = (f.elements.namedItem('time') as HTMLInputElement).value;
    if (!time) return;
    void addLaunch(time, (f.elements.namedItem('kind') as HTMLSelectElement).value as Launch['k'], k);
    f.reset();
  };
  return (
    <details class="launchbox" data-testid="launch-box" open={launchesOpen.value} onToggle={e => { launchesOpen.value = (e.currentTarget as HTMLDetailsElement).open; }}>
      <summary><span>{t('launchPoints')}</span> <span class="hint-inline" data-testid="launch-summary">· {L.length ? L.map(l => l.t).join(', ') : t('launchNone')}</span></summary>
      <p class="hint">{t('launchHint')}</p>
      <div class="launches">
        {L.length ? L.map((l, i) => (
          <span class={'chip' + (i === nextIdx ? ' next' : '') + (hm && l.t < hm ? ' past' : '')}>
            <span aria-hidden="true">{l.k === 'restart' ? '↻' : '▶'}</span><time>{l.t}</time><span>{l.k === 'restart' ? t('restart') : t('start')}</span>
            <button type="button" onClick={() => delLaunch(i, k)} aria-label={t('remove', { what: l.t })}>×</button>
          </span>
        )) : <span class="hint">{t('noLaunches')}</span>}
        <form class="launch-add" onSubmit={submit}>
          <input type="time" name="time" aria-label={t('launchTime')} required />
          <select name="kind" aria-label={t('startOrRestart')}><option value="start">{t('start')}</option><option value="restart">{t('restart')}</option></select>
          <button class="btn small" type="submit">{t('add')}</button>
        </form>
      </div>
    </details>
  );
}

function Navigator({ k }: { k: string }) {
  const td = today.value;
  const go = (d: string | null) => { dayView.value = d === td ? null : d; };
  const n = daysBetween(td, k);
  const label = n === 0 ? t('pickToday') : n === -1 ? t('pickYesterday') : n === 1 ? t('pickTomorrow') : fmtDate(k, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <nav class="daynav" aria-label={t('dayNav')}>
      <button class="icon-btn" type="button" onClick={() => go(addDays(k, -1))} aria-label={t('prevDay')} data-testid="prev-day">‹</button>
      <label class="daynav-date"><span>{label}</span><input type="date" value={k} onChange={e => { const v = (e.target as HTMLInputElement).value; if (v) go(v); }} aria-label={t('pickADay')} /></label>
      <button class="icon-btn" type="button" onClick={() => go(addDays(k, 1))} aria-label={t('nextDay')} data-testid="next-day">›</button>
      {n !== 0 && <button class="btn small ghost" type="button" onClick={() => go(null)}>{t('backToToday')}</button>}
    </nav>
  );
}

function StayNotice() {
  const s = currentStay.value;
  if (!s || s.from !== today.value) return null;
  let seen = false;
  try { seen = localStorage.getItem('reussite.stay.' + s.id) === '1'; } catch { /* fine */ }
  if (seen) return null;
  return (
    <div class="banner" role="status" data-testid="stay-notice">
      <p>{t('stayStarts', { place: places.value.get(s.placeId)?.name ?? s.placeId, date: fmtDate(s.to) })}</p>
      <button class="btn small ghost" type="button" onClick={e => { try { localStorage.setItem('reussite.stay.' + s.id, '1'); } catch { /* fine */ } (e.currentTarget as HTMLElement).parentElement!.remove(); }}>{t('ok')}</button>
    </div>
  );
}

/** Another day's plan: its list, first step and launch points, editable. Past days show their cards. */
function OtherDay({ k }: { k: string }) {
  const past = k < today.value;
  const plan = shownPlan(k);
  const d = dayDoc(k);
  const cards = cardsOn(k);
  const open = plan.filter(id => isOpen(T(id)));
  const sd = splitDone(plan, id => T(id)!.status === 'done');
  const optional = new Set(d?.optional ?? []);
  return (
    <div data-testid="other-day">
      {past && (
        <section class="first">
          <p class="eyebrow">{t('cardsThatDay')}</p>
          <p class="t">{t('cardsPlayed2', { n: cards.length })} · {fmtMin(minutesOn(k))}</p>
          {cards.length > 0 && <p class="meta">{cards.map(c => <span class={'suit-' + c.suit}>{settings.value.suits[c.suit]?.glyph}</span>)}</p>}
        </section>
      )}
      {!past && (
        <section class="first">
          <p class="eyebrow">{t('firstStepOf', { date: fmtDate(k, { weekday: 'long', day: 'numeric', month: 'long' }) })}</p>
          <label class="field" style="margin:0">
            <select value={d?.first?.id ?? ''} onChange={e => { const v = (e.target as HTMLSelectElement).value; if (v) void setFirst(v, k); }} aria-label={t('firstStep')}>
              <option value="">{t('chooseOne')}</option>
              {[...open.map(id => T(id)!), ...candidates(k).slice(0, 12)].map(x => <option value={x.id}>{x.title}</option>)}
            </select>
          </label>
        </section>
      )}
      {!past && (
        <div class="adders">
          <button class="btn" type="button" onClick={() => openPick('list', k)}>{t('fromYourList')}</button>
          <button class="btn" type="button" onClick={() => openPick('standing', k)}>{t('leisurePeople')}</button>
        </div>
      )}
      <Launches k={k} />
      <h2 class="sec">{t('dayList')}</h2>
      {plan.length ? <PlanLists ids={sd.open} k={k} optional={optional} from={0} /> : <p class="hint">{t('emptyDay')}</p>}
      <DoneFold n={sd.done.length}><ol class="tableau">{sd.done.map(id => <Row key={id} tk={T(id)!} n={0} k={k} />)}</ol></DoneFold>
    </div>
  );
}

export function Today() {
  const td = today.value;
  const k = dayView.value && dayView.value !== td ? dayView.value : td;
  if (k !== td) return <div><Navigator k={k} /><OtherDay k={k} /></div>;
  const d = dayDoc(k);
  const every = shownPlan(k);
  // Narrowed to an area (a chip): that area's steps and Anywhere's.
  const af = areaFilter('today');
  const plan = af ? every.filter(id => inArea(whereOf(T(id)!), af)) : every;
  const open = plan.filter(id => isOpen(T(id)));
  // The day's one order (src/domain/dayOrder.ts): its first item is Start here (a fixed-time item once it takes over), the list follows it,
  // with the time each floating step is projected to start. Cards the order leaves out (a fixed item whose time has passed) come last.
  const day = dayOrderOf(k), dorder = day.order;
  const fo = dorder[0], fid = fo?.id;
  // A fixed-time item whose time has passed is not a card played, nor one still to play: a list of only those has nothing to say yet.
  const live = every.filter(id => !day.missed.includes(id));
  const sd = splitDone(plan, id => T(id)!.status === 'done');
  const inOrder = new Set(sd.open);
  const seq = [...dorder.map(x => x.id).filter(id => inOrder.has(id)), ...sd.open.filter(id => !dorder.some(x => x.id === id))];
  const yOpen = yesterdayOpen(k);
  const rest = seq.filter(id => id !== fid);
  const zone = hereZone.value;
  const proj: Projected = new Map(dorder.filter(x => x.kind === 'step' && x.id !== fid).map(x => [x.id, wallOf(x.start, zone)]));
  const optional = new Set(d?.optional ?? []);
  const work = open.filter(id => !optional.has(id));
  const est = work.reduce((a, id) => a + (planEst(T(id)!) ?? 0), 0);
  const lo = work.reduce((a, id) => { const x = T(id)!; return a + (personal(x)?.lo ?? x.est ?? 0); }, 0);
  const hi = work.reduce((a, id) => { const x = T(id)!; return a + (personal(x)?.hi ?? x.est ?? 0); }, 0);
  const more = open.length - (fid && open.includes(fid) ? 1 : 0);
  // Nothing open on the list: Start here still shows, with the step the list would pick next.
  const s = !fid && !(af && every.length && !plan.length) ? candidates()[0] : undefined;
  const checks = decisionsToCheck(k);
  const reviewDay = isoDow(k) === settings.value.reviewDay && !d?.review;
  return (
    <div>
      <Navigator k={k} />
      <AreaChips view="today" />
      <StayNotice />
      <SyncCards />
      {checks.map(dc => (
        <div class="banner" data-testid="decision-check"><p>{t('checkDecision', { title: dc.title })}</p><button class="btn small" type="button" onClick={() => openDecisionPage(dc.id, true)}>{t('checkNow')}</button></div>
      ))}
      {nudges.value.map(tk => <NudgeRow key={tk.id} tk={tk} />)}
      {reviewDay && <div class="banner" data-testid="review-card"><p>{t('reviewToday')}</p><button class="btn small" type="button" onClick={openReview}>{t('startReview')}</button></div>}
      {fid && fo ? (fo.kind === 'fixed' && !T(fid)!.started ? <FixedFirst tk={T(fid)!} time={wallOf(fo.at!, zone)} leave={wallOf(fo.start, zone)} /> : <FirstCard tk={T(fid)!} />) : af && every.length && !plan.length ? (
        <section class="first" data-testid="area-nothing"><p class="t">{t('areaNothing', { area: areaName(af) })}</p></section>
      ) : s ? <SuggestCard tk={s} played={live.length > 0} /> : !live.length ? (
        <section class="first" data-testid="first">
          <Rings />
          <p class="eyebrow">{t('noListYet')}</p>
          <p class="t">{t('planTheDayQ')}</p>
          <div class="go"><button class="btn primary" type="button" onClick={openCheckin} data-testid="checkin">{t('planTheDay')}</button></div>
        </section>
      ) : (
        <section class="first"><Rings /><p class="eyebrow">{t('listPlayed')}</p><p class="t">{t('allDone')}</p><p class="hint">{t('addOneOrClose')}</p></section>
      )}
      {yOpen.length > 0 && (
        <div class="carry"><p>{t('carryText', { n: yOpen.length })}</p><button class="btn small" type="button" onClick={carryOver}>{t('carryButton', { n: yOpen.length })}</button></div>
      )}
      <div class="after-first">
        <div class="adders" data-testid="adders">
          {plan.length > 0 && !d?.checkin && <button class="btn" type="button" onClick={openCheckin}>{t('planTheDay')}</button>}
          <button class="btn" type="button" onClick={() => openPick('list')}>{t('fromYourList')}</button>
          <button class="btn" type="button" onClick={() => openPick('standing')}>{t('leisurePeople')}</button>
          {open.length > 0 && <button class="btn" type="button" onClick={() => flows.stuck()}>{t('imStuck')}</button>}
        </div>
        <Launches k={k} />
        {rest.length > 0 && (
          <>
            <h2 class="sec">{fid ? t('then') : t('todaysList')} <span class="hint-inline">
              {more ? t('more', { n: more }) : t('allPlayed')}
              {est > 0 && ' · ' + (lo !== hi ? t('estimatedRange', { t: fmtMin(est), lo: fmtMin(lo), hi: fmtMin(hi) }) : t('estimatedToday', { t: fmtMin(est) }))}
            </span></h2>
            <PlanLists ids={rest} k={k} optional={optional} from={fid ? 1 : 0} testid="plan-list" proj={proj} seq={seq} />
          </>
        )}
        <DoneFold n={sd.done.length}><ol class="tableau" data-testid="done-list">{sd.done.map(id => <Row key={id} tk={T(id)!} n={0} k={k} />)}</ol></DoneFold>
        <CommandBox scope={{ kind: 'today' }} />
        <button class="btn primary close-day" type="button" onClick={openClose}>{d?.closed ? t('closeAgain') : t('closeTheDay')}</button>
      </div>
    </div>
  );
}
