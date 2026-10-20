// apply_changes and undo. A change-set in the app's contract (docs/CHANGESET.md) goes through the
// app's own validator (ChangeSchema) and planner (planChanges); the connector adds only what an AI
// in a chat needs: titles in place of ids, "one low-risk change applies at once", a confirmation
// id for anything bigger, and an undo id for what was applied.
//
// Nothing is written unless the whole change-set is valid, every name is found once, and (for
// more than one low-risk change) the person said yes.
import { isLowRisk, planChanges, applyPlanned, type Plan } from '../../../src/ai/apply';
import { ChangeSchema, NOTE_MAX, type Change, type ChangeSet } from '../../../src/ai/changeset';
import { undoWrites } from '../../../src/ai/undo';
import { b64uDecode } from '../../../src/sync/bytes';
import { decryptJson, sealToText } from '../../../src/sync/crypto';
import type { Env } from '../env';
import { Edits, NeedCold, needsCold, type Loaded, type UndoDoc } from './space';
import { describe } from './render';
import { resolveChanges } from './resolve';
import type { View } from './view';
import { docWriter, newId } from './writer';

export const PENDING_MS = 60 * 60_000;
const UNDO_KEEP_MS = 30 * 24 * 3600_000;
const MAX_CHANGES = 80;

export interface Out { text: string; error?: boolean }
const err = (text: string): Out => ({ text, error: true });

export interface Input { changes?: unknown[]; note?: string; v?: unknown; confirm?: string }
export interface Ctx {
  env: Env;
  s: Loaded;
  v: View;
  /** Read the cold part too (if there is one and it isn't read yet); `v` is rebuilt over the whole list. */
  full(): Promise<void>;
}

const gen = (v: View) => ({ id: newId, now: () => new Date().toISOString(), zone: v.zone });
const rid = (p: string) => p + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => (b % 36).toString(36)).join('');

/** Check every change against the contract. All errors at once, so the AI can fix them in one go. */
function validate(input: Input): { changes: Change[] } | { errors: string[] } {
  if (input.v !== undefined && String(input.v) !== '1') return { errors: ['Only change-set version 1 is understood ("v": 1).'] };
  const raw = input.changes;
  if (!Array.isArray(raw) || !raw.length) return { errors: ['"changes" must be a list with at least one change.'] };
  if (raw.length > MAX_CHANGES) return { errors: [`At most ${MAX_CHANGES} changes in one change-set; send fewer.`] };
  const errors: string[] = [];
  const changes: Change[] = [];
  raw.forEach((c, i) => {
    const r = ChangeSchema.safeParse(c);
    if (r.success) { changes.push(r.data); return; }
    const op = c && typeof c === 'object' && 'op' in c ? String((c as { op: unknown }).op) : '?';
    const why = r.error.issues.slice(0, 3).map(x => (x.path.length ? x.path.join('.') + ': ' : '') + x.message).join('; ');
    errors.push(`Change ${i + 1} (${op}): ${why}`);
  });
  return errors.length ? { errors } : { changes };
}

const noWrite = 'Nothing was written.';

export async function applyChanges(c: Ctx, input: Input): Promise<Out> {
  if (input.confirm) return confirmed(c, input.confirm);

  const checked = validate(input);
  if ('errors' in checked) return err(`${noWrite} The change-set is not valid:\n${checked.errors.join('\n')}\nThe contract is in get_method.`);

  const found = resolveChanges(checked.changes, c.v.data);
  if (found.problems.some(p => p.text.startsWith('No step')) && needsCold(c.s)) throw new NeedCold(); // maybe it is an old finished step
  if (found.ambiguous.length) return err(`${noWrite} Which one is meant?\n${found.ambiguous.map(a => `Change ${a.index + 1}: ${a.text}`).join('\n')}\nRepeat the change with the id of the one meant.`);
  if (found.problems.length) return err(`${noWrite} Not found:\n${found.problems.map(p => `Change ${p.index + 1}: ${p.text}`).join('\n')}`);

  const cs: ChangeSet = { v: 1, note: (input.note ?? '').trim().slice(0, NOTE_MAX), changes: found.changes, bad: 0 };
  const plan = planChanges(cs, c.v.snapshot(), gen(c.v));
  const skipped = plan.skippedAt.map(i => `Change ${i + 1} (${cs.changes[i]!.op}): nothing to change (already so, or it does not apply).`);
  if (!plan.items.length) return { text: `${noWrite} Nothing to change.\n${skipped.join('\n')}` };

  if (isLowRisk(cs, plan)) return commit(c, plan, 'one low-risk change, applied at once', skipped);

  const id = rid('c');
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM connector_pending WHERE space = ?1 AND expires <= ?2').bind(c.s.space, now),
    c.env.DB.prepare('INSERT INTO connector_pending (id, space, blob, expires) VALUES (?1, ?2, ?3, ?4)')
      .bind(id, c.s.space, await sealToText(c.s.keys, { cs, items: plan.items.length }), now + PENDING_MS),
  ]);
  return {
    text: [
      `This needs the person's yes before anything is written. ${plan.items.length} change${plan.items.length === 1 ? '' : 's'}:`,
      ...plan.items.map((it, i) => `${i + 1}. ${describe(it, c.v)}`),
      ...skipped,
      `Nothing has been written yet. Show this to the person. If they say yes, call apply_changes again with only {"confirm": "${id}"} (valid for one hour).`,
    ].join('\n'),
  };
}

