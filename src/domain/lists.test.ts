import { describe, it, expect } from 'vitest';
import { inPlace, isObligation, type TaskW } from './lists';

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

describe('inPlace', () => {
  const places = new Map<string, { parentId?: string | null }>([['cairo', {}], ['heli', { parentId: 'cairo' }], ['paris', {}]]);
  const projects = new Map([['p', { where: 'heli' }]]);
  it('without places: its own steps and Anywhere, as before', () => {
    expect(inPlace(tk('a', { where: 'cairo', project: 'x' }), 'cairo', projects)).toBe(true);
    expect(inPlace(tk('a', { where: 'heli', project: 'x' }), 'cairo', projects)).toBe(false);
    expect(inPlace(tk('a', { project: 'x' }), 'paris', projects)).toBe(true);
  });
  it('with places: an area is on its parent place’s page and the parent’s steps are on the area’s', () => {
    expect(inPlace(tk('a', { where: 'heli', project: 'x' }), 'cairo', projects, places)).toBe(true);
    expect(inPlace(tk('a', { where: 'cairo', project: 'x' }), 'heli', projects, places)).toBe(true);
    expect(inPlace(tk('a', { where: 'heli', project: 'x' }), 'paris', projects, places)).toBe(false);
    expect(inPlace(tk('a', { project: 'p' }), 'cairo', projects, places)).toBe(true); // through the project's place
    expect(inPlace(tk('a', { project: 'x' }), 'paris', projects, places)).toBe(true);
  });
});
