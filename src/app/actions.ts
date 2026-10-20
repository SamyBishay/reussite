// Write-side actions. Every write goes through store.ts (createDoc, update, upsert, removeDoc).
import { createDoc, update, upsert, removeDoc, today, toast, days, tasks, stays, places, people, addresses, db, newId, type WithId } from './store';
import { T, rawPlan, dayDoc, whereOf, elapsedSec, running, isOpen, cardsOn, minutesOn, ratio, planOf, type T as Tk } from './model';
import { projects } from './store';
import type { Address, Day, Launch, Person, Place, Project, Session, SessionSource, Stay, Task, Verdict, Visit } from '../data/schema';
import { fieldsOf } from '../data/doc';
import { normAddress } from '../data/normalize';
import { seenAfter, visitPromptFor } from '../domain/offers';
import { addDays } from '../domain/dates';
import { dueRulePatches, finishEffects, newTaskFields, nextOccurrence, projectCompletes } from '../domain/effects';
import { t } from '../i18n';

const nowISO = () => new Date().toISOString();

export const newTaskDoc = (title: string, suit: Task['suit'] | null, project: string | null, extra: Partial<Task> = {}): Task =>
  newTaskFields(title, suit, project, extra, projects.value, nowISO(), Date.now());
export const createTask = (doc: Task) => createDoc('tasks', doc);
export const patchTask = (id: string, p: Partial<Task>) => update<Task>('tasks', id, p);

export async function dayPatch(k: string, p: Partial<Day>) {
  if (days.value.has(k)) return update<Day>('days', k, p);
  return upsert<Day>('days', k, { date: k, plan: [], launches: [], first: null, checkin: null, closed: null, summary: null, ...p });
}

// ---------- sessions ----------
export async function addSession(taskId: string, m: number, why: string | null, source: SessionSource, d = today.value) {
  await createDoc<Session>('sessions', { taskId, d, m: Math.max(1, Math.round(m)), why, at: nowISO(), source });
}
/** Editing a session makes it `corrected` (brief §5). */
export const editSession = (id: string, p: Partial<Session>) => update<Session>('sessions', id, { ...p, source: 'corrected' });
export const deleteSession = (id: string) => removeDoc('sessions', id);

// ---------- the timer ----------
/** Start the timer, now or backdated ("I started earlier"). */
export async function startTask(id: string, startedAt?: Date) {
  const cur = running();
  if (cur && cur.id !== id) await stopTimer(cur, 'switched', null);
  const tk = T(id);
  // The first session freezes the estimate the learning uses (brief §5).
  const freeze = tk && tk.est0 == null && tk.est ? { est0: tk.est } : {};
  await patchTask(id, { started: (startedAt ?? new Date()).toISOString(), stillAt: null, ...freeze });
}

/** Stop the timer. `minutes` overrides the clock ("I stopped at…") and saves the session as corrected. */
export async function stopTimer(tk: Tk, why: string | null, resume: string | null, minutes?: number) {
  const m = minutes ?? Math.max(1, Math.round(elapsedSec(tk) / 60));
  await addSession(tk.id, m, why, minutes != null ? 'corrected' : 'timer', sessionDay(tk));
  await patchTask(tk.id, { started: null, stillAt: null, resume: resume == null ? tk.resume ?? null : resume || null });
}
/** A timer started yesterday and stopped today belongs to the day it started. */
const sessionDay = (tk: Tk) => (tk.started && tk.started.slice(0, 10) < today.value && Date.now() - Date.parse(tk.started) < 36e5 * 30 ? addDays(today.value, -1) : today.value);

/** `addressId`: the address whose after-visit screen to show (a step that feeds it was just done and no visit came from it yet). */
export interface Finished { last: boolean; projectDone: string | null; nextId: string | null; addressId: string | null }

/**
 * Mark a step done, today or on another day. With a running timer, its time is saved
 * (or `minutes`, corrected). Without one, `typed` minutes are saved as `typed`; null means
 * "didn't time it". Repeating steps come back once, on their next date.
 */
