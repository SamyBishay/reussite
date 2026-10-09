// From a change-set to reviewable changes, and from ticked changes to writes (brief §10).
// `planChanges` is pure: it checks every change against a snapshot of the data, drops what
// wouldn't change anything, and prepares low-level writes. `applyPlanned` runs only the ticked
// ones through a Writer (store.ts and actions.ts in the app, a fake in tests).
// AI-originated fields are marked `by`/`estBy`/`goalBy`/`smartBy: 'ai'`; weights are always 3.
import type { Change, ChangeSet, TaskSet } from './changeset';
import type { Day, Decision, Place, Project, Smart, Stay, Task, Collection, Launch } from '../data/schema';
import { COLUMNS, type Column, type Item, type Option } from '../domain/decision';
import { normDecision } from '../data/normalize';
import { isAllowedLink } from '../domain/links';

type W<T> = T & { id: string };
export interface Snapshot {
  today: string;
  tasks: Map<string, W<Task>>;
  projects: Map<string, W<Project>>;
  days: Map<string, W<Day>>;
  decisions: Map<string, W<Decision>>;
  places: Map<string, W<Place>>;
  stays: Map<string, W<Stay>>;
}
/** Ids, time and zone come from outside so tests are deterministic. */
export interface Gen { id: (prefix: string) => string; now: () => string; zone: string }

/** A string standing for the id of something created earlier in the same change-set. */
const REF = '\u0000ref:';
const asRef = (r: string) => REF + r;
export const isRef = (v: unknown): v is string => typeof v === 'string' && v.startsWith(REF);

export type Op =
  | { t: 'task'; ref?: string; fields: Partial<Task> & { title: string } }
  | { t: 'create'; c: Collection; ref?: string; fields: Record<string, unknown> }
  | { t: 'update'; c: Collection; id: string; patch: Record<string, unknown>; delta?: Delta }
  | { t: 'finish'; id: string; day: string }
  | { t: 'drop'; id: string }
  | { t: 'day'; k: string; patch: Partial<Day> }
  | { t: 'stay'; id: string | null; ref?: string; fields: Stay };

/** What a decision update adds, so two ticked updates of the same decision both land (see mergeDelta). */
export interface Delta { problem?: Record<string, string>; options?: Option[] }

export interface Diff { field: string; before: unknown; after: unknown }
export interface Planned {
  /** What it acts on and how; the review screen shows these. */
  target: 'task' | 'project' | 'day' | 'place' | 'stay' | 'decision';
  kind: 'create' | 'update' | 'done' | 'drop' | 'reorder';
  title: string;
  diffs: Diff[];
  ops: Op[];
}
export interface Plan { items: Planned[]; skipped: number; refTitles: Map<string, string> }

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const validZone = (z: string | undefined) => { if (!z) return false; try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } };

