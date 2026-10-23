import { describe, it, expect } from 'vitest';
import { insertAfterCurrent, reorderSubset, reslot } from './planOrder';

const open = (done: string[]) => (id: string) => !done.includes(id);

describe('insertAfterCurrent', () => {
  it('goes right after the running step', () => {
    expect(insertAfterCurrent(['a', 'b', 'c'], 'n', 'a', open([]))).toEqual(['a', 'n', 'b', 'c']);
    expect(insertAfterCurrent(['a', 'b', 'c'], 'n', 'b', open([]))).toEqual(['a', 'b', 'n', 'c']);
  });
  it('goes at the top of what is left when nothing runs', () => {
    expect(insertAfterCurrent(['a', 'b', 'c'], 'n', null, open(['a']))).toEqual(['a', 'n', 'b', 'c']);
    expect(insertAfterCurrent(['a', 'b'], 'n', null, open([]))).toEqual(['n', 'a', 'b']);
  });
  it('ignores a running step that is not on the list', () => {
    expect(insertAfterCurrent(['a', 'b'], 'n', 'zz', open([]))).toEqual(['n', 'a', 'b']);
  });
  it('goes last when everything is done, and onto an empty list', () => {
    expect(insertAfterCurrent(['a', 'b'], 'n', null, open(['a', 'b']))).toEqual(['a', 'b', 'n']);
    expect(insertAfterCurrent([], 'n', null, open([]))).toEqual(['n']);
  });
  it('does not duplicate a step already on the list', () => {
    expect(insertAfterCurrent(['a', 'n', 'b'], 'n', 'a', open([]))).toEqual(['a', 'n', 'b']);
  });
});

describe('reorderSubset', () => {
  it('puts the shown ids in the new order and leaves the others where they were', () => {
    expect(reorderSubset(['a', 'x', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'x', 'a', 'b']);
  });
  it('changes nothing when the shown ids are not all on the list', () => {
    expect(reorderSubset(['a', 'b'], ['b', 'q'])).toEqual(['a', 'b']);
  });
});

describe('reslot', () => {
  it('reuses the numbers and returns only what changes', () => {
    const cur = [{ id: 'a', order: 1 }, { id: 'b', order: 2 }, { id: 'c', order: 5 }];
    expect(reslot(cur, ['c', 'a', 'b'])).toEqual([{ id: 'c', order: 1 }, { id: 'a', order: 2 }, { id: 'b', order: 5 }]);
  });
  it('makes equal numbers distinct', () => {
    expect(reslot([{ id: 'a', order: 0 }, { id: 'b', order: 0 }], ['b', 'a'])).toEqual([{ id: 'a', order: 1 }]);
  });
});