export async function finishTask(tk: Tk, typed: number | null, day = today.value, minutes?: number): Promise<Finished> {
  const k = today.value;
  const wasLast = rawPlan(k).includes(tk.id) && planOf(k).filter(id => id !== tk.id && T(id)?.status === 'open' && !T(id)?.fixed).length === 0;
  const { patch, session } = finishEffects(tk, { today: k, day, nowIso: nowISO(), nowMs: Date.now(), typed, minutes });
  if (session) await addSession(tk.id, session.m, session.why, session.source, session.d);
  await patchTask(tk.id, patch);
  const nextId = tk.repeat ? await createNext(tk, day) : null;
  const projectDone = await maybeCompleteProject(tk.project);
  if (tk.personId) await seeStepPerson(tk.personId, day);
  return { last: wasLast && day === k, projectDone, nextId, addressId: visitPromptFor(tk, addresses.value) };
}

/** A project whose real steps are all done moves to the Completed shelf. */
async function maybeCompleteProject(pid: string): Promise<string | null> {
  if (!projectCompletes(pid, projects.value, tasks.value.values())) return null;
  await update<Project>('projects', pid, { status: 'done', doneAt: nowISO() });
  return pid;
}

export async function reopen(id: string) {
  const tk = T(id);
  await patchTask(id, { status: 'open', doneAt: null, doneDay: null });
  const p = tk && projects.value.get(tk.project);
  if (p?.status === 'done') await update<Project>('projects', p.id, { status: 'active', doneAt: null });
}
/** Drop a step for good (a repeating one stops repeating). */
export async function dropTask(id: string) {
  await patchTask(id, { status: 'dropped', started: null });
  if (rawPlan(today.value).includes(id)) await removeToday(id);
}

// ---------- repeating steps ----------
/** Create the next occurrence once; returns its id, or null when the series has ended. */
export async function createNext(tk: Tk, day: string): Promise<string | null> {
  const next = nextOccurrence(tk, day, tasks.value.values());
  if (!next) return null;
  if ('existing' in next) return next.existing;
  return createTask(newTaskDoc(tk.title, tk.suit, tk.project, next.fields));
}
/** "Skip this time": drop this occurrence and create the next. */
export async function skipThisTime(id: string) {
  const tk = T(id);
  if (!tk) return;
  await dropTask(id);
  await createNext(tk, today.value);
}
export const stopRepeating = (id: string) => patchTask(id, { repeat: null });

// ---------- a day's plan (any day: the day navigator and the calendar) ----------
export async function addToday(id: string, quiet = false, k = today.value) {
  const p = rawPlan(k);
  if (p.includes(id)) return;
  p.push(id);
  await dayPatch(k, { plan: p });
  if (!quiet) toast(k === today.value ? t('addedToday') : t('plannedOn', { date: k }));
}
export const removeToday = (id: string, k = today.value) => dayPatch(k, { plan: rawPlan(k).filter(x => x !== id) });
export async function movePlan(id: string, dir: -1 | 1, k = today.value) {
  const p = rawPlan(k);
  const i = p.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= p.length) return;
  [p[i], p[j]] = [p[j]!, p[i]!];
  await dayPatch(k, { plan: p });
}
/** "Plan it on…": put a step on a day's list (and off any other future day's). */
export async function planOn(id: string, k: string) {
  for (const d of days.value.values()) if (d.date !== k && d.date >= today.value && d.plan?.includes(id)) await dayPatch(d.date, { plan: d.plan.filter(x => x !== id) });
  await addToday(id, true, k);
}
export const dueOn = (id: string, k: string | null) => patchTask(id, { due: k, dueRule: null });
/** A done step moved to another day changes its done date. */
export const moveDone = (id: string, k: string) => patchTask(id, { doneDay: k, doneAt: k + 'T12:00:00.000Z' });

