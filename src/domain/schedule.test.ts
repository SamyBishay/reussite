import { describe, expect, it } from 'vitest';
import { day, task } from './agenda.fixture';
import { DEFAULT_CARD_MINUTES, makeScheduler, placeCards, reorderForDrop, type SchedCard } from './schedule';

const m = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const hm = (n: number) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
const card = (id: string, minutes = 30, o: Partial<SchedCard> = {}): SchedCard => ({ id, minutes, ...o });
const at = (r: { slots: { id: string; start: number; end: number }[] }) => r.slots.map(s => `${s.id} ${hm(s.start)}-${hm(s.end)}`);
const base = { fixed: [], startDefault: m('09:00'), mode: 'future' as const };

describe('placing cards', () => {
  it('lays cards one after another from the launch point', () => {
    expect(at(placeCards({ ...base, cards: [card('a'), card('b'), card('c')], launches: [m('09:30')] }))).toEqual(['a 09:30-10:00', 'b 10:00-10:30', 'c 10:30-11:00']);
  });
  it('starts at the default when there is no launch point', () => {
    expect(at(placeCards({ ...base, cards: [card('a')], launches: [], startDefault: m('08:15') }))).toEqual(['a 08:15-08:45']);
  });
  it('moves a card that would overlap a fixed item to after it, and fits a short one before it', () => {
    const r = placeCards({ ...base, cards: [card('a', 45), card('b', 20), card('c', 30)], launches: [m('09:00')], fixed: [{ start: m('09:50'), end: m('10:30') }] });
    expect(at(r)).toEqual(['a 09:00-09:45', 'b 10:30-10:50', 'c 10:50-11:20']);
    const r2 = placeCards({ ...base, cards: [card('a', 30), card('b', 30)], launches: [m('09:00')], fixed: [{ start: m('09:30'), end: m('10:00') }] });
    expect(at(r2)).toEqual(['a 09:00-09:30', 'b 10:00-10:30']);
  });
  it('resumes at a restart when the earlier block does not fit before it, and carries on when it ran past', () => {
    const cards = [card('a', 60), card('b', 60), card('c', 60)];
    expect(at(placeCards({ ...base, cards, launches: [m('09:00'), m('10:30')] }))).toEqual(['a 09:00-10:00', 'b 10:30-11:30', 'c 11:30-12:30']);
    expect(at(placeCards({ ...base, cards: [card('a', 90), card('b', 30)], launches: [m('09:00'), m('09:30')] }))).toEqual(['a 09:00-10:30', 'b 10:30-11:00']);
  });
  it('puts afternoon-area cards from the first launch at or after 13:00', () => {
    const r = placeCards({ ...base, cards: [card('a'), card('p', 30, { pm: true }), card('q', 30, { pm: true })], launches: [m('09:00'), m('14:00')] });
    expect(at(r)).toEqual(['a 09:00-09:30', 'p 14:00-14:30', 'q 14:30-15:00']);
  });
  it('places optional cards last', () => {
    expect(at(placeCards({ ...base, cards: [card('o', 30, { optional: true }), card('a')], launches: [m('09:00')] }))).toEqual(['a 09:00-09:30', 'o 09:30-10:00']);
  });
  it('today: done cards at their real times, the running card from its start to now, the rest from now', () => {
    const r = placeCards({
      mode: 'today', now: m('11:12'), fixed: [], startDefault: m('09:00'), launches: [m('09:00')],
      cards: [card('d', 30, { isDone: true, done: { start: m('09:05'), end: m('09:40') } }), card('r', 30, { running: { start: m('10:50') } }), card('x'), card('y')],
    });
    expect(at(r)).toEqual(['d 09:05-09:40', 'r 10:50-11:20', 'x 11:20-11:50', 'y 11:50-12:20']);
    expect(r.slots.find(s => s.id === 'r')!.state).toBe('running');
    const late = placeCards({ mode: 'today', now: m('13:07'), fixed: [], startDefault: m('09:00'), launches: [m('09:00')], cards: [card('x')] });
    expect(at(late)).toEqual(['x 13:10-13:40']);
  });
  it('a past day: done cards at real times, the rest not drawn; a done card with no known time is not drawn', () => {
    const r = placeCards({ ...base, mode: 'past', launches: [m('09:00')], cards: [card('d', 30, { isDone: true, done: { start: 600, end: 630 } }), card('n', 30, { isDone: true }), card('x')] });
    expect(at(r)).toEqual(['d 10:00-10:30']);
    expect(r.unplaced).toEqual(['n', 'x']);
  });
  it('leaves out what the day has no room for', () => {
    const r = placeCards({ ...base, cards: [card('a', 60), card('b', 60)], launches: [m('23:00')] });
    expect(at(r)).toEqual(['a 23:00-23:59']);
    expect(r.unplaced).toEqual(['b']);
  });
});

