// From a change-set to reviewable changes, and from ticked changes to writes (brief §10).
// `planChanges` is pure: it checks every change against a snapshot of the data, drops what
// wouldn't change anything, and prepares low-level writes. `applyPlanned` runs only the ticked
// ones through a Writer (store.ts and actions.ts in the app, a fake in tests).
// AI-originated fields are marked `by`/`estBy`/`goalBy`/`smartBy: 'ai'`; weights are always 3.
import { eventClash, eventClashes, NUDGE_ONLY, type Change, type ChangeSet, type TaskSet } from './changeset';
import type { Address, Day, Decision, Place, Project, Smart, Stay, Task, Collection, Launch, MemoryLine, MemoryNote } from '../data/schema';
import { COLUMNS, type Column, type Item, type Option } from '../domain/decision';
import { normDecision } from '../data/normalize';
import { isAllowedLink } from '../domain/links';
import { norm } from '../domain/names';
import { isArea, parentProblem, zoneOfPlace } from '../domain/places';
import { toEventFields } from '../domain/events';

type W<T> = T & { id: string };
export interface Snapshot {
  today: string;
  tasks: Map<string, W<Task>>;
  projects: Map<string, W<Project>>;
  days: Map<string, W<Day>>;
  decisions: Map<string, W<Decision>>;
  places: Map<string, W<Place>>;
  stays: Map<string, W<Stay>>;
  /** Only read when a change names a memory note (the connector builds it on first use). */
  memory: Map<string, W<MemoryNote>>;
  /**
   * The addresses, to keep a suggested one from doubling one the person has, and the ids of their categories.
   * Left out by a caller that never reads addresses (the connector): `address.create` then comes to nothing.
   */
  addresses?: Map<string, W<Address>>;
  categories?: string[];
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
  /** `ifMissing`: for a change to something made earlier in the change-set, the fields to make it with if that change wasn't ticked. */
  | { t: 'update'; c: Collection; id: string; patch: Record<string, unknown>; delta?: Delta; ifMissing?: Record<string, unknown> }
  | { t: 'finish'; id: string; day: string }
  | { t: 'drop'; id: string }
  | { t: 'day'; k: string; patch: Partial<Day> }
  | { t: 'stay'; id: string | null; ref?: string; fields: Stay };

/** What a decision or memory update adds, so two ticked updates of the same document both land (see mergeDelta). */
export interface Delta { problem?: Record<string, string>; options?: Option[]; lines?: LinesDelta }
/** One change to a memory note's lines, kept as a change (not as the whole list) for the same reason. */
export interface LinesDelta { add?: MemoryLine; edit?: MemoryLine; remove?: string }

export interface Diff { field: string; before: unknown; after: unknown }
export interface Planned {
  /** What it acts on and how; the review screen shows these. */
  target: 'task' | 'project' | 'day' | 'place' | 'stay' | 'decision' | 'memory' | 'address';
  /** `remember`: a change to a memory note (a line added, edited or forgotten, or the note's own fields). */
  kind: 'create' | 'update' | 'done' | 'drop' | 'reorder' | 'remember';
  title: string;
  diffs: Diff[];
  ops: Op[];
}
export interface Plan {
  items: Planned[];
  skipped: number;
  /** Positions in `cs.changes` of the changes that came to nothing: an unknown id, or nothing to change. */
  skippedAt: number[];
  refTitles: Map<string, string>;
  /** Why a change was left out or cut back, by its position in `cs.changes` (an event given an estimate, a nudge on a step): the connector refuses these and says so; the review screen just counts the change as skipped. */
  notes?: { at: number; text: string }[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Whether a memory change makes a new note (the review marks it as new). */
export const createsNote = (it: Planned): boolean => it.target === 'memory' && it.ops[0]?.t === 'create';
const validZone = (z: string | undefined) => { if (!z) return false; try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } };

/** The notes a change-set may name: never a private one (an AI is never told one exists, so planning acts as if it didn't). */
const openNotes = (m: Map<string, W<MemoryNote>>): W<MemoryNote>[] => [...m.values()].filter(n => !n.private);
/** A note by id, then by name or alias; 'many' when several match. */
function findOpenNote(notes: W<MemoryNote>[], v: string): W<MemoryNote> | 'many' | undefined {
  const byId = notes.find(n => n.id === v);
  if (byId) return byId;
  const want = norm(v);
  const hits = want ? notes.filter(n => norm(n.name) === want || n.aliases.some(a => norm(a) === want)) : [];
  return hits.length > 1 ? 'many' : hits[0];
}
/** A line by its number (from 1, as shown to the AI), its id, or its exact text. */
function lineOf(n: MemoryNote, want: number | string): MemoryLine | undefined {
  if (typeof want === 'number') return n.lines[want - 1];
  const text = norm(want.replace(/^\d+\.\s+/, ''));
  return n.lines.find(l => l.id === want) ?? n.lines.find(l => norm(l.text) === text) ?? (/^\d+$/.test(want) ? n.lines[Number(want) - 1] : undefined);
}

/**
 * The change-set with each memory line named by its id instead of its number or text, as `s` has them:
 * for a change-set kept to be applied later (the connector's confirmation), so a line that moved up
 * since is not mistaken for another. A line not found is left as it was (planning skips it).
 */
export function pinLines(cs: ChangeSet, s: Pick<Snapshot, 'memory'>): ChangeSet {
  const notes = openNotes(s.memory);
  return {
    ...cs,
    changes: cs.changes.map(c => {
      if (c.op !== 'memory.edit' && c.op !== 'memory.remove') return c;
      const hit = findOpenNote(notes, c.note);
      const ln = hit && hit !== 'many' ? lineOf(hit, c.line) : undefined;
      return ln ? { ...c, note: hit !== 'many' && hit ? hit.id : c.note, line: ln.id } : c;
    }),
  };
}

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
  const byPlaceName = (v: string): string | undefined => [...s.places.values()].find(p => p.name.trim().toLowerCase() === v.trim().toLowerCase())?.id;
  /** A place by id, by a ref made earlier in this change-set, or by name. */
  const placeRef = (v: string): string | undefined => resolve(v, s.places, 'place') ?? byPlaceName(v);
  /** Refs of places this change-set makes as areas (an area holds no areas). */
  const areaRefs = new Set<string>();
  /** Notes made earlier in this change-set, by name: a second line for a new note joins it. */
  const madeNotes = new Map<string, { ref: string; name: string; kind: MemoryNote['kind'] }>();
  /** Addresses suggested earlier in this change-set, so one named twice is made once. */
  const madeAddresses: { name: string; placeId: string; mapsUrl: string | null }[] = [];
  const notes = openNotes(s.memory);
  const findNote = (v: string) => findOpenNote(notes, v);
  const items: Planned[] = [];
  let skipped = cs.bad;
  const skippedAt: number[] = [];
  const refused: { at: number; text: string }[] = [];
  /** Refs of events made earlier in this change-set (they are on no day's list). */
  const eventRefs = new Set<string>();

