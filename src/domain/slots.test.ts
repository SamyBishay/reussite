import { describe, expect, it } from 'vitest';
import { timeCounts, eventMissed, dueState, slotState, readSlot, writeSlot, slotsFor, slotEnd, MAX_SLOT_LOG } from './slots';
import type { DayOrder } from './dayOrder';
import { wallToInstant } from './zone';

const Z = 'Europe/Paris';
const T = (hhmm: string) => wallToInstant('2026-11-10', hhmm, Z);

describe('dueState: a deadline never turns red or leaves', () => {
  it('a later day is ahead, an earlier one carried over', () => {
    expect(dueState('2026-11-12', null, '2026-11-10', '09:00')).toBe('ahead');
    expect(dueState('2026-11-09', '17:00', '2026-11-10', '09:00')).toBe('carried');
  });
  it('today: no time, or a time still to come, is today; once the time is gone it is passed', () => {
    expect(dueState('2026-11-10', null, '2026-11-10', '23:00')).toBe('today');
    expect(dueState('2026-11-10', '17:00', '2026-11-10', '16:59')).toBe('today');
    expect(dueState('2026-11-10', '17:00', '2026-11-10', '17:00')).toBe('passed');
    expect(dueState('2026-11-10', '17:00', '2026-11-10', '21:30')).toBe('passed');
  });
  it('a time before the day starts is late in that day', () => {
    expect(dueState('2026-11-10', '01:00', '2026-11-10', '23:00', '05:00')).toBe('today'); // 01:00 is still to come that night
    expect(dueState('2026-11-10', '01:00', '2026-11-10', '09:00', '05:00')).toBe('today');
    expect(dueState('2026-11-10', '01:00', '2026-11-10', '02:00', '05:00')).toBe('passed');
  });
});

describe('slotState', () => {
  const s = { day: '2026-11-10', at: '14:00', dur: 45 };
  it('is ahead, now, then passed', () => {
    expect(slotState(s, '2026-11-10', '13:59')).toBe('ahead');
    expect(slotState(s, '2026-11-10', '14:00')).toBe('now');
    expect(slotState(s, '2026-11-10', '14:44')).toBe('now');
    expect(slotState(s, '2026-11-10', '14:45')).toBe('passed');
  });
  it('another day: earlier is passed, later is ahead', () => {
    expect(slotState(s, '2026-11-11', '08:00')).toBe('passed');
    expect(slotState(s, '2026-11-09', '23:00')).toBe('ahead');
  });
});

describe('readSlot and slotEnd', () => {
  it('reads a good slot, pads the hour, floors the length, refuses the rest', () => {
    expect(readSlot({ day: '2026-11-10', at: '9:30', dur: 2 })).toEqual({ day: '2026-11-10', at: '09:30', dur: 5 });
    for (const bad of [null, 'x', {}, { day: '10 Nov', at: '09:00', dur: 30 }, { day: '2026-11-10', at: '9h', dur: 30 }, { day: '2026-11-10', at: '09:00', dur: '30' }]) expect(readSlot(bad)).toBeNull();
  });
  it('ends within the day', () => { expect(slotEnd({ day: 'd', at: '23:30', dur: 90 })).toBe('23:59'); expect(slotEnd({ day: 'd', at: '14:00', dur: 45 })).toBe('14:45'); });
});

