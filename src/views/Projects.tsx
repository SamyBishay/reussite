// Projects by suit (brief §5, Projects): the project editor with its SMART goal, steps in
// order with what waits for what, linked decisions, progress bars, and the Completed shelf.
import { useState } from 'preact/hooks';
import { tasks, projects, settings, decisions, places, createDoc, toast, pagePlace } from '../app/store';
import { onPage } from '../domain/places';
import { isOpen, inPlace, blocked, byOrder, waitingOn, type T } from '../app/model';
import { createTask, newTaskDoc, patchProject, moveStep, moveProject, setStepOrder } from '../app/actions';
import { openTask, PlaceSelect, placeName } from '../app/sheets';
import { openSheet, closeSheet } from '../app/sheet';
import { Title, Suit, Due, DueChip, suitName } from '../app/ui';
import { SmartEditor, smartFilled } from '../app/smart';
import { openDecision, openDecisionPage, decisionGroups } from '../flows/decision';
import { Scope, scope } from './Matrix';
import { t, fmtMin, fmtDate, type Key } from '../i18n';
import { SUIT_ORDER } from '../data/settings';
import type { Project, Task } from '../data/schema';
import { useSortable, GRIP } from '../app/sortable';
import { CommandBox } from '../ai/ui';

type P = Project & { id: string };
const openProj = new Set<string>();

function Step({ tk, first, last, sortable }: { tk: T; first?: boolean; last?: boolean; sortable?: boolean }) {
  const done = tk.status === 'done';
  const w = waitingOn(tk)[0];
  return (
    <li class={done ? 'done' : ''} data-task={tk.id} {...(sortable ? { 'data-sort': '' } : {})}>
      <span class={'g suit-' + tk.suit} aria-hidden="true">{tk.template ? '↻' : done ? '✓' : '·'}</span>
      <span class="stept">
        <button class="linklike" type="button" onClick={() => openTask(tk.id)}><Title s={tk.title} /></button>
        {!done && w && <small class="muted"> · {t('waitsFor', { what: w.title.length > 30 ? w.title.slice(0, 28) + '…' : w.title })}</small>}
      </span>
      <span class="stepctl">
        {!done && !tk.template && <DueChip tk={tk} />}
        <span class="due">{tk.template ? t('standing') : tk.est ? fmtMin(tk.est) : ''}</span>
        {!done && !tk.template && <>
          <span class="grip sm" aria-hidden="true" data-testid="grip">{GRIP}</span>
          <button type="button" class="icon-btn sm kbd-only" disabled={first} onClick={() => moveStep(tk.id, -1)} aria-label={t('earlier')}>↑</button>
          <button type="button" class="icon-btn sm kbd-only" disabled={last} onClick={() => moveStep(tk.id, 1)} aria-label={t('later')}>↓</button>
        </>}
      </span>
    </li>
  );
}

