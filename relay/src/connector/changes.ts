// apply_changes and undo. A change-set in the app's contract (docs/CHANGESET.md) goes through the
// app's own validator (ChangeSchema) and planner (planChanges); the connector adds only what an AI
// in a chat needs: titles in place of ids, "one low-risk change applies at once", a confirmation
// id for anything bigger, and an undo id for what was applied.
//
// Nothing is written unless the whole change-set is valid, every name is found once, and (for
// more than one low-risk change) the person said yes.
import { isLowRisk, planChanges, applyPlanned, pinLines, type Plan } from '../../../src/ai/apply';
import { ChangeSchema, NOTE_MAX, type Change, type ChangeSet } from '../../../src/ai/changeset';
import { undoWrites } from '../../../src/ai/undo';
import { liveNextHeads } from '../../../src/domain/events';
import { isEvent, oneLine } from '../../../src/domain/lists';
import { b64uDecode } from '../../../src/sync/bytes';
import { decryptJson, sealToText } from '../../../src/sync/crypto';
import type { Env } from '../env';
import { Edits, NeedCold, needsCold, type Loaded, type UndoDoc } from './space';
import { describe } from './render';
import { resolveChanges } from './resolve';
import { writeWarnings } from './warn';
import type { View } from './view';
import { docWriter, newId } from './writer';

export const PENDING_MS = 60 * 60_000;
const UNDO_KEEP_MS = 30 * 24 * 3600_000;
/** A change-set is at most this long: more does not fit the free plan's 10 ms of CPU (docs/dev/connector.md, "CPU on the free plan"). The app's own AI path is not limited by it. */
export const MAX_CHANGES = 25;
/** How long a confirmation is claimed while it is applied; a killed request's lease runs out and the id works again. */
export const LEASE_MS = 30_000;

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
  if (raw.length > MAX_CHANGES) return { errors: [`At most ${MAX_CHANGES} changes in one change-set, and this one has ${raw.length}. Split it into several change-sets of at most ${MAX_CHANGES} changes and send them one after the other.`] };
  const errors: string[] = [];
  const changes: Change[] = [];
  raw.forEach((c, i) => {
    // The connector never reads or writes addresses and people (they go to an AI only from the app's own trip pack).
    if (c && typeof c === 'object' && String((c as { op?: unknown }).op).startsWith('address.')) {
      errors.push(`Change ${i + 1} (${String((c as { op: unknown }).op)}): the connector does not handle addresses; the person adds them in the app (a trip plan's reply is pasted there).`);
      return;
    }
    // The person's own settings (setup with an AI) are written in the app, from a reply they paste there.
    if (c && typeof c === 'object' && String((c as { op?: unknown }).op).startsWith('settings.')) {
      errors.push(`Change ${i + 1} (${String((c as { op: unknown }).op)}): the connector does not change the app's settings; the person sets those up in the app (a setup reply is pasted there).`);
      return;
    }
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
  // An event given what only a step has (an estimate, a time), or a step given a check date: said, and nothing written, like any invalid change.
  if (plan.notes?.length) return err(`${noWrite} The change-set is not valid:\n${plan.notes.map(n => `Change ${n.at + 1} (${cs.changes[n.at]!.op}): ${n.text}`).join('\n')}\nThe contract is in get_method.`);
  const skipped = plan.skippedAt.map(i => `Change ${i + 1} (${cs.changes[i]!.op}): nothing to change (already so, or it does not apply).`);
  if (!plan.items.length) return { text: `${noWrite} Nothing to change.\n${skipped.join('\n')}` };

  if (isLowRisk(cs, plan)) return commit(c, cs, plan, 'one low-risk change, applied at once', skipped);

  const id = rid('c');
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM connector_pending WHERE space = ?1 AND expires <= ?2').bind(c.s.space, now),
    c.env.DB.prepare('INSERT INTO connector_pending (id, space, blob, expires) VALUES (?1, ?2, ?3, ?4)')
      .bind(id, c.s.space, await sealToText(c.s.keys, { cs: pinLines(cs, c.v.snapshot()), items: plan.items.length }), now + PENDING_MS),
  ]);
  return {
    text: [
      `This needs the person's yes before anything is written. ${plan.items.length} change${plan.items.length === 1 ? '' : 's'}:`,
      ...plan.items.map((it, i) => `${i + 1}. ${describe(it, c.v)}`),
      ...skipped,
      ...writeWarnings(cs, plan, c.v),
      `Nothing has been written yet. Read it, and show it to the person (the warnings too). If they say yes, call apply_changes again with only {"confirm": "${id}"} (valid for one hour).`,
    ].join('\n'),
  };
}