export function planChanges(cs: ChangeSet, s: Snapshot, gen: Gen): Plan {
  const refs = new Map<string, { target: string; title: string }>();
  for (const c of cs.changes) {
    if ('ref' in c && c.ref) refs.set(c.ref, { target: c.op.split('.')[0]!, title: 'set' in c ? String((c.set as { title?: string; name?: string }).title ?? (c.set as { name?: string }).name ?? '') : '' });
  }
  const refTitles = new Map([...refs].map(([k, v]) => [asRef(k), v.title]));
  /** An existing id in `m`, or a ref to something of `target` created in this change-set. */
  const resolve = (v: string | undefined | null, m: Map<string, unknown>, target: string): string | undefined => {
    if (v == null) return undefined;
    if (m.has(v)) return v;
    const r = refs.get(v);
    return r && r.target === target ? asRef(v) : undefined;
  };
  const taskId = (v: string) => resolve(v, s.tasks, 'task');
  const items: Planned[] = [];
  let skipped = cs.bad;

  /** Clean a task's fields: unknown references and unsafe links are dropped. */
  const cleanTask = (set: TaskSet): Partial<Task> => {
    const o: Partial<Task> = {};
    for (const [k, v] of Object.entries(set)) {
      if (v === undefined) continue;
      if (k === 'project') { const p = resolve(v as string, s.projects, 'project'); if (p) o.project = p; continue; }
      if (k === 'where') { const w = v === 'any' ? 'any' : resolve(v as string, s.places, 'place'); if (w) o.where = w; continue; }
      if (k === 'after') { const a = ((v as string[] | null) ?? []).map(taskId).filter((x): x is string => !!x); o.after = a.length ? a : null; continue; }
      if (k === 'link') { if (v === null || isAllowedLink(v as string)) o.link = (v as string | null) || null; continue; }
      if (k === 'title' && !v) continue;
      (o as Record<string, unknown>)[k] = v;
    }
    if (o.est != null) o.estBy = 'ai';
    if ('due' in o) o.dueRule = null;
    return o;
  };

  const newOptions = (cur: Option[], incoming: NonNullable<Extract<Change, { op: 'decision.update' }>['set']['options']>) => {
    const out = cur.map(o => ({ ...o, ...Object.fromEntries(COLUMNS.map(c => [c, [...o[c]]])) })) as Option[];
    const added: string[] = [];
    for (const inc of incoming) {
      let o = out.find(x => x.name.trim().toLowerCase() === inc.name.trim().toLowerCase());
      if (!o) {
        o = { id: gen.id('o'), name: inc.name, screened: inc.screened ?? null, pros: [], cons: [], prosNot: [], consNot: [], by: 'ai' };
        out.push(o);
        added.push(inc.name);
      } else if (inc.screened !== undefined && inc.screened !== o.screened) o.screened = inc.screened;
      for (const col of COLUMNS as Column[]) {
        for (const text of inc[col] ?? []) {
          if (!text || o[col].some(i => i.text.trim().toLowerCase() === text.toLowerCase())) continue;
          // Weights are the person's: an AI's item starts at 3 and is marked as a suggestion.
          o[col].push({ id: gen.id('i'), text, w: 3, by: 'ai' } satisfies Item);
        }
      }
    }
    return { options: out, added };
  };

  const decisionFields = (set: Extract<Change, { op: 'decision.update' }>['set'], cur: Decision | null, projectFallback: string | null) => {
    const f: Partial<Decision> = {};
    if (set.title) f.title = set.title;
    if (set.project !== undefined) f.projectId = set.project === null ? null : resolve(set.project, s.projects, 'project') ?? cur?.projectId ?? null;
    if (set.problem) f.problem = { ...(cur?.problem ?? { what: '', should: '', gap: '', constraints: '', deadline: '', control: '' }), ...Object.fromEntries(Object.entries(set.problem).filter(([, v]) => v !== undefined)) };
    let options = cur?.options ?? [];
    const delta: Delta = {};
    if (set.problem) delta.problem = Object.fromEntries(Object.entries(set.problem).filter(([, v]) => v !== undefined)) as Record<string, string>;
    if (set.options?.length) {
      options = newOptions(options, set.options).options;
      f.options = options;
      const names = new Set(set.options.map(o => o.name.trim().toLowerCase()));
      delta.options = options.filter(o => names.has(o.name.trim().toLowerCase()));
    }
    if (set.chosen !== undefined) {
      const o = set.chosen ? options.find(x => x.name.trim().toLowerCase() === set.chosen!.toLowerCase()) : null;
      f.chosen = set.chosen || null;
      f.chosenId = o?.id ?? null;
      (f as Record<string, unknown>).chosenBy = set.chosen ? 'ai' : null;
      if (set.chosen && (!cur || cur.status === 'draft')) { f.status = 'decided'; f.date = s.today; }
    }
    for (const k of ['why', 'mustBeTrue', 'falsifier'] as const) if (set[k] !== undefined) f[k] = set[k]!;
    if (set.reviewOn !== undefined) f.reviewOn = set.reviewOn;
    // Steps that carry out the choice go to the decision's project.
    const ops: Op[] = [];
    const stepIds: string[] = [];
    const proj = f.projectId ?? cur?.projectId ?? projectFallback;
    (set.steps ?? []).forEach(st => {
      const r = gen.id('step');
      refTitles.set(asRef(r), st.title);
      ops.push({ t: 'task', ref: r, fields: { ...cleanTask(st), title: st.title, project: proj ?? 'inbox', by: 'ai', src: 'ai' } });
      stepIds.push(asRef(r));
    });
    if (stepIds.length) f.taskIds = [...(cur?.taskIds ?? []), ...stepIds];
    return { f, ops, delta };
  };

  for (const c of cs.changes) {
    const before = items.length;
    switch (c.op) {
      case 'task.create': {
        const f = cleanTask(c.set);
        const p = f.project && !isRef(f.project) ? s.projects.get(f.project) : undefined;
        const fields = { ...f, title: c.set.title, suit: f.suit ?? p?.suit, by: 'ai', src: 'ai' } as Partial<Task> & { title: string };
        items.push({ target: 'task', kind: 'create', title: c.set.title, diffs: Object.entries(f).filter(([k]) => k !== 'title' && k !== 'estBy' && k !== 'dueRule').map(([field, after]) => ({ field, before: undefined, after })), ops: [{ t: 'task', ref: c.ref, fields }] });
        break;
      }
      case 'task.update': {
        const tk = s.tasks.get(c.id);
        if (!tk || tk.status === 'dropped' || tk.template) break;
        const f = cleanTask(c.set);
        const diffs: Diff[] = [];
        for (const [k, v] of Object.entries(f)) {
          if (k === 'estBy' || k === 'dueRule') continue;
          const cur = k === 'where' ? tk.where || s.projects.get(tk.project)?.where || 'any' : k === 'after' ? ((Array.isArray(tk.after) ? tk.after : tk.after ? [tk.after] : []).length ? tk.after : null) : tk[k];
          if (same(cur, v)) { delete (f as Record<string, unknown>)[k]; continue; }
          diffs.push({ field: k, before: cur, after: v });
        }
        if (!diffs.length) break;
        if (!('est' in f)) delete f.estBy;
        if (!('due' in f)) delete f.dueRule;
        items.push({ target: 'task', kind: 'update', title: tk.title, diffs, ops: [{ t: 'update', c: 'tasks', id: tk.id, patch: f }] });
        break;
      }
      case 'task.done': {
        const tk = s.tasks.get(c.id);
        if (!tk || tk.status !== 'open') break;
        const d = c.day && c.day <= s.today ? c.day : s.today;
        items.push({ target: 'task', kind: 'done', title: tk.title, diffs: [{ field: 'doneDay', before: null, after: d }], ops: [{ t: 'finish', id: tk.id, day: d }] });
        break;
      }
      case 'task.drop': {
        const tk = s.tasks.get(c.id);
        if (!tk || tk.status === 'dropped') break;
        items.push({ target: 'task', kind: 'drop', title: tk.title, diffs: [], ops: [{ t: 'drop', id: tk.id }] });
        break;
      }
      case 'task.reorder': {
        const ts = [...new Set(c.ids)].map(id => s.tasks.get(id)).filter((x): x is W<Task> => !!x && x.status === 'open');
        if (ts.length < 2) break;
        const slots = ts.map(x => x.order || 0).sort((a, b) => a - b);
        // Equal orders would leave the result undefined: spread them out from the smallest.
        const distinct = new Set(slots).size === slots.length ? slots : slots.map((_, i) => slots[0]! + i);
        const ops: Op[] = [];
        ts.forEach((x, i) => { if ((x.order || 0) !== distinct[i]) ops.push({ t: 'update', c: 'tasks', id: x.id, patch: { order: distinct[i] } }); });
        if (!ops.length) break;
        const was = [...ts].sort((a, b) => (a.order || 0) - (b.order || 0)).map(x => x.id);
        items.push({ target: 'task', kind: 'reorder', title: '', diffs: [{ field: 'order', before: was, after: ts.map(x => x.id) }], ops });
        break;
      }
      case 'project.create': {
        const f = projectFields(c.set, null);
        const fields: Project = { name: c.set.name, suit: c.set.suit ?? 'S', where: f.where ?? 'any', goal: null, goalBy: null, due: null, order: Date.parse(gen.now()), status: 'active', created: gen.now(), ...f, by: 'ai' };
        items.push({ target: 'project', kind: 'create', title: c.set.name, diffs: Object.entries(f).filter(([k]) => !k.endsWith('By') && k !== 'name').map(([field, after]) => ({ field, before: undefined, after })), ops: [{ t: 'create', c: 'projects', ref: c.ref, fields }] });
        break;
      }
      case 'project.update': {
        const p = s.projects.get(c.id);
        if (!p) break;
        const f = projectFields(c.set, p);
        const diffs: Diff[] = [];
        for (const [k, v] of Object.entries(f)) {
          if (k.endsWith('By')) continue;
          if (same(p[k], v)) { delete (f as Record<string, unknown>)[k]; delete (f as Record<string, unknown>)[k + 'By']; continue; }
          diffs.push({ field: k, before: p[k], after: v });
        }
        if (!diffs.length) break;
        if (f.status === 'done') f.doneAt = gen.now();
        items.push({ target: 'project', kind: 'update', title: p.name, diffs, ops: [{ t: 'update', c: 'projects', id: p.id, patch: f }] });
        break;
      }
      case 'day.update': {
        const d = s.days.get(c.date);
        const cur = Array.isArray(d?.plan) ? d!.plan : [];
        const okStep = (id: string) => { const r = taskId(id); if (!r) return undefined; const tk = s.tasks.get(r); return !tk || tk.status !== 'dropped' ? r : undefined; };
        let plan = c.plan ? c.plan.map(okStep).filter((x): x is string => !!x) : [...cur];
        for (const a of c.add ?? []) { const r = okStep(a); if (r && !plan.includes(r)) plan.push(r); }
        const rm = new Set((c.remove ?? []).map(taskId).filter(Boolean));
        plan = [...new Set(plan.filter(x => !rm.has(x)))];
        const patch: Partial<Day> = {};
        const diffs: Diff[] = [];
        let firstId: string | undefined;
        if (c.first) { firstId = okStep(c.first); if (firstId) plan = [firstId, ...plan.filter(x => x !== firstId)]; }
        if (!same(plan, cur)) { patch.plan = plan; diffs.push({ field: 'plan', before: cur, after: plan }); }
        if (firstId && d?.first?.id !== firstId) {
          patch.first = { id: firstId, title: s.tasks.get(firstId)?.title ?? refTitles.get(firstId) ?? '' };
          diffs.push({ field: 'first', before: d?.first?.id ?? null, after: firstId });
        }
        if (c.launches) {
          const L: Launch[] = c.launches.map((l, i) => ({ t: l.t.padStart(5, '0'), k: l.k ?? (i ? 'restart' : 'start'), ...(l.n ? { n: l.n } : {}) })).sort((a, b) => a.t.localeCompare(b.t));
          const was = d?.launches ?? [];
          if (!same(L.map(l => l.t + l.k), was.map(l => l.t + l.k))) { patch.launches = L; diffs.push({ field: 'launches', before: was.map(l => l.t), after: L.map(l => l.t) }); }
        }
        if (!diffs.length) break;
        items.push({ target: 'day', kind: 'update', title: c.date, diffs, ops: [{ t: 'day', k: c.date, patch }] });
        break;
      }
      case 'place.create': {
        if ([...s.places.values()].some(p => p.name.trim().toLowerCase() === c.set.name.toLowerCase())) break;
        const timeZone = validZone(c.set.timeZone) ? c.set.timeZone! : gen.zone;
        items.push({ target: 'place', kind: 'create', title: c.set.name, diffs: [{ field: 'timeZone', before: undefined, after: timeZone }], ops: [{ t: 'create', c: 'places', ref: c.ref, fields: { name: c.set.name, timeZone, order: s.places.size, by: 'ai' } }] });
        break;
      }
      case 'place.update': {
        const p = s.places.get(c.id);
        if (!p) break;
        const patch: Partial<Place> = {};
        if (c.set.name && c.set.name !== p.name) patch.name = c.set.name;
        if (c.set.timeZone && validZone(c.set.timeZone) && c.set.timeZone !== p.timeZone) patch.timeZone = c.set.timeZone;
        const diffs = Object.entries(patch).map(([field, after]) => ({ field, before: p[field], after }));
        if (!diffs.length) break;
        items.push({ target: 'place', kind: 'update', title: p.name, diffs, ops: [{ t: 'update', c: 'places', id: p.id, patch }] });
        break;
      }
      case 'stay.create':
      case 'stay.update': {
        const cur = c.op === 'stay.update' ? s.stays.get(c.id) : undefined;
        if (c.op === 'stay.update' && !cur) break;
        const want = c.set.place;
        const placeId = want ? resolve(want, s.places, 'place') ?? [...s.places.values()].find(p => p.name.trim().toLowerCase() === want.trim().toLowerCase())?.id : cur?.placeId;
        if (!placeId) break;
        const from = c.set.from ?? cur!.from, to0 = c.set.to ?? cur!.to;
        const next: Stay = { ...(cur ?? {}), placeId, from, to: to0 < from ? from : to0, note: c.set.note ?? cur?.note ?? '' };
        if (!cur) next.by = 'ai';
        const diffs = (['placeId', 'from', 'to', 'note'] as const).filter(k => !same(cur?.[k], next[k]) && (cur || next[k])).map(k => ({ field: k === 'placeId' ? 'place' : k, before: cur?.[k], after: next[k] }));
        if (!diffs.length) break;
        const { id: _drop, ...fields } = next as Stay & { id?: string };
        void _drop;
        items.push({ target: 'stay', kind: cur ? 'update' : 'create', title: s.places.get(placeId)?.name ?? refTitles.get(placeId) ?? '', diffs, ops: [{ t: 'stay', id: cur?.id ?? null, fields }] });
        break;
      }
      case 'decision.create': {
        const { f, ops } = decisionFields(c.set, null, null);
        const fields = { ...normDecision({ status: 'draft', ...f, title: c.set.title } as Record<string, unknown>), by: 'ai' };
        items.push({ target: 'decision', kind: 'create', title: c.set.title, diffs: decisionDiffs(null, f), ops: [...ops, { t: 'create', c: 'decisions', ref: c.ref, fields }] });
        break;
      }
      case 'decision.update': {
        const d = s.decisions.get(c.id);
        if (!d) break;
        const { f, ops, delta } = decisionFields(c.set, d, null);
        const diffs = decisionDiffs(d, f);
        if (!diffs.length) break;
        items.push({ target: 'decision', kind: 'update', title: d.title, diffs, ops: [...ops, { t: 'update', c: 'decisions', id: d.id, patch: f, delta }] });
        break;
      }
    }
    if (items.length === before) skipped++;
  }
  return { items, skipped, refTitles };

  function projectFields(set: Extract<Change, { op: 'project.update' }>['set'], cur: Project | null): Partial<Project> {
    const f: Partial<Project> = {};
    if (set.name) f.name = set.name;
    if (set.suit) f.suit = set.suit;
    if (set.where) { const w = set.where === 'any' ? 'any' : resolve(set.where, s.places, 'place'); if (w) f.where = w; }
    if (set.goal !== undefined) { f.goal = set.goal || null; f.goalBy = set.goal ? 'ai' : null; }
    if (set.smart !== undefined) {
      const base: Smart = { specific: '', measurable: '', attainable: '', relevant: '', dated: '', ...(cur?.smart ?? {}) };
      f.smart = set.smart ? { ...base, ...Object.fromEntries(Object.entries(set.smart).filter(([, v]) => v !== undefined)) } : null;
      f.smartBy = set.smart ? 'ai' : null;
    }
    if (set.due !== undefined) f.due = set.due;
    if (set.status) f.status = set.status;
    return f;
  }
}