export async function cloneTemplate(id: string, k = today.value, at?: string) {
  const tk = T(id);
  if (!tk) return null;
  // A copy with a time is due that day, or it falls out of the day's fixed times and the calendar.
  const time = at ?? tk.at ?? null;
  const nid = await createTask(newTaskDoc(tk.title, tk.suit, tk.project, {
    est: tk.est ?? null, estBy: tk.estBy ?? null, where: whereOf(tk), from: id, note: tk.note || '', starter: tk.starter ?? null,
    app: tk.app ?? null, link: tk.link ?? null, at: time, dur: tk.dur ?? tk.est ?? null, due: time ? k : null, important: true,
  }));
  await addToday(nid, true, k);
  return nid;
}
export async function carryOver() {
  const k = today.value;
  const add = yesterdayCarry(k);
  if (!add.length) return;
  await carry(add, k);
  toast(t('carried', { n: add.length }));
}
const yesterdayCarry = (k: string) => rawPlan(addDays(k, -1)).filter(id => isOpen(T(id)) && !rawPlan(k).includes(id));
/** Carry steps to a day's list; each carry counts (at 3, the step is too big or hides a decision). */
export async function carry(ids: string[], k = today.value) {
  const plan = rawPlan(k);
  const add = ids.filter(id => !plan.includes(id));
  if (add.length) await dayPatch(k, { plan: plan.concat(add) });
  for (const id of add) await patchTask(id, { carried: (T(id)!.carried || 0) + 1 });
}
export async function setFirst(id: string, k = today.value) {
  const tk = T(id);
  if (!tk) return;
  const p = rawPlan(k).filter(x => x !== id);
  p.unshift(id);
  await dayPatch(k, { plan: p, first: { id, title: tk.title } });
  if (k === today.value) toast(t('startHereToast', { title: tk.title }));
}
export async function addLaunch(time: string, kind: Launch['k'], k = today.value) {
  const L = [...(dayDoc(k)?.launches ?? []), { t: time, k: kind }].sort((a, b) => a.t.localeCompare(b.t));
  await dayPatch(k, { launches: L });
}
export async function delLaunch(i: number, k = today.value) {
  const L = [...(dayDoc(k)?.launches ?? [])];
  L.splice(i, 1);
  await dayPatch(k, { launches: L });
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
  // Optional Later cards that weren't played go back to Later, with no carry count.
  const optional = (dayDoc(k)?.optional ?? []).filter(x => T(x)?.status === 'open');
  if (optional.length) await dayPatch(k, { plan: rawPlan(k).filter(x => !optional.includes(x)) });
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

// ---------- projects ----------
export const patchProject = (id: string, p: Partial<Project>) => update<Project>('projects', id, p);
/** Swap a step with its neighbour in its project's order. */
export async function moveStep(id: string, dir: -1 | 1) {
  const tk = T(id);
  if (!tk) return;
  const sib = [...tasks.value.values()].filter(x => x.project === tk.project && x.status === 'open' && !x.template).sort((a, b) => (a.order || 0) - (b.order || 0));
  const i = sib.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= sib.length) return;
  const a = sib[i]!, b = sib[j]!;
  const oa = a.order || 0, ob = b.order || 0;
  await patchTask(a.id, { order: oa === ob ? ob + dir : ob });
  await patchTask(b.id, { order: oa });
}
export async function moveProject(id: string, dir: -1 | 1) {
  const p = projects.value.get(id);
  if (!p) return;
  const sib = [...projects.value.values()].filter(x => x.suit === p.suit && x.status !== 'done' && x.status !== 'dropped' && x.id !== 'inbox').sort((a, b) => (a.order || 0) - (b.order || 0));
  const i = sib.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= sib.length) return;
  const a = sib[i]!, b = sib[j]!;
  const oa = a.order || 0, ob = b.order || 0;
  await patchProject(a.id, { order: oa === ob ? ob + dir : ob });
  await patchProject(b.id, { order: oa });
}

