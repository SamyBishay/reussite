import { describe, expect, it } from 'vitest';
import type { TaskW } from './lists';
import { chainIndex, chainOf, effectiveDue, isWaiting, nextHeads } from './chains';

const mk = (id: string, p: Partial<TaskW> = {}): [string, TaskW] => [id, { id, status: 'open', after: null, order: 0, due: null, ...p } as TaskW];
const map = (...a: [string, TaskW][]) => new Map(a);

describe('chainIndex', () => {
  it('has no chains when nothing waits', () => {
    const ix = chainIndex(map(mk('a'), mk('b')));
    expect(ix.chains.size).toBe(0);
    expect(isWaiting(ix, 'a')).toBe(false);
  });

  it('makes a linear chain headed by the first step', () => {
    const ix = chainIndex(map(mk('c', { after: 'b' }), mk('b', { after: 'a' }), mk('a')));
    const c = chainOf(ix, 'c')!;
    expect(c.id).toBe('a');
    expect(c.members).toEqual(['a', 'b', 'c']);
    expect(c.after).toBe(2);
    expect(isWaiting(ix, 'a')).toBe(false);
    expect(isWaiting(ix, 'b')).toBe(true);
    expect(isWaiting(ix, 'c')).toBe(true);
    expect(c.depth.get('c')).toBe(2);
  });

  it('shows a step after two under the deeper one', () => {
    const ix = chainIndex(map(mk('a'), mk('b', { after: ['a'] }), mk('c', { after: ['a', 'b'] })));
    expect(ix.chains.get('a')!.parent.get('c')).toBe('b');
    expect(ix.chains.get('a')!.members).toEqual(['a', 'b', 'c']);
  });

  it('keeps two separate roots as two heads, the joined step under the later', () => {
    const ix = chainIndex(map(mk('a', { order: 1 }), mk('b', { order: 2 }), mk('c', { after: ['a', 'b'] })));
    expect(isWaiting(ix, 'a')).toBe(false);
    expect(isWaiting(ix, 'b')).toBe(false);
    expect(ix.chains.get('b')!.members).toEqual(['b', 'c']);
    expect(ix.chains.has('a')).toBe(false);
  });

  it('terminates on a cycle and gives it one deterministic head', () => {
    const ix = chainIndex(map(mk('a', { after: 'c', order: 2 }), mk('b', { after: 'a', order: 3 }), mk('c', { after: 'b', order: 1 })));
    const c = chainOf(ix, 'a')!;
    expect(c.id).toBe('c');
    expect([...c.members].sort()).toEqual(['a', 'b', 'c']);
    expect(isWaiting(ix, 'c')).toBe(false);
  });

  it('handles a step after itself, a two-step cycle and a step hanging off a cycle', () => {
    const ix = chainIndex(map(mk('s', { after: 's' }), mk('x', { after: 'y' }), mk('y', { after: 'x' }), mk('z', { after: 'x' })));
    expect(ix.of.has('s')).toBe(false);
    expect(chainOf(ix, 'z')!.id).toBe('x');
    expect([...chainOf(ix, 'z')!.members].sort()).toEqual(['x', 'y', 'z']);
    expect(isWaiting(ix, 'x')).toBe(false);
  });

  it('ignores done, dropped and missing steps', () => {
    const ix = chainIndex(map(mk('a', { status: 'done' }), mk('b', { after: ['a', 'gone'] }), mk('c', { after: 'b' }), mk('d', { status: 'dropped' }), mk('e', { after: 'd' })));
    expect(chainOf(ix, 'c')!.members).toEqual(['b', 'c']);
    expect(isWaiting(ix, 'b')).toBe(false);
    expect(ix.of.has('e')).toBe(false);
  });

  it('takes the earliest due date of the chain', () => {
    const ix = chainIndex(map(mk('a', { due: '2026-12-01' }), mk('b', { after: 'a', due: '2026-11-12' }), mk('c', { after: 'b' })));
    expect(ix.chains.get('a')!.due).toBe('2026-11-12');
    expect(effectiveDue(ix, 'a', '2026-12-01')).toBe('2026-11-12');
    expect(effectiveDue(ix, 'b', '2026-11-12')).toBe('2026-11-12');
    expect(effectiveDue(ix, 'zz', null)).toBe(null);
  });

  it('does not wait for a step the map does not hold (a tombstoned one)', () => {
    const ix = chainIndex(map(mk('b', { after: 'dead' })));
    expect(ix.chains.size).toBe(0);
    expect(isWaiting(ix, 'b')).toBe(false);
  });

  it('is fast on a long chain', () => {
    const t = new Map<string, TaskW>();
    for (let i = 0; i < 3000; i++) t.set('t' + i, mk('t' + i, { after: i ? 't' + (i - 1) : null, order: i })[1]);
    const ix = chainIndex(t);
    expect(ix.chains.get('t0')!.after).toBe(2999);
  });
});

describe('nextHeads', () => {
  it('names the step that takes the head’s place', () => {
    const t = map(mk('a'), mk('b', { after: 'a' }), mk('c', { after: 'b' }));
    expect(nextHeads(t, 'a')).toEqual(['b']);
    expect(nextHeads(t, 'b')).toEqual([]);
  });
  it('names every step freed', () => {
    const t = map(mk('a'), mk('b', { after: 'a', order: 1 }), mk('c', { after: 'a', order: 2 }));
    expect(nextHeads(t, 'a')).toEqual(['b', 'c']);
  });
});
