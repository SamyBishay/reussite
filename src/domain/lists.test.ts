import { describe, it, expect } from 'vitest';
import { isObligation, type TaskW } from './lists';

const tk = (id: string, o: Partial<TaskW> = {}) => ({ id, template: false, ...o }) as TaskW;

describe('isObligation', () => {
  const choir = tk('choir', { template: true });
  const tasks = new Map([['choir', choir]]);
  it('is a standing obligation, and a copy of one', () => {
    expect(isObligation(choir, tasks)).toBe(true);
    expect(isObligation(tk('c1', { from: 'choir' }), tasks)).toBe(true);
  });
  it('is not an ordinary step, urgent or not, nor a copy of something that is not standing', () => {
    expect(isObligation(tk('a', { urgent: true, important: true } as Partial<TaskW>), tasks)).toBe(false);
    expect(isObligation(tk('b', { from: 'a' }), new Map([['a', tk('a')]]))).toBe(false);
    expect(isObligation(tk('c', { from: 'gone' }), tasks)).toBe(false);
  });
});
