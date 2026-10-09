import { describe, expect, it } from 'vitest';
import { score, ranked, tooClose, normItems, type Option } from './decision';
import { stayOn, currentPlace, dueBeforeEnd } from './places';
import { moveTo, firstCalmDay } from './moves';
import { monthGrid, weekOf, minutesBetween, stillOnAfter } from './calendar';

const it_ = (id: string, w: number, mirrorOf?: string) => ({ id, text: id, w, mirrorOf });
const opt = (id: string, o: Partial<Option>): Option => ({ id, name: id, pros: [], cons: [], prosNot: [], consNot: [], ...o });

describe('decision scores', () => {
  it('(pros + cons of not doing) − (cons + pros of not doing)', () => {
    expect(score(opt('a', { pros: [it_('1', 5), it_('2', 3)], consNot: [it_('3', 2)], cons: [it_('4', 4)], prosNot: [it_('5', 1)] }))).toBe(5);
  });
  it('a mirror counts once', () => {
    expect(score(opt('a', { pros: [it_('1', 4)], consNot: [it_('2', 4, '1')] }))).toBe(4);
  });
  it('clamps weights to 1–5 and ranks options still in play', () => {
    expect(score(opt('a', { pros: [it_('1', 9)] }))).toBe(5);
    const r = ranked([opt('a', { pros: [it_('1', 2)] }), opt('b', { pros: [it_('1', 4)] }), opt('c', { pros: [it_('1', 5)], screened: 'impossible' })]);
    expect(r.map(x => x.option.id)).toEqual(['b', 'a']);
  });
  it('asks about regret when the top two are within 10%', () => {
    expect(tooClose([20, 19])).toBe(true);
    expect(tooClose([20, 17])).toBe(false);
    expect(tooClose([5])).toBe(false);
    expect(tooClose([0, 0])).toBe(true);
  });
  it('reads v1 items', () => {
    expect(normItems([['cheaper', 4], ['near', 9]], 'p')).toEqual([{ id: 'p0', text: 'cheaper', w: 4, by: 'me' }, { id: 'p1', text: 'near', w: 5, by: 'me' }]);
  });
});

describe('stays', () => {
  const stays = [{ id: 's1', placeId: 'strasbourg', from: '2026-10-04', to: '2026-10-07' }, { id: 's2', placeId: 'cairo', from: '2026-10-07', to: '2026-10-20' }];
  it('switches the current place on a stay’s first day, and back after', () => {
    expect(currentPlace(stays, '2026-10-03', 'paris')).toBe('paris');
    expect(currentPlace(stays, '2026-10-04', 'paris')).toBe('strasbourg');
    expect(currentPlace(stays, '2026-10-21', 'paris')).toBe('paris');
  });
  it('a shared day belongs to the stay that starts on it', () => {
    expect(stayOn(stays, '2026-10-07')?.id).toBe('s2');
  });
  it('before I leave: the last day minus one', () => {
    expect(dueBeforeEnd(stays[0]!)).toBe('2026-10-06');
    expect(dueBeforeEnd(stays[0]!, 3)).toBe('2026-10-04');
  });
});

describe('matrix moves', () => {
  const today = '2026-10-09';
  it('moving into Now or Quick without a date in the window asks for one, or a blocker', () => {
    expect(moveTo({ important: false }, 1, today)).toEqual({ patch: { important: true }, ask: 'dueOrBlocker' });
    expect(moveTo({ due: '2026-12-01' }, 3, today)).toEqual({ patch: { important: false }, ask: 'dueOrBlocker' });
    expect(moveTo({ due: '2026-10-12' }, 1, today)).toEqual({ patch: { important: true }, ask: null });
  });
  it('moving out of urgent with a date in the window asks for a new date', () => {
    expect(moveTo({ due: '2026-10-12', important: true }, 2, today)).toEqual({ patch: { important: true }, ask: 'newDue' });
    expect(moveTo({ urgent: true }, 4, today)).toEqual({ patch: { important: false, urgent: false }, ask: null });
    expect(moveTo({ important: true }, 4, today)).toEqual({ patch: { important: false }, ask: null });
    expect(firstCalmDay(today)).toBe('2026-10-31');
  });
});

describe('calendar', () => {
  it('lays a month out in Monday-first weeks', () => {
    const g = monthGrid(2026, 10);
    expect(g[0]![0]).toBe('2026-09-28');
    expect(g.at(-1)!.at(-1)).toBe('2026-11-01');
    expect(g.length).toBe(5);
    expect(monthGrid(2026, 12).at(-1)!.includes('2026-12-31')).toBe(true);
  });
  it('weeks, minutes and the still-on threshold', () => {
    expect(weekOf('2026-10-09')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(minutesBetween('23:30', '00:15')).toBe(45);
    expect(stillOnAfter(10)).toBe(45);
    expect(stillOnAfter(40)).toBe(80);
    expect(stillOnAfter(null)).toBe(45);
  });
});
