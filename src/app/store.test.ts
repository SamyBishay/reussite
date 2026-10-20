import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { applyUndo, createDoc, db, exchanges, memory, projects, recordWrites, removeDoc, start, tasks, update } from './store';
import { finishTask } from './actions';
import { newTaskFields } from '../domain/effects';

describe('memory and exchanges in the store', () => {
  it('mirrors notes and exchanges as signals, filled with defaults, and a removed one leaves the signal', async () => {
    await start();
    const id = await createDoc('memory', { name: 'Ibrahim' });
    await createDoc('exchanges', { at: '2026-10-20T09:00:00Z', text: 'hi' }, 'e1');
    await new Promise(r => setTimeout(r, 30));
    expect(memory.value.get(id)).toMatchObject({ id, name: 'Ibrahim', kind: 'topic', aliases: [], lines: [], private: false });
    expect(exchanges.value.get('e1')).toMatchObject({ text: 'hi', turns: [], changes: [], undo: {}, undone: [], src: 'home' });
    await update('memory', id, { lines: [{ id: 'l0', text: 'one', at: '', by: 'me' }] });
    await new Promise(r => setTimeout(r, 30));
    expect(memory.value.get(id)!.lines).toHaveLength(1);
    await removeDoc('memory', id);
    await new Promise(r => setTimeout(r, 30));
    expect(memory.value.has(id)).toBe(false);
  });
});

const settle = () => new Promise(r => setTimeout(r, 40));

describe('recording writes for Undo', () => {
  it('records a finished repeating step (the step, its session, the next one) and puts it all back', async () => {
    await start();
    const now = new Date().toISOString();
    const day = new Date().toISOString().slice(0, 10);
    await createDoc('projects', { name: 'Plants', suit: 'C', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' }, 'pr1');
    await createDoc('tasks', newTaskFields('Water', 'C', 'pr1', { due: day, repeat: { every: 1, unit: 'week', from: 'due' } }, new Map(), now, 1), 'w1');
    await settle();

    const { undo } = await recordWrites(async () => {
      await finishTask(tasks.value.get('w1')!, 10);
      await update('projects', 'pr1', { status: 'done' }); // finishTask does this itself when the last step of a project is done
    });
    await settle();
    expect(tasks.value.get('w1')!.status).toBe('done');
    expect(projects.value.get('pr1')!.status).toBe('done');
    const kinds = undo.map(u => u.c + (u.created ? '+' : '~'));
    expect(kinds).toEqual(expect.arrayContaining(['tasks~', 'sessions+', 'tasks+', 'projects~']));
    const next = undo.find(u => u.c === 'tasks' && u.created)!.id;
    expect(tasks.value.get(next)).toBeTruthy();

    // A write made after the recording ended is not in it.
    const before = undo.length;
    await update('tasks', 'w1', { note: 'later' });
    expect(undo).toHaveLength(before);

    const r = await applyUndo(undo);
    await settle();
    expect(r.restored).toBeGreaterThan(0);
    expect(tasks.value.get('w1')).toMatchObject({ status: 'open', note: 'later' });
    expect(projects.value.get('pr1')!.status).toBe('active');
    expect(tasks.value.has(next)).toBe(false); // tombstoned, never hard-deleted
    expect((await db.table_('tasks').get(next))!._del).toBeTruthy();
  });

  it('leaves alone what changed since, and records nothing when no one is recording', async () => {
    await start();
    await createDoc('memory', { kind: 'person', name: 'Zed', aliases: [], lines: [], private: false, updated: '' }, 'mz');
    await settle();
    const { undo } = await recordWrites(() => update('memory', 'mz', { name: 'Zed K', updated: 'x' }));
    await update('memory', 'mz', { name: 'Zed Q' });
    const r = await applyUndo(undo);
    await settle();
    expect(r.kept).toBe(1);
    expect(memory.value.get('mz')).toMatchObject({ name: 'Zed Q', updated: '' });
  });
});
