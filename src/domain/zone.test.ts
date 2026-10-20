import { describe, expect, it } from 'vitest';
import { atOnDay, offsetAt, placeOfDay, validZone, wallOf, wallToInstant } from './zone';

const z = (ms: number) => new Date(ms).toISOString();
const PARIS = 'Europe/Paris', CAIRO = 'Africa/Cairo';

describe('wall time to an instant', () => {
  it('uses the zone offset of that day: summer and winter time in Paris', () => {
    expect(z(wallToInstant('2026-10-19', '19:00', PARIS))).toBe('2026-10-19T17:00:00.000Z');
    expect(z(wallToInstant('2026-10-26', '19:00', PARIS))).toBe('2026-10-26T18:00:00.000Z');
    expect(z(wallToInstant('2026-01-12', '07:05', PARIS))).toBe('2026-01-12T06:05:00.000Z');
  });

  it('crosses the end of daylight-saving time on 25 October 2026', () => {
    // Clocks go back at 03:00 CEST: 02:30 happens twice, and the first one is meant.
    expect(z(wallToInstant('2026-10-25', '01:59', PARIS))).toBe('2026-10-24T23:59:00.000Z');
    expect(z(wallToInstant('2026-10-25', '02:30', PARIS))).toBe('2026-10-25T00:30:00.000Z');
    expect(z(wallToInstant('2026-10-25', '03:00', PARIS))).toBe('2026-10-25T02:00:00.000Z');
    expect(z(wallToInstant('2026-10-25', '19:00', PARIS))).toBe('2026-10-25T18:00:00.000Z');
    // The same wall time, a day apart, is 25 hours apart.
    expect(wallToInstant('2026-10-26', '19:00', PARIS) - wallToInstant('2026-10-25', '19:00', PARIS)).toBe(24 * 3600_000);
    expect(wallToInstant('2026-10-25', '19:00', PARIS) - wallToInstant('2026-10-24', '19:00', PARIS)).toBe(25 * 3600_000);
  });

  it('puts a time that does not exist (clocks going forward) after the gap', () => {
    expect(z(wallToInstant('2026-03-29', '02:30', PARIS))).toBe('2026-03-29T01:30:00.000Z'); // 03:30 CEST
    expect(wallOf(wallToInstant('2026-03-29', '02:30', PARIS), PARIS)).toBe('03:30');
  });

  it('knows Cairo, which has daylight-saving time until 29 October 2026', () => {
    expect(z(wallToInstant('2026-10-20', '19:00', CAIRO))).toBe('2026-10-20T16:00:00.000Z');
    expect(z(wallToInstant('2026-11-02', '19:00', CAIRO))).toBe('2026-11-02T17:00:00.000Z');
    expect(z(wallToInstant('2026-01-15', '09:00', CAIRO))).toBe('2026-01-15T07:00:00.000Z');
    expect(offsetAt(Date.parse('2026-07-01T00:00:00Z'), CAIRO)).toBe(3 * 3600_000);
  });

  it('reads an instant back as the same clock time', () => {
    for (const [d, tz] of [['2026-10-19', PARIS], ['2026-10-25', PARIS], ['2026-10-30', CAIRO], ['2026-03-29', 'America/New_York']] as const) {
      expect(wallOf(wallToInstant(d, '18:45', tz), tz)).toBe('18:45');
    }
  });
});

describe('a day and its start', () => {
  it('a time before the day-start rule is in the small hours of the next calendar date', () => {
    expect(z(atOnDay('2026-10-19', '04:59', '05:00', PARIS))).toBe('2026-10-20T02:59:00.000Z'); // 04:59 CEST on the 20th
    expect(z(atOnDay('2026-10-19', '05:00', '05:00', PARIS))).toBe('2026-10-19T03:00:00.000Z');
    expect(z(atOnDay('2026-10-19', '01:30', '05:00', PARIS))).toBe('2026-10-19T23:30:00.000Z');
    // Over the end of daylight-saving time: the day of 24 Oct has 02:30 on the 25th, the first one.
    expect(z(atOnDay('2026-10-24', '02:30', '05:00', PARIS))).toBe('2026-10-25T00:30:00.000Z');
    // A day that starts at midnight has no small hours.
    expect(z(atOnDay('2026-10-19', '00:30', '00:00', PARIS))).toBe('2026-10-18T22:30:00.000Z');
  });
});

describe('which place a day belongs to', () => {
  const zoneOf = (id: string) => ({ paris: PARIS, cairo: CAIRO })[id];
  const stays = [{ id: 's1', placeId: 'cairo', from: '2026-10-21', to: '2026-10-24' }];
  it('is the stay covering it, else the place chosen by hand, and the zone follows', () => {
    expect(placeOfDay('2026-10-20', stays, 'paris', zoneOf)).toEqual({ placeId: 'paris', timeZone: PARIS });
    expect(placeOfDay('2026-10-21', stays, 'paris', zoneOf)).toEqual({ placeId: 'cairo', timeZone: CAIRO });
    expect(placeOfDay('2026-10-24', stays, 'paris', zoneOf)).toEqual({ placeId: 'cairo', timeZone: CAIRO });
    expect(placeOfDay('2026-10-25', stays, 'paris', zoneOf).timeZone).toBe(PARIS);
    // So the same wall time lands on different instants as the stay switches the zone.
    const at = (k: string) => wallToInstant(k, '19:00', placeOfDay(k, stays, 'paris', zoneOf).timeZone);
    expect(z(at('2026-10-20'))).toBe('2026-10-20T17:00:00.000Z');
    expect(z(at('2026-10-21'))).toBe('2026-10-21T16:00:00.000Z');
  });
  it('falls back to the device zone for a zone the platform does not know', () => {
    expect(validZone('Mars/Olympus')).toBeUndefined();
    expect(validZone('')).toBeUndefined();
    expect(validZone(PARIS)).toBe(PARIS);
    expect(placeOfDay('2026-10-20', [], 'x', () => 'Mars/Olympus').timeZone).toBeUndefined();
  });
});
