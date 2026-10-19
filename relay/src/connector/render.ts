// What the read tools say, as compact plain text an AI can use: the same lines the app's AI
// context uses (src/domain/lists.ts), plus a few labelled facts. Nothing here writes.
import type { Planned } from '../../../src/ai/apply';
import type { Task } from '../../../src/data/schema';
import { fit, predict, type Model } from '../../../src/domain/estimates';
import {
  blocked, byPriority, decisionsToCheck, estPointsOf, fixedOn, isOpen, listOf, oneLine, planOf, projName, quadOf, stepLine, yesterdayOpen, type TaskW,
} from '../../../src/domain/lists';
import { addDays } from '../../../src/domain/dates';
import type { View } from './view';

export const MAX_LINES = 50;

export const mins = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`);

const model = new WeakMap<View, Model>();
function estModel(v: View): Model {
  let m = model.get(v);
  if (!m) {
    const points = estPointsOf(v.tasks.values(), v.sessions.values());
    // Finished steps in the cold part count too (hot ones were just counted: a step in both is skipped).
    if (v.cold) for (const [id, est0, real, w0, doneDay, app, project, suit, by] of v.cold.x.est) {
      if (!v.tasks.has(id as string)) points.push({ id: id as string, title: '', est0: est0 as number, real: real as number, w0: w0 as number, doneDay: doneDay as string, app: app as string | null, project: project as string | null, suit: suit as string, by: by as 'me' | 'ai' | null });
    }
    m = fit(points, v.today);
    model.set(v, m);
  }
  return m;
}
const personal = (v: View, t: Pick<Task, 'est' | 'app' | 'project' | 'suit' | 'estBy'>) => predict(estModel(v), { est: t.est, app: t.app, project: t.project, suit: t.suit, estBy: t.estBy });

export const line = (v: View, t: TaskW) => stepLine(t, v.data);
export const lines = (v: View, ts: TaskW[], max = MAX_LINES) => ts.slice(0, max).map(t => line(v, t)).join('\n');

const weekday = (k: string) => new Date(k + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });

/** The first line of every answer: the date, the place, what urgent means. */
export function header(v: View): string {
  const { today, here } = v.where;
  const where = here === 'any' ? '' : `, in ${v.places.get(here)?.name ?? here}`;
  return `Today is ${weekday(today)} ${today}${where}. Urgent means due within ${v.settings.urgencyDays} days.`;
}

/** One step with what a person needs to start it. */
function step(v: View, t: TaskW): string {
  const extra: string[] = [];
  if (t.at) extra.push(`at ${t.at}${t.dur ? ' for ' + mins(t.dur) : ''}`);
  if (t.starter) extra.push(`starter: ${oneLine(t.starter)}`);
  if (t.resume) extra.push(`resume: ${oneLine(t.resume)}`);
  if (t.started) extra.push(`timer running since ${t.started.slice(11, 16)} UTC`);
  if (blocked(t, v.tasks)) extra.push('waiting on ' + listOf(t.after).map(id => v.tasks.get(id)?.title ?? id).join(', '));
  return line(v, t) + (extra.length ? '\n    ' + extra.join(' · ') : '');
}

/** A day: its list in order, launch points, fixed times, the next step, and for today what carries over. */
export function dayText(v: View, k: string): string {
  const d = v.data;
  const day = v.days.get(k);
  const isToday = k === v.today;
  const plan = planOf(d, k).map(id => v.tasks.get(id)!);
  const optional = new Set(day?.optional ?? []);
  const open = plan.filter(t => isOpen(t));
  const work = open.filter(t => !optional.has(t.id));
  const L: string[] = [isToday ? header(v) : `${weekday(k)} ${k}.`];

  if (isToday && v.where.here !== 'any') L.push(`Place: ${v.places.get(v.where.here)?.name ?? v.where.here} (${v.zone})`);
  const next = open[0];
  if (isToday) L.push(next ? `Next step:\n${step(v, next)}` : plan.length ? 'Next step: none, the list is played.' : 'Next step: none, no list yet today.');

  if (plan.length) {
    const est = work.reduce((a, t) => a + (personal(v, t)?.value ?? t.est ?? 0), 0);
    const lo = work.reduce((a, t) => a + (personal(v, t)?.lo ?? t.est ?? 0), 0);
    const hi = work.reduce((a, t) => a + (personal(v, t)?.hi ?? t.est ?? 0), 0);
    const total = est > 0 ? ` · estimated ${lo !== hi ? `${mins(est)} (range ${mins(lo)} to ${mins(hi)})` : mins(est)}` : '';
    L.push(`List (${open.length} open of ${plan.length}${total}), in order:\n` + plan.map((t, i) => `${i + 1}. ${line(v, t)}${optional.has(t.id) ? ' [if there is room]' : ''}${t.at ? ` [${t.at}]` : ''}${t.started ? ' [running]' : ''}`).join('\n'));
  } else L.push('List: empty.');

  const launches = day?.launches ?? [];
  if (launches.length) L.push('Launch points: ' + launches.map(l => `${l.t} ${l.k}${l.n ? ' (' + oneLine(l.n) + ')' : ''}`).join(', '));
  const fixed = fixedOn(d, k);
  if (fixed.length) L.push('Fixed times:\n' + fixed.map(t => `${t.at}${t.dur ? ' (' + mins(t.dur) + ')' : ''} ${line(v, t)}`).join('\n'));
  if (isToday) {
    const carried = yesterdayOpen(d, k, addDays(k, -1)).map(id => v.tasks.get(id)!);
    if (carried.length) L.push(`Carried from yesterday, not on today's list yet (${carried.length}):\n${lines(v, carried, 10)}`);
    const check = decisionsToCheck(v.decisions.values(), k);
    if (check.length) L.push('Decisions to check: ' + check.map(c => `${c.id} ${oneLine(c.title)}`).join('; '));
  }
  const done = [...v.tasks.values()].filter(t => t.status === 'done' && !t.template && t.doneDay === k);
  let minutes = 0;
  for (const s of v.sessions.values()) if (s.d === k) minutes += Number(s.m) || 0;
  if (done.length || minutes) L.push(`Done: ${done.length} step${done.length === 1 ? '' : 's'}, ${mins(Math.round(minutes))} worked.${done.length ? '\n' + lines(v, done, 10) : ''}`);
  if (day?.first && !isToday) L.push(`First step chosen: ${oneLine(day.first.title)}`);
  return L.join('\n\n');
}

