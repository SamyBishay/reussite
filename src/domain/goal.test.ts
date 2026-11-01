import { describe, expect, it } from 'vitest';
import { movedOn, addMilestone, advancing, amountOf, goalFieldsFor, goalLines, measureOf, measureText, mergeMilestones, offerFor, outcomeOf, progressOf, readMeasure, sameMeasure, startOf, tickMilestone } from './goal';
import type { Measure } from '../data/schema';

const step = (o: Record<string, unknown> = {}) => ({ id: 's', project: 'p', status: 'open', advances: true, ...o }) as never;

describe('reading a measure', () => {
  it('missing, broken or unknown measures are "none"', () => {
    for (const m of [undefined, null, 5, 'count', {}, { kind: 'bars' }, { kind: 'count' }, { kind: 'count', target: 0 }, { kind: 'count', target: -3 }, { kind: 'count', target: 'x' }]) expect(readMeasure(m)).toEqual({ kind: 'none' });
  });
  it('reads a count, with a trimmed unit', () => {
    expect(readMeasure({ kind: 'count', target: 12, unit: '  pages ' })).toEqual({ kind: 'count', target: 12, unit: 'pages' });
    expect(readMeasure({ kind: 'count', target: '4' })).toEqual({ kind: 'count', target: 4, unit: '' });
  });
  it('reads milestones, skipping empty ones and giving ids to those without', () => {
    expect(readMeasure({ kind: 'milestones', items: [{ id: 'a', text: 'Draft', done: '2026-10-01' }, { text: '  ' }, { text: 'Filed', done: 'soon' }, 'x', null, { id: 'a', text: 'Dup' }] })).toEqual({
      kind: 'milestones', items: [{ id: 'a', text: 'Draft', done: '2026-10-01' }, { id: 'm3', text: 'Filed', done: null }, { id: 'a_', text: 'Dup', done: null }],
    });
  });
  it('measureOf reads the project, and a project with none has none', () => {
    expect(measureOf({})).toEqual({ kind: 'none' });
    expect(measureOf(undefined)).toEqual({ kind: 'none' });
  });
});

describe('the outcome', () => {
  it('is the outcome; the old goal stands in only while there is no outcome field', () => {
    expect(outcomeOf({ goal: 'Old', outcome: 'New' })).toBe('New');
    expect(outcomeOf({ goal: 'Old' })).toBe('Old');
    expect(outcomeOf({ goal: 'Old', outcome: null })).toBe('');
    expect(outcomeOf({ goal: null })).toBe('');
    expect(outcomeOf({ goal: '  spaced ' })).toBe('spaced');
  });
  it('the start is the one set, else the creation day', () => {
    expect(startOf({ start: '2026-10-01', created: '2026-01-01T00:00:00.000Z' })).toBe('2026-10-01');
    expect(startOf({ created: '2026-01-05T08:00:00.000Z' })).toBe('2026-01-05');
    expect(startOf({})).toBeNull();
  });
});

describe('which steps move a bar', () => {
  it('only advances: true, and not a standing or waited-for step', () => {
    expect(advancing(step())).toBe(true);
    for (const o of [{ advances: false }, { advances: null }, { advances: undefined }, { template: true }, { kind: 'event' }]) expect(advancing(step(o))).toBe(false);
  });
  it('a step adds 1 unless it says otherwise', () => {
    expect(amountOf({})).toBe(1);
    expect(amountOf({ advanceBy: 0 })).toBe(1);
    expect(amountOf({ advanceBy: -2 })).toBe(1);
    expect(amountOf({ advanceBy: 2.5 })).toBe(2.5);
    expect(amountOf({ advanceBy: null })).toBe(1);
  });
});