// ---------- places and stays ----------
export async function addPlace(name: string): Promise<string> {
  const n = name.trim();
  const same = [...places.value.values()].find(p => p.name.toLowerCase() === n.toLowerCase());
  if (same) return same.id;
  return createDoc<Place>('places', { name: n, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, order: places.value.size });
}
export async function saveStay(id: string | null, s: Stay): Promise<string> {
  const sid = id ?? await createDoc<Stay>('stays', s);
  if (id) await update<Stay>('stays', id, s);
  await syncDueRules(sid, s);
  return sid;
}
export const removeStay = (id: string) => removeDoc('stays', id);
/** "Before I leave" steps move with their stay's dates, so they turn urgent on their own. */
export async function syncDueRules(stayId: string, s: Pick<Stay, 'to'> | undefined = stays.value.get(stayId)) {
  if (!s) return;
  for (const x of dueRulePatches(stayId, s, tasks.value.values())) await patchTask(x.id, { due: x.due });
}

// ---------- addresses and people (phase 4) ----------
type AddressFields = Pick<Address, 'name'> & Partial<Omit<Address, 'name'>>;

/** A new address; its id. Unset fields get their defaults (state *want to go*, category *other*, by the person). */
export const createAddress = (a: AddressFields): Promise<string> =>
  createDoc<Address>('addresses', { category: 'other', placeId: 'any', mapsUrl: null, street: null, state: 'want', visits: [], by: 'me', note: '', ...a, name: a.name.trim() });
export const editAddress = (id: string, p: Partial<Address>) => update<Address>('addresses', id, p);
/** Remove an address (a tombstone; its visits go with it). */
export const removeAddress = (id: string) => removeDoc('addresses', id);

/** The address as stored now, not as the screen last saw it, so two quick edits don't overwrite each other. */
async function currentAddress(id: string): Promise<Address | null> {
  const d = await db.table_('addresses').get(id);
  return d && !d._del ? normAddress(fieldsOf(d) as Record<string, unknown>) : null;
}

/**
 * Record a visit: the day (default today), how it was, whether to go back, and the step that took the person
 * there if any. The address becomes *been*. Returns the visit's id, or null when the address is gone.
 * A second visit from the same step replaces the first (the after-visit screen opened twice writes one).
 */
export async function recordVisit(addressId: string, v: { note?: string; verdict: Verdict; day?: string; stepId?: string | null }): Promise<string | null> {
  const cur = await currentAddress(addressId);
  if (!cur) return null;
  const same = v.stepId ? cur.visits.find(x => x.stepId === v.stepId) : undefined;
  const visit: Visit = { id: same?.id ?? newId('v'), day: v.day ?? today.value, note: (v.note ?? '').trim(), verdict: v.verdict, stepId: v.stepId ?? null };
  await update<Address>('addresses', addressId, { visits: same ? cur.visits.map(x => (x === same ? visit : x)) : [...cur.visits, visit], state: 'been' });
  return visit.id;
}
/** Edit or remove one visit (an empty `patch` is not allowed; to remove pass `null`). */
export async function editVisit(addressId: string, visitId: string, patch: Partial<Pick<Visit, 'day' | 'note' | 'verdict'>> | null): Promise<void> {
  const cur = await currentAddress(addressId);
  if (!cur) return;
  const visits = patch ? cur.visits.map(x => (x.id === visitId ? { ...x, ...patch } : x)) : cur.visits.filter(x => x.id !== visitId);
  await update<Address>('addresses', addressId, { visits });
}

type PersonFields = Pick<Person, 'name'> & Partial<Omit<Person, 'name'>>;
export const createPerson = (p: PersonFields): Promise<string> =>
  createDoc<Person>('people', { placeId: 'any', reach: null, note: '', lastSeen: null, ...p, name: p.name.trim() });
export const editPerson = (id: string, p: Partial<Person>) => update<Person>('people', id, p);
export const removePerson = (id: string) => removeDoc('people', id);
/** Set when the person was last seen (a date); `null` clears it. */
export const setLastSeen = (id: string, day: string | null) => update<Person>('people', id, { lastSeen: day });

/** A step that feeds a person was done on `day`: their last seen becomes that day, never an earlier one than it already is. */
async function seeStepPerson(personId: string, day: string): Promise<void> {
  const p = people.value.get(personId);
  if (!p) return;
  const next = seenAfter(p.lastSeen, day);
  if (next !== p.lastSeen) await setLastSeen(personId, next);
}
