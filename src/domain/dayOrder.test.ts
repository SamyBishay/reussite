import { describe, expect, it } from 'vitest';
import { dayOrder, dayLoad, marginOf, DEFAULT_EST, type DayOrderInput, type FixedItem } from './dayOrder';

const at = (hhmm: string) => Date.parse('2026-10-26T' + hhmm + ':00Z');
const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const ESTS: Record<string, number | null> = { s1: 20, s2: 45, s3: 120, s4: 30 };
// A call at 09:00 (leave at 08:45, 30 minutes long) and the dentist at 14:00 (leave at 13:30, an hour long).
const call: FixedItem = { id: 'call', at: at('09:00'), dur: 30, lead: 15 };
const dentist: FixedItem = { id: 'dentist', at: at('14:00'), dur: 60, lead: 30 };
const day = (now: string, o: Partial<DayOrderInput> = {}): DayOrderInput => ({
  now: at(now), floor: at('05:00'), end: at('19:00'), cards: ['s1', 's2', 's3', 's4'], est: id => ESTS[id] ?? null, fixed: [call, dentist], ...o,
});
/** The order as `id@start`, to read a whole day at a glance. */
const read = (i: DayOrderInput) => dayOrder(i).order.map(x => x.id + '@' + hm(x.start));

describe('dayOrder, a day with a call at 09:00 and the dentist at 14:00', () => {
  it('08:00: the first step fits before the call and is Start here', () => {
    const o = dayOrder(day('08:00'));
    // s1 (20 min) fits the 45 minutes before 08:45; the others wait for the gap after the call; the 2 h step does not fit before the dentist's 13:30 with the other two, so it comes after.
    expect(read(day('08:00'))).toEqual(['s1@08:00', 'call@08:45', 's2@09:30', 's3@10:15', 's4@12:15', 'dentist@13:30']);
    expect(o.order[0]).toMatchObject({ id: 's1', kind: 'step' });
    expect(o.missed).toEqual([]);
    expect(o.over).toBe(0);
  });

  it('08:50: the call is on, so it is Start here, and the steps start after it', () => {
    const o = dayOrder(day('08:50'));
    expect(o.order[0]).toMatchObject({ id: 'call', kind: 'fixed', start: at('08:45'), end: at('09:30'), at: at('09:00') });
    expect(o.order[1]).toMatchObject({ id: 's1', start: at('09:30') });
  });

  it('11:00: the call has passed and left the order; a shorter step moves up past the one that does not fit before 14:00', () => {
    const o = dayOrder(day('11:00'));
    expect(o.missed).toEqual(['call']);
    // 150 minutes until 13:30: s1 (20) and s2 (45) fit, s3 (120) no longer does, so s4 (30) moves up and s3 waits for the gap after the dentist.
    expect(read(day('11:00'))).toEqual(['s1@11:00', 's2@11:20', 's4@12:05', 'dentist@13:30', 's3@15:00']);
    expect(o.order[0]!.id).toBe('s1');
  });

  it('13:30: the dentist is Start here', () => {
    const o = dayOrder(day('13:30'));
    expect(o.order[0]).toMatchObject({ id: 'dentist', kind: 'fixed' });
    expect(o.order[1]).toMatchObject({ id: 's1', start: at('15:00') });
  });

  it('13:55 with a step running: the dentist still comes first, and the running step stays in the order', () => {
    const i = day('13:55', { running: { id: 's2', started: new Date(at('13:40')).toISOString() } });
    const o = dayOrder(i);
    expect(o.order[0]).toMatchObject({ id: 'dentist', kind: 'fixed' });
    expect(o.order.map(x => x.id)).toContain('s2');
    expect(o.order.find(x => x.id === 's2')).toMatchObject({ start: at('13:40'), end: at('14:25') });
    // The other steps start after the dentist.
    expect(o.order.find(x => x.id === 's1')!.start).toBe(at('15:00'));
  });

  it('15:00: the dentist is over and missed; the steps start now', () => {
    const o = dayOrder(day('15:00'));
    expect(o.missed).toEqual(['call', 'dentist']);
    expect(read(day('15:00'))).toEqual(['s1@15:00', 's2@15:20', 's3@16:05', 's4@18:05']);
    expect(o.over).toBe(0);
  });

  it('a card dragged above the call in the list still orders by time: fixed items are sorted whatever order they come in', () => {
    const a = dayOrder(day('06:00', { fixed: [dentist, call] }));
    const b = dayOrder(day('06:00', { fixed: [call, dentist] }));
    expect(a).toEqual(b);
    const ids = a.order.map(x => x.id);
    expect(ids.indexOf('call')).toBeLessThan(ids.indexOf('dentist'));
  });

  it('a step that has no estimate takes 15 minutes', () => {
    expect(DEFAULT_EST).toBe(15);
    const i = day('08:00', { cards: ['none', 's1'], est: id => ESTS[id] ?? null, fixed: [call] });
    // 'none' (15) fits before 08:45, then s1 (20) fits in the 30 that are left.
    expect(read(i)).toEqual(['none@08:00', 's1@08:15', 'call@08:45']);
  });
});