describe('progress', () => {
  const count = { id: 'p', measure: { kind: 'count', target: 10, unit: 'pages' } };
  it('no measure, no bar', () => {
    expect(progressOf({ id: 'p' }, [step({ status: 'done' })])).toBeNull();
    expect(progressOf({ id: 'p', measure: { kind: 'none' } }, [step({ status: 'done' })])).toBeNull();
  });
  it('a count adds the amount of every done advancing step of the project, and nothing else', () => {
    const steps = [
      step({ id: '1', status: 'done' }), step({ id: '2', status: 'done', advanceBy: 4 }),
      step({ id: '3', status: 'open', advanceBy: 9 }), // not done
      step({ id: '4', status: 'done', advances: false }), step({ id: '5', status: 'done', advances: null }), step({ id: '6', status: 'done', advances: undefined }),
      step({ id: '7', status: 'dropped' }), step({ id: '8', status: 'done', project: 'other' }), step({ id: '9', status: 'done', template: true }),
    ];
    const pr = progressOf(count, steps)!;
    expect(pr).toMatchObject({ kind: 'count', value: 5, max: 10, frac: 0.5, unit: 'pages', reached: false });
  });
  it('card counts never feed it: ten done steps that do not advance leave the bar at zero', () => {
    const steps = Array.from({ length: 10 }, (_, i) => step({ id: 'x' + i, status: 'done', advances: i % 2 ? false : null }));
    expect(progressOf(count, steps)!.value).toBe(0);
  });
  it('a count is capped at the target for the bar, and says it is reached', () => {
    const pr = progressOf(count, [step({ status: 'done', advanceBy: 12 })])!;
    expect(pr).toMatchObject({ value: 12, frac: 1, reached: true });
  });
  it('fractions add up cleanly', () => {
    expect(progressOf(count, [step({ id: 'a', status: 'done', advanceBy: 0.1 }), step({ id: 'b', status: 'done', advanceBy: 0.2 })])!.value).toBe(0.3);
  });
  it('milestones: the ticked over all, the open in order', () => {
    const p = { id: 'p', measure: { kind: 'milestones', items: [{ id: 'a', text: 'A', done: '2026-10-01' }, { id: 'b', text: 'B', done: null }, { id: 'c', text: 'C', done: null }] } };
    expect(progressOf(p, [step({ status: 'done' })])).toMatchObject({ kind: 'milestones', value: 1, max: 3, reached: false, open: [{ id: 'b' }, { id: 'c' }] });
    expect(progressOf(p, [])!.frac).toBeCloseTo(1 / 3);
    expect(progressOf({ id: 'p', measure: { kind: 'milestones', items: [] } }, [])).toMatchObject({ value: 0, max: 0, frac: 0, reached: false });
  });
});

describe('what finishing a step offers', () => {
  const ms = (open: boolean) => ({ measure: { kind: 'milestones', items: [{ id: 'a', text: 'A', done: open ? null : '2026-10-01' }] } });
  it('a count asks for the amount; milestones for one to tick, while some are open', () => {
    expect(offerFor(step(), { measure: { kind: 'count', target: 3, unit: '' } })).toBe('count');
    expect(offerFor(step(), ms(true))).toBe('milestones');
    expect(offerFor(step(), ms(false))).toBeNull();
  });
  it('nothing for a step that does not advance, a project with no bar, or no project', () => {
    expect(offerFor(step({ advances: null }), ms(true))).toBeNull();
    expect(offerFor(step({ advances: false }), { measure: { kind: 'count', target: 3, unit: '' } })).toBeNull();
    expect(offerFor(step(), { measure: { kind: 'none' } })).toBeNull();
    expect(offerFor(step(), undefined)).toBeNull();
  });
});

describe('editing milestones', () => {
  const m: Measure = { kind: 'milestones', items: [{ id: 'a', text: 'Draft', done: null }, { id: 'b', text: 'Filed', done: '2026-10-02' }] };
  it('tick and untick by id; another measure is returned as it is', () => {
    expect(tickMilestone(m, 'a', '2026-10-05')).toMatchObject({ items: [{ id: 'a', done: '2026-10-05' }, { id: 'b', done: '2026-10-02' }] });
    expect(tickMilestone(m, 'b', null)).toMatchObject({ items: [{ id: 'a', done: null }, { id: 'b', done: null }] });
    expect(tickMilestone(m, 'zz', '2026-10-05')).toEqual(m);
    const c: Measure = { kind: 'count', target: 2, unit: '' };
    expect(tickMilestone(c, 'a', 'x')).toBe(c);
  });
  it('adds one at the end, trimmed; nothing for empty text', () => {
    expect(addMilestone(m, 'c', '  Sent  ')).toMatchObject({ items: [{}, {}, { id: 'c', text: 'Sent', done: null }] });
    expect(addMilestone(m, 'c', '  ')).toBe(m);
  });
  it('a list from words keeps the id and the tick of a matching text (any case), and drops what is left out', () => {
    let n = 0;
    const out = mergeMilestones(m, [{ text: 'filed' }, { text: 'New one' }, { text: 'Draft', done: true }], '2026-10-09', () => 'n' + ++n);
    expect(out).toEqual({ kind: 'milestones', items: [{ id: 'b', text: 'Filed', done: '2026-10-02' }, { id: 'n1', text: 'New one', done: null }, { id: 'a', text: 'Draft', done: '2026-10-09' }] });
  });
  it('done: false opens one again, a day sets the day, true keeps an earlier tick', () => {
    const out = mergeMilestones(m, [{ text: 'Draft', done: '2026-09-30' }, { text: 'Filed', done: false }], '2026-10-09', () => 'x');
    expect(out).toMatchObject({ items: [{ id: 'a', done: '2026-09-30' }, { id: 'b', done: null }] });
    expect(mergeMilestones(m, [{ text: 'Filed', done: true }], '2026-10-09', () => 'x')).toMatchObject({ items: [{ id: 'b', done: '2026-10-02' }] });
  });
  it('a list over an existing count or none starts from nothing', () => {
    expect(mergeMilestones({ kind: 'none' }, [{ text: 'One' }], '2026-10-09', () => 'q')).toEqual({ kind: 'milestones', items: [{ id: 'q', text: 'One', done: null }] });
  });
  it('sameMeasure ignores what a read would ignore', () => {
    expect(sameMeasure({ kind: 'none' }, undefined as never)).toBe(true);
    expect(sameMeasure(m, structuredClone(m))).toBe(true);
    expect(sameMeasure(m, tickMilestone(m, 'a', '2026-10-05'))).toBe(false);
  });
});

