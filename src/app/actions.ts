// Write-side actions, ported from v1. Sessions are their own documents now.
import { createDoc, update, upsert, today, toast, days, type WithId } from './store';
import { T, rawPlan, dayDoc, whereOf, elapsedSec, running, isOpen, cardsOn, minutesOn, ratio, type T as Tk } from './model';
import { projects } from './store';
import type { Day, Launch, SessionSource, Task } from '../data/schema';
import { addDays } from '../domain/dates';
import { t } from '../i18n';

const nowISO = () => new Date().toISOString();

export function newTaskDoc(title: string, suit: Task['suit'] | null, project: string | null, extra: Partial<Task> = {}): Task {
  const p = projects.value.get(project ?? '') ?? ({} as Partial<WithId<{ suit: Task['suit']; where: string }>>);
  return {
    title, suit: suit || p.suit || 'S', project: project || 'inbox', kind: 'task', urgent: false, important: true, due: null,
    est: null, est0: null, estBy: null, status: 'open', doneDay: null, doneAt: null, started: null, resume: null, carried: 0,
    where: p.where || 'any', template: false, note: '', order: Date.now(), created: nowISO(), src: 'page', ...extra,
  };
}

export const createTask = (doc: Task) => createDoc('tasks', doc);
export const patchTask = (id: string, p: Partial<Task>) => update<Task>('tasks', id, p);

export async function dayPatch(k: string, p: Partial<Day>) {
  if (days.value.has(k)) return update<Day>('days', k, p);
  return upsert<Day>('days', k, { date: k, plan: [], launches: [], first: null, checkin: null, closed: null, summary: null, ...p });
}

async function addSession(taskId: string, m: number, why: string | null, source: SessionSource, d = today.value) {
  await createDoc('sessions', { taskId, d, m, why, at: nowISO(), source });
}

export async function startTask(id: string) {
  const cur = running();
  if (cur && cur.id !== id) await stopTimer(cur, 'switched', null);
  const tk = T(id);
  // The first session freezes the estimate the learning uses (brief §5).
  const freeze = tk && tk.est0 == null && tk.est ? { est0: tk.est } : {};
  await patchTask(id, { started: nowISO(), ...freeze });
}

export async function stopTimer(tk: Tk, why: string | null, resume: string | null) {
  const m = Math.max(1, Math.round(elapsedSec(tk) / 60));
  await addSession(tk.id, m, why, 'timer');
  await patchTask(tk.id, { started: null, resume: resume == null ? tk.resume ?? null : resume || null });
}

/**
 * Mark a step done. With a running timer, its time is saved. Without one, `typed` minutes
 * (from the duration sheet) are saved as a `typed` session; null means "didn't time it".
 */
export async function finishTask(tk: Tk, typed: number | null) {
  const patch: Partial<Task> = { status: 'done', doneAt: nowISO(), doneDay: today.value, resume: null, started: null };
  if (tk.started) await addSession(tk.id, Math.max(1, Math.round(elapsedSec(tk) / 60)), 'done', 'timer');
  else if (typed && typed > 0) await addSession(tk.id, typed, 'done', 'typed');
  if (tk.est0 == null && tk.est) patch.est0 = tk.est;
  await patchTask(tk.id, patch);
}

export const reopen = (id: string) => patchTask(id, { status: 'open', doneAt: null, doneDay: null });

export async function dropTask(id: string) {
  await patchTask(id, { status: 'dropped', started: null });
  if (rawPlan(today.value).includes(id)) await removeToday(id);
}

export async function addToday(id: string, quiet = false) {
  const p = rawPlan(today.value);
  if (p.includes(id)) return;
  p.push(id);
  await dayPatch(today.value, { plan: p });
  if (!quiet) toast(t('addedToday'));
}
export const removeToday = (id: string) => dayPatch(today.value, { plan: rawPlan(today.value).filter(x => x !== id) });

export async function movePlan(id: string, dir: -1 | 1) {
  const p = rawPlan(today.value);
  const i = p.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= p.length) return;
  [p[i], p[j]] = [p[j]!, p[i]!];
  await dayPatch(today.value, { plan: p });
}

export async function cloneTemplate(id: string) {
  const tk = T(id);
  if (!tk) return;
  const nid = await createTask(newTaskDoc(tk.title, tk.suit, tk.project, { est: tk.est ?? null, estBy: tk.estBy ?? null, where: whereOf(tk), from: id, note: tk.note || '' }));
  await addToday(nid);
}

export async function carryOver() {
  const k = today.value;
  const plan = rawPlan(k);
  const add = rawPlan(addDays(k, -1)).filter(id => isOpen(T(id)) && !plan.includes(id));
  if (!add.length) return;
  await dayPatch(k, { plan: plan.concat(add) });
  for (const id of add) await patchTask(id, { carried: (T(id)!.carried || 0) + 1 });
  toast(t('carried', { n: add.length }));
}

export async function setFirst(id: string) {
  const tk = T(id);
  if (!tk) return;
  const p = rawPlan(today.value).filter(x => x !== id);
  p.unshift(id);
  await dayPatch(today.value, { plan: p, first: { id, title: tk.title } });
  toast(t('startHereToast', { title: tk.title }));
}

export async function addLaunch(time: string, k: Launch['k']) {
  const L = [...(dayDoc(today.value)?.launches ?? []), { t: time, k }].sort((a, b) => a.t.localeCompare(b.t));
  await dayPatch(today.value, { launches: L });
}
export async function delLaunch(i: number) {
  const L = [...(dayDoc(today.value)?.launches ?? [])];
  L.splice(i, 1);
  await dayPatch(today.value, { launches: L });
}

export async function closeDay(firstId: string | null, newTitle: string, time: string) {
  const k = today.value;
  const r = running();
  if (r) await stopTimer(r, 'close', null);
  let id = firstId, title = firstId ? T(firstId)?.title ?? '' : '';
  if (!id && newTitle.trim()) {
    title = newTitle.trim();
    id = await createTask(newTaskDoc(title, 'S', 'inbox', { src: 'close' }));
  }
  await dayPatch(k, { closed: nowISO(), summary: { cards: cardsOn(k).length, minutes: Math.round(minutesOn(k)), ratio: ratio.value.v } });
  if (id) {
    const tk = addDays(k, 1), td = dayDoc(tk);
    const plan = [id, ...(td?.plan ?? []).filter(x => x !== id)];
    const L = (td?.launches ?? []).filter(l => !l.first);
    if (time) L.push({ t: time, k: 'start', n: title, first: true });
    L.sort((a, b) => a.t.localeCompare(b.t));
    await dayPatch(tk, { plan, first: { id, title }, launches: L });
  }
  toast(id ? t('dayClosedFirst', { title }) : t('dayClosedToast'));
}