describe('the takeover', () => {
  const one = (now: string, o: Partial<DayOrderInput> = {}) => dayOrder(day(now, { cards: ['s1'], fixed: [dentist], ...o })).order[0]!;

  it('margin: 20% of the step, at least 5 minutes', () => {
    expect(marginOf(10)).toBe(5);
    expect(marginOf(25)).toBe(5);
    expect(marginOf(60)).toBe(12);
  });

  it('with nothing running, the first step estimate stands in: 20 + 5 minutes of margin before 13:30', () => {
    expect(one('13:04').id).toBe('s1');
    expect(one('13:05').id).toBe('s1'); // 13:05 + 20 + 5 = 13:30, not past it
    expect(one('13:06').id).toBe('dentist');
  });

  it('a running step counts what is left of it, from its timestamp', () => {
    const run = (started: string) => ({ id: 's2', started: new Date(at(started)).toISOString() });
    const first = (now: string, started: string) => dayOrder(day(now, { cards: ['s2'], fixed: [dentist], running: run(started) })).order[0]!.id;
    // s2 is 45 minutes with a margin of 9. Started at 12:30, at 12:45 it has 30 left: 12:45 + 30 + 9 is 13:24.
    expect(first('12:45', '12:30')).toBe('s2');
    // At 13:10 it has 5 left: 13:24 again.
    expect(first('13:10', '12:30')).toBe('s2');
    // Started at 13:00, at 13:05 it has 40 left: 13:54 is past the time to leave.
    expect(first('13:05', '13:00')).toBe('dentist');
  });

  it('a step that overran its estimate has nothing left, and still gives way once the margin reaches the time to leave', () => {
    const run = { id: 's1', started: new Date(at('12:00')).toISOString() }; // 20 minutes, long over
    expect(dayOrder(day('13:24', { cards: ['s1'], fixed: [dentist], running: run })).order[0]!.id).toBe('s1'); // 13:24 + 0 + 5 < 13:30
    expect(dayOrder(day('13:26', { cards: ['s1'], fixed: [dentist], running: run })).order[0]!.id).toBe('dentist');
  });

  it('with a fixed item and no steps at all, the fixed item is Start here, however far', () => {
    expect(dayOrder(day('08:00', { cards: [], fixed: [dentist] })).order[0]!.id).toBe('dentist');
  });

  it('only the next fixed item can take over', () => {
    // s4 is 30 minutes with a margin of 6: at 08:00 it fits before the call; at 08:10, 08:10 + 36 is past 08:45.
    expect(dayOrder(day('08:00', { cards: ['s4'], fixed: [call, dentist] })).order.map(x => x.id)).toEqual(['s4', 'call', 'dentist']);
    expect(dayOrder(day('08:10', { cards: ['s4'], fixed: [call, dentist] })).order.map(x => x.id)).toEqual(['call', 's4', 'dentist']);
  });

  it('a fixed item being timed holds the order and is never missed', () => {
    const i = day('15:30', { cards: ['s1'], fixed: [dentist], running: { id: 'dentist', started: new Date(at('14:05')).toISOString() } });
    const o = dayOrder(i);
    expect(o.missed).toEqual([]);
    expect(o.order[0]).toMatchObject({ id: 'dentist', kind: 'fixed' });
    expect(o.order[1]).toMatchObject({ id: 's1', start: at('15:30') });
  });
});

