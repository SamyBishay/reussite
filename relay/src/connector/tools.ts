// The connector's MCP server: nine tools (docs/dev/connector.md). A server is built per request
// (the handler is stateless); the space is only decrypted when a tool actually runs.
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import methodEn from '../../../docs/METHOD.en.md';
import methodFr from '../../../docs/METHOD.fr.md';
import changesetDoc from '../../../docs/CHANGESET.md';
import { cleanMethod, shortChangeset } from '../../../src/ai/method';
import { b64uDecode } from '../../../src/sync/bytes';
import { importEncKey } from '../../../src/sync/keys';
import { decisionLines, type TaskW } from '../../../src/domain/lists';
import type { Env } from '../env';
import { applyChanges, undo, type Ctx, type Out } from './changes';
import { cacheGet, remember } from './cache';
import { dayText, lines, projectText, queryText, taskText } from './render';
import { findByName } from '../../../src/domain/names';
import { compact, loadCold, loadSpace, NeedCold, needsCold, type Loaded } from './space';
import { View } from './view';
import { unwrap } from './wrap';

export const INSTRUCTIONS = `Réussite is a planning app built on a CBT method for adults with ADHD. This connector reads and edits one person's list: steps, projects, the day's plan, places, decisions.

Call get_method before planning a day or running a decision, and follow it. Read with today, get_day, query_tasks, get_task, get_project and get_decision.

Never change the list without the person's yes, except one low-risk change they asked for (add one step, tick one done, move one date): apply_changes applies that at once and returns an undo id. Anything else comes back as a diff and a confirmation id; show the diff, and call apply_changes again with that id only after the person says yes in the chat.

A quick edit such as "R: choir Monday 19:00, Hill House 602" takes a single apply_changes call: a task.create with "at", and titles work wherever an id is expected. Never give weights to decision items; the person weighs them.`;

export interface Row { wrapped: string; wall: number; counter: number }

class ToolError extends Error {}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const text = (o: Out) => ({ content: [{ type: 'text' as const, text: o.text }], ...(o.error ? { isError: true } : {}) });

const viewOf = (s: Loaded): View => new View(s.maps, undefined, needsCold(s) ? { x: s.split!.x, from: s.split!.from } : null);

/**
 * Open the space once per request: unwrap the key, read the snapshot's hot part (or take the
 * isolate's copy) and the batches after it, fold them in. The cold part is read only when
 * something needs it: `full()` does that, and so does a hot part that points into the cold one.
 */
function opener(env: Env, space: string, row: Row) {
  let opened: Promise<Ctx> | undefined;
  return () => (opened ??= (async () => {
    const entry = cacheGet(space, row.wrapped);
    const keys = entry?.keys ?? { spaceId: space, encKey: await importEncKey(b64uDecode((await unwrap(env, space, row.wrapped)).k)) };
    const s = await loadSpace(env, space, keys, { wall: row.wall, counter: row.counter }, entry);
    s.wrapped = row.wrapped;
    if (s.newer) throw new ToolError('The list was saved by a newer version of Réussite than this connector understands. Update the relay, then try again.');
    const c: Ctx = { env, s, v: viewOf(s), full: async () => { if (needsCold(s)) { await loadCold(env, s); if (s.newer) throw new ToolError('The list was saved by a newer version of Réussite than this connector understands. Update the relay, then try again.'); } c.v = viewOf(s); } };
    if (s.split?.pending) { await c.full(); await compact(env, s).catch(() => undefined); } // a stub of an old step: read the cold part, and cut the hot one again so the next call needn't
    remember(s);
    return c;
  })());
}

const unknown = (what: string, value: string, hint: string) => new ToolError(`No ${what} with the id or title "${value}". ${hint}`);

