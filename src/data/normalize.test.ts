import { describe, expect, it } from 'vitest';
import { normExchange, normNote } from './normalize';

describe('normNote', () => {
  it('fills every field of a bare note', () => {
    expect(normNote({})).toEqual({ kind: 'topic', name: '', aliases: [], lines: [], private: false, updated: '' });
  });
  it('keeps what it knows and what it does not', () => {
    const n = normNote({ kind: 'person', name: 'Ibrahim', aliases: ['Ibra', 3], private: true, description: 'cousin', future: { a: 1 }, lines: [{ id: 'x', text: 'one', at: '2026-10-01', by: 'ai', extra: 1 }, 'junk', { text: 'two', by: 'person' }] });
    expect(n).toMatchObject({ kind: 'person', name: 'Ibrahim', aliases: ['Ibra'], private: true, description: 'cousin', future: { a: 1 } });
    expect(n.lines).toEqual([{ id: 'x', text: 'one', at: '2026-10-01', by: 'ai', extra: 1 }, { id: 'l1', text: 'two', at: '', by: 'me' }]);
  });
  it('reads an unknown kind as a topic', () => {
    expect(normNote({ kind: 'planet' }).kind).toBe('topic');
  });
});

describe('normExchange', () => {
  it('fills every field of a bare exchange', () => {
    expect(normExchange({})).toEqual({ at: '', text: '', turns: [], changes: [], undo: {}, undone: [], src: 'home' });
  });
  it('keeps the undo records and unknown fields', () => {
    const undo = { c1: [{ c: 'tasks', id: 't1', created: true }] };
    const e = normExchange({ at: '2026-10-01T10:00:00Z', text: 'hi', turns: [{ at: 'a', text: 'b', reply: 'c', kind: 'say' }], changes: ['c1'], undo, undone: ['c1', 4], src: 'link', later: 1 });
    expect(e).toMatchObject({ changes: ['c1'], undo, undone: ['c1'], src: 'link', later: 1, turns: [{ text: 'b', reply: 'c', kind: 'say' }] });
  });
});
