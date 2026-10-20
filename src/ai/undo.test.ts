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
    expect(log.docs).toEqual([{ c: 'tasks', id: 't1', fields: { due: { was: 'a', now: 'c' }, note: { was: null, now: 'n' } }, at: '4' }]);
  });
  it('marks a creation and a removal', () => {
    const log = new UndoLog();
    log.created('tasks', 't2', doc({ title: 'x' }, { title: '5' }));
    log.removed('tasks', 't3');
    expect(log.docs).toEqual([{ c: 'tasks', id: 't2', created: true, at: '5' }, { c: 'tasks', id: 't3', removed: true }]);
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

  const h = (ms: number, n = 0) => String(ms).padStart(13, '0') + ':' + String(n).padStart(4, '0') + ':d1';
  const T0 = Date.parse('2026-10-01T10:00:00Z');
  it('keeps a document it made when something was written to it since', () => {
    const made: UndoDoc[] = [{ c: 'tasks', id: 't2', created: true, at: h(T0) }];
    const untouched = { title: 'x', note: '', _hlc: { title: h(T0), note: h(T0) } };
    expect(undoWrites(made, () => untouched)).toEqual([{ c: 'tasks', id: 't2', remove: true }]);
    const edited = { title: 'x', note: 'two weeks of notes', _hlc: { title: h(T0), note: h(T0 + 14 * 864e5) } };
    expect(undoWrites(made, () => edited)).toEqual([{ c: 'tasks', id: 't2', kept: ['note'] }]);
    // an older record with no `at`: anything newer than the creation clock
    expect(undoWrites([{ c: 'tasks', id: 't2', created: true }], () => edited)).toEqual([{ c: 'tasks', id: 't2', kept: ['note'] }]);
  });
  it('keeps a document it made that something made since refers to', () => {
    const made: UndoDoc[] = [{ c: 'tasks', id: 't2', created: true, at: h(T0) }];
    const live = { title: 'x', _hlc: { title: h(T0) } };
    expect(undoWrites(made, () => live, { used: (c, id) => c === 'tasks' && id === 't2' })).toEqual([{ c: 'tasks', id: 't2', inUse: true }]);
  });
  it('takes back several change-sets at once: a step one made and the next edited is still removed', () => {
    const made: UndoDoc[] = [
      { c: 'tasks', id: 't2', created: true, at: h(T0) },
      { c: 'tasks', id: 't2', fields: { due: { was: null, now: '2026-10-02' } }, at: h(T0 + 60_000) },
      { c: 'tasks', id: 't1', fields: { due: { was: 'a', now: 'b' } }, at: h(T0) },
      { c: 'tasks', id: 't1', fields: { due: { was: 'b', now: 'c' } }, at: h(T0 + 60_000) },
    ];
    const live: Record<string, Record<string, unknown>> = {
      'tasks/t2': { title: 'x', due: '2026-10-02', _hlc: { title: h(T0), due: h(T0 + 60_000) } },
      'tasks/t1': { due: 'c', _hlc: { due: h(T0 + 60_000) } },
    };
    expect(undoWrites(made, (c, id) => live[c + '/' + id] as never)).toEqual([
      { c: 'tasks', id: 't1', patch: { due: 'b' } },
      { c: 'tasks', id: 't1', patch: { due: 'a' } },
      { c: 'tasks', id: 't2', patch: { due: null } },
      { c: 'tasks', id: 't2', remove: true },
    ]);
  });
  it('starts a timer it stopped again only within ten minutes; after that the time it ran stays logged', () => {
    const started = '2026-10-01T09:30:00.000Z';
    const done: UndoDoc[] = [
      { c: 'sessions', id: 's1', created: true, at: h(T0) },
      { c: 'tasks', id: 't1', fields: { status: { was: 'open', now: 'done' }, started: { was: started, now: null } }, at: h(T0, 1) },
    ];
    const live: Record<string, Record<string, unknown>> = {
      'sessions/s1': { taskId: 't1', m: 30, _hlc: { taskId: h(T0), m: h(T0) } },
      'tasks/t1': { status: 'done', started: null, _hlc: { status: h(T0, 1), started: h(T0, 1) } },
    };
    const get = (c: string, id: string) => live[c + '/' + id] as never;
    expect(undoWrites(done, get, { now: T0 + 5 * 60_000 })).toEqual([
      { c: 'tasks', id: 't1', patch: { status: 'open', started } },
      { c: 'sessions', id: 's1', remove: true },
    ]);
    expect(undoWrites(done, get, { now: T0 + 14 * 864e5 })).toEqual([{ c: 'tasks', id: 't1', patch: { status: 'open' } }]);
    expect(undoWrites(done, get)).toEqual([{ c: 'tasks', id: 't1', patch: { status: 'open' } }]);
  });
});