export function buildServer(env: Env, space: string, row: Row): McpServer {
  const server = new McpServer({ name: 'reussite', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const open = opener(env, space, row);
  const read = { readOnlyHint: true, openWorldHint: false } as const;

  /**
   * Run a tool: errors become a readable tool error, never a crash. A tool that finds it needs the
   * cold part (`NeedCold`, thrown before anything is written) gets it and runs again; a tool that
   * writes starts from copies of the maps, so a run that stopped half way leaves nothing behind.
   */
  const tool = <S extends z.ZodType>(name: string, description: string, input: S, annotations: object, fn: (c: Ctx, args: z.infer<S>) => Promise<Out> | Out) =>
    server.registerTool(name, { description, inputSchema: input, annotations }, (async (args: z.infer<S>) => {
      try {
        const c = await open();
        const before = c.s.maps;
        c.s.own = new Set();
        try { return text(await fn(c, args)); } catch (e) {
          if (!(e instanceof NeedCold)) throw e;
          c.s.maps = before;
          c.s.own = new Set();
          await c.full();
          return text(await fn(c, args));
        }
      } catch (e) {
        if (e instanceof ToolError) return text({ text: e.message, error: true });
        console.error('connector tool failed', name, e instanceof Error ? e.name : typeof e);
        return text({ text: 'Something went wrong reading or writing the list. Try again; if it keeps happening, switch the connector off and on in Réussite.', error: true });
      }
    }) as never);

  const task = (c: Ctx, value: string): TaskW => {
    const t = c.v.tasks.get(value);
    if (t) return t;
    const f = findByName(value, [...c.v.tasks.values()].filter(x => !x.template).map(x => ({ id: x.id, name: x.title })));
    if ('id' in f) return c.v.tasks.get(f.id)!;
    if ('many' in f) throw new ToolError(`"${value}" matches ${f.many.length} steps; call again with the id of the one meant:\n${lines(c.v, f.many.slice(0, 8).map(m => c.v.tasks.get(m.id)!))}`);
    if (needsCold(c.s)) throw new NeedCold(); // an old finished step: not in the hot part
    throw unknown('step', value, 'Use query_tasks to find it.');
  };

  tool('today', "Today: the current place, today's list in order with launch points and fixed times, the next step, steps carried from yesterday, and the day's estimated total with its range.", z.object({}), read, c => ({ text: dayText(c.v, c.v.today) }));

  tool('get_day', 'Any date (YYYY-MM-DD): its list in order, launch points, fixed times, and what was done that day.', z.object({ date: day }), read, (c, { date }) => {
    if (needsCold(c.s) && date < c.s.split!.from) throw new NeedCold(); // before the hot window
    return { text: dayText(c.v, date) };
  });

  tool('query_tasks', 'Find steps, at most 50 as compact lines (id | title | quadrant | due | estimate | project). Quadrants: 1 now, 2 plan, 3 quick, 4 later. Open steps by default, most pressing first.', z.object({
    quadrant: z.number().int().min(1).max(4).optional(),
    project: z.string().optional().describe('A project id or name'),
    place: z.string().optional().describe('A place id or name, or "any"; includes steps that can be done anywhere'),
    status: z.enum(['open', 'done', 'dropped', 'all']).optional(),
    due_from: day.optional(), due_to: day.optional(),
    text: z.string().optional().describe('Words that must all appear in the title, note or project name'),
    limit: z.number().int().min(1).max(50).optional(),
  }), read, (c, a) => {
    if (needsCold(c.s) && (a.status ?? 'open') !== 'open') throw new NeedCold(); // finished steps are mostly in the cold part
    const ids: { project?: string; place?: string } = {};
    if (a.project) {
      const f = c.v.projects.has(a.project) || a.project === 'inbox' ? { id: a.project } : findByName(a.project, [...c.v.projects.values()].map(p => ({ id: p.id, name: p.name })));
      if ('id' in f) ids.project = f.id; else throw unknown('project', a.project, 'Projects are listed by get_project.');
    }
    if (a.place) {
      const f = a.place === 'any' || c.v.places.has(a.place) ? { id: a.place } : findByName(a.place, [...c.v.places.values()].map(p => ({ id: p.id, name: p.name })));
      if ('id' in f) ids.place = f.id; else throw unknown('place', a.place, '');
    }
    return { text: queryText(c.v, { quadrant: a.quadrant, status: a.status, dueFrom: a.due_from, dueTo: a.due_to, text: a.text, limit: a.limit }, ids) };
  });

  tool('get_task', 'One step with everything on it, and its work sessions. The id, or its title.', z.object({ id: z.string() }), read, (c, { id }) => ({ text: taskText(c.v, task(c, id)) }));

  tool('get_project', 'One project: goal, SMART fields, and its steps (at most 50 open ones). The id, or its name.', z.object({ id: z.string() }), read, (c, { id }) => {
    const f = c.v.projects.has(id) || id === 'inbox' ? { id } : findByName(id, [...c.v.projects.values()].map(p => ({ id: p.id, name: p.name })));
    if ('many' in f) throw new ToolError(`"${id}" matches several projects:\n${f.many.map(m => `${m.id} | ${m.name}`).join('\n')}`);
    if (!('id' in f)) {
      const all = [...c.v.projects.values()].filter(p => p.status === 'active' || p.status === 'paused');
      throw unknown('project', id, 'Active projects:\n' + all.slice(0, 40).map(p => `${p.id} | ${p.name}`).join('\n'));
    }
    return { text: projectText(c.v, f.id) };
  });

  tool('get_decision', 'One decision: the problem, the options with their pros and cons, the choice and its check date. The id, or its title.', z.object({ id: z.string() }), read, (c, { id }) => {
    const f = c.v.decisions.has(id) ? { id } : findByName(id, [...c.v.decisions.values()].map(d => ({ id: d.id, name: d.title })));
    if ('many' in f) throw new ToolError(`"${id}" matches several decisions:\n${f.many.map(m => `${m.id} | ${m.name}`).join('\n')}`);
    if (!('id' in f)) throw unknown('decision', id, 'Decisions:\n' + [...c.v.decisions.values()].slice(0, 30).map(d => `${d.id} | ${d.title}`).join('\n'));
    const d = c.v.decisions.get(f.id)!;
    const steps = d.taskIds.map(i => c.v.tasks.get(i)).filter((t): t is TaskW => !!t);
    return { text: decisionLines(d) + (steps.length ? `\nsteps:\n${lines(c.v, steps)}` : '') };
  });

  // The method needs no list: it doesn't open the space.
  server.registerTool('get_method', {
    description: 'The Réussite method (rules, tone, how to run a plan or a decision) and the change-set format apply_changes takes. Read it before planning or deciding.',
    inputSchema: z.object({ language: z.enum(['en', 'fr']).optional().describe('Default en') }),
    annotations: read,
  }, async ({ language }) => text({ text: `${cleanMethod(language === 'fr' ? methodFr : methodEn)}\n\n---\n\n${shortChangeset(changesetDoc)}` }));

  tool('apply_changes', 'Edit the list with a change-set (format in get_method). One low-risk change (add a step, tick one done, move one date) applies at once and returns an undo id. Anything else returns a diff and a confirmation id; call again with {"confirm": id} only after the person says yes. Titles work in place of ids. An invalid change-set writes nothing.', z.object({
    changes: z.array(z.looseObject({ op: z.string().describe('e.g. task.create, task.update, task.done, task.drop, day.update') })).optional(),
    note: z.string().optional(),
    v: z.union([z.number(), z.string()]).optional().describe('Change-set version, 1'),
    confirm: z.string().optional().describe('A confirmation id from an earlier call'),
  }), { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, (c, a) => applyChanges(c, a));

  tool('undo', 'Put back what one applied change-set changed, by its undo id. Anything the person changed since is left alone.', z.object({ id: z.string() }), { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, (c, { id }) => undo(c, id));

  return server;
}