  /** Clean a task's fields: unknown references and unsafe links are dropped. */
  const by = cs.by ?? 'ai';
  const cleanTask = (set: TaskSet): Partial<Task> => {
    const o: Partial<Task> = {};
    for (const [k, v] of Object.entries(set)) {
      if (v === undefined) continue;
      if (k === 'project') { const p = resolve(v as string, s.projects, 'project'); if (p) o.project = p; continue; }
      if (k === 'where') { const w = v === 'any' ? 'any' : resolve(v as string, s.places, 'place'); if (w) o.where = w; continue; }
      if (k === 'after') { const a = ((v as string[] | null) ?? []).map(taskId).filter((x): x is string => !!x); o.after = a.length ? a : null; continue; }
      if (k === 'link') { if (v === null || isAllowedLink(v as string)) o.link = (v as string | null) || null; continue; }
      if (k === 'title' && !v) continue;
      if (k === 'label') { o.label = String(v).trim(); continue; }
      if (k === 'weekdays') { const w = [...new Set((v as number[] | null) ?? [])].sort((a, b) => a - b); o.weekdays = w.length ? w : null; continue; }
      (o as Record<string, unknown>)[k] = v;
    }
    // A standing obligation with no time or no days would sit unseen: it stays an ordinary step.
    if (o.template && (!o.at || !o.weekdays?.length)) delete o.template;
    if (o.est != null) o.estBy = by;
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

  for (const [ci, c] of cs.changes.entries()) {
    const before = items.length;
    switch (c.op) {
      case 'task.create': {
        const f = cleanTask(c.set);
        if (!f.label) delete f.label;
        const event = f.kind === 'event';
        if (!event) delete f.nudge; // only an event has a check date
        else if (c.ref) eventRefs.add(asRef(c.ref));
        const p = f.project && !isRef(f.project) ? s.projects.get(f.project) : undefined;
        // An event is made with nothing a step has (no estimate, not important): the change-set may not give any (the contract refuses it).
        const fields = { ...(event ? toEventFields() : {}), ...f, title: c.set.title, suit: f.suit ?? p?.suit, by, src: by === 'me' ? 'home' : 'ai' } as Partial<Task> & { title: string };
        items.push({ target: 'task', kind: 'create', title: c.set.title, diffs: Object.entries(f).filter(([k]) => k !== 'title' && k !== 'estBy' && k !== 'dueRule').map(([field, after]) => ({ field, before: undefined, after })), ops: [{ t: 'task', ref: c.ref, fields }] });
        break;
      }
      case 'task.update': {
        const tk = s.tasks.get(c.id);
        if (!tk || tk.status === 'dropped') break;
        const f = cleanTask(c.set);
        delete f.template; // only a new step becomes a standing obligation
        if (tk.template) {
          // A standing obligation keeps a time and its days, and has no date: the copies placed on days have those.
          if ('at' in f && !f.at) delete f.at;
          if ('weekdays' in f && !f.weekdays?.length) delete f.weekdays;
          delete f.due; delete f.dueRule;
        }
        // Events (kind 'event': something the person waits for). A step turned into one is set to nothing, as the card sheet does;
        // an event keeps none of a step's fields, and a step has no check date. What cannot be so is cut back, with the reason.
        const wasEvent = tk.kind === 'event';
        const becomes = (f.kind ?? tk.kind) === 'event';
        const ops: Op[] = [];
        if (becomes) {
          const clash = eventClashes(f as Partial<TaskSet>);
          if (clash.length) { refused.push({ at: ci, text: eventClash(clash) }); for (const k of clash) delete (f as Record<string, unknown>)[k]; }
          if (!wasEvent) {
            if (tk.template) { refused.push({ at: ci, text: 'a standing step cannot become an event' }); break; }
            if (tk.status !== 'open') { refused.push({ at: ci, text: 'only an open step can become an event' }); break; }
            if (tk.started) { refused.push({ at: ci, text: 'its timer is running; the person stops it in the app first, then it can become an event' }); break; }
            const nothing = toEventFields() as Record<string, unknown>;
            for (const k of Object.keys(nothing)) if ((tk[k] ?? false) !== (nothing[k] ?? false)) (f as Record<string, unknown>)[k] = nothing[k];
            // It leaves every day's list: it is not something to do.
            for (const [k, d] of s.days) if (Array.isArray(d.plan) && d.plan.includes(tk.id)) ops.push({ t: 'day', k, patch: { plan: d.plan.filter(x => x !== tk.id) } });
          }
        } else if (f.nudge != null && !wasEvent) {
          refused.push({ at: ci, text: NUDGE_ONLY });
          delete f.nudge;
        } else if (wasEvent && tk.nudge) f.nudge = null; // an event turned back into a step has no check date
        if (!becomes && !wasEvent) delete f.nudge;
        const diffs: Diff[] = [];
        for (const [k, v] of Object.entries(f)) {
          if (k === 'estBy' || k === 'dueRule') continue;
          const cur = k === 'where' ? tk.where || s.projects.get(tk.project)?.where || 'any' : k === 'label' ? tk.label ?? '' : k === 'after' ? ((Array.isArray(tk.after) ? tk.after : tk.after ? [tk.after] : []).length ? tk.after : null) : tk[k];
          if (same(cur, v)) { delete (f as Record<string, unknown>)[k]; continue; }
          diffs.push({ field: k, before: cur, after: v });
        }
        if (!diffs.length) break;
        if (!('est' in f)) delete f.estBy;
        if (!('due' in f)) delete f.dueRule;
        items.push({ target: 'task', kind: 'update', title: tk.title, diffs, ops: [{ t: 'update', c: 'tasks', id: tk.id, patch: f }, ...ops] });
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
        // An event (something waited for) is on no day's list.
        const okStep = (id: string) => { const r = taskId(id); if (!r) return undefined; const tk = s.tasks.get(r); return (tk ? tk.status !== 'dropped' && tk.kind !== 'event' : !eventRefs.has(r)) ? r : undefined; };
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
        // An area (`parent`): of an existing place, or of one made earlier in this change-set; one level only. A parent that cannot be one skips the change.
        let parentId: string | undefined, parentName = '';
        if (c.set.parent) {
          parentId = placeRef(c.set.parent);
          if (!parentId) break;
          if (isRef(parentId)) { if (areaRefs.has(parentId)) break; parentName = refTitles.get(parentId) ?? ''; }
          else { if (parentProblem(s.places, null, parentId)) break; parentName = s.places.get(parentId)!.name; }
        }
        const dupe = [...s.places.values()].some(p => p.name.trim().toLowerCase() === c.set.name.toLowerCase() && (parentId ? p.parentId === parentId : true));
        if (dupe) break;
        // An area has no zone of its own: the stored one is the parent's, for a reader that does not know areas.
        const timeZone = parentId && !isRef(parentId) ? zoneOfPlace(s.places, parentId) ?? gen.zone : validZone(c.set.timeZone) ? c.set.timeZone! : gen.zone;
        if (parentId && c.ref) areaRefs.add(asRef(c.ref));
        const diffs: Diff[] = parentId ? [{ field: 'area of', before: undefined, after: parentName }] : [{ field: 'timeZone', before: undefined, after: timeZone }];
        items.push({ target: 'place', kind: 'create', title: c.set.name, diffs, ops: [{ t: 'create', c: 'places', ref: c.ref, fields: { name: c.set.name, timeZone, order: s.places.size, ...(parentId ? { parentId } : {}), by: 'ai' } }] });
        break;
      }
      case 'place.update': {
        const p = s.places.get(c.id);
        if (!p) break;
        const patch: Partial<Place> = {};
        if (c.set.name && c.set.name !== p.name) patch.name = c.set.name;
        if (c.set.parent !== undefined) {
          const want = c.set.parent === null ? null : s.places.has(c.set.parent) ? c.set.parent : byPlaceName(c.set.parent);
          if (want === undefined || (want !== null && parentProblem(s.places, p.id, want))) break; // not a place, or not allowed as a parent: the whole change is skipped
          if (!same(p.parentId, want)) patch.parentId = want;
        }
        // An area (or a place being made one) has no zone of its own.
        const isAreaNow = patch.parentId !== undefined ? !!patch.parentId : isArea(s.places, p.id);
        if (c.set.timeZone && !isAreaNow && validZone(c.set.timeZone) && c.set.timeZone !== p.timeZone) patch.timeZone = c.set.timeZone;
        const diffs = Object.entries(patch).map(([field, after]) => field === 'parentId' ? { field: 'area of', before: p.parentId ? s.places.get(p.parentId)?.name : undefined, after: after ? s.places.get(after as string)?.name : null } : { field, before: p[field], after });
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
      case 'address.create': {
        const it = addressChange(c.set);
        if (it) items.push(it);
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
      case 'memory.add':
      case 'memory.edit':
      case 'memory.remove':
      case 'memory.note': {
        const it = memoryChange(c);
        if (it) items.push(it);
        break;
      }
    }
    if (items.length === before) { skipped++; skippedAt.push(ci); }
  }
  return { items, skipped, skippedAt, refTitles, ...(refused.length ? { notes: refused } : {}) };

  /**
   * An address an AI suggests (brief §5, Planning a trip): saved as *want to go*, `by: 'ai'`, its reason in the note. Not
   * made when the person already has one of that name in the place (or anywhere) or with that link, or when this change-set
   * already suggested it. A place that is not found, or none, is Anywhere; a category the person does not have is *other*.
   */
  function addressChange(set: Extract<Change, { op: 'address.create' }>['set']): Planned | undefined {
    if (!s.addresses) return undefined;
    const want = set.place?.trim();
    const placeId = !want || want.toLowerCase() === 'any' ? 'any'
      : s.places.has(want) ? want
        : [...s.places.values()].find(p => norm(p.name) === norm(want))?.id ?? 'any';
    const link = set.mapsUrl && isAllowedLink(set.mapsUrl) ? set.mapsUrl : null;
    const here = (p: string) => p === placeId || p === 'any' || placeId === 'any';
    const name = norm(set.name);
    const dup = (a: { name: string; placeId: string; mapsUrl?: string | null }) => (norm(a.name) === name && here(a.placeId)) || (!!link && a.mapsUrl === link);
    if ([...s.addresses.values()].some(dup) || madeAddresses.some(dup)) return undefined;
    const category = set.category && (s.categories ?? []).find(c => c === set.category || norm(c) === norm(set.category!)) || 'other';
    const fields: Address = { name: set.name, category, placeId, mapsUrl: link, street: set.street || null, state: 'want', visits: [], by: 'ai', note: set.note ?? '' };
    madeAddresses.push({ name: set.name, placeId, mapsUrl: link });
    const diffs: Diff[] = [
      { field: 'place', before: undefined, after: placeId },
      { field: 'category', before: undefined, after: category },
      ...(link ? [{ field: 'mapsUrl', before: undefined, after: link }] : []),
      ...(fields.street ? [{ field: 'street', before: undefined, after: fields.street }] : []),
      { field: 'state', before: undefined, after: 'want' },
      ...(fields.note ? [{ field: 'note', before: undefined, after: fields.note }] : []),
    ];
    return { target: 'address', kind: 'create', title: set.name, diffs, ops: [{ t: 'create', c: 'addresses', fields: fields as unknown as Record<string, unknown> }] };
  }

  /**
   * A change to memory (brief §10). A note is found by id, then by name or alias; one that several notes
   * match is left alone. Private notes are not looked at at all (they are never sent to an AI, so an AI
   * has no business writing to one, and planning must not tell it one exists): a new note may take a
   * private note's name. Lines an AI writes are marked `by: 'ai'`. A line is named by its number (from
   * 1, as shown to the AI), its id, or its exact text; once planned, the write names it by id.
   */
  function memoryChange(c: Extract<Change, { op: `memory.${string}` }>): Planned | undefined {
    const now = gen.now();
    const hit = findNote(c.note);
    if (hit === 'many') return undefined;
    const item = (note: { name: string }, diffs: Diff[], op: Op): Planned => ({ target: 'memory', kind: 'remember', title: note.name, diffs, ops: [op] });
    if (c.op === 'memory.add') {
      const line: MemoryLine = { id: gen.id('l'), text: c.text, at: now, by: 'ai' };
      const diff: Diff = { field: 'line', before: undefined, after: c.text };
      if (hit) {
        if (hit.lines.some(l => norm(l.text) === norm(c.text))) return undefined;
        return item(hit, [diff], { t: 'update', c: 'memory', id: hit.id, patch: { lines: [...hit.lines, line], updated: now }, delta: { lines: { add: line } } });
      }
      const made = madeNotes.get(norm(c.note));
      if (made) {
        const fields: MemoryNote = { kind: made.kind, name: made.name, aliases: [], lines: [line], private: false, updated: now };
        return item(fields, [diff], { t: 'update', c: 'memory', id: asRef(made.ref), patch: { lines: [line], updated: now }, delta: { lines: { add: line } }, ifMissing: fields as unknown as Record<string, unknown> });
      }
      if (!c.kind) return undefined;
      const ref = 'note ' + norm(c.note);
      madeNotes.set(norm(c.note), { ref, name: c.note, kind: c.kind });
      const fields: MemoryNote = { kind: c.kind, name: c.note, aliases: [], lines: [line], private: false, updated: now };
      return item(fields, [{ field: 'kind', before: undefined, after: c.kind }, diff], { t: 'create', c: 'memory', ref, fields: fields as unknown as Record<string, unknown> });
    }
    if (!hit) return undefined;
    if (c.op === 'memory.note') {
      const patch: Partial<MemoryNote> = {};
      const diffs: Diff[] = [];
      const others = notes.filter(n => n.id !== hit.id);
      const taken = (name: string) => others.some(n => norm(n.name) === norm(name) || n.aliases.some(a => norm(a) === norm(name)));
      const name = c.set.name ?? hit.name;
      if (name !== hit.name && !taken(name)) { patch.name = name; diffs.push({ field: 'name', before: hit.name, after: name }); }
      if (c.set.aliases) {
        const seen = new Set([norm(patch.name ?? hit.name)]);
        const aliases = c.set.aliases.filter(a => !seen.has(norm(a)) && !!seen.add(norm(a)));
        if (!same(aliases, hit.aliases)) { patch.aliases = aliases; diffs.push({ field: 'aliases', before: hit.aliases, after: aliases }); }
      }
      if (c.set.kind && c.set.kind !== hit.kind) { patch.kind = c.set.kind; diffs.push({ field: 'kind', before: hit.kind, after: c.set.kind }); }
      if (!diffs.length) return undefined;
      return item(hit, diffs, { t: 'update', c: 'memory', id: hit.id, patch: { ...patch, updated: now } });
    }
    const ln = lineOf(hit, c.line);
    if (!ln) return undefined;
    if (c.op === 'memory.remove') {
      return item(hit, [{ field: 'line', before: ln.text, after: undefined }], { t: 'update', c: 'memory', id: hit.id, patch: { lines: hit.lines.filter(l => l.id !== ln.id), updated: now }, delta: { lines: { remove: ln.id } } });
    }
    if (ln.text === c.text) return undefined;
    const edited: MemoryLine = { ...ln, text: c.text, at: now, by: 'ai' };
    return item(hit, [{ field: 'line', before: ln.text, after: c.text }], { t: 'update', c: 'memory', id: hit.id, patch: { lines: hit.lines.map(l => (l.id === ln.id ? edited : l)), updated: now }, delta: { lines: { edit: edited } } });
  }

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

/**
 * One low-risk change (brief §2, §10): a single change that adds a step (not a decision), ticks one
 * done, or moves one date. It may be applied at once, with Undo; anything else waits for a yes.
 */
export function isLowRisk(cs: Pick<ChangeSet, 'changes' | 'bad'>, plan: Pick<Plan, 'items'>): boolean {
  if (cs.changes.length !== 1 || cs.bad || plan.items.length !== 1) return false;
  const it = plan.items[0]!;
  if (it.target !== 'task') return false;
  const first = cs.changes[0]!;
  if (first.op === 'task.create' && first.set.kind === 'decision') return false; // a decision opens the review (brief §10)
  if (it.kind === 'create' || it.kind === 'done') return true;
  if (it.kind !== 'update') return false;
  const fields = it.diffs.map(d => d.field);
  return fields.includes('due') && fields.every(f => f === 'due' || f === 'at');
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
  /** The document as stored now (undefined for none or a tombstone): a note's line changes apply to its lines at the time of writing. */
  read?(c: Collection, id: string): Promise<Record<string, unknown> | undefined>;
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
  items: for (const [i, it] of plan.items.entries()) {
    if (!ticked(i)) continue;
    for (const op of it.ops) {
      switch (op.t) {
        case 'task': { const id = await w.createTask(subst(op.fields) as Task); if (op.ref) ids.set(asRef(op.ref), id); break; }
        case 'create': {
          const fields = subst(op.fields) as Record<string, unknown>;
          const id = await w.create(op.c, fields);
          if (op.ref) { ids.set(asRef(op.ref), id); wrote.set(op.c + '/' + asRef(op.ref), fields); }
          break;
        }
        case 'update': {
          const key = op.c + '/' + op.id, prev = wrote.get(key);
          // Something made by an earlier change: its id is only known now. If that change wasn't ticked, this one
          // makes it (a ticked line is not lost); with nothing to make it from, it is not applied and not counted.
          const id = isRef(op.id) ? ids.get(op.id) : op.id;
          if (!id) {
            if (!op.ifMissing) continue items;
            ids.set(op.id, await w.create(op.c, op.ifMissing));
            wrote.set(key, op.ifMissing);
            break;
          }
          let p = subst(op.patch) as Record<string, unknown>;
          const delta = op.delta ? (subst(op.delta) as Delta) : undefined;
          if (delta?.lines && w.read) {
            // Lines are changed as a delta on what the note holds now, by line id, not on the copy the plan was made
            // from: a line added or forgotten since (here or on another device) stays so. A note gone since is left gone.
            const base = prev ?? (await w.read(op.c, id));
            if (!base) continue items;
            p = mergeDelta(base, p, delta);
          } else if (prev && delta) p = mergeDelta(prev, p, delta);
          await w.update(op.c, id, p);
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
  if (d.lines && Array.isArray(prev.lines)) {
    let lines = [...(prev.lines as MemoryLine[])];
    if (d.lines.add && !lines.some(l => l.id === d.lines!.add!.id)) lines.push(d.lines.add);
    if (d.lines.edit) lines = lines.map(l => (l.id === d.lines!.edit!.id ? d.lines!.edit! : l));
    if (d.lines.remove) lines = lines.filter(l => l.id !== d.lines!.remove);
    out.lines = lines;
  }
  return out;
}