function ProjectCard({ p, ts }: { p: P; ts: T[] }) {
  const real = ts.filter(x => !x.template && x.status !== 'dropped');
  const done = real.filter(x => x.status === 'done');
  const open = real.filter(x => x.status === 'open').sort(byOrder);
  const tmpl = ts.filter(x => x.template && x.status !== 'dropped');
  const total = real.length;
  const next = open.find(x => !blocked(x)) ?? open[0];
  const doneSorted = done.sort((a, b) => String(a.doneAt ?? '').localeCompare(String(b.doneAt ?? '')));
  const label = t('stepsDone', { d: done.length, n: total });
  const linked = [...decisions.value.values()].filter(d => d.projectId === p.id);
  const left = open.length;
  const listRef = useSortable<HTMLOListElement>(ids => void setStepOrder(ids));
  const add = async (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const title = (f.elements.namedItem('title') as HTMLInputElement).value.trim();
    if (!title) return;
    const est = Number((f.elements.namedItem('est') as HTMLInputElement).value) || null;
    const order = ts.reduce((m, x) => Math.max(m, x.order || 0), 0) + 1;
    f.reset();
    openProj.add(p.id);
    await createTask(newTaskDoc(title, null, p.id, { est, estBy: est ? 'me' : null, order }));
  };
  return (
    <article class="proj" data-project={p.id}>
      <h4><span>{p.name}{p.status === 'paused' && <> <span class="tag">{t('pst_paused')}</span></>}</span>
        <span class="frac">{total ? done.length + ' / ' + total : ''}{p.id !== 'inbox' && <button type="button" class="btn small ghost" onClick={() => openProject(p.id)} data-testid="edit-project">{t('edit')}</button>}</span></h4>
      {total > 0 && total <= 16 && <div class="bar" role="img" aria-label={label}>{real.map((_, i) => <i class={i < done.length ? 'on' : ''} />)}</div>}
      {total > 16 && <div class="bar cont" role="img" aria-label={label}><i style={{ width: Math.round((done.length / total) * 100) + '%' }} /></div>}
      {total >= 4 && left > 0 && left <= 3 && <p class="left">{t('stepsLeft', { n: left })}</p>}
      {p.goal ? <p class="goal">{p.goal}{p.goalBy === 'ai' && <span class="proposed" title={t('proposedHint')}>{t('proposed')}</span>}{p.id !== 'inbox' && <small class="muted"> · {t('smartN', { n: smartFilled(p.smart) })}</small>}</p>
        : p.id !== 'inbox' && <p class="goal muted">{t('noGoal')}</p>}
      {p.due && <p class="next"><Due k={p.due} /></p>}
      {next && <p class="next">{t('next', { what: '' })}<Title s={next.title} /></p>}
      {linked.length > 0 && <ul class="linked">{linked.map(d => (
        <li><button type="button" class="linklike" onClick={() => openDecisionPage(d.id)}>⚖ {d.title || t('untitledDecision')}</button>
          <small class="muted">{d.chosen ? ' · ' + t('chosen', { what: d.chosen }) : ' · ' + t(('dst_' + d.status) as Key)}{d.reviewOn && d.status === 'decided' ? ' · ' + t('checkOn', { date: fmtDate(d.reviewOn) }) : ''}</small></li>
      ))}</ul>}
      <details open={openProj.has(p.id)} onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) openProj.add(p.id); else openProj.delete(p.id); }}>
        <summary>{tmpl.length && !total ? t('standingItems') : tmpl.length ? t('stepsAndStanding') : t('steps')}</summary>
        <ol class="steps" ref={listRef}>{open.map((x, i) => <Step key={x.id} tk={x} first={i === 0} last={i === open.length - 1} sortable />)}{doneSorted.map(x => <Step key={x.id} tk={x} />)}{tmpl.map(x => <Step key={x.id} tk={x} />)}</ol>
        <form class="addstep" onSubmit={add}>
          <input type="text" name="title" placeholder={t('nextStepPlaceholder')} aria-label={t('newStepFor', { name: p.name })} autocomplete="off" required />
          <input type="number" name="est" min="1" max="600" placeholder={t('minShort')} aria-label={t('estimateMin')} />
          <button class="btn small" type="submit">{t('add')}</button>
        </form>
        {p.id !== 'inbox' && <div class="actions" style="margin-top:8px"><button class="btn small" type="button" onClick={() => void openDecision(null, { projectId: p.id })}>{t('newDecision')}</button></div>}
      </details>
    </article>
  );
}

