import { describe, expect, it } from 'vitest';
import { proposeDay, mustWhy, loadOf, type ProposeInput, type PropStep } from './propose';

const at = (hhmm: string) => Date.parse('2026-11-02T' + hhmm + ':00Z');
const TODAY = '2026-11-02';
let n = 0;
const step = (id: string, o: Partial<PropStep> = {}): PropStep => ({
  id, suit: 'S', project: 'inbox', quad: 4, due: null, atPlace: true, specific: false, order: ++n, ...o,
});
const ESTS: Record<string, number> = {};
const input = (steps: PropStep[], o: Partial<ProposeInput> = {}): ProposeInput => ({
  today: TODAY, steps, fixed: [], checks: [], carried: [], projects: [],
  layout: { now: at('08:00'), floor: at('08:00'), end: at('19:00'), est: id => ESTS[id] ?? 30, fixed: [] },
  ...o,
});
const proj = (id: string, o: Partial<ProposeInput['projects'][number]> = {}) => ({ id, status: 'active', due: null, order: 1, hasGoal: false, ...o });

describe('proposeDay: what has to happen today', () => {
  it('lists fixed items first, then overdue, due today, urgent and carried steps, with the reason', () => {
    const p = proposeDay(input([
      step('later', { quad: 2 }),
      step('urg', { quad: 3 }),
      step('late', { quad: 1, due: '2026-10-30' }),
      step('today', { quad: 1, due: TODAY }),
      step('carry', { quad: 4 }),
    ], { fixed: ['dentist'], carried: ['carry'], checks: ['wait1'] }));
    expect(p.must.map(m => m.id + ':' + m.why)).toEqual(['dentist:fixed', 'late:overdue', 'today:dueToday', 'urg:urgent', 'carry:carried', 'wait1:check']);
    expect(p.mustMore).toEqual([]);
  });

  it('keeps the limit and offers the rest to swap in; a step that waits for another is never proposed', () => {
    const steps = ['a', 'b', 'c', 'd', 'e'].map(id => step(id, { quad: 1, due: TODAY }));
    const p = proposeDay(input([...steps, step('w', { quad: 1, due: TODAY, blocked: true })], { limits: { must: 3 } }));
    expect(p.must.map(m => m.id)).toEqual(['a', 'b', 'c']);
    expect(p.mustMore).toEqual(['d', 'e']);
    expect(JSON.stringify(p)).not.toContain('"w"');
  });

  it('puts an urgent step that can only be done elsewhere aside, but a carried one stays', () => {
    const p = proposeDay(input([step('far', { quad: 1, atPlace: false }), step('farCarried', { quad: 4, atPlace: false })], { carried: ['farCarried'] }));
    expect(p.must.map(m => m.id)).toEqual(['farCarried']);
  });

  it('mustWhy names the reason or none', () => {
    const none = new Set<string>();
    expect(mustWhy(step('x', { quad: 4 }), TODAY, none)).toBeNull();
    expect(mustWhy(step('x', { quad: 2 }), TODAY, none)).toBeNull();
    expect(mustWhy(step('x', { quad: 4, due: TODAY }), TODAY, none)).toBe('dueToday');
    expect(mustWhy(step('x', { quad: 1 }), TODAY, none)).toBe('urgent');
    expect(mustWhy(step('x', { quad: 2 }), TODAY, new Set(['x']))).toBe('carried');
  });
});

describe('proposeDay: the main goals', () => {
  const steps = [
    step('a1', { project: 'pa', order: 1 }), step('a2', { project: 'pa', order: 2 }),
    step('b1', { project: 'pb', order: 1 }), step('c1', { project: 'pc', order: 1 }), step('d1', { project: 'pd', order: 1 }),
    step('inb', { project: 'inbox' }),
  ];
  const projects = [proj('pa', { order: 3 }), proj('pb', { order: 1, due: '2026-12-01' }), proj('pc', { order: 2, hasGoal: true }), proj('pd', { order: 4, status: 'paused' }), proj('inbox')];

  it('takes at most two active projects, the nearest date first then one with a goal, each with its first open step', () => {
    const p = proposeDay(input(steps, { projects }));
    expect(p.goals).toEqual([
      { project: 'pb', step: 'b1', more: [] },
      { project: 'pc', step: 'c1', more: [] },
    ]);
    expect(p.moreGoals).toEqual([{ project: 'pa', step: 'a1', more: ['a2'] }]);
  });

  it('starts with the first step of the project that is not already in the first section, and lists the others to swap', () => {
    const p = proposeDay(input([step('a1', { project: 'pa', order: 1, quad: 1, due: TODAY }), step('a2', { project: 'pa', order: 2 }), step('a3', { project: 'pa', order: 3 })], { projects: [proj('pa')] }));
    expect(p.must.map(m => m.id)).toEqual(['a1']);
    expect(p.goals).toEqual([{ project: 'pa', step: 'a2', more: ['a3'] }]);
  });

  it('leaves the goals empty when no project has a step to do here', () => {
    const p = proposeDay(input([step('a1', { project: 'pa', atPlace: false })], { projects: [proj('pa')] }));
    expect(p.goals).toEqual([]);
  });
});

