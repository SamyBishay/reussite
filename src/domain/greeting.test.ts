import { describe, expect, it } from 'vitest';
import { agenda } from './agenda';
import { greeting, fixedNow, type GreetingInput } from './greeting';
import { choir, settings, state, task } from './agenda.fixture';

const S = settings();
const at = (iso: string) => Date.parse(iso);
// The choir's events around a day, as the app asks for them (the day before to the day after).
const events = (o: Parameters<typeof choir>[0] = {}) =>
  agenda(state({ tasks: [choir(o)] }), S, '2026-10-18', '2026-10-28').filter(e => e.kind === 'fixed');
const base = (o: Partial<GreetingInput> = {}): GreetingInput => ({ now: at('2026-10-19T12:00:00Z'), fixed: [], running: null, closed: false, planned: 2, next: 's1', tomorrow: null, ...o });

describe('the fixed-time item takes over within its lead time', () => {
  it('shows the choir from 18:30 on a Monday in summer time (the day before the clocks go back)', () => {
    const fixed = events();
    // 19:00 in Paris is 17:00 UTC until 25 October; the lead is 30 minutes.
    expect(greeting(base({ fixed, now: at('2026-10-19T16:29:59Z') })).kind).toBe('next');
    const g = greeting(base({ fixed, now: at('2026-10-19T16:30:00Z') }));
    expect(g).toMatchObject({ kind: 'fixed', leave: '18:30', event: { taskId: 'choir', time: '19:00', title: 'Choir, Hill House 602' } });
  });

  it('shows the choir from 18:30 on the first Monday after the clocks go back, an hour later in UTC', () => {
    const fixed = events();
    expect(greeting(base({ fixed, now: at('2026-10-26T17:29:00Z') })).kind).toBe('next');
    expect(greeting(base({ fixed, now: at('2026-10-26T17:30:00Z') })).kind).toBe('fixed');
    // The summer-time instant is no longer the choir's.
    expect(greeting(base({ fixed, now: at('2026-10-26T16:30:00Z') })).kind).toBe('next');
  });

  it('keeps the greeting until the item is over: its own length, else 30 minutes', () => {
    const fixed = events(); // dur 90: until 20:30 Paris = 18:30Z
    expect(greeting(base({ fixed, now: at('2026-10-19T18:29:00Z') })).kind).toBe('fixed');
    expect(greeting(base({ fixed, now: at('2026-10-19T18:30:00Z') })).kind).toBe('next');
    const short = events({ dur: null, est: null });
    expect(greeting(base({ fixed: short, now: at('2026-10-19T17:29:00Z') })).kind).toBe('fixed');
    expect(greeting(base({ fixed: short, now: at('2026-10-19T17:30:00Z') })).kind).toBe('next');
  });

  it('a lead of 0 means the time itself; a longer lead shows it sooner', () => {
    expect(fixedNow(events({ lead: 0 }), at('2026-10-19T16:59:00Z'))).toBeNull();
    expect(fixedNow(events({ lead: 0 }), at('2026-10-19T17:00:00Z'))).not.toBeNull();
    const g = greeting(base({ fixed: events({ lead: 60 }), now: at('2026-10-19T16:00:00Z') }));
    expect(g).toMatchObject({ kind: 'fixed', leave: '18:00' });
  });

  it('beats a running timer and a closed day; the earliest of two wins', () => {
    const fixed = events();
    const now = at('2026-10-19T16:45:00Z');
    expect(greeting(base({ fixed, now, running: 'r1' })).kind).toBe('fixed');
    expect(greeting(base({ fixed, now, closed: true })).kind).toBe('fixed');
    const two = agenda(state({ tasks: [choir(), task('dentist', { at: '19:15', lead: 30, due: '2026-10-19' })] }), S, '2026-10-19', '2026-10-19').filter(e => e.kind === 'fixed');
    expect(fixedNow(two, now)!.taskId).toBe('choir');
  });

  it('has nothing on other days, and nothing once the item is done', () => {
    expect(greeting(base({ fixed: events(), now: at('2026-10-20T16:45:00Z') })).kind).toBe('next'); // a Tuesday
    const done = agenda(state({ tasks: [choir(), task('copy', { from: 'choir', at: '19:00', due: '2026-10-19', status: 'done' })] }), S, '2026-10-19', '2026-10-19').filter(e => e.kind === 'fixed');
    expect(greeting(base({ fixed: done, now: at('2026-10-19T16:45:00Z') })).kind).toBe('next');
  });
});

describe('the rest of the greeting', () => {
  it('a running timer', () => {
    expect(greeting(base({ running: 'r1' }))).toEqual({ kind: 'running', id: 'r1' });
    expect(greeting(base({ running: 'r1', closed: true }))).toEqual({ kind: 'running', id: 'r1' });
  });
  it('the next step on the list', () => {
    expect(greeting(base())).toEqual({ kind: 'next', id: 's1' });
  });
  it('no list yet: Plan the day', () => {
    expect(greeting(base({ planned: 0, next: null }))).toEqual({ kind: 'plan' });
  });
  it('a closed day shows tomorrow’s first step, or says none is chosen', () => {
    expect(greeting(base({ closed: true, tomorrow: { id: 'z', title: 'Open the form' } }))).toEqual({ kind: 'tomorrow', step: { id: 'z', title: 'Open the form' } });
    expect(greeting(base({ closed: true }))).toEqual({ kind: 'tomorrow', step: null });
  });
  it('everything on the list is done', () => {
    expect(greeting(base({ next: null, planned: 3 }))).toEqual({ kind: 'allDone' });
  });
});