const STATUSES: Project['status'][] = ['active', 'paused', 'done', 'dropped'];
export function openProject(id: string) {
  openSheet(<ProjectSheet key={'proj' + id + Date.now()} id={id} />, true);
}
function ProjectSheet({ id }: { id: string }) {
  const p = projects.value.get(id);
  const [where, setWhere] = useState(p?.where || 'any');
  if (!p) return null;
  const set = (x: Partial<Project>) => void patchProject(id, x);
  return (
    <div data-testid="project-sheet">
      <h3>{p.name}</h3>
      <label class="field"><span>{t('name')}</span><input type="text" defaultValue={p.name} onChange={e => set({ name: (e.target as HTMLInputElement).value.trim() || p.name })} /></label>
      <div class="row2">
        <label class="field"><span>{t('suit')}</span>
          <select value={p.suit} onChange={e => set({ suit: (e.target as HTMLSelectElement).value as Task['suit'] })}>{SUIT_ORDER.map(s => <option value={s}>{settings.value.suits[s].glyph} {suitName(s, true)}</option>)}</select>
        </label>
        <label class="field"><span>{t('where')}</span><PlaceSelect value={where} onChange={v => { setWhere(v); set({ where: v }); }} /></label>
      </div>
      <div class="row2">
        <label class="field"><span>{t('dueField')}</span><input type="date" defaultValue={p.due ?? ''} onChange={e => set({ due: (e.target as HTMLInputElement).value || null })} /></label>
        <label class="field"><span>{t('status')}</span>
          <select value={p.status} onChange={e => { const v = (e.target as HTMLSelectElement).value as Project['status']; set({ status: v, doneAt: v === 'done' ? new Date().toISOString() : null }); }}>
            {STATUSES.map(s => <option value={s}>{t(('pst_' + s) as Key)}</option>)}
          </select>
        </label>
      </div>
      <div class="actions" style="margin-top:10px">
        <button class="btn small" type="button" onClick={() => moveProject(id, -1)}>{t('earlier')}</button>
        <button class="btn small" type="button" onClick={() => moveProject(id, 1)}>{t('later')}</button>
      </div>
      <h2 class="sec">{t('smartGoal')}</h2>
      <p class="hint">{t('smartHint')}</p>
      <SmartEditor projectId={id} />
      <div class="actions"><button class="btn primary" type="button" onClick={closeSheet}>{t('doneButton')}</button><button class="btn" type="button" onClick={() => void openDecision(null, { projectId: id })}>{t('newDecision')}</button></div>
    </div>
  );
}

function NewProject() {
  const [where, setWhere] = useState('any');
  const submit = async (e: Event) => {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const name = (f.elements.namedItem('name') as HTMLInputElement).value.trim();
    if (!name) return;
    const suit = (f.elements.namedItem('suit') as HTMLSelectElement).value as Task['suit'];
    f.reset();
    const id = await createDoc<Project>('projects', { name, suit, where, goal: null, goalBy: null, due: null, order: Date.now(), status: 'active', created: new Date().toISOString() });
    openProj.add(id);
    toast(t('projectAdded'));
  };
  return (
    <form class="newproj" onSubmit={submit}>
      <h2 class="sec" style="margin-top:0">{t('newProject')}</h2>
      <div class="row3">
        <input type="text" name="name" placeholder={t('name')} aria-label={t('name')} autocomplete="off" required />
        <select name="suit" aria-label={t('suit')}>{SUIT_ORDER.map(s => <option value={s}>{settings.value.suits[s].glyph} {suitName(s, true)}</option>)}</select>
        <PlaceSelect value={where} onChange={setWhere} />
        <button class="btn primary" type="submit">{t('add')}</button>
      </div>
      <p class="hint">{t('smartHint')}</p>
    </form>
  );
}

const GROUP_KEY = { check: 'decToCheck', open: 'decOpen', decided: 'decDecided', closed: 'decClosed' } as const;