export interface Query { quadrant?: number; project?: string; place?: string; status?: 'open' | 'done' | 'dropped' | 'all'; dueFrom?: string; dueTo?: string; text?: string; limit?: number }

export function queryText(v: View, q: Query, ids: { project?: string; place?: string }): string {
  const status = q.status ?? 'open';
  const words = q.text ? q.text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean) : [];
  const d = v.data;
  const hit = [...v.tasks.values()].filter(t => {
    if (t.template) return false;
    if (status !== 'all' && t.status !== status) return false;
    if (q.quadrant && quadOf(t, d.today, d.urgencyDays) !== q.quadrant) return false;
    if (ids.project && t.project !== ids.project) return false;
    if (ids.place) { const w = t.where || v.projects.get(t.project)?.where || 'any'; if (w !== 'any' && w !== ids.place) return false; }
    if (q.dueFrom && !(t.due && t.due >= q.dueFrom)) return false;
    if (q.dueTo && !(t.due && t.due <= q.dueTo)) return false;
    if (words.length) {
      const hay = (t.title + ' ' + t.note + ' ' + projName(v.projects, t.project)).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  });
  hit.sort(status === 'done' || status === 'dropped' ? (a, b) => String(b.doneDay ?? '').localeCompare(String(a.doneDay ?? '')) || a.order - b.order : (a, b) => byPriority(a, b, d));
  const max = Math.min(q.limit ?? MAX_LINES, MAX_LINES);
  if (!hit.length) return 'No steps match.';
  return `${hit.length} step${hit.length === 1 ? '' : 's'} match${hit.length > max ? `, showing the first ${max}` : ''}.\n${'id | title | quadrant | due | estimate | project'}\n${lines(v, hit, max)}`;
}