function decisionDiffs(cur: Decision | null, f: Partial<Decision>): Diff[] {
  const out: Diff[] = [];
  for (const [k, v] of Object.entries(f)) {
    if (k === 'chosenId' || k === 'chosenBy' || k === 'status' || k === 'date') continue;
    const was = cur ? (cur as Record<string, unknown>)[k] : undefined;
    if (k === 'problem') {
      for (const [pk, pv] of Object.entries(v as Record<string, string>)) if (pv !== ((was as Record<string, string> | undefined)?.[pk] ?? '')) out.push({ field: 'problem.' + pk, before: (was as Record<string, string> | undefined)?.[pk], after: pv });
      continue;
    }
    if (k === 'options') {
      const before = (cur?.options ?? []) as Option[];
      for (const o of v as Option[]) {
        const b = before.find(x => x.id === o.id);
        const n = COLUMNS.reduce((a, c) => a + o[c].length - (b ? b[c].length : 0), 0);
        if (!b) out.push({ field: 'option', before: undefined, after: o.name + (n ? ' (+' + n + ')' : '') });
        else if (n) out.push({ field: 'items', before: o.name, after: '+' + n });
      }
      continue;
    }
    if (k === 'taskIds') { out.push({ field: 'steps', before: undefined, after: (v as string[]).filter(isRef) }); continue; }
    if (!same(was, v)) out.push({ field: k, before: was, after: v });
  }
  return out;
}