describe('dropping a card at a time', () => {
  it('puts it before the first waiting card at or after the drop, else last', () => {
    const slots = placeCards({ ...base, cards: [card('a'), card('b'), card('c')], launches: [m('09:00')] }).slots;
    expect(reorderForDrop(['a', 'b', 'c'], slots, 'c', m('09:20'))).toEqual(['a', 'c', 'b']);
    expect(reorderForDrop(['a', 'b', 'c'], slots, 'a', m('12:00'))).toEqual(['b', 'c', 'a']);
    expect(reorderForDrop(['a', 'b', 'c'], slots, 'c', m('06:00'))).toEqual(['c', 'a', 'b']);
  });
});

describe('from the data', () => {
  const T = (id: string, est: number | null, o = {}) => ({ ...task(id, { est }), ...o });
  const tasks = new Map([['a', T('a', 30)], ['b', T('b', 30)], ['c', T('c', null)], ['w', T('w', 30, { after: 'a' })]] as const);
  const opts = { today: '2026-10-21', dayStart: '05:00', now: Date.parse('2026-10-21T08:00:00Z') };

  it('uses the estimate, else 30 minutes, skips a waiting step, and the default start from settings', () => {
    const days = new Map([['2026-10-22', day('2026-10-22', { plan: ['a', 'b', 'c', 'w'], launches: [{ t: '09:30', k: 'start' }] })]]);
    const s = makeScheduler({ tasks: tasks as never, days }, { ...opts, launchStart: '08:00' })('2026-10-22', 'Europe/Paris');
    expect(at(s)).toEqual(['a 09:30-10:00', 'b 10:00-10:30', 'c 10:30-11:00']);
    expect(DEFAULT_CARD_MINUTES).toBe(30);
    const one = new Map([['2026-10-22', day('2026-10-22', { plan: ['a'] })]]);
    expect(at(makeScheduler({ tasks: tasks as never, days: one }, { ...opts, launchStart: '08:00' })('2026-10-22'))).toEqual(['a 08:00-08:30']);
    expect(at(makeScheduler({ tasks: tasks as never, days: one }, opts)('2026-10-22'))).toEqual(['a 09:00-09:30']);
  });

  it('flows around a fixed-time item of the day', () => {
    const t = new Map([...tasks, ['f', task('f', { at: '09:00', due: '2026-10-22', dur: 60 })] as const]);
    const days = new Map([['2026-10-22', day('2026-10-22', { plan: ['a'], launches: [{ t: '09:00', k: 'start' }] })]]);
    expect(at(makeScheduler({ tasks: t as never, days }, opts)('2026-10-22'))).toEqual(['a 10:00-10:30']);
  });

  it('puts a done card at the end of its last session', () => {
    const t = new Map([['d', T('d', 30, { status: 'done', doneDay: '2026-10-21', doneAt: '2026-10-21T07:00:00Z' })]] as const);
    const sessions = new Map([['s1', { id: 's1', taskId: 'd', d: '2026-10-21', m: 25, why: null, at: '2026-10-21T07:30:00Z', source: 'timer' }]]) as never;
    const days = new Map([['2026-10-21', day('2026-10-21', { plan: ['d'] })]]);
    expect(at(makeScheduler({ tasks: t as never, days, sessions }, opts)('2026-10-21', 'Europe/Paris'))).toEqual(['d 09:05-09:30']);
  });
});