const already = (undoId: string | null): Out => ({
  text: `Already applied: this confirmation was used before, and nothing new was written.${undoId ? ` Undo id: ${undoId} (call undo with it to put things back).` : ''}`,
});
const gone = () => err(`${noWrite} That confirmation id is unknown or has expired (they last an hour). Send the changes again to get a new one.`);

interface Pending { blob: string; expires: number; applied_at: number | null; undo_id: string | null }
const pendingRow = (c: Ctx, id: string) =>
  c.env.DB.prepare('SELECT blob, expires, applied_at, undo_id FROM connector_pending WHERE id = ?1 AND space = ?2 AND expires > ?3').bind(id, c.s.space, Date.now()).first<Pending>();

/**
 * A confirmation is applied at most once, and survives a request that is killed (the free plan stops one at 10 ms of CPU):
 * - Nothing is consumed before the write. The row is *claimed* with a lease (`claimed_until`, `LEASE_MS`); a second call
 *   while the lease holds is told it is being applied and writes nothing. A request that dies leaves a lease that runs out,
 *   and the same id works again; one that fails cleanly (NeedCold, rate limit, an error) lets go of it at once.
 * - The change batch and the row's `applied_at` (with the seq and the undo id) are in one D1 transaction (`commit`), so a
 *   kill leaves both or neither. A retry of an applied id answers "Already applied" with the original undo id.
 * - Even if a lease ran out under a request that was merely slow, the batch's insert is conditional on the row being unapplied,
 *   so the slow one writes nothing when it gets there.
 */
async function confirmed(c: Ctx, id: string): Promise<Out> {
  const row = await pendingRow(c, id);
  if (!row) return gone();
  if (row.applied_at !== null) return already(row.undo_id);
  const { cs, items } = await decryptJson<{ cs: ChangeSet; items: number }>(c.s.keys, b64uDecode(row.blob));
  // The list may have moved on since the person was shown the diff: if the plan is no longer the same size, show it again.
  const plan = planChanges(cs, c.v.snapshot(), gen(c.v));
  if (plan.items.length !== items) {
    if (needsCold(c.s)) throw new NeedCold(); // it may name an old finished step, which only the cold part holds
    await c.env.DB.prepare('DELETE FROM connector_pending WHERE id = ?1 AND applied_at IS NULL').bind(id).run();
    return err(`${noWrite} The list changed since the person was shown these changes. Send the change-set again to get a fresh confirmation.`);
  }
  const now = Date.now();
  const claim = await c.env.DB.prepare(
    'UPDATE connector_pending SET claimed_until = ?1 WHERE id = ?2 AND space = ?3 AND applied_at IS NULL AND (claimed_until IS NULL OR claimed_until < ?4)',
  ).bind(now + LEASE_MS, id, c.s.space, now).run();
  if (!claim.meta.changes) {
    const now2 = await pendingRow(c, id); // applied between our read and our claim, or being applied by another call
    if (!now2) return gone();
    if (now2.applied_at !== null) return already(now2.undo_id);
    return err(`${noWrite} That confirmation is being applied right now by another call. Wait a moment and call apply_changes with the same id again; it is applied once.`);
  }
  try {
    return await commit(c, cs, plan, `${plan.items.length} change${plan.items.length === 1 ? '' : 's'}, confirmed`, [], id);
  } finally {
    // Not applied (NeedCold, rate limit, an error): let go, so the same id works at once. Applied: this matches nothing.
    await c.env.DB.prepare('UPDATE connector_pending SET claimed_until = NULL WHERE id = ?1 AND applied_at IS NULL').bind(id).run().catch(() => undefined);
  }
}

/**
 * Write the plan as one encrypted batch and keep what it replaced for undo. The batch, the undo record (sealed before the
 * append so it can go in with it), the connector's clock, the "feed is behind" flag and, for a confirmation, its `applied_at`
 * are one D1 transaction (`Edits.flush`, `appendBatchWith`). The one thing outside it is the seq's allocation (a killed request
 * leaves a number unused, which readers ignore). Without a confirmation id (the one low-risk change applied at once) a retry
 * after a kill is a new call and writes again: that path has no id to make it idempotent, and the AI is told what it did only
 * by this answer.
 */