describe('writeSlot: one slot, and a log that keeps the past', () => {
  const a = { day: '2026-11-10', at: '14:00', dur: 45 }, b = { day: '2026-11-10', at: '16:00', dur: 45 };
  const now = '2026-11-10T08:00:00.000Z';
  it('the first write has no from; the next keeps the old one in the log', () => {
    const w1 = writeSlot({}, a, 'me', 'planned', now);
    expect(w1).toEqual({ slot: a, slotLog: [{ from: null, to: a, at: now, by: 'me', why: 'planned' }] });
    const w2 = writeSlot(w1 as { slot: typeof a; slotLog: never[] }, b, 'me', 'reslotted', '2026-11-10T15:00:00.000Z');
    expect(w2).toMatchObject({ slot: b });
    expect((w2 as { slotLog: unknown[] }).slotLog).toHaveLength(2);
    expect((w2 as { slotLog: unknown[] }).slotLog[1]).toEqual({ from: a, to: b, at: '2026-11-10T15:00:00.000Z', by: 'me', why: 'reslotted' });
  });
  it('writing the same slot changes nothing; taking it off is logged as cleared', () => {
    expect(writeSlot({ slot: a }, { ...a }, 'ai', 'set', now)).toEqual({});
    expect(writeSlot({ slot: a }, null, 'me', 'set', now)).toMatchObject({ slot: null, slotLog: [{ from: a, to: null, why: 'cleared' }] });
    expect(writeSlot({}, null, 'me', 'set', now)).toEqual({});
  });
  it('keeps the last twenty', () => {
    let cur: { slot?: unknown; slotLog?: unknown[] } = {};
    for (let i = 0; i < 30; i++) cur = { ...cur, ...(writeSlot(cur as never, { day: '2026-11-10', at: `${String(8 + (i % 10)).padStart(2, '0')}:${i < 10 ? '00' : '30'}`, dur: 10 + i }, 'me', 'moved', now)) };
    expect(cur.slotLog).toHaveLength(MAX_SLOT_LOG);
    expect((cur.slotLog![19] as { to: { dur: number } }).to.dur).toBe(39);
  });
});

describe('slotsFor: Plan my day writes slots from the accepted order, never a time on the step', () => {
  const order: DayOrder = {
    order: [
      { id: 'a', kind: 'step', start: T('09:00'), end: T('09:30') },
      { id: 'call', kind: 'fixed', start: T('10:00'), end: T('10:30'), at: T('10:30') },
      { id: 'b', kind: 'step', start: T('10:30'), end: T('11:15') },
      { id: 'late', kind: 'step', start: T('19:30'), end: T('20:00') },
    ], missed: [], over: 30,
  };
  it('one slot per step with the order\'s time and length; fixed items and steps after the end get none', () => {
    const m = slotsFor(order, '2026-11-10', T('19:00'), Z);
    expect([...m]).toEqual([['a', { day: '2026-11-10', at: '09:00', dur: 30 }], ['b', { day: '2026-11-10', at: '10:30', dur: 45 }]]);
  });
  it('a step that runs past the end is cut at it', () => {
    const m = slotsFor(order, '2026-11-10', T('19:45'), Z);
    expect(m.get('late')).toEqual({ day: '2026-11-10', at: '19:30', dur: 15 });
  });
});

describe('eventMissed: an appointment that passed stays, marked', () => {
  it('today: missed once at + length has gone (30 minutes without a length)', () => {
    expect(eventMissed('2026-11-10', '10:00', 60, '2026-11-10', '10:59')).toBe(false);
    expect(eventMissed('2026-11-10', '10:00', 60, '2026-11-10', '11:00')).toBe(true);
    expect(eventMissed('2026-11-10', '10:00', null, '2026-11-10', '10:30')).toBe(true);
  });
  it('an earlier day is missed, a later one is not, no day or a bad time is not', () => {
    expect(eventMissed('2026-11-09', '23:00', 30, '2026-11-10', '08:00')).toBe(true);
    expect(eventMissed('2026-11-11', '08:00', 30, '2026-11-10', '23:00')).toBe(false);
    expect(eventMissed(null, '10:00', 30, '2026-11-10', '23:00')).toBe(false);
    expect(eventMissed('2026-11-10', 'x', 30, '2026-11-10', '23:00')).toBe(false);
  });
});

describe('timeCounts: what exists, counts only', () => {
  it('counts each field on one-off steps, standing apart, deleted ignored, and the at an AI made', () => {
    const c = timeCounts([
      { due: '2026-11-10' }, { due: '2026-11-11', dueAt: '17:00' }, { at: '10:00', src: 'ai' }, { at: '11:00', src: 'page' }, { at: '12:00', fixed: true, src: 'ai' },
      { at: '13:00', by: 'ai' }, { slot: { day: '2026-11-10', at: '14:00', dur: 30 } }, { slot: 'junk' }, { template: true, at: '19:00' }, { _del: 'h', at: '09:00', src: 'ai' },
    ]);
    expect(c).toEqual({ steps: 8, due: 2, dueAt: 1, at: 4, fixed: 1, standing: 1, slot: 1, atFromAi: 2 });
  });
});