/** What a Writer does: the app's is built on store.ts and actions.ts (src/ai/writer.ts). */
export interface Writer {
  createTask(fields: Partial<Task> & { title: string }): Promise<string>;
  create(c: Collection, fields: Record<string, unknown>): Promise<string>;
  update(c: Collection, id: string, patch: Record<string, unknown>): Promise<void>;
  finish(id: string, day: string): Promise<void>;
  drop(id: string): Promise<void>;
  day(k: string, patch: Partial<Day>): Promise<void>;
  stay(id: string | null, s: Stay): Promise<string>;
}

/** Write the ticked changes, in order, resolving refs to the ids just created. Returns how many were applied. */
export async function applyPlanned(plan: Plan, ticked: (i: number) => boolean, w: Writer): Promise<number> {
  const ids = new Map<string, string>();
  const subst = (v: unknown): unknown => {
    if (isRef(v)) return ids.get(v);
    if (Array.isArray(v)) return v.map(subst).filter(x => x !== undefined);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) { const r = subst(x); o[k] = r === undefined && isRef(x) ? (k === 'project' ? 'inbox' : null) : r; }
      return o;
    }
    return v;
  };
  // Each update was planned against the same snapshot; later ones build on what earlier ones wrote.
  const wrote = new Map<string, Record<string, unknown>>();
  let n = 0;
  for (const [i, it] of plan.items.entries()) {
    if (!ticked(i)) continue;
    for (const op of it.ops) {
      switch (op.t) {
        case 'task': { const id = await w.createTask(subst(op.fields) as Task); if (op.ref) ids.set(asRef(op.ref), id); break; }
        case 'create': { const id = await w.create(op.c, subst(op.fields) as Record<string, unknown>); if (op.ref) ids.set(asRef(op.ref), id); break; }
        case 'update': {
          const key = op.c + '/' + op.id, prev = wrote.get(key);
          let p = subst(op.patch) as Record<string, unknown>;
          if (prev && op.delta) p = mergeDelta(prev, p, subst(op.delta) as Delta);
          await w.update(op.c, op.id, p);
          wrote.set(key, { ...prev, ...p });
          break;
        }
        case 'finish': await w.finish(op.id, op.day); break;
        case 'drop': await w.drop(op.id); break;
        case 'day': {
          const p = subst(op.patch) as Partial<Day>;
          if (p.first && !p.first.id) delete p.first;
          await w.day(op.k, p);
          break;
        }
        case 'stay': {
          const f = subst(op.fields) as Stay;
          if (!f.placeId) continue;
          const id = await w.stay(op.id, f);
          if (op.ref) ids.set(asRef(op.ref), id);
          break;
        }
      }
    }
    n++;
  }
  return n;
}

/** A decision patch rebuilt on top of what an earlier ticked change already wrote. */
export function mergeDelta(prev: Record<string, unknown>, p: Record<string, unknown>, d: Delta): Record<string, unknown> {
  const out = { ...p };
  if (d.problem && prev.problem) out.problem = { ...(prev.problem as Record<string, string>), ...d.problem };
  if (d.options && prev.options) {
    const opts = (prev.options as Option[]).map(o => ({ ...o, ...Object.fromEntries(COLUMNS.map(c => [c, [...o[c]]])) })) as Option[];
    for (const o of d.options) {
      const have = opts.find(x => x.id === o.id || x.name.trim().toLowerCase() === o.name.trim().toLowerCase());
      if (!have) { opts.push(o); continue; }
      if (o.screened !== undefined) have.screened = o.screened;
      for (const c of COLUMNS) for (const it of o[c]) if (!have[c].some(x => x.id === it.id || x.text.trim().toLowerCase() === it.text.trim().toLowerCase())) have[c].push(it);
    }
    out.options = opts;
  }
  return out;
}