describe('missed and over', () => {
  it('a fixed item is missed when its end has passed: at + dur, 30 minutes without one', () => {
    const plain: FixedItem = { id: 'x', at: at('10:00'), lead: 0 };
    expect(dayOrder(day('10:29', { cards: [], fixed: [plain] })).missed).toEqual([]);
    expect(dayOrder(day('10:30', { cards: [], fixed: [plain] })).missed).toEqual(['x']);
    expect(dayOrder(day('10:30', { cards: [], fixed: [plain] })).order).toEqual([]);
  });

  it('a standing item that was never placed on the day is not missed once it is over', () => {
    const choir: FixedItem = { id: 'choir', at: at('19:00'), lead: 30, standing: true };
    expect(dayOrder(day('18:30', { cards: [], fixed: [choir] })).order[0]).toMatchObject({ id: 'choir', start: at('18:30') });
    const over = dayOrder(day('19:30', { cards: [], fixed: [choir] }));
    expect(over.missed).toEqual([]);
    expect(over.order).toEqual([]);
  });

  it('a standing item alone is not Start here until it is time to leave', () => {
    const choir: FixedItem = { id: 'choir', at: at('19:00'), lead: 30, standing: true };
    expect(dayOrder(day('08:00', { cards: [], fixed: [choir] })).order).toEqual([]);
    expect(dayOrder(day('18:24', { cards: [], fixed: [choir] })).order).toEqual([]);
    expect(dayOrder(day('18:25', { cards: [], fixed: [choir] })).order[0]).toMatchObject({ id: 'choir' });
    // With a step to do it is in the order from the start, so it can take over from the step.
    expect(read(day('08:00', { cards: ['s1'], fixed: [choir] }))).toEqual(['s1@08:00', 'choir@18:30']);
    // A card placed on the day is Start here however far, as a step with a time always was.
    expect(dayOrder(day('08:00', { cards: [], fixed: [{ ...choir, standing: false }] })).order[0]).toMatchObject({ id: 'choir' });
  });

  it('over: planned minutes that do not fit before the end of the day', () => {
    // From 17:00, 120 + 45 minutes of steps against two hours: the last 45 are past 19:00.
    const o = dayOrder(day('17:00', { cards: ['s3', 's2'], fixed: [] }));
    expect(o.over).toBe(45);
    // A step that starts before the end and finishes after it counts only the part past it.
    expect(dayOrder(day('18:30', { cards: ['s1', 's2'], fixed: [] })).over).toBe(35);
    expect(dayOrder(day('08:00', { fixed: [] })).over).toBe(0);
  });

  it('optional cards come after the others and never count as over', () => {
    const o = dayOrder(day('18:00', { cards: ['s4', 's1', 's2'], fixed: [], optional: new Set(['s4']) }));
    expect(o.order.map(x => x.id)).toEqual(['s1', 's2', 's4']);
    // s1 runs 18:00-18:20 and s2 18:20-19:05, so 5 minutes are over; s4 comes after at 19:05 and does not count.
    expect(o.over).toBe(5);
    expect(dayOrder(day('18:40', { cards: ['s1', 's4'], fixed: [], optional: new Set(['s4']) })).over).toBe(0);
  });

  it('nothing is placed before the start of the day', () => {
    const o = dayOrder(day('04:00', { cards: ['s1'], fixed: [] }));
    expect(o.order[0]!.start).toBe(at('05:00'));
  });
});

describe('dayLoad, the planned minutes against the free time', () => {
  it('free is the window minus the fixed-time items (from the time to leave), planned the steps that are not optional', () => {
    // 08:00 to 19:00 is 11 h; the call takes 08:45-09:30 (45 min) and the dentist 13:30-15:00 (90 min).
    const l = dayLoad(day('08:00'));
    expect(l).toEqual({ planned: 215, free: 660 - 45 - 90, over: 0 });
    expect(dayLoad(day('08:00', { optional: new Set(['s3']) })).planned).toBe(95);
  });

  it('counts the part of a fixed item inside the window, and overlapping items once', () => {
    const late: FixedItem = { id: 'late', at: at('18:30'), dur: 60, lead: 0 };
    expect(dayLoad(day('17:00', { fixed: [late], cards: [] })).free).toBe(90);
    const a: FixedItem = { id: 'a', at: at('10:00'), dur: 60, lead: 0 }, b: FixedItem = { id: 'b', at: at('10:30'), dur: 60, lead: 0 };
    expect(dayLoad(day('09:00', { fixed: [a, b], cards: [], end: at('12:00') })).free).toBe(180 - 90);
  });

  it('is over when the steps do not fit before the end, and a step with no estimate takes the default', () => {
    expect(dayLoad(day('17:00', { cards: ['s3', 's2'], fixed: [] }))).toEqual({ planned: 165, free: 120, over: 45 });
    expect(dayLoad(day('08:00', { cards: ['x'], fixed: [] })).planned).toBe(DEFAULT_EST);
  });

  it('starts from the chosen start when it is later than now', () => {
    expect(dayLoad(day('08:00', { floor: at('14:00'), fixed: [], cards: [] })).free).toBe(300);
  });
});