describe('proposeDay: one for each pillar', () => {
  it('picks the best of each pillar (Protect before Later) and lists the next ones to swap in', () => {
    const p = proposeDay(input([
      step('s1', { suit: 'S', quad: 4 }), step('s2', { suit: 'S', quad: 2 }), step('s3', { suit: 'S', quad: 4 }),
      step('c1', { suit: 'C', quad: 2, due: '2027-01-10' }), step('c2', { suit: 'C', quad: 2, due: '2027-01-05' }),
      step('h1', { suit: 'H', quad: 4 }),
    ]));
    expect(p.pillars.S).toEqual({ pick: 's2', more: ['s1', 's3'], covered: [] });
    expect(p.pillars.C.pick).toBe('c2');
    expect(p.pillars.C.more).toEqual(['c1']);
    expect(p.pillars.H.pick).toBe('h1');
    // A pillar with nothing for it is empty, not missing: the AI may write a new step for it.
    expect(p.pillars.D).toEqual({ pick: null, more: [], covered: [] });
  });

  it('does not pick a step twice, and says which steps of a pillar are already in the sections above', () => {
    const p = proposeDay(input([
      step('f1', { suit: 'C', quad: 1, due: TODAY }), step('f2', { suit: 'C', quad: 2 }),
    ]));
    expect(p.must.map(m => m.id)).toEqual(['f1']);
    expect(p.pillars.C).toEqual({ pick: 'f2', more: [], covered: ['f1'] });
  });

  it('every pillar of the person is there, in their own order of suits', () => {
    expect(Object.keys(proposeDay(input([])).pillars)).toEqual(['S', 'D', 'C', 'H']);
  });
});

describe('proposeDay: where you are', () => {
  it('lists steps that have today\'s place (or an area of it) as their own, not the Anywhere ones', () => {
    const p = proposeDay(input([
      step('q1', { specific: true, quad: 2 }), step('q2', { specific: true, quad: 4 }), step('any', { specific: false, quad: 2, suit: 'D' }),
      step('away', { specific: false, atPlace: false }),
    ]));
    expect(p.here.ids).toEqual(['q1', 'q2']);
    // A step in this section is not picked again for its pillar.
    expect(p.pillars.S.pick).toBeNull();
    expect(p.pillars.S.covered).toEqual(['q1', 'q2']);
    expect(p.pillars.D.pick).toBe('any');
  });

  it('keeps the limit and offers the rest', () => {
    const p = proposeDay(input(['a', 'b', 'c'].map(id => step(id, { specific: true })), { limits: { here: 2 } }));
    expect(p.here).toEqual({ ids: ['a', 'b'], more: ['c'] });
  });

  it('is empty when no step belongs to the place', () => {
    expect(proposeDay(input([step('a')])).here).toEqual({ ids: [], more: [] });
  });
});

describe('proposeDay: the load', () => {
  it('is the planned time of what it proposes against the free time, over when it does not fit', () => {
    ESTS.a = 120; ESTS.b = 120; ESTS.c = 120;
    const steps = ['a', 'b', 'c'].map((id, k) => step(id, { suit: (['S', 'D', 'C'] as const)[k]! }));
    const lunch = { id: 'lunch', at: at('12:00'), dur: 60, lead: 0 };
    const p = proposeDay(input(steps, { layout: { now: at('08:00'), floor: at('08:00'), end: at('15:00'), est: id => ESTS[id] ?? 30, fixed: [lunch] } }));
    // 7 h minus the hour at lunch = 6 h free; 6 h planned fits exactly, with the lunch in between.
    expect(p.load).toEqual({ planned: 360, free: 360, over: 0 });
    const over = proposeDay(input(steps, { layout: { now: at('08:00'), floor: at('08:00'), end: at('13:00'), est: id => ESTS[id] ?? 30, fixed: [lunch] } }));
    expect(over.load.over).toBeGreaterThan(0);
    expect(over.load.planned).toBe(360);
  });

  it('loadOf recomputes the load for the steps the person kept', () => {
    ESTS.k = 45;
    const p = input([]);
    expect(loadOf(p.layout, ['k'])).toEqual({ planned: 45, free: 660, over: 0 });
    expect(loadOf(p.layout, [])).toEqual({ planned: 0, free: 660, over: 0 });
  });

  it('is the same for the same list: it does not depend on the order the steps arrive in', () => {
    const steps = [step('a', { quad: 2 }), step('b', { quad: 4, suit: 'H' }), step('c', { quad: 1, due: TODAY, suit: 'D' })];
    expect(proposeDay(input([...steps].reverse()))).toEqual(proposeDay(input(steps)));
  });
});
