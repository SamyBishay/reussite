import { describe, expect, it } from 'vitest';
import { UndoLog, undoWrites } from './undo';
import type { UndoDoc } from '../data/schema';

const doc = (fields: Record<string, unknown>, hlc: Record<string, string>) => ({ ...fields, _hlc: hlc });

describe('the undo log', () => {
  it('keeps what each edit replaced, once per document, and only for fields whose clock moved', () => {
    const log = new UndoLog();
    log.updated('tasks', 't1', doc({ due: 'a', est: 5 }, { due: '1', est: '1' }), doc({ due: 'b', est: 5 }, { due: '2', est: '1' }), ['due', 'est']);
    log.updated('tasks', 't1', doc({ due: 'b' }, { due: '2' }), doc({ due: 'c' }, { due: '3' }), ['due']);
    log.updated('tasks', 't1', doc({}, {}), doc({ note: 'n' }, { note: '4' }), ['note']);
    expect(log.docs).toEqual([{ c: 'tasks', id: 't1', fields: { due: { was: 'a', now: 'c' }, note: { was: null, now: 'n' } } }]);
  });
  it('marks a creation and a removal', () => {
    const log = new UndoLog();
    log.created('tasks', 't2');
    log.removed('tasks', 't3');
    expect(log.docs).toEqual([{ c: 'tasks', id: 't2', created: true }, { c: 'tasks', id: 't3', removed: true }]);
  });
});

describe('undoWrites', () => {
  const docs: UndoDoc[] = [
    { c: 'tasks', id: 't1', fields: { due: { was: 'a', now: 'b' }, est: { was: 5, now: 10 } } },
    { c: 'tasks', id: 't2', created: true },
    { c: 'memory', id: 'n1', fields: { lines: { was: [{ id: 'l1' }], now: [{ id: 'l1' }, { id: 'l2' }] } } },
  ];
  it('puts fields back, last record first, and tombstones what was created', () => {
    const live: Record<string, Record<string, unknown>> = {
      'tasks/t1': { due: 'b', est: 10 }, 'tasks/t2': { title: 'x' }, 'memory/n1': { lines: [{ id: 'l1' }, { id: 'l2' }] },
    };
    expect(undoWrites(docs, (c, id) => live[c + '/' + id])).toEqual([
      { c: 'memory', id: 'n1', patch: { lines: [{ id: 'l1' }] } },
      { c: 'tasks', id: 't2', remove: true },
      { c: 'tasks', id: 't1', patch: { due: 'a', est: 5 } },
    ]);
  });
  it('leaves alone a field changed since, and says so', () => {
    const live: Record<string, Record<string, unknown>> = { 'tasks/t1': { due: 'later', est: 10 } };
    expect(undoWrites([docs[0]!], (c, id) => live[c + '/' + id])).toEqual([{ c: 'tasks', id: 't1', patch: { est: 5 }, kept: ['due'] }]);
    live['tasks/t1'] = { due: 'later', est: 99 };
    expect(undoWrites([docs[0]!], (c, id) => live[c + '/' + id])).toEqual([{ c: 'tasks', id: 't1', kept: ['due', 'est'] }]);
  });
  it('does nothing for a document that is gone, or already removed', () => {
    expect(undoWrites(docs, () => undefined)).toEqual([]);
    expect(undoWrites([{ c: 'tasks', id: 't9', removed: true }], () => ({}))).toEqual([]);
  });
});
