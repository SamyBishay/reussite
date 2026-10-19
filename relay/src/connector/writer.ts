// The connector's Writer for change-sets: the same job as the app's (src/ai/writer.ts), producing
// stored documents instead of calling store.ts. What each write means lives in src/domain/effects.ts,
// shared with the app, so a step ticked done here is exactly a step ticked done by hand.
import type { Writer } from '../../../src/ai/apply';
import type { Collection, Day, Project, Session, Stay, Task } from '../../../src/data/schema';
import { dueRulePatches, finishEffects, newTaskFields, nextOccurrence, projectCompletes } from '../../../src/domain/effects';
import type { Edits } from './space';
import type { View } from './view';

/** Same shape as the app's ids: a letter, the time in base 36, a few random characters. */
export const newId = (prefix: string) => prefix + Date.now().toString(36) + Array.from(crypto.getRandomValues(new Uint8Array(3)), b => (b % 36).toString(36)).join('');

type TaskDoc = Task & { id: string };

export interface Made { collection: Collection; id: string }

export function docWriter(e: Edits, view: View, now: () => Date = () => new Date()): Writer & { made: Made[] } {
  const made: Made[] = [];
  const today = view.today;
  const liveTasks = (): Iterable<TaskDoc> => e.live('tasks') as unknown as Iterable<TaskDoc>;
  const task = (id: string) => e.get('tasks', id) as unknown as TaskDoc | undefined;
  const create = (c: Collection, fields: object, id = newId(c[0]!)) => { e.createDoc(c, id, fields); made.push({ collection: c, id }); return id; };
  const dayPatch = (k: string, p: Partial<Day>) => {
    if (e.get('days', k)) e.update('days', k, p);
    else create('days', { date: k, plan: [], launches: [], first: null, checkin: null, closed: null, summary: null, ...p }, k);
  };
  const projectsNow = () => new Map([...e.live('projects')].map(p => [p.id, p as unknown as Project & { id: string }]));

  const w: Writer & { made: Made[] } = {
    made,
    async createTask(f) {
      const { title, suit, project, ...extra } = f;
      const t = now();
      return create('tasks', newTaskFields(title, suit ?? null, project ?? null, extra, projectsNow(), t.toISOString(), t.getTime()));
    },
    async create(c, fields) { return create(c, fields); },
    async update(c, id, patch) { e.update(c, id, patch); },
    async finish(id, day) {
      const tk = task(id);
      if (!tk || tk.status !== 'open') return;
      const t = now();
      const { patch, session } = finishEffects(tk, { today, day, nowIso: t.toISOString(), nowMs: t.getTime() });
      if (session) create('sessions', { taskId: id, d: session.d, m: session.m, why: session.why, at: t.toISOString(), source: session.source } satisfies Session);
      e.update('tasks', id, patch);
      if (tk.repeat) {
        const next = nextOccurrence(tk, day, liveTasks());
        if (next && 'fields' in next) {
          const projects = projectsNow();
          create('tasks', newTaskFields(tk.title, tk.suit, tk.project, next.fields, projects, t.toISOString(), t.getTime()));
        }
      }
      if (projectCompletes(tk.project, projectsNow(), liveTasks())) e.update('projects', tk.project, { status: 'done', doneAt: t.toISOString() });
    },
    async drop(id) {
      e.update('tasks', id, { status: 'dropped', started: null });
      const plan = e.get('days', today)?.plan;
      if (Array.isArray(plan) && plan.includes(id)) dayPatch(today, { plan: plan.filter((x: string) => x !== id) });
    },
    async day(k, patch) { dayPatch(k, patch); },
    async stay(id, s: Stay) {
      const sid = id ?? create('stays', s);
      if (id) e.update('stays', id, s as unknown as Record<string, unknown>);
      for (const x of dueRulePatches(sid, s, liveTasks())) e.update('tasks', x.id, { due: x.due });
      return sid;
    },
  };
  return w;
}
