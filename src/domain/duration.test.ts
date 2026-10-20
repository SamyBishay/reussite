import { describe, expect, it } from 'vitest';
import { parseMinutes } from './duration';

describe('parseMinutes', () => {
  it('reads a length', () => {
    for (const [s, m] of [['20', 20], ['20 min', 20], ['20min', 20], ['45 minutes', 45], ['1h', 60], ['1 h 30', 90], ['1h30', 90], ['2 hours', 120], ['2h 15 min', 135],
      ['1 hour and 5 minutes', 65], ['une heure', 60], ['1 heure 30', 90], ['half an hour', 30], ['une demi-heure', 30], ['25.', 25], ['  15  ', 15]] as const) expect(parseMinutes(s), s).toBe(m);
  });
  it('leaves anything else alone', () => {
    for (const s of ['', 'call the bank', 'done dentist', '0', '2000', '3pm', '19:00', 'at 7', 'it took forever', '20 euros']) expect(parseMinutes(s), s).toBeNull();
  });
});
