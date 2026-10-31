import { describe, it, expect } from 'vitest';
import { dayCards, inPlace, isEvent, isObligation, isOpen, ownerDay, planOf, releaseFrom, splitDone, yesterdayOpen, type TaskW } from './lists';

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

describe('dayCards', () => {
  const k = '2026-10-24';
  const step = (id: string, o: Partial<TaskW> = {}) => tk(id, { status: 'open', ...o } as Partial<TaskW>);
  const data = (plan: string[], ts: TaskW[]) => ({ days: new Map([[k, { plan } as never]]), tasks: new Map(ts.map(x => [x.id, x])) });
  it('is the list, with the day’s fixed-time items that are not on it slotted in by time', () => {
    const d = data(['a', 'nine', 'b', 'noon'], [step('a'), step('nine', { at: '09:00' }), step('b'), step('noon', { at: '12:00' }), step('choir', { at: '10:30', due: k }), step('late', { at: '19:00', due: k })]);
    expect(dayCards(d, k)).toEqual(['a', 'nine', 'b', 'choir', 'noon', 'late']);
  });
  it('never repeats a card, and leaves out other days’, dropped and standing items', () => {
    const d = data(['choir'], [step('choir', { at: '10:30', due: k }), step('x', { at: '08:00', due: '2026-10-25' }), step('y', { at: '08:00', due: k, status: 'dropped' }), step('z', { at: '08:00', due: k, template: true })]);
    expect(dayCards(d, k)).toEqual(['choir']);
  });
});

describe('one list per card', () => {
  const y = '2026-10-23', k = '2026-10-24', n = '2026-10-25';
  const step = (id: string, o: Partial<TaskW> = {}) => tk(id, { status: 'open', ...o } as Partial<TaskW>);
  const data = (plans: Record<string, string[]>, ts: TaskW[]) => ({ days: new Map(Object.entries(plans).map(([d, plan]) => [d, { plan } as never])), tasks: new Map(ts.map(x => [x.id, x])) });
  it('a card on two lists shows on the latest only', () => {
    const d = data({ [y]: ['a', 'b'], [k]: ['a'] }, [step('a'), step('b')]);
    expect(ownerDay(d, 'a')).toBe(k);
    expect(planOf(d, y)).toEqual(['b']);
    expect(planOf(d, k)).toEqual(['a']);
    expect(ownerDay(d, 'zz')).toBeUndefined();
  });
  it('a done card belongs to the day it was done on, when that list holds it', () => {
    const done = (doneDay: string) => step('a', { status: 'done', doneDay } as Partial<TaskW>);
    expect(planOf(data({ [y]: ['a'], [k]: ['a'] }, [done(k)]), y)).toEqual([]);
    expect(planOf(data({ [y]: ['a'], [k]: ['a'] }, [done(k)]), k)).toEqual(['a']);
    expect(planOf(data({ [y]: ['a'], [k]: ['a'] }, [done(y)]), y)).toEqual(['a']);
    expect(planOf(data({ [y]: ['a'], [k]: ['a'] }, [done(y)]), k)).toEqual([]);
    // Done on a day whose list does not hold it: the latest list that does.
    expect(planOf(data({ [y]: ['a'], [k]: ['a'] }, [done(n)]), k)).toEqual(['a']);
  });
  it('yesterday does not offer a card that a later list holds', () => {
    const d = data({ [y]: ['a', 'b'], [n]: ['a'] }, [step('a'), step('b')]);
    expect(yesterdayOpen(d, k, y)).toEqual(['b']);
  });
  it('releaseFrom: the other lists holding the cards, without them', () => {
    const days: [string, { plan: string[] }][] = [[y, { plan: ['a', 'b'] }], [k, { plan: ['a'] }], [n, { plan: ['c'] }]];
    expect(releaseFrom(days, k, ['a'])).toEqual([[y, ['b']]]);
    expect(releaseFrom(days, k, [])).toEqual([]);
  });
});

describe('events (schema 6)', () => {
  it('are not open work, whatever their status', () => {
    expect(isOpen({ status: 'open', template: false, kind: 'event' })).toBe(false);
    expect(isOpen({ status: 'open', template: false, kind: 'task' })).toBe(true);
    expect(isOpen({ status: 'open', template: false })).toBe(true); // a step written before kinds were optional reads as a task
    expect(isEvent({ kind: 'event' })).toBe(true);
    expect(isEvent({ kind: 'decision' })).toBe(false);
  });
});

describe('splitDone', () => {
  it('keeps the open cards in their order and sets the done ones apart, also in their order', () => {
    const done = new Set(['b', 'd']);
    expect(splitDone(['a', 'b', 'c', 'd', 'e'], id => done.has(id))).toEqual({ open: ['a', 'c', 'e'], done: ['b', 'd'] });
    expect(splitDone([], () => false)).toEqual({ open: [], done: [] });
    expect(splitDone(['a'], () => true)).toEqual({ open: [], done: ['a'] });
  });
});
