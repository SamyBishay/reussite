import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { fr } from '../i18n/fr';
import { translate } from '../i18n/core';
import { GREETING_KEYS, eligibleLines, greeting, greetingLine, partOfDay, pickGreeting, seedOf, type GreetingInput, type LineInput } from './greeting';

const base = (o: Partial<GreetingInput> = {}): GreetingInput => ({ closed: false, planned: 2, running: false, hasFirst: true, ...o });

describe('the card under the greeting', () => {
  it('shows nothing while a step runs, or while a plan is open with something left to start', () => {
    expect(greeting(base({ running: true }))).toBeNull();
    expect(greeting(base({ running: true, planned: 0, hasFirst: false }))).toBeNull();
    expect(greeting(base())).toBeNull();
  });
  it('no list shows Plan the day, even when a fixed-time item is first; a list with nothing left shows all done', () => {
    expect(greeting(base({ planned: 0, hasFirst: false }))).toEqual({ kind: 'plan' });
    expect(greeting(base({ planned: 0, hasFirst: true }))).toEqual({ kind: 'plan' });
    expect(greeting(base({ hasFirst: false, planned: 3 }))).toEqual({ kind: 'allDone' });
  });
  it('a closed day shows nothing: tomorrow and Start here are not Home’s', () => {
    expect(greeting(base({ closed: true }))).toBeNull();
    expect(greeting(base({ closed: true, planned: 0, hasFirst: false }))).toBeNull();
    expect(greeting(base({ closed: true, hasFirst: false }))).toBeNull();
  });
});

const line = (o: Partial<LineInput> = {}): LineInput => ({ clock: '10:00', dayStart: '05:00', ...o });
const kinds = (i: LineInput) => eligibleLines(i).map(l => l.key.replace(/\d+$/, '').replace('greet', '').toLowerCase());
const unique = (xs: string[]) => [...new Set(xs)];

describe('the line: which greetings are eligible', () => {
  it('the ones for any time, and the hour’s own', () => {
    expect(unique(kinds(line()))).toEqual(['any', 'morning']);
    expect(unique(kinds(line({ clock: '15:00' })))).toEqual(['any', 'afternoon']);
    expect(unique(kinds(line({ clock: '19:00' })))).toEqual(['any', 'evening']);
    expect(unique(kinds(line({ clock: '23:30' })))).toEqual(['any', 'night']);
  });
  it('the part of the day follows the clock and the day-start rule', () => {
    expect(partOfDay('05:00', '05:00')).toBe('morning');
    expect(partOfDay('11:59', '05:00')).toBe('morning');
    expect(partOfDay('12:00', '05:00')).toBe('afternoon');
    expect(partOfDay('17:59', '05:00')).toBe('afternoon');
    expect(partOfDay('18:00', '05:00')).toBe('evening');
    expect(partOfDay('21:59', '05:00')).toBe('evening');
    expect(partOfDay('22:00', '05:00')).toBe('night');
    expect(partOfDay('02:30', '05:00')).toBe('night');
  });
  it('a greeting has no slots: it says nothing about the day', () => {
    for (const l of eligibleLines(line())) expect(l.slots).toEqual({});
    expect(translate('en', 'greetAny3')).toBe('Wazzaaap.');
  });
});

describe('the line: no repeat within a day', () => {
  const all = [...GREETING_KEYS.any, ...GREETING_KEYS.morning];
  it('returns nothing without a candidate', () => {
    expect(pickGreeting([], [], 1)).toBeNull();
  });
  it('picks the first unshown template in the seeded order, and the same one for the same seed', () => {
    const a = pickGreeting(all, [], 7);
    expect(a).not.toBeNull();
    expect(pickGreeting(all, [], 7)).toBe(a);
  });
  it('never repeats until every eligible template was shown', () => {
    for (const seed of [0, 1, 42, seedOf('2026-10-31')]) {
      const shown: string[] = [];
      for (let n = 0; n < all.length; n++) shown.push(pickGreeting(all, shown, seed)!);
      expect(new Set(shown).size).toBe(all.length);
    }
  });
  it('starts over when all were shown, with the one shown longest ago', () => {
    const shown: string[] = [];
    for (let n = 0; n < all.length; n++) shown.push(pickGreeting(all, shown, 3)!);
    expect(pickGreeting(all, shown, 3)).toBe(shown[0]);
    expect(pickGreeting(all, [...shown, shown[0]!], 3)).toBe(shown[1]);
  });
  it('a template that is no longer eligible does not stand in the way', () => {
    expect(pickGreeting(['greetMorning1'], ['greetMorning2', 'greetNight1'], 5)).toBe('greetMorning1');
  });
  it('a day has its own order', () => {
    const orders = new Set(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map(d => pickGreeting(all, [], seedOf(d))));
    expect(orders.size).toBeGreaterThan(1);
  });
  it('greetingLine fills the slots of the pick', () => {
    const i = line();
    const l = greetingLine(i, [], 11)!;
    expect(eligibleLines(i).map(x => x.key)).toContain(l.key);
    const shown = [l.key];
    expect(greetingLine(i, shown, 11)!.key).not.toBe(l.key);
  });
});

describe('every template', () => {
  const templates = (dict: Record<string, unknown>) => Object.values(GREETING_KEYS).flat().flatMap(k => {
    const v = dict[k];
    return v == null ? [] : typeof v === 'string' ? [v] : Object.values(v as Record<string, string>);
  });
  const BAD = [/database/i, /record/i, /entry/i, /field/i, /base de donn/i, /enregistrement/i, /entr[ée]e/i, /champ/i];
  it('exists in English and French, with the same slots', () => {
    const slots = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort().join();
    for (const k of Object.values(GREETING_KEYS).flat()) {
      const e = (en as Record<string, unknown>)[k], f = (fr as Record<string, unknown>)[k];
      expect(e, k).toBeTruthy();
      expect(f, k).toBeTruthy();
      expect(typeof f).toBe(typeof e);
      const one = (v: unknown) => (typeof v === 'string' ? [v] : Object.values(v as Record<string, string>));
      expect(slots(one(f).join(' ')), k).toBe(slots(one(e).join(' ')));
    }
  });
  it('never says database, record, entry or field (nor their French)', () => {
    for (const s of [...templates(en), ...templates(fr)]) for (const re of BAD) expect(s, s).not.toMatch(re);
  });
  it('never mentions what was missed or carried', () => {
    for (const s of [...templates(en), ...templates(fr)]) expect(s, s).not.toMatch(/missed|carried|overdue|late|behind|manqu|report|retard/i);
  });
  it('is plain: no call to action, no question, nothing to type, add, move or tick off', () => {
    for (const s of templates(en)) expect(s, s).not.toMatch(/type|box|below|\badd\b|\bmove\b|tick|\?/i);
    for (const s of templates(fr)) expect(s, s).not.toMatch(/écri|case|ci-dessous|ajout|déplac|coch|\?/i);
  });
});
