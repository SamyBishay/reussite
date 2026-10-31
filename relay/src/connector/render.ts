// What the read tools say, as compact plain text an AI can use: the same lines the app's AI
// context uses (src/domain/lists.ts), plus a few labelled facts. Nothing here writes.
import { createsNote, type Planned } from '../../../src/ai/apply';
import type { Task } from '../../../src/data/schema';
import { fit, predict, type Model } from '../../../src/domain/estimates';
import {
  blocked, byPriority, decisionsToCheck, estPointsOf, fixedOn, isEvent, isOpen, listOf, oneLine, planOf, projName, quadOf, stepLine, yesterdayOpen, type TaskW,
} from '../../../src/domain/lists';
import { nudgesDue, waitingList } from '../../../src/domain/events';
import { addDays } from '../../../src/domain/dates';
import { chainIndex, chainOf, effectiveDue, isWaiting, type ChainIndex } from '../../../src/domain/chains';
import { noteBlock, noteHead, notesMatching, type Note } from '../../../src/domain/memory';
import { findByName, norm } from '../../../src/domain/names';
import { onPage } from '../../../src/domain/places';
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

/** The chains of the open steps, built once per view: one pass, shared by every tool. */
const chainsOf = new WeakMap<View, ChainIndex>();
export function chains(v: View): ChainIndex {
  let ix = chainsOf.get(v);
  if (!ix) { ix = chainIndex(v.tasks); chainsOf.set(v, ix); }
  return ix;
}
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** When a standing step comes back: "every day at 20:00", "Mon Thu at 19:00". */
export function standingText(t: Pick<Task, 'weekdays' | 'at'>): string {
  const w = Array.isArray(t.weekdays) ? [...new Set(t.weekdays.map(Number).filter(d => Number.isInteger(d) && d >= 1 && d <= 7))].sort() : [];
  return (w.length === 7 ? 'every day' : w.length ? w.map(d => DOW[d - 1]).join(' ') : 'on no day') + (t.at ? ' at ' + t.at : '');
}

/** A step as a line; a chain's head says "+n after" and its chain's date, a step that waits says so, a standing step when it comes back. */
export const line = (v: View, t: TaskW) => {
  const ix = chains(v), c = ix.chains.get(t.id);
  const shown = t.template ? { ...t, title: `${t.title} (standing, ${standingText(t)})` } : t;
  return stepLine(shown, v.data, c ? { after: c.after, due: c.due } : isWaiting(ix, t.id) ? 'waiting' : undefined);
};
export const lines = (v: View, ts: TaskW[], max = MAX_LINES) => ts.slice(0, max).map(t => line(v, t)).join('\n');

const weekday = (k: string) => new Date(k + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });

/** The first line of every answer: the date, the place, what urgent means. */
export function header(v: View): string {
  const { today, here } = v.where;
  const where = here === 'any' ? '' : `, in ${v.places.get(here)?.name ?? here}`;
  return `Today is ${weekday(today)} ${today}${where}. Urgent means due within ${v.settings.urgencyDays} days.`;
}

/** A step's title in a "waiting on" list: something the person waits for (an event) is named as such. */
const waitName = (v: View, id: string): string => { const x = v.tasks.get(id); return x ? oneLine(x.title) + (isEvent(x) ? ' [waiting for]' : '') : id; };

/** One step with what a person needs to start it. */
function step(v: View, t: TaskW): string {
  const extra: string[] = [];
  if (t.at) extra.push(`at ${t.at}${t.dur ? ' for ' + mins(t.dur) : ''}`);
  if (t.starter) extra.push(`starter: ${oneLine(t.starter)}`);
  if (t.resume) extra.push(`resume: ${oneLine(t.resume)}`);
  if (t.started) extra.push(`timer running since ${t.started.slice(11, 16)} UTC`);
  if (blocked(t, v.tasks)) extra.push('waiting on ' + listOf(t.after).map(id => waitName(v, id)).join(', '));
  return line(v, t) + (extra.length ? '\n    ' + extra.join(' · ') : '');
}

