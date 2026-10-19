// Finding things by name, so an AI needn't search before it edits: "tick Call the agency" works
// where an id is expected. A value that is already an id (or a ref made in the same change-set)
// is left alone; otherwise the title is matched exactly, then by a unique prefix, ignoring case,
// accents and punctuation. More than one match returns the candidates and writes nothing.
import type { Change } from '../../../src/ai/changeset';
import { oneLine, stepLine, type Data } from '../../../src/domain/lists';

export const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export interface Named { id: string; name: string }
export type Found = { id: string } | { none: true } | { many: Named[] };

/** Exact match first, then a unique prefix. `pool` are the things that may be meant. */
export function findByName(value: string, pool: Named[]): Found {
  const want = norm(value);
  if (!want) return { none: true };
  const exact = pool.filter(p => norm(p.name) === want);
  if (exact.length === 1) return { id: exact[0]!.id };
  if (exact.length > 1) return { many: exact };
  const pre = pool.filter(p => norm(p.name).startsWith(want));
  if (pre.length === 1) return { id: pre[0]!.id };
  if (pre.length > 1) return { many: pre };
  return { none: true };
}

export interface Problem { index: number; text: string }
export interface Resolved { changes: Change[]; problems: Problem[]; ambiguous: Problem[] }

/**
 * Replace titles and names with ids across a change-set. Anything not found, and anything that
 * matches several, is reported (with candidates) so the caller can write nothing and ask.
 */
export function resolveChanges(changes: Change[], d: Data): Resolved {
  const refs = new Set<string>();
  for (const c of changes) if ('ref' in c && c.ref) refs.add(c.ref);
  const problems: Problem[] = [];
  const ambiguous: Problem[] = [];
  let at = 0;

  const line = (id: string) => stepLine(d.tasks.get(id)!, d);
  const open = [...d.tasks.values()].filter(t => t.status === 'open' && !t.template).map(t => ({ id: t.id, name: t.title }));
  const anyTask = [...d.tasks.values()].filter(t => !t.template).map(t => ({ id: t.id, name: t.title }));
  const projects = [...d.projects.values()].map(p => ({ id: p.id, name: p.name }));
  const places = [...d.places.values()].map(p => ({ id: p.id, name: p.name }));

  function pick(kind: 'step' | 'project' | 'place', value: string, ids: ReadonlyMap<string, unknown>, pool: Named[], strict = true): string {
    if (ids.has(value) || refs.has(value) || (kind === 'project' && value === 'inbox') || (kind === 'place' && value === 'any')) return value;
    let f = findByName(value, pool);
    if ('none' in f && kind === 'step') f = findByName(value, anyTask); // maybe it's already done or dropped
    if ('id' in f) return f.id;
    if ('many' in f) {
      const shown = f.many.slice(0, 8).map(m => (kind === 'step' ? line(m.id) : `${m.id} | ${oneLine(m.name)}`));
      ambiguous.push({ index: at, text: `"${value}" matches ${f.many.length} ${kind}s; repeat with the id of the one meant:\n${shown.join('\n')}` });
    } else if (strict) {
      problems.push({ index: at, text: `No ${kind} with the id or title "${value}".` });
    }
    return value;
  }
  const step = (v: string) => pick('step', v, d.tasks, open);
  const project = (v: string) => pick('project', v, d.projects, projects);
  const place = (v: string) => pick('place', v, d.places, places);

  const out = changes.map((c, i): Change => {
    at = i;
    switch (c.op) {
      case 'task.create': return { ...c, set: fixTask(c.set) };
      case 'task.update': return { ...c, id: step(c.id), set: fixTask(c.set) };
      case 'task.done': case 'task.drop': return { ...c, id: step(c.id) };
      case 'task.reorder': return { ...c, ids: c.ids.map(step) };
      case 'project.create': return { ...c, set: c.set.where ? { ...c.set, where: place(c.set.where) } : c.set };
      case 'project.update': return { ...c, id: project(c.id), set: c.set.where ? { ...c.set, where: place(c.set.where) } : c.set };
      case 'day.update': return { ...c, plan: c.plan?.map(step), add: c.add?.map(step), remove: c.remove?.map(step), first: c.first ? step(c.first) : c.first };
      case 'place.update': return { ...c, id: place(c.id) };
      case 'stay.create': return { ...c, set: { ...c.set, place: place(c.set.place) } };
      case 'stay.update': return c;
      case 'decision.create': return { ...c, set: c.set.project ? { ...c.set, project: project(c.set.project) } : c.set };
      case 'decision.update': return { ...c, set: c.set.project ? { ...c.set, project: project(c.set.project) } : c.set };
      default: return c;
    }
  });
  function fixTask<T extends { project?: string; where?: string; after?: string[] | null }>(set: T): T {
    const o = { ...set };
    if (o.project) o.project = project(o.project);
    if (o.where) o.where = place(o.where);
    if (o.after) o.after = o.after.map(step);
    return o;
  }
  return { changes: out, problems, ambiguous };
}
