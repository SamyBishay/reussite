import { describe, expect, it } from 'vitest';
import { nextDue, occurrences, isoDow, type Repeat } from './repeat';

const r = (o: Partial<Repeat>): Repeat => ({ every: 1, unit: 'day', from: 'due', ...o });

describe('repeating steps', () => {
  it('knows the weekday', () => {
    expect(isoDow('2026-10-05')).toBe(1); // Monday
    expect(isoDow('2026-10-11')).toBe(7); // Sunday
  });

  it('repeats every n days, from the due date or from completion', () => {
    expect(nextDue(r({ every: 10 }), '2026-10-01', '2026-10-01')).toBe('2026-10-11');
    expect(nextDue(r({ every: 10, from: 'done' }), '2026-10-01', '2026-10-04')).toBe('2026-10-14');
    // From the due date, with no due date: counts from completion.
    expect(nextDue(r({ every: 2 }), null, '2026-10-04')).toBe('2026-10-06');
  });

  it('repeats monthly on a date, clamped to short months', () => {
    expect(nextDue(r({ unit: 'month', monthDay: 5 }), '2026-10-05', '2026-10-03')).toBe('2026-11-05');
    expect(nextDue(r({ unit: 'month', monthDay: 31 }), '2026-01-31', '2026-01-31')).toBe('2026-02-28');
    expect(nextDue(r({ unit: 'month', monthDay: 31 }), '2026-02-28', '2026-02-28')).toBe('2026-03-31');
    expect(nextDue(r({ unit: 'month', every: 3 }), '2026-11-15', '2026-11-15')).toBe('2027-02-15');
  });

  it('repeats weekly on chosen weekdays, every n weeks', () => {
    // Mon and Thu; done on Monday 5 Oct → Thursday 8 Oct.
    expect(nextDue(r({ unit: 'week', weekdays: [1, 4] }), '2026-10-05', '2026-10-05')).toBe('2026-10-08');
    expect(nextDue(r({ unit: 'week', weekdays: [1, 4] }), '2026-10-08', '2026-10-08')).toBe('2026-10-12');
    // Every 2 weeks on Monday.
    expect(nextDue(r({ unit: 'week', every: 2, weekdays: [1] }), '2026-10-05', '2026-10-05')).toBe('2026-10-19');
    // No weekdays: a plain 7-day step.
    expect(nextDue(r({ unit: 'week' }), '2026-10-07', '2026-10-07')).toBe('2026-10-14');
  });

  it('a late step comes back once, on the first date after it was done', () => {
    expect(nextDue(r({ unit: 'month', monthDay: 5 }), '2026-10-05', '2026-11-10')).toBe('2026-12-05');
    expect(nextDue(r({}), '2026-10-01', '2026-10-09')).toBe('2026-10-10');
  });

  it('stops after its end date', () => {
    expect(nextDue(r({ every: 7, until: '2026-10-10' }), '2026-10-01', '2026-10-01')).toBe('2026-10-08');
    expect(nextDue(r({ every: 7, until: '2026-10-10' }), '2026-10-08', '2026-10-08')).toBeNull();
  });

  it('lists later dates for the calendar', () => {
    expect(occurrences(r({ unit: 'week', weekdays: [3] }), '2026-10-07', '2026-10-31')).toEqual(['2026-10-14', '2026-10-21', '2026-10-28']);
  });
});