async function commit(c: Ctx, cs: ChangeSet, plan: Plan, how: string, notes: string[], pendingId?: string): Promise<Out> {
  const warnings = writeWarnings(cs, plan, c.v); // read before anything is written
  const edits = new Edits(c.s);
  const writer = docWriter(edits, c.v);
  await applyPlanned(plan, () => true, writer);
  if (edits.empty) return { text: 'Nothing changed.' };
  const lines = plan.items.map(it => describe(it, c.v));
  // The connector never puts a step on a day's list (so an event's happening does not either): say what it freed, so the person can be asked where it goes.
  for (const it of plan.items) for (const op of it.ops) {
    if (op.t !== 'finish' || !isEvent(c.v.tasks.get(op.id))) continue;
    const freed = liveNextHeads(c.v.tasks, op.id).map(id => `${id} ${oneLine(c.v.tasks.get(id)?.title ?? '')}`.trim());
    if (freed.length) notes = [...notes, `Freed by it: ${freed.join('; ')}. It is on no day's list yet; day.update adds it to one.`];
  }
  const undoId = rid('u');
  const undoBlob = await sealToText(c.s.keys, { docs: edits.undo });
  const { space } = c.s;
  const db = c.env.DB;
  const flushed = await edits.flush(c.env, {
    when: pendingId ? { sql: 'EXISTS (SELECT 1 FROM connector_pending WHERE id = ?7 AND space = ?1 AND applied_at IS NULL)', args: [pendingId] } : undefined,
    then: seq => {
      const now = Date.now();
      const ours = 'EXISTS (SELECT 1 FROM batches WHERE space = ?2 AND seq = ?5)';
      return [
        db.prepare('DELETE FROM connector_undo WHERE space = ?1 AND at < ?2').bind(space, now - UNDO_KEEP_MS),
        db.prepare(`INSERT INTO connector_undo (id, space, blob, at) SELECT ?1, ?2, ?3, ?4 WHERE ${ours}`).bind(undoId, space, undoBlob, now, seq),
        ...(pendingId
          ? [db.prepare(`UPDATE connector_pending SET applied_at = ?1, undo_id = ?2, seq = ?3, claimed_until = NULL WHERE id = ?4 AND space = ?5 AND applied_at IS NULL AND EXISTS (SELECT 1 FROM batches WHERE space = ?5 AND seq = ?3)`).bind(now, undoId, seq, pendingId, space)]
          : []),
      ];
    },
  });
  if (flushed === 'limited') return err('Too many changes this minute. Wait a moment and try again; nothing was written.');
  if (flushed === 'empty') return { text: 'Nothing changed.' };
  if (flushed === 'skipped') {
    const row = pendingId ? await pendingRow(c, pendingId) : null; // another call applied it first
    return row?.applied_at != null ? already(row.undo_id) : err(`${noWrite} It was applied by another call; check with query_tasks.`);
  }
  const made = writer.made.filter(m => m.collection !== 'sessions' && m.collection !== 'days');
  return {
    text: [
      `Done: ${how}.`,
      ...lines.map(l => '- ' + l),
      ...(made.length ? [`Created: ${made.map(m => m.id).join(', ')}`] : []),
      ...notes,
      ...warnings,
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
  // The batch and the use of the undo id are one transaction: a kill leaves the id usable, and a second call can't undo twice.
  const del = (db: D1Database) => db.prepare('DELETE FROM connector_undo WHERE id = ?1 AND space = ?2').bind(id, c.s.space);
  const flushed = edits.empty ? 'empty' : await edits.flush(c.env, {
    when: { sql: 'EXISTS (SELECT 1 FROM connector_undo WHERE id = ?7 AND space = ?1)', args: [id] },
    then: () => [del(c.env.DB)],
  });
  if (flushed === 'limited') return err('Too many changes this minute. Wait a moment and try again; nothing was undone.');
  if (flushed === 'skipped') return err('Nothing to undo: that undo id is unknown, or it was already used.');
  if (flushed === 'empty') await del(c.env.DB).run();
  return { text: lines.length ? ['Undone.', ...lines].join('\n') : 'Nothing to put back: everything it touched has changed since.' };
}
