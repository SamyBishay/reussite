import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { fr } from '../i18n/fr';
import { translate } from '../i18n/core';
import { GREETING_KEYS, eligibleLines, greeting, greetingLine, nearGoal, partOfDay, pickGreeting, seedOf, type GreetingInput, type LineInput } from './greeting';

const base = (o: Partial<GreetingInput> = {}): GreetingInput => ({ closed: false, planned: 2, first: { id: 's1', kind: 'step', running: false }, tomorrow: null, ...o });

describe('the card under the greeting', () => {
  it('a running step is shown running', () => {
    expect(greeting(base({ first: { id: 'r1', kind: 'step', running: true } }))).toEqual({ kind: 'running', id: 'r1' });
    expect(greeting(base({ first: { id: 'r1', kind: 'step', running: true }, closed: true }))).toEqual({ kind: 'running', id: 'r1' });
  });
  it('a fixed-time item that took over is Start here, closed day or not', () => {
    expect(greeting(base({ first: { id: 'f', kind: 'fixed', running: false } }))).toEqual({ kind: 'next', id: 'f', fixed: true });
    expect(greeting(base({ first: { id: 'f', kind: 'fixed', running: false }, closed: true }))).toEqual({ kind: 'next', id: 'f', fixed: true });
  });
  it('a fixed-time item that is being timed is shown running', () => {
    expect(greeting(base({ first: { id: 'f', kind: 'fixed', running: true } }))).toEqual({ kind: 'running', id: 'f' });
  });
  it('otherwise the first step is Start here', () => {
    expect(greeting(base())).toEqual({ kind: 'next', id: 's1', fixed: false });
  });
  it('no list shows Plan the day; a list with nothing left shows all done', () => {
    expect(greeting(base({ planned: 0, first: null }))).toEqual({ kind: 'plan' });
    expect(greeting(base({ first: null, planned: 3 }))).toEqual({ kind: 'allDone' });
  });
  it('a closed day shows tomorrow’s first step, or says there is none', () => {
    expect(greeting(base({ closed: true, tomorrow: { id: 'z', title: 'Open the form' } }))).toEqual({ kind: 'tomorrow', step: { id: 'z', title: 'Open the form' } });
    expect(greeting(base({ closed: true }))).toEqual({ kind: 'tomorrow', step: null });
  });
});

const line = (o: Partial<LineInput> = {}): LineInput => ({ clock: '10:00', dayStart: '05:00', fixed: null, project: null, doneToday: 0, planned: 0, running: false, ...o });
const kinds = (i: LineInput) => eligibleLines(i).map(l => l.key.replace(/\d$/, '').replace('greet', '').toLowerCase());
const unique = (xs: string[]) => [...new Set(xs)];

describe('the line: which kinds are eligible', () => {
  it('only the time of day, with nothing else to say', () => {
    expect(unique(kinds(line()))).toEqual(['morning']);
  });
  it('the part of the day follows the clock and the day-start rule', () => {
    expect(partOfDay('05:00', '05:00')).toBe('morning');
    expect(partOfDay('11:59', '05:00')).toBe('morning');
    expect(partOfDay('12:00', '05:00')).toBe('afternoon');
    expect(partOfDay('17:59', '05:00')).toBe('afternoon');
    expect(partOfDay('18:00', '05:00')).toBe('evening');
    expect(partOfDay('02:30', '05:00')).toBe('evening');
  });
  it('the next fixed item, with its time and title', () => {
    const l = eligibleLines(line({ fixed: { time: '14:00', title: 'Dentist' } })).filter(x => x.key.startsWith('greetFixed'));
    expect(l).toHaveLength(3);
    expect(l[0]!.slots).toEqual({ time: '14:00', title: 'Dentist' });
    expect(translate('en', 'greetFixed1', l[0]!.slots)).toBe('Anything to move before the 14:00 Dentist? Type it in the box.');
  });
  it('a project close to its goal is named', () => {
    const l = eligibleLines(line({ project: { name: 'Flat move' } })).filter(x => x.key.startsWith('greetProject'));
    expect(l).toHaveLength(3);
    expect(translate('en', l[0]!.key, l[0]!.slots)).toContain('Flat move');
  });
  it('done so far counts done steps only, and needs one', () => {
    expect(kinds(line({ doneToday: 0 }))).not.toContain('done');
    const l = eligibleLines(line({ doneToday: 2 })).find(x => x.key === 'greetDone1')!;
    expect(translate('en', l.key, l.slots)).toBe('2 down. What’s next to tick off? Type it in the box.');
    expect(translate('en', 'greetDone1', { n: 1 })).toBe('One down. What’s next to tick off? Type it in the box.');
  });
  it('planned but not started: steps on the list, nothing done, nothing running', () => {
    expect(unique(kinds(line({ planned: 3 })))).toEqual(['morning', 'planned']);
    expect(kinds(line({ planned: 3, doneToday: 1 }))).not.toContain('planned');
    expect(kinds(line({ planned: 3, running: true }))).not.toContain('planned');
  });
  it('a project is near its goal with a step done and one or two left, the fewest first', () => {
    const p = (name: string, order: number, open: number, done: number) => ({ name, order, open, done });
    expect(nearGoal([p('A', 1, 5, 4), p('B', 2, 3, 3), p('C', 3, 0, 4), p('D', 4, 2, 0)])).toBeNull();
    expect(nearGoal([p('A', 2, 2, 1), p('B', 1, 1, 3), p('C', 0, 2, 5)])).toEqual({ name: 'B' });
    expect(nearGoal([p('A', 2, 2, 1), p('C', 0, 2, 5)])).toEqual({ name: 'C' });
  });
});

describe('the line: no repeat within a day', () => {
  const all = [...GREETING_KEYS.fixed, ...GREETING_KEYS.morning];
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
    expect(pickGreeting(['greetMorning1'], ['greetMorning2', 'greetFixed1'], 5)).toBe('greetMorning1');
  });
  it('a day has its own order', () => {
    const orders = new Set(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map(d => pickGreeting(all, [], seedOf(d))));
    expect(orders.size).toBeGreaterThan(1);
  });
  it('greetingLine fills the slots of the pick', () => {
    const i = line({ fixed: { time: '09:00', title: 'Call' } });
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
  it('invites the person to use the box: every sentence names what to add, move or tick off, or says where to type', () => {
    for (const s of templates(en)) expect(s, s).toMatch(/type|box|below/i);
    for (const s of templates(fr)) expect(s, s).toMatch(/écri|case|ci-dessous/i);
  });
});