async function confirmed(c: Ctx, id: string): Promise<Out> {
  const row = await c.env.DB.prepare('SELECT blob, expires FROM connector_pending WHERE id = ?1 AND space = ?2 AND expires > ?3').bind(id, c.s.space, Date.now()).first<{ blob: string; expires: number }>();
  if (!row) return err(`${noWrite} That confirmation id is unknown or has expired (they last an hour). Send the changes again to get a new one.`);
  const { cs, items } = await decryptJson<{ cs: ChangeSet; items: number }>(c.s.keys, b64uDecode(row.blob));
  // The list may have moved on since the person was shown the diff: if the plan is no longer the same size, show it again.
  const plan = planChanges(cs, c.v.snapshot(), gen(c.v));
  if (plan.items.length !== items) {
    if (needsCold(c.s)) throw new NeedCold(); // it may name an old finished step, which only the cold part holds
    await c.env.DB.prepare('DELETE FROM connector_pending WHERE id = ?1').bind(id).run();
    return err(`${noWrite} The list changed since the person was shown these changes. Send the change-set again to get a fresh confirmation.`);
  }
  // Taking the row is what makes a confirmation work once. If the write turns out to need the cold part, nothing has been
  // written yet: put the row back, so the same id works when the tool runs again with it.
  const taken = await c.env.DB.prepare('DELETE FROM connector_pending WHERE id = ?1').bind(id).run();
  if (!taken.meta.changes) return err(`${noWrite} That confirmation id is unknown or has expired (they last an hour). Send the changes again to get a new one.`);
  try {
    return await commit(c, plan, `${plan.items.length} change${plan.items.length === 1 ? '' : 's'}, confirmed`, []);
  } catch (e) {
    if (e instanceof NeedCold) await c.env.DB.prepare('INSERT OR REPLACE INTO connector_pending (id, space, blob, expires) VALUES (?1, ?2, ?3, ?4)').bind(id, c.s.space, row.blob, row.expires).run();
    throw e;
  }
}

/** Write the plan as one encrypted batch and keep what it replaced for undo. */
async function commit(c: Ctx, plan: Plan, how: string, notes: string[]): Promise<Out> {
  const edits = new Edits(c.s);
  const writer = docWriter(edits, c.v);
  await applyPlanned(plan, () => true, writer);
  if (edits.empty) return { text: 'Nothing changed.' };
  const lines = plan.items.map(it => describe(it, c.v));
  const seq = await edits.flush(c.env);
  if (seq === null) return err('Too many changes this minute. Wait a moment and try again; nothing was written.');

  const undoId = rid('u');
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM connector_undo WHERE space = ?1 AND at < ?2').bind(c.s.space, now - UNDO_KEEP_MS),
    c.env.DB.prepare('INSERT INTO connector_undo (id, space, blob, at) VALUES (?1, ?2, ?3, ?4)').bind(undoId, c.s.space, await sealToText(c.s.keys, { docs: edits.undo }), now),
  ]);
  const made = writer.made.filter(m => m.collection !== 'sessions' && m.collection !== 'days');
  return {
    text: [
      `Done: ${how}.`,
      ...lines.map(l => '- ' + l),
      ...(made.length ? [`Created: ${made.map(m => m.id).join(', ')}`] : []),
      ...notes,
      `Undo id: ${undoId} (call undo with it to put things back). It reaches the person's devices at their next sync.`,
    ].join('\n'),
  };
}

/** Put back what one applied change-set replaced. Fields the person changed since are left alone. */
export async function undo(c: Ctx, id: string): Promise<Out> {
  const row = await c.env.DB.prepare('SELECT blob FROM connector_undo WHERE id = ?1 AND space = ?2').bind(id, c.s.space).first<{ blob: string }>();
  if (!row) return err('Nothing to undo: that undo id is unknown, or it was already used.');
  const { docs } = await decryptJson<{ docs: UndoDoc[] }>(c.s.keys, b64uDecode(row.blob));
  const edits = new Edits(c.s);
  const lines: string[] = [];
  const made = new Set(docs.filter(d => d.created).map(d => d.c + '/' + d.id));
  const used = (col: string, did: string) => {
    if (col === 'tasks') for (const x of edits.live('sessions')) if (x.taskId === did && !made.has('sessions/' + x.id)) return true;
    if (col === 'projects') for (const x of edits.live('tasks')) if (x.project === did && !made.has('tasks/' + x.id)) return true;
    return false;
  };
  for (const u of undoWrites(docs, (col, did) => edits.get(col, did), { now: Date.now(), used })) {
    const what = `${u.c}/${u.id}`;
    if (u.remove) { edits.remove(u.c, u.id); lines.push(`Removed ${what} (it was created by the change)`); }
    if (u.patch) { edits.update(u.c, u.id, u.patch); lines.push(`Restored ${what}: ${Object.keys(u.patch).join(', ')}`); }
    if (u.kept) lines.push(`Left ${what} alone: ${u.kept.join(', ')} changed since`);
    if (u.inUse) lines.push(`Left ${what} alone: it was created by the change, and something made since refers to it`);
  }
  if (!edits.empty) {
    const seq = await edits.flush(c.env);
    if (seq === null) return err('Too many changes this minute. Wait a moment and try again; nothing was undone.');
  }
  await c.env.DB.prepare('DELETE FROM connector_undo WHERE id = ?1').bind(id).run();
  return { text: lines.length ? ['Undone.', ...lines].join('\n') : 'Nothing to put back: everything it touched has changed since.' };
}

