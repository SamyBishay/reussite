import { describe, expect, it } from 'vitest';
import { withTime } from './calendar';
import { plan, checkPlan, needsBreakDown, totalOf, type PlanInput, type PlanItem, type PStep } from './planner';

const today = '2026-10-09';
const s = (id: string, quad: PStep['quad'], o: Partial<PStep> = {}): PStep => ({ id, quad, due: null, est: 15, starter: 'Open it', ...o });
const input = (o: Partial<PlanInput> = {}): PlanInput => ({
  today, maxWorkSteps: 3, planningMin: 15, defaultRestarts: ['14:00'], obligationAt: '18:00',
  shape: { start: '09:30', preset: 'normal', fixed: [] },
  carried: [], candidates: [], obligations: [], optional: [], laterPool: [], usualLoad: null, ...o,
});
const roles = (p: ReturnType<typeof plan>) => p.items.map(i => i.id + ':' + i.role);

describe('the planner', () => {
  it('Now first, exactly one Protect, then Quick, within the work-step limit', () => {
    const p = plan(input({ candidates: [s('n1', 1), s('n2', 1), s('n3', 1), s('p1', 2), s('p2', 2), s('q1', 3), s('l1', 4)] }));
    expect(roles(p)).toEqual(['n1:now', 'n2:now', 'p1:protect']);
  });

  it('fills spare slots with Quick steps, each its own card', () => {
    const p = plan(input({ maxWorkSteps: 4, candidates: [s('n1', 1), s('p1', 2), s('q1', 3), s('q2', 3), s('q3', 3)] }));
    expect(roles(p)).toEqual(['n1:now', 'p1:protect', 'q1:quick', 'q2:quick']);
  });

  it('puts carried steps first and still keeps one Protect', () => {
    const p = plan(input({ carried: [s('c1', 1), s('c2', 3), s('c3', 1)], candidates: [s('n1', 1), s('p1', 2)] }));
    expect(roles(p)).toEqual(['c1:carried', 'c2:carried', 'c3:carried', 'p1:protect']);
    // A carried Protect step is the day's Protect.
    expect(roles(plan(input({ carried: [s('c1', 2)], candidates: [s('n1', 1), s('p1', 2)] })))).toEqual(['c1:carried', 'n1:now']);
  });

  it('skips blocked steps', () => {
    expect(roles(plan(input({ candidates: [s('n1', 1, { blocked: true }), s('n2', 1)] })))).toEqual(['n2:now']);
  });

  it('adds one standing obligation, least recently done, with a time', () => {
    const p = plan(input({ obligations: [{ id: 'walk', lastDone: '2026-10-08', est: 30 }, { id: 'call', lastDone: '2026-10-01', est: 20, at: '19:00' }, { id: 'swim', lastDone: '2026-10-05', est: 45 }] }));
    expect(p.items).toEqual([{ id: 'call', role: 'obligation', at: '19:00' }]);
    expect(plan(input({ obligations: [{ id: 'walk', lastDone: null, est: 30 }] })).items[0]).toEqual({ id: 'walk', role: 'obligation', at: '18:00' });
  });

  it('rest day: the obligation only, unless something is due within two days', () => {
    const base = { shape: { start: '10:00', preset: 'rest' as const, fixed: [] }, obligations: [{ id: 'walk', lastDone: null, est: 30 }] };
    expect(roles(plan(input({ ...base, candidates: [s('n1', 1, { due: '2026-10-20' }), s('p1', 2)] })))).toEqual(['walk:obligation']);
    expect(roles(plan(input({ ...base, candidates: [s('n1', 1, { due: '2026-10-11' }), s('p1', 2)] })))).toEqual(['n1:now', 'walk:obligation']);
  });

  it('afternoon only: one work step fewer; an hour or less: fits in an hour', () => {
    const c = [s('n1', 1), s('n2', 1), s('p1', 2), s('q1', 3)];
    expect(roles(plan(input({ shape: { start: '14:00', preset: 'afternoon', fixed: [] }, candidates: c })))).toEqual(['n1:now', 'p1:protect']);
    const big = [s('n1', 1, { est: 40 }), s('n2', 1, { est: 15 }), s('p1', 2, { est: 30 }), s('q1', 3, { est: 5 })];
    expect(roles(plan(input({ shape: { start: '09:00', preset: 'hour', fixed: [] }, candidates: big })))).toEqual(['n1:now', 'n2:now', 'q1:quick']);
  });

  it('totals personal estimates with their range, plus planning time', () => {
    const p = plan(input({ candidates: [s('n1', 1, { est: 30, lo: 25, hi: 45 }), s('p1', 2, { est: 20 })], obligations: [{ id: 'w', lastDone: null, est: 30 }] }));
    expect(p.total).toEqual({ est: 15 + 30 + 20 + 30, lo: 15 + 25 + 20 + 30, hi: 15 + 45 + 20 + 30 });
  });

  it('flags steps over 30 minutes or without a starter', () => {
    const p = plan(input({ candidates: [s('n1', 1, { est: 45 }), s('n2', 1, { starter: '' }), s('p1', 2)] }));
    expect(p.items.map(i => !!i.breakDown)).toEqual([true, true, false]);
    expect(needsBreakDown({ est: 30, starter: 'x' })).toBe(false);
  });

  it('a start launch point, and restarts after fixed commitments', () => {
    expect(plan(input()).launches).toEqual([{ t: '09:30', k: 'start' }, { t: '14:00', k: 'restart' }]);
    const p = plan(input({ shape: { start: '09:00', preset: 'normal', fixed: [{ at: '11:00', dur: 60 }, { at: '15:30', dur: 30 }, { at: '17:00', dur: 30 }, { at: '08:00', dur: 30 }] } }));
    expect(p.launches).toEqual([{ t: '09:00', k: 'start' }, { t: '12:00', k: 'restart' }, { t: '16:00', k: 'restart' }]);
  });

  it('optional Later cards go at the end, outside the limit', () => {
    const p = plan(input({ candidates: [s('n1', 1), s('n2', 1), s('p1', 2)], optional: [s('l1', 4)] }));
    expect(roles(p)).toEqual(['n1:now', 'n2:now', 'p1:protect', 'l1:optional']);
    expect(p.total.est).toBe(15 + 45);
  });

  it('offers one Later step on a light day', () => {
    expect(plan(input({ candidates: [s('q1', 3, { est: 5 })], laterPool: [s('l1', 4)], usualLoad: 90 })).offerLater).toBe('l1');
    expect(plan(input({ candidates: [s('n1', 1, { est: 60 })], laterPool: [s('l1', 4)], usualLoad: 90 })).offerLater).toBeNull();
  });

  it('checks plans against the rules', () => {
    const inp = input({ candidates: [s('n1', 1), s('p1', 2), s('p2', 2)] });
    expect(checkPlan(plan(inp), inp)).toEqual([]);
    expect(checkPlan({ items: [{ id: 'n1', role: 'now' }] }, inp)).toEqual(['no Protect step']);
    expect(checkPlan({ items: [{ id: 'p1', role: 'protect' }, { id: 'p2', role: 'protect' }] }, inp)).toEqual(['more than one Protect step']);
    const many: PlanItem[] = [...['a', 'b', 'c', 'd'].map(id => ({ id, role: 'now' as const })), { id: 'p1', role: 'protect' }];
    expect(checkPlan({ items: many }, inp)).toContain('too many work steps');
  });

  describe('fixed-time items', () => {
    const cands = [...Array.from({ length: 6 }, (_, i) => s('n' + i, 1)), ...Array.from({ length: 4 }, (_, i) => s('p' + i, 2)), s('q1', 3), s('q2', 3)];
    const choir = { id: 'choir', at: '19:00', lead: 30, template: true };

    it('the 19 October case: twelve open cards and a choir at 19:00 give a plan that starts with the choir and its leave-by time', () => {
      const p = plan(input({ today: '2026-10-19', candidates: cands, timed: [choir] }));
      expect(p.items[0]).toEqual({ id: 'choir', role: 'fixed', at: '19:00', leave: '18:30' });
      expect(withTime('Choir, Hill House 602', p.items[0]!.at!)).toBe('Choir 19:00, Hill House 602');
      // The three work steps are still there, and the choir does not count against them.
      expect(roles(p)).toEqual(['choir:fixed', 'n0:now', 'n1:now', 'p0:protect']);
      expect(p.items.filter(i => i.role !== 'fixed')).toHaveLength(3);
      // The leave-by time is worked out, not stored in the launch points.
      expect(p.launches).toEqual([{ t: '09:30', k: 'start' }, { t: '14:00', k: 'restart' }]);
    });

    it('lists every one by time, outside the limit, with a leave-by only where there is a lead', () => {
      const p = plan(input({ maxWorkSteps: 1, candidates: cands, timed: [{ id: 'b', at: '19:00', lead: 30 }, { id: 'a', at: '09:05', lead: 0 }, { id: 'c', at: '14:00', lead: 45 }, { id: 'd', at: '00:20', lead: 30 }] }));
      expect(p.items.filter(i => i.role === 'fixed')).toEqual([
        { id: 'd', role: 'fixed', at: '00:20', leave: '23:50' }, { id: 'a', role: 'fixed', at: '09:05' }, { id: 'c', role: 'fixed', at: '14:00', leave: '13:15' }, { id: 'b', role: 'fixed', at: '19:00', leave: '18:30' },
      ]);
      expect(p.items.slice(0, 4).every(i => i.role === 'fixed')).toBe(true);
      expect(p.items.filter(i => i.role !== 'fixed').map(i => i.role)).toEqual(['protect']);
    });

    it('stays on a rest day, and does not take the step’s place in the plan', () => {
      const p = plan(input({ shape: { start: '10:00', preset: 'rest', fixed: [] }, candidates: cands, timed: [choir] }));
      expect(roles(p)).toEqual(['choir:fixed']);
      // A step that is also a fixed item is listed once, as fixed.
      const q = plan(input({ candidates: [s('choir', 1), s('n1', 1)], timed: [choir] }));
      expect(roles(q)).toEqual(['choir:fixed', 'n1:now']);
    });

    it('is not counted by the rules a plan must keep, nor by the total', () => {
      const inp = input({ candidates: cands, timed: [choir] });
      const p = plan(inp);
      expect(checkPlan(p, inp)).toEqual([]);
      expect(checkPlan({ items: [{ id: 'choir', role: 'fixed' }, ...p.items.filter(i => i.role !== 'fixed')] }, inp)).toEqual([]);
      expect(totalOf(p.items, inp)).toEqual(p.total);
      expect(plan(input({ candidates: cands })).total).toEqual(p.total);
    });

    it('older callers, with no timed items, get the same plan as before', () => {
      expect(roles(plan(input({ candidates: cands })))).toEqual(['n0:now', 'n1:now', 'p0:protect']);
    });
  });
});