export function taskText(v: View, t: TaskW): string {
  const d = v.data;
  const f = (label: string, val: unknown) => (val == null || val === '' || (Array.isArray(val) && !val.length) ? null : `${label}: ${typeof val === 'object' ? JSON.stringify(val) : val}`);
  const p = personal(v, t);
  const L = [
    line(v, t),
    f('status', t.status + (t.doneDay ? ' on ' + t.doneDay : '')),
    f('quadrant', `Q${quadOf(t, d.today, d.urgencyDays)}${t.urgent ? ' (marked urgent)' : ''}${t.important ? '' : ', not important'}`),
    f('estimate', t.est ? `${mins(t.est)}${p ? `, personal estimate ${mins(p.value)} (range ${mins(p.lo)} to ${mins(p.hi)})` : ''}` : null),
    f('at', t.at ? `${t.at}${t.dur ? ' for ' + mins(t.dur) : ''}` : null),
    f('where', t.where && t.where !== 'any' ? v.places.get(t.where)?.name ?? t.where : null),
    f('starter', t.starter), f('resume', t.resume), f('note', t.note),
    f('app', t.app), f('link', t.link), f('prompt', t.prompt),
    f('waiting on', listOf(t.after).map(id => `${id} ${oneLine(v.tasks.get(id)?.title ?? '')}`)),
    f('repeats', t.repeat), f('carried', t.carried || null), f('stuck', t.stalls || null), f('frictions', t.friction),
    f('created', t.created), f('by', t.src === 'ai' ? 'an AI' : null),
  ].filter(Boolean);
  const ss = [...v.sessions.values()].filter(s => s.taskId === t.id).sort((a, b) => String(a.d + a.at).localeCompare(String(b.d + b.at)));
  L.push(ss.length ? `Sessions (${ss.length}, ${mins(ss.reduce((a, s) => a + (Number(s.m) || 0), 0))} in all):\n` + ss.map(s => `${s.d} | ${s.m}m | ${s.source}${s.why ? ' | ' + s.why : ''}`).join('\n') : 'Sessions: none.');
  return L.join('\n');
}

export function projectText(v: View, id: string): string {
  const p = v.projects.get(id);
  const d = v.data;
  if (!p) {
    if (id !== 'inbox') return '';
    const open = [...v.tasks.values()].filter(t => t.project === 'inbox' && t.status === 'open' && !t.template).sort((a, b) => byPriority(a, b, d));
    return `Project inbox: Inbox\n${open.length} open:\n${lines(v, open)}`;
  }
  const all = [...v.tasks.values()].filter(t => t.project === id && !t.template && t.status !== 'dropped');
  const open = all.filter(t => t.status === 'open').sort((a, b) => (a.order || 0) - (b.order || 0));
  const smart = p.smart ? Object.entries(p.smart).filter(([, x]) => x).map(([k, x]) => `${k}: ${oneLine(String(x))}`).join('; ') : '';
  const where = p.where && p.where !== 'any' ? `, place ${v.places.get(p.where)?.name ?? p.where}` : '';
  const done = all.length - open.length + (v.cold?.x.done[id] ?? 0);
  return `Project ${p.id}: ${oneLine(p.name)} (${p.status}, suit ${p.suit}${where}), due ${p.due ?? '-'}\ngoal: ${p.goal ? oneLine(p.goal) : '-'}${smart ? '\nSMART: ' + smart : ''}\n${done} steps done, ${open.length} open${open.length > MAX_LINES ? ` (first ${MAX_LINES})` : ''}:\n${lines(v, open)}`;
}

// ---------- change-sets, in words ----------

const show = (x: unknown): string => {
  if (x === null || x === undefined || x === '') return '-';
  if (Array.isArray(x)) return x.length ? x.map(show).join(', ') : '-';
  if (typeof x === 'object') { const s = JSON.stringify(x); return s.length > 90 ? s.slice(0, 87) + '...' : s; }
  return String(x);
};

/** One planned change as a line, with `before → after` for each field. */
export function describe(it: Planned, v: View): string {
  const what = it.target === 'task' ? 'step' : it.target;
  const name = it.title ? ` "${oneLine(it.title)}"` : '';
  const head = it.kind === 'create' ? `Add ${what}${name}` : it.kind === 'done' ? `Mark done:${name}` : it.kind === 'drop' ? `Drop${name}` : it.kind === 'reorder' ? 'Reorder steps' : `Change ${what}${name}`;
  const diffs = it.diffs.map(d => {
    const nice = (x: unknown) => (d.field === 'plan' || d.field === 'order' || d.field === 'after') && Array.isArray(x) ? x.map(i => v.tasks.get(String(i))?.title ?? i).join(', ') : show(x);
    return d.before === undefined ? `${d.field} ${nice(d.after)}` : `${d.field} ${nice(d.before)} → ${nice(d.after)}`;
  });
  return diffs.length ? `${head} (${diffs.join('; ')})` : head;
}
