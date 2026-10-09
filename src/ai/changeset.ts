// The change-set contract, version 1 (brief §10, docs/CHANGESET.md). One contract, one parser and
// one review screen for the command box, the AI features and "Paste the reply".
// Weights are never read from an AI: any `w` is dropped here (items get 3 when applied).
import { z } from 'zod';
import { extractJson } from './json';

export const CHANGESET_VERSION = 1;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/, 'HH:MM');
const id = z.union([z.string().min(1), z.number()]).transform(String);
const minutes = z.union([z.number(), z.string().regex(/^\s*\d+(\.\d+)?\s*$/).transform(Number)]).pipe(z.number().min(1).max(1440)).transform(Math.round);
const text = (max: number) => z.string().transform(s => s.trim().slice(0, max));
const ids = z.union([id, z.array(id)]).transform(v => (Array.isArray(v) ? v : [v]));
const suit = z.enum(['S', 'D', 'C', 'H']);

const taskSet = z.object({
  title: text(240).optional(),
  project: id.optional(),
  suit: suit.optional(),
  urgent: z.boolean().optional(),
  important: z.boolean().optional(),
  due: day.nullable().optional(),
  est: minutes.nullable().optional(),
  starter: text(240).nullable().optional(),
  app: text(60).nullable().optional(),
  link: text(2000).nullable().optional(),
  prompt: text(4000).nullable().optional(),
  note: text(2000).optional(),
  where: id.optional(),
  after: ids.nullable().optional(),
  kind: z.enum(['task', 'decision']).optional(),
  at: hhmm.nullable().optional(),
  dur: minutes.nullable().optional(),
});
export type TaskSet = z.infer<typeof taskSet>;

const smart = z.object({ specific: text(400), measurable: text(400), attainable: text(400), relevant: text(400), dated: text(400) }).partial();
const projectSet = z.object({
  name: text(120).optional(),
  suit: suit.optional(),
  where: id.optional(),
  goal: text(400).nullable().optional(),
  smart: smart.nullable().optional(),
  due: day.nullable().optional(),
  status: z.enum(['active', 'paused', 'done', 'dropped']).optional(),
});
export type ProjectSet = z.infer<typeof projectSet>;

// A column item: a string, or { text } (any weight is ignored).
const item = z.union([text(300), z.object({ text: text(300) }).transform(o => o.text)]);
const column = z.array(item).optional();
const option = z.object({ name: text(200), screened: text(300).nullable().optional(), pros: column, cons: column, prosNot: column, consNot: column });
const problem = z.object({ what: text(600), should: text(600), gap: text(600), constraints: text(600), deadline: text(200), control: text(600) }).partial();
const decisionSet = z.object({
  title: text(200).optional(),
  project: id.nullable().optional(),
  problem: problem.optional(),
  options: z.array(option).max(20).optional(),
  chosen: text(200).nullable().optional(),
  why: text(1000).optional(),
  mustBeTrue: text(1000).optional(),
  falsifier: text(1000).optional(),
  reviewOn: day.nullable().optional(),
  steps: z.array(taskSet.extend({ title: text(240) })).max(20).optional(),
});
export type DecisionSet = z.infer<typeof decisionSet>;

const launch = z.object({ t: hhmm, k: z.enum(['start', 'restart']).optional(), n: text(120).optional() });

const ref = text(40).optional();
export const ChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('task.create'), ref, set: taskSet.extend({ title: text(240).pipe(z.string().min(1)) }) }),
  z.object({ op: z.literal('task.update'), id, set: taskSet }),
  z.object({ op: z.literal('task.done'), id, day: day.optional() }),
  z.object({ op: z.literal('task.drop'), id }),
  z.object({ op: z.literal('task.reorder'), ids: z.array(id).min(2) }),
  z.object({ op: z.literal('project.create'), ref, set: projectSet.extend({ name: text(120).pipe(z.string().min(1)) }) }),
  z.object({ op: z.literal('project.update'), id, set: projectSet }),
  z.object({ op: z.literal('day.update'), date: day, plan: z.array(id).optional(), add: z.array(id).optional(), remove: z.array(id).optional(), first: id.nullable().optional(), launches: z.array(launch).optional() }),
  z.object({ op: z.literal('place.create'), ref, set: z.object({ name: text(80).pipe(z.string().min(1)), timeZone: text(60).optional() }) }),
  z.object({ op: z.literal('place.update'), id, set: z.object({ name: text(80).optional(), timeZone: text(60).optional() }) }),
  z.object({ op: z.literal('stay.create'), set: z.object({ place: id, from: day, to: day, note: text(300).optional() }) }),
  z.object({ op: z.literal('stay.update'), id, set: z.object({ place: id.optional(), from: day.optional(), to: day.optional(), note: text(300).optional() }) }),
  z.object({ op: z.literal('decision.create'), ref, set: decisionSet.extend({ title: text(200).pipe(z.string().min(1)) }) }),
  z.object({ op: z.literal('decision.update'), id, set: decisionSet }),
]);
export type Change = z.infer<typeof ChangeSchema>;

/** The envelope. Changes are checked one by one afterwards, so one bad line doesn't sink the rest. */
export const ChangeSetSchema = z.object({
  v: z.union([z.literal(1), z.literal('1').transform(() => 1 as const)]).optional(),
  note: z.string().optional(),
  changes: z.array(z.unknown()).max(80),
});
export type ChangeSetRaw = z.infer<typeof ChangeSetSchema>;

export interface ChangeSet { v: 1; note: string; changes: Change[]; bad: number }

export type ParseResult = { ok: true; cs: ChangeSet } | { ok: false; error: 'noJson' | 'invalid' | 'version' | 'empty' };

/** Validate an envelope already parsed (an AI reply) into a change-set. */
export function readChangeSet(raw: unknown): ParseResult {
  const wrapped = Array.isArray(raw) ? { changes: raw } : raw;
  if (wrapped && typeof wrapped === 'object' && 'v' in wrapped && String((wrapped as { v: unknown }).v) !== '1') return { ok: false, error: 'version' };
  const env = ChangeSetSchema.safeParse(wrapped);
  if (!env.success) return { ok: false, error: 'invalid' };
  const changes: Change[] = [];
  let bad = 0;
  for (const c of env.data.changes) {
    const r = ChangeSchema.safeParse(c);
    if (r.success) changes.push(r.data); else bad++;
  }
  if (!changes.length) return { ok: false, error: bad ? 'invalid' : 'empty' };
  return { ok: true, cs: { v: 1, note: (env.data.note ?? '').trim().slice(0, 600), changes, bad } };
}

/** Find the ```reussite block in a pasted reply (or any JSON) and validate it. */
export function parseChangeSet(text: string): ParseResult {
  const raw = extractJson(text, 'reussite');
  if (raw === undefined) return { ok: false, error: 'noJson' };
  return readChangeSet(raw);
}
