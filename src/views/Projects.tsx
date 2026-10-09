// Projects by suit, ported from v1. The SMART editor arrives in phase 1.
import { useState } from 'preact/hooks';
import { tasks, projects, settings, createDoc, toast } from '../app/store';
import { isOpen, inPlace, blocked, byOrder, type T } from '../app/model';
import { createTask, newTaskDoc } from '../app/actions';
import { openTask, placeName, placeIds } from '../app/sheets';
import { Title, Suit, Due, suitName } from '../app/ui';
import { Scope, scope } from './Matrix';
import { t, fmtMin } from '../i18n';
import { SUIT_ORDER } from '../data/settings';
import type { Project, Task } from '../data/schema';

type P = Project & { id: string };
const openProj = new Set<string>();

function Step({ tk }: { tk: T }) {
  const done = tk.status === 'done';
  return (
    <li class={done ? 'done' : ''}>
      <span class={'g suit-' + tk.suit} aria-hidden="true">{tk.template ? '↻' : done ? '✓' : '·'}</span>
      <button class="linklike" type="button" onClick={() => openTask(tk.id)}><Title s={tk.title} /></button>
      <span class="due">{tk.template ? t('standing') : tk.est ? fmtMin(tk.est) : ''}</span>
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
  const steps = open.concat(done.sort((a, b) => String(a.doneAt ?? '').localeCompare(String(b.doneAt ?? ''))));
  const label = t('stepsDone', { d: done.length, n: total });
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
    <article class="proj">
      <h4><span>{p.name}</span><span class="frac">{total ? done.length + ' / ' + total : ''}</span></h4>
      {total > 0 && total <= 16 && <div class="bar" role="img" aria-label={label}>{real.map((_, i) => <i class={i < done.length ? 'on' : ''} />)}</div>}
      {total > 16 && <div class="bar cont" role="img" aria-label={label}><i style={{ width: Math.round((done.length / total) * 100) + '%' }} /></div>}
      {p.goal ? <p class="goal">{p.goal}{p.goalBy === 'ai' && <span class="proposed" title={t('proposedHint')}>{t('proposed')}</span>}</p>
        : p.id !== 'inbox' && <p class="goal muted">{t('noGoal')}</p>}
      {p.due && <p class="next"><Due k={p.due} /></p>}
      {next && <p class="next">{t('next', { what: '' })}<Title s={next.title} /></p>}
      <details open={openProj.has(p.id)} onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) openProj.add(p.id); else openProj.delete(p.id); }}>
        <summary>{tmpl.length && !total ? t('standingItems') : tmpl.length ? t('stepsAndStanding') : t('steps')}</summary>
        <ol class="steps">{steps.map(x => <Step key={x.id} tk={x} />)}{tmpl.map(x => <Step key={x.id} tk={x} />)}</ol>
        <form class="addstep" onSubmit={add}>
          <input type="text" name="title" placeholder={t('nextStepPlaceholder')} aria-label={t('newStepFor', { name: p.name })} autocomplete="off" required />
          <input type="number" name="est" min="1" max="600" placeholder={t('minShort')} aria-label={t('estimateMin')} />
          <button class="btn small" type="submit">{t('add')}</button>
        </form>
      </details>
    </article>
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
        <select aria-label={t('where')} value={where} onChange={e => setWhere((e.target as HTMLSelectElement).value)}>{[...placeIds(), 'any'].map(id => <option value={id}>{placeName(id)}</option>)}</select>
        <button class="btn primary" type="submit">{t('add')}</button>
      </div>
      <p class="hint">{t('smartHint')}</p>
    </form>
  );
}

export function Projects() {
  const by = new Map<string, T[]>();
  for (const x of tasks.value.values()) { if (!by.has(x.project)) by.set(x.project, []); by.get(x.project)!.push(x); }
  const projs = [...projects.value.values()].filter(p => p.status !== 'done' && p.status !== 'dropped');
  const here = settings.value.here;
  let hidden = 0;
  const vis = projs.filter(p => {
    const ok = scope.value === 'all' || !p.where || p.where === 'any' || p.where === here || (by.get(p.id) ?? []).some(x => isOpen(x) && inPlace(x));
    if (!ok) hidden++;
    return ok;
  });
  const inbox = by.get('inbox') ?? [];
  return (
    <div>
      <Scope hidden={hidden} />
      {SUIT_ORDER.map(s => {
        const ps = vis.filter(p => p.suit === s && p.id !== 'inbox').sort(byOrder);
        if (!ps.length) return null;
        return (
          <section class="suitsec"><h3><Suit s={s} /> {suitName(s)}</h3>
            <div class="projs">{ps.map(p => <ProjectCard key={p.id} p={p} ts={by.get(p.id) ?? []} />)}</div>
          </section>
        );
      })}
      {inbox.some(x => x.status === 'open') && (
        <section class="suitsec"><h3>{t('inbox')}</h3><p class="hint" style="margin-bottom:10px">{t('inboxHint')}</p>
          <div class="projs"><ProjectCard p={(projects.value.get('inbox') as P) ?? ({ id: 'inbox', name: t('inbox') } as P)} ts={inbox} /></div>
        </section>
      )}
      <NewProject />
    </div>
  );
}