/** A day: its list in order, launch points, fixed times, the next step, and for today what carries over. */
export function dayText(v: View, k: string): string {
  const d = v.data;
  const day = v.days.get(k);
  const isToday = k === v.today;
  const plan = planOf(d, k).filter(id => !isWaiting(chains(v), id)).map(id => v.tasks.get(id)!);
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
  if (day?.areas?.length) L.push('Half days: ' + day.areas.map(a => `${a.half === 'am' ? 'morning' : 'afternoon'} in ${v.places.get(a.placeId)?.name ?? a.placeId}`).join(', '));
  const fixed = fixedOn(d, k);
  if (fixed.length) L.push('Fixed times:\n' + fixed.map(t => `${t.at}${t.dur ? ' (' + mins(t.dur) + ')' : ''} ${line(v, t)}`).join('\n'));
  // Things the person waits for whose check date has come: asked from that day until answered, as Today does. Not steps, never on the list.
  if (k >= v.today) {
    const checks = nudgesDue(v.tasks.values(), k);
    if (checks.length) L.push(checks.map(t => `Check: ${oneLine(t.title)} (${t.id}, since ${t.nudge}). Ask whether it happened: task.done with the day it did, task.update nudge to ask again later, or task.drop.`).join('\n'));
  }
  if (isToday) {
    const carried = yesterdayOpen(d, k, addDays(k, -1)).map(id => v.tasks.get(id)!);
    if (carried.length) L.push(`Carried from yesterday, not on today's list yet (${carried.length}):\n${lines(v, carried, 10)}`);
    const check = decisionsToCheck(v.decisions.values(), k);
    if (check.length) L.push('Decisions to check: ' + check.map(c => `${c.id} ${oneLine(c.title)}`).join('; '));
  }
  const dayDone = [...v.tasks.values()].filter(t => t.status === 'done' && !t.template && t.doneDay === k);
  const done = dayDone.filter(t => !isEvent(t)), happened = dayDone.filter(isEvent);
  let minutes = 0;
  for (const s of v.sessions.values()) if (s.d === k) minutes += Number(s.m) || 0;
  if (done.length || minutes) L.push(`Done: ${done.length} step${done.length === 1 ? '' : 's'}, ${mins(Math.round(minutes))} worked.${done.length ? '\n' + lines(v, done, 10) : ''}`);
  if (happened.length) L.push(`Happened (things waited for):\n${lines(v, happened, 10)}`);
  if (day?.first && !isToday) L.push(`First step chosen: ${oneLine(day.first.title)}`);
  return L.join('\n\n');
}

/** A chain's head with its chain's earliest due date when that comes first, for the quadrant. */
const effective = (t: TaskW, ix: ChainIndex): TaskW => { const d = effectiveDue(ix, t.id, t.due); return d === (t.due ?? null) ? t : { ...t, due: d }; };

/** `standing`: only standing steps; `status: 'all'` includes them with the rest; otherwise they are left out. */
export interface Query { quadrant?: number; project?: string; place?: string; status?: 'open' | 'done' | 'dropped' | 'all'; standing?: boolean; waitingFor?: boolean; dueFrom?: string; dueTo?: string; text?: string; limit?: number }

export function queryText(v: View, q: Query, ids: { project?: string; place?: string }): string {
  const status = q.status ?? 'open';
  const words = q.text ? q.text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean) : [];
  const d = v.data;
  const ix = chains(v);
  let hidden = 0;
  const hit = [...v.tasks.values()].filter(t => {
    if (q.standing ? !t.template : t.template && status !== 'all') return false;
    if (q.waitingFor && !isEvent(t)) return false;
    // A step that waits is under its head ("+n after"); naming words finds it anyway. A thing waited for is always listed when asked for.
    if (!words.length && !q.waitingFor && isWaiting(ix, t.id)) { if (status === 'open' || status === 'all') hidden++; return false; }
    if (status !== 'all' && t.status !== status) return false;
    if (q.quadrant && (isEvent(t) || quadOf(effective(t, ix), d.today, d.urgencyDays) !== q.quadrant)) return false; // a thing waited for has no quadrant
    if (ids.project && t.project !== ids.project) return false;
    if (ids.place) { const w = t.where || v.projects.get(t.project)?.where || 'any'; if (!onPage(v.places, w, ids.place)) return false; }
    if (q.dueFrom && !(t.due && t.due >= q.dueFrom)) return false;
    if (q.dueTo && !(t.due && t.due <= q.dueTo)) return false;
    if (words.length) {
      const hay = (t.title + ' ' + t.note + ' ' + projName(v.projects, t.project)).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  });
  hit.sort(status === 'done' || status === 'dropped' ? (a, b) => String(b.doneDay ?? '').localeCompare(String(a.doneDay ?? '')) || a.order - b.order : (a, b) => byPriority(effective(a, ix), effective(b, ix), d));
  const max = Math.min(q.limit ?? MAX_LINES, MAX_LINES);
  if (q.waitingFor) {
    // What each holds back and how long it has been waited for (src/domain/events.ts, as the app's Waiting for screen).
    const by = new Map(waitingList(v.tasks.values(), d.today).map(w => [w.id, w]));
    const body = hit.slice(0, max).map(t => {
      const w = by.get(t.id);
      const extra = w ? [`waiting ${w.days} day${w.days === 1 ? '' : 's'}`, ...(w.unlocks.length ? [`holds back: ${w.unlocks.map(x => oneLine(x.title)).join(', ')}`] : [])] : [];
      return line(v, t) + (extra.length ? '\n    ' + extra.join(' · ') : '');
    }).join('\n');
    return hit.length ? `${hit.length} thing${hit.length === 1 ? '' : 's'} waited for (outside events, not steps to do or schedule)${hit.length > max ? `, showing the first ${max}` : ''}.\n${'id | title | - | - | - | project'}\n${body}` : 'Nothing is being waited for.';
  }
  const waiting = hidden ? ` ${hidden} more wait${hidden === 1 ? 's' : ''} for another step, under its head; get_task on a head lists its chain.` : '';
  if (!hit.length) return 'No steps match.' + waiting;
  return `${hit.length} step${hit.length === 1 ? '' : 's'} match${hit.length > max ? `, showing the first ${max}` : ''}.${waiting}\n${'id | title | quadrant | due | estimate | project'}\n${lines(v, hit, max)}`;
}