/** Every decision, grouped: to check, open, decided, closed. Steps that are decisions open theirs from the Matrix. */
function Decisions() {
  const groups = decisionGroups();
  return (
    <section data-testid="decisions">
      <h2 class="sec">{t('decisions')} <button type="button" class="btn small" onClick={() => void openDecision(null)} data-testid="new-decision">{t('newDecision')}</button></h2>
      {(['check', 'open', 'decided', 'closed'] as const).map(g => groups[g].length > 0 && (
        <>
          <h3 class="subsec">{t(GROUP_KEY[g])}</h3>
          <ul class="decs">{groups[g].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))).map(d => (
            <li>
              <button type="button" class="linklike" onClick={() => openDecisionPage(d.id, g === 'check')}><b>{d.title || t('untitledDecision')}</b></button>
              <p class="meta">{d.date && fmtDate(d.date, { day: 'numeric', month: 'short', year: 'numeric' }) + ' · '}{d.chosen ? t('chosen', { what: d.chosen }) : t('dst_' + d.status as Key)}</p>
              {d.falsifier && <p class="meta">{t('revisitIf', { what: d.falsifier })}{d.reviewOn && ' · ' + t('checkOn', { date: fmtDate(d.reviewOn) })}</p>}
            </li>
          ))}</ul>
        </>
      ))}
      {!Object.values(groups).some(g => g.length) && <p class="hint">{t('noDecisions')}</p>}
    </section>
  );
}

/** Finished projects stay browsable, their cards stacked like a finished foundation. */
function Shelf({ done, by }: { done: P[]; by: Map<string, T[]> }) {
  if (!done.length) return null;
  return (
    <details class="shelf" data-testid="shelf">
      <summary>{t('completedShelf', { n: done.length })}</summary>
      <ul class="shelf-list">{done.sort((a, b) => String(b.doneAt ?? '').localeCompare(String(a.doneAt ?? ''))).map(p => {
        const n = (by.get(p.id) ?? []).filter(x => x.status === 'done' && !x.template).length;
        return (
          <li><span class={'pc stack suit-' + p.suit} aria-hidden="true"><span class="big">{settings.value.suits[p.suit]?.glyph}</span></span>
            <span><b>{p.name}</b><br /><small class="muted">{t('stepsDoneShort', { n })}{p.doneAt ? ' · ' + fmtDate(p.doneAt.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</small></span>
            <button type="button" class="btn small ghost" onClick={() => openProject(p.id)}>{t('edit')}</button></li>
        );
      })}</ul>
    </details>
  );
}

export function Projects() {
  const by = new Map<string, T[]>();
  for (const x of tasks.value.values()) { if (!by.has(x.project)) by.set(x.project, []); by.get(x.project)!.push(x); }
  const projs = [...projects.value.values()].filter(p => p.status !== 'done' && p.status !== 'dropped');
  const page = pagePlace.value;
  let hidden = 0;
  const vis = projs.filter(p => {
    const ok = scope.value === 'all' || !p.where || onPage(places.value, p.where, page) || (by.get(p.id) ?? []).some(x => isOpen(x) && inPlace(x));
    if (!ok) hidden++;
    return ok;
  });
  const inbox = by.get('inbox') ?? [];
  return (
    <div>
      <Scope hidden={hidden} />
      <CommandBox scope={{ kind: 'matrix' }} />
      {SUIT_ORDER.map(s => {
        const ps = vis.filter(p => p.suit === s && p.id !== 'inbox').sort(byOrder);
        if (!ps.length) return null;
        return (
          <section class="suitsec"><h3><Suit s={s} /> {suitName(s)}</h3>
            <div class="projs">{ps.map(p => <ProjectCard key={p.id} p={p} ts={by.get(p.id) ?? []} />)}</div>
          </section>
        );
      })}
      {inbox.some(x => x.status === 'open' && !x.fixed) && (
        <section class="suitsec"><h3>{t('inbox')}</h3><p class="hint" style="margin-bottom:10px">{t('inboxHint')}</p>
          <div class="projs"><ProjectCard p={(projects.value.get('inbox') as P) ?? ({ id: 'inbox', name: t('inbox') } as P)} ts={inbox.filter(x => !x.fixed && x.src !== 'plan')} /></div>
        </section>
      )}
      <Decisions />
      <NewProject />
      <Shelf done={[...projects.value.values()].filter(p => p.status === 'done')} by={by} />
      <p class="hint" style="margin-top:10px">{t('placePageNote', { place: placeName(page) })}</p>
    </div>
  );
}