describe('the words an AI reads', () => {
  const p = { id: 'p', goal: 'Old', outcome: 'Hand in the thesis', measure: { kind: 'count', target: 10, unit: 'pages' }, created: '2026-09-01T00:00:00.000Z' };
  const steps = [step({ id: 's1', title: 'Write intro', status: 'done', advanceBy: 3 }), step({ id: 's2', title: 'Write methods' }), step({ id: 's3', advances: false, title: 'Email' })];
  it('says the outcome, the measure, the start and the steps that move it', () => {
    expect(goalLines(p, steps, s => s)).toEqual(['goal: Hand in the thesis', 'measure: count, 3 of 10 pages', 'starts: 2026-09-01', 'moves the goal: s2 Write methods']);
  });
  it('a project with no bar says so; older done steps are mentioned for a count only', () => {
    expect(goalLines({ id: 'p', goal: null }, [], s => s)).toEqual(['goal: -', 'measure: none (no bar)']);
    expect(goalLines(p, steps, s => s, true)[1]).toContain('older done steps not counted');
    expect(goalLines({ id: 'p', goal: null }, [], s => s, true)[1]).toBe('measure: none (no bar)');
  });
  it('milestones list what is done and what is open', () => {
    expect(measureText({ id: 'p', measure: { kind: 'milestones', items: [{ id: 'a', text: 'A', done: '2026-10-01' }, { id: 'b', text: 'B', done: null }] } }, [])).toBe('milestones, 1 of 2 (done: A; open: B)');
  });
});

describe('the migration helper', () => {
  it('copies a goal, leaves none as null, and takes the start from the creation date', () => {
    expect(goalFieldsFor({ goal: 'Sing', created: '2026-03-04T10:00:00.000Z' })).toEqual({ outcome: 'Sing', measure: { kind: 'none' }, start: '2026-03-04' });
    expect(goalFieldsFor({ goal: '  ' })).toEqual({ outcome: null, measure: { kind: 'none' }, start: null });
    expect(goalFieldsFor({ goal: null, created: 5 })).toEqual({ outcome: null, measure: { kind: 'none' }, start: null });
  });
});

describe('the bars that moved on a day', () => {
  const day = '2026-11-02';
  const cnt = { id: 'a', name: 'Thesis', order: 2, measure: { kind: 'count', target: 10, unit: 'pages' } };
  const ms = { id: 'b', name: 'Lease', order: 1, measure: { kind: 'milestones', items: [{ id: 'm1', text: 'Sent', done: day }, { id: 'm2', text: 'Filed', done: '2026-10-30' }, { id: 'm3', text: 'Paid', done: null }] } };
  it('a count moves by the advancing steps done that day, by their amount', () => {
    const got = movedOn([cnt], [step({ project: 'a', status: 'done', doneDay: day, advanceBy: 3 }), step({ project: 'a', status: 'done', doneDay: '2026-11-01' }), step({ project: 'a', status: 'done', doneDay: day, advances: false }), step({ project: 'a', status: 'open' })], day);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ id: 'a', gain: 3 });
    expect(got[0]!.progress.value).toBe(4);
  });
  it('milestones move by the ones ticked that day; the projects come in their order', () => {
    const got = movedOn([cnt, ms], [step({ project: 'a', status: 'done', doneDay: day })], day);
    expect(got.map(x => [x.id, x.gain])).toEqual([['b', 1], ['a', 1]]);
  });
  it('no bar, nothing done today, open steps or a closed project give nothing', () => {
    expect(movedOn([{ id: 'n', name: 'N' }], [step({ project: 'n', status: 'done', doneDay: day })], day)).toEqual([]);
    expect(movedOn([cnt], [step({ project: 'a', status: 'open' })], day)).toEqual([]);
    expect(movedOn([{ ...cnt, status: 'done' }], [step({ project: 'a', status: 'done', doneDay: day })], day)).toEqual([]);
    expect(movedOn([ms], [], '2026-11-03')).toEqual([]);
  });
});