/** The steps of the chain a step is in, in the order they unfold (head first), each with its id; the step asked for is marked. */
function chainLines(v: View, t: TaskW): string[] {
  const c = chainOf(chains(v), t.id);
  if (!c) return [];
  return [...c.members.map(id => `${id === t.id ? '> ' : ''}${id} ${oneLine(v.tasks.get(id)?.title ?? '')}`), ...(c.due ? [`earliest due ${c.due}`] : [])];
}

export function taskText(v: View, t: TaskW): string {
  const d = v.data;
  const f = (label: string, val: unknown) => (val == null || val === '' || (Array.isArray(val) && !val.length) ? null : `${label}: ${typeof val === 'object' ? JSON.stringify(val) : val}`);
  const p = personal(v, t);
  const event = isEvent(t);
  const L = [
    line(v, t),
    f('status', (event && t.status === 'done' ? 'happened' : t.status) + (t.doneDay ? ' on ' + t.doneDay : '')),
    event ? f('waiting for', `something outside the person's hands, not a step to do or schedule${t.status === 'open' ? t.nudge ? `; check on ${t.nudge}, then ask whether it happened` : '; no check date' : ''}`) : f('quadrant', `Q${quadOf(t, d.today, d.urgencyDays)}${t.urgent ? ' (marked urgent)' : ''}${t.important ? '' : ', not important'}`),
    f('estimate', t.est ? `${mins(t.est)}${p ? `, personal estimate ${mins(p.value)} (range ${mins(p.lo)} to ${mins(p.hi)})` : ''}` : null),
    f('at', t.at ? `${t.at}${t.dur ? ' for ' + mins(t.dur) : ''}` : null),
    f('standing', t.template ? `${standingText(t)}${t.lead != null ? `, leave ${mins(t.lead)} before` : ''}; drop it to end the series` : null),
    f('copy of', t.from ? `${t.from} ${oneLine(v.tasks.get(t.from)?.title ?? '')}` : null),
    f('where', t.where && t.where !== 'any' ? v.places.get(t.where)?.name ?? t.where : null),
    f('label', t.label), f('starter', t.starter), f('resume', t.resume), f('note', t.note),
    f('app', t.app), f('link', t.link), f('prompt', t.prompt),
    f('waiting on', listOf(t.after).filter(id => v.tasks.get(id)?.status !== 'dropped').map(id => `${id} ${oneLine(v.tasks.get(id)?.title ?? '')}${isEvent(v.tasks.get(id)) ? ' [waiting for]' : ''}`)),
    f('chain', chainLines(v, t)),
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

// ---------- memory ----------

export const MAX_INDEX = 60;
const MAX_NOTES = 8;
const MAX_NOTE_STEPS = 10;
const newest = (a: Note, b: Note) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.id < b.id ? -1 : 1);

/** `id | kind | name | aliases` for the newest notes, at most MAX_INDEX. */
function noteIndex(notes: Note[]): string {
  const sorted = [...notes].sort(newest);
  return sorted.slice(0, MAX_INDEX).map(noteHead).join('\n') + (sorted.length > MAX_INDEX ? `\n(${sorted.length - MAX_INDEX} more; ask by name)` : '');
}

/**
 * What read_memory says. Private notes are not read at all: nothing here can tell an AI one exists.
 * Nothing asked: the profile in full, then the index. A name (an id, a name, an alias, or words with
 * one in them) and/or a query (free words: notes named in them, or with all the words in a line): the
 * matching notes in full, each with its open steps. Memory is in the hot part, so this never needs the cold one.
 */
export function memoryText(v: View, a: { name?: string; query?: string }): string {
  const notes: Note[] = [...v.memory.values()].filter(n => !n.private);
  const name = a.name?.trim(), query = a.query?.trim();
  if (!name && !query) {
    const profile = notes.filter(n => n.kind === 'profile').sort((x, y) => (x.id < y.id ? -1 : 1));
    const rest = notes.filter(n => n.kind !== 'profile');
    return [
      profile.length ? 'About the person, in their own words (note id | kind | name | aliases, then numbered lines):\n\n' + profile.map(noteBlock).join('\n\n') : 'No profile note yet.',
      rest.length ? `Other notes (id | kind | name | aliases; ask for one by name):\n${noteIndex(rest)}` : 'No other notes yet.',
    ].join('\n\n');
  }
  const hit = new Map<string, Note>();
  if (name) {
    const want = norm(name);
    const byId = v.memory.get(name);
    if (byId && !byId.private) hit.set(byId.id, byId);
    for (const n of notes) if (want && (norm(n.name) === want || n.aliases.some(x => norm(x) === want))) hit.set(n.id, n);
    for (const n of notesMatching(name, notes)) hit.set(n.id, n);
    if (!hit.size) { const f = findByName(name, notes.map(n => ({ id: n.id, name: n.name }))); if ('id' in f) hit.set(f.id, v.memory.get(f.id)!); else if ('many' in f) for (const m of f.many) hit.set(m.id, v.memory.get(m.id)!); }
  }
  if (query) {
    for (const n of notesMatching(query, notes)) hit.set(n.id, n);
    const words = norm(query).split(' ').filter(w => w.length > 2);
    if (words.length) for (const n of notes) if (n.lines.some(l => { const t = norm(l.text); return words.every(w => t.includes(w)); })) hit.set(n.id, n);
  }
  const found = [...hit.values()].sort(newest);
  if (!found.length) return `No memory note matches that. The notes (id | kind | name | aliases):\n${noteIndex(notes.filter(n => n.kind !== 'profile'))}`;
  const shown = found.slice(0, MAX_NOTES);
  const out = shown.map(n => {
    let t = noteBlock(n);
    if (n.kind !== 'profile') {
      const steps = queryText(v, { text: n.name, limit: MAX_NOTE_STEPS }, {});
      if (steps !== 'No steps match.') t += `\nOpen steps naming ${oneLine(n.name)}:\n${steps}`;
    }
    return t;
  });
  return (found.length > shown.length ? `${found.length} notes match, showing the ${shown.length} most recently updated.\n\n` : '') + `Memory (note id | kind | name | aliases, then numbered lines):\n\n` + out.join('\n\n');
}

// ---------- change-sets, in words ----------

const show = (x: unknown): string => {
  if (x === null || x === undefined || x === '') return '-';
  if (Array.isArray(x)) return x.length ? x.map(show).join(', ') : '-';
  if (typeof x === 'object') { const s = JSON.stringify(x); return s.length > 90 ? s.slice(0, 87) + '...' : s; }
  return String(x);
};

/** Whether a planned "done" is for something waited for (an event): then it is marked happened. */
const happens = (it: Planned, v: View): boolean => { const op = it.ops[0]; return op?.t === 'finish' && isEvent(v.tasks.get(op.id)); };

/** One planned change as a line, with `before → after` for each field. */
export function describe(it: Planned, v: View): string {
  const what = it.target === 'task' ? 'step' : it.target === 'memory' ? 'memory note' : it.target;
  const name = it.title ? ` "${oneLine(it.title)}"` : '';
  const waitingFor = it.target === 'task' && it.kind === 'create' && it.diffs.some(x => x.field === 'kind' && x.after === 'event');
  const head = it.kind === 'remember' ? `${createsNote(it) ? 'Remember, in a new note' : 'Remember, in the note'}${name}` : it.kind === 'create' ? `Add ${waitingFor ? 'waiting-for step' : what}${name}` : it.kind === 'done' ? `Mark ${happens(it, v) ? 'happened' : 'done'}:${name}` : it.kind === 'drop' ? `Drop${name}` : it.kind === 'reorder' ? 'Reorder steps' : `Change ${what}${name}`;
  const diffs = it.diffs.map(d => {
    const nice = (x: unknown) => (d.field === 'plan' || d.field === 'order' || d.field === 'after') && Array.isArray(x) ? x.map(i => v.tasks.get(String(i))?.title ?? i).join(', ') : show(x);
    return d.before === undefined ? `${d.field} ${nice(d.after)}` : `${d.field} ${nice(d.before)} → ${nice(d.after)}`;
  });
  return diffs.length ? `${head} (${diffs.join('; ')})` : head;
}
