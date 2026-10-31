// The Sunday review's goals with an AI (plan 2 Nov, S7): the reply read against the project, what the person's taps change, the
// change-set that comes out, and the request that goes in. Nothing here writes.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { tasks, projects, memory } from '../app/store';
import { GoalReviewReply, readGoalReview, goalReviewChangeSet, setMoves, setPropSkipped, setDropSkipped, setAddSkipped, sameProposal, type GoalNow } from './features';
import { goalReviewPrompt } from './prompts';
import type { Task } from '../data/schema';

const now = (o: Partial<GoalNow> = {}): GoalNow => ({
  id: 'p1', outcome: 'Hand in the draft', measure: { kind: 'none' }, start: '2026-10-01', due: '2026-12-15',
  steps: [{ id: 's1', advances: true }, { id: 's2', advances: false }, { id: 's3', advances: false }], ...o,
});
const adv = new Map([['s1', true], ['s2', false], ['s3', false]]);

describe('the reply read against the project', () => {
  it('keeps only what changes something: a reworded outcome, a new measure, other dates', () => {
    const d = readGoalReview({
      outcome: 'Hand in the full draft by 15 December', measure: { kind: 'count', target: 10, unit: 'pages' }, start: '2026-10-01', due: '2026-12-10',
    }, now());
    expect(d.props.map(p => p.key)).toEqual(['outcome', 'measure', 'due']);
    // The same outcome, the same measure and the same dates are not proposals.
    const same = readGoalReview({ outcome: ' Hand in the draft ', measure: { kind: 'none' }, start: '2026-10-01', due: '2026-12-15' }, now());
    expect(same.props).toEqual([]);
  });

  it('knows a measure that says the same thing, ids and ticks aside', () => {
    const cur = { kind: 'milestones' as const, items: [{ id: 'm1', text: 'Draft sent', done: '2026-10-20' }, { id: 'm2', text: 'Filed', done: null }] };
    expect(sameProposal({ kind: 'milestones', items: [{ text: 'draft sent', done: undefined }, { text: 'Filed', done: undefined }] }, cur)).toBe(true);
    expect(sameProposal({ kind: 'milestones', items: [{ text: 'Draft sent', done: undefined }] }, cur)).toBe(false);
    expect(sameProposal({ kind: 'count', target: 10, unit: 'pages' }, { kind: 'count', target: 10, unit: 'pages' })).toBe(true);
    expect(sameProposal({ kind: 'count', target: 12, unit: 'pages' }, { kind: 'count', target: 10, unit: 'pages' })).toBe(false);
    expect(sameProposal({ kind: 'none' }, { kind: 'none' })).toBe(true);
  });

  it('gives every open step an answer: the AI’s, else the one it has; a step that does not belong cannot move the goal', () => {
    const d = readGoalReview({ steps: [
      { id: 's2', belongs: true, moves: true, line: 'Page one is a page' },
      { id: 's3', belongs: false, moves: true, line: 'Unrelated' },
      { id: 'ghost', belongs: true, moves: true },
    ] }, now());
    expect(d.steps.map(s => [s.id, s.moves, s.belongs])).toEqual([['s1', true, null], ['s2', true, true], ['s3', false, false]]);
    expect(d.steps[1]!.line).toBe('Page one is a page');
  });

  it('drops an id it was not given, repeats and more than three new steps', () => {
    const d = readGoalReview({
      drop: [{ id: 's3', line: 'no longer serves it' }, { id: 's3' }, { id: 'ghost' }],
      add: [1, 2, 3, 4].map(n => ({ title: 'Open the draft, part ' + n, moves: n === 1 })) as never,
    }, now());
    expect(d.drops.map(x => x.id)).toEqual(['s3']);
    expect(d.adds.map(x => [x.key, x.moves])).toEqual([['new:1', true], ['new:2', false], ['new:3', false]]);
  });

  it('with no reply the steps are there to answer by hand, with nothing proposed', () => {
    const d = readGoalReview(null, now());
    expect(d.props).toEqual([]);
    expect(d.steps.map(s => s.moves)).toEqual([true, false, false]);
    expect(goalReviewChangeSet([d], adv)).toBeNull();
  });

  it('the schema survives a half-wrong reply and drops the app’s own words from the AI’s lines', () => {
    const r = GoalReviewReply.parse({ note: 'Each card moves it.', check: [{ part: 'outcome', ok: 'maybe', line: 'vague' }, { part: 'x', ok: true }], steps: [{ id: 5, moves: 'yes' }], measure: { kind: 'count', target: 'ten' }, due: 'soon' });
    expect(r.note).toBe('');
    expect(r.steps).toEqual([{ id: '5', belongs: undefined, moves: undefined, line: undefined }]);
    expect(r.measure).toBeUndefined();
    expect(r.due).toBeUndefined();
  });
});

describe('what the taps change, and the one change-set', () => {
  const reply = {
    outcome: 'Hand in the full draft by 15 December', measure: { kind: 'count' as const, target: 10, unit: 'pages' },
    steps: [{ id: 's1', moves: true }, { id: 's2', belongs: true, moves: true }, { id: 's3', belongs: true, moves: false }],
    drop: [{ id: 's3', line: 'Done elsewhere' }], add: [{ title: 'Open the draft and write page one', est: 20, moves: true }],
  };
  const draft = () => readGoalReview(reply, now());
  const ops = (cs: ReturnType<typeof goalReviewChangeSet>) => cs!.changes.map(c => c.op + ':' + ('id' in c ? c.id : 'ref' in c ? c.ref : ''));

  it('writes only the proposals kept and the answers that differ from the stored ones', () => {
    const cs = goalReviewChangeSet([draft()], adv)!;
    expect(ops(cs)).toEqual(['project.update:p1', 'task.update:s2', 'task.drop:s3', 'task.create:gp1-1']);
    expect(cs.changes[0]).toMatchObject({ set: { outcome: 'Hand in the full draft by 15 December', measure: { kind: 'count', target: 10, unit: 'pages' } } });
    expect(cs.changes[1]).toMatchObject({ set: { advances: true } });
    expect(cs.changes[3]).toMatchObject({ set: { title: 'Open the draft and write page one', project: 'p1', advances: true, est: 20 } });
  });

  it('flipping an answer, or skipping a proposal, takes it out; flipping back puts it as it was', () => {
    let d = draft();
    d = setMoves(d, 's2', false);
    d = setPropSkipped(d, 'measure', true);
    d = setDropSkipped(d, 's3', true);
    d = setAddSkipped(d, 'new:1', true);
    expect(ops(goalReviewChangeSet([d], adv))).toEqual(['project.update:p1']);
    expect((goalReviewChangeSet([d], adv)!.changes[0] as { set: object }).set).toEqual({ outcome: 'Hand in the full draft by 15 December' });
    // A step flipped to "does not move it" when it did: one update says so.
    d = setMoves(d, 's1', false);
    expect(goalReviewChangeSet([d], adv)!.changes.find(c => c.op === 'task.update')).toMatchObject({ id: 's1', set: { advances: false } });
    // A new step's answer flips by its key.
    d = setAddSkipped(d, 'new:1', false);
    d = setMoves(d, 'new:1', false);
    expect(goalReviewChangeSet([d], adv)!.changes.find(c => c.op === 'task.create')).toMatchObject({ set: { project: 'p1' } });
    expect(JSON.stringify(goalReviewChangeSet([d], adv)!.changes.find(c => c.op === 'task.create'))).not.toContain('advances');
  });

  it('a step to drop gets no answer written, and nothing left to change is no change-set', () => {
    const d = setDropSkipped(draft(), 's3', false);
    expect(goalReviewChangeSet([setMoves(d, 's3', true)], adv)!.changes.some(c => c.op === 'task.update' && c.id === 's3')).toBe(false);
    expect(goalReviewChangeSet([readGoalReview({ steps: [{ id: 's1', moves: true }] }, now())], adv)).toBeNull();
  });

  it('puts every project’s choices in one change-set, with the AI’s notes', () => {
    const a = readGoalReview({ note: 'First holds.', outcome: 'A clearer goal' }, now());
    const b = readGoalReview({ note: 'Second is vague.', steps: [{ id: 'q1', moves: true }] }, now({ id: 'p2', steps: [{ id: 'q1', advances: false }] }));
    const cs = goalReviewChangeSet([a, b], new Map([...adv, ['q1', false]]))!;
    expect(ops(cs)).toEqual(['project.update:p1', 'task.update:q1']);
    expect(cs.note).toBe('First holds. Second is vague.');
  });
});

describe('the request', () => {
  const task = (id: string, o: Partial<Task> = {}): Task & { id: string } => ({
    id, title: 'Open the draft ' + id, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 20, est0: null, estBy: 'me',
    status: 'open', doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: Number(id.replace(/\D/g, '')) || 1, created: '', ...o,
  });
  tasks.value = new Map([
    task('s1', { advances: true }), task('s2', { advances: false }), task('s3'), task('d1', { status: 'done', advances: true }),
    task('w1', { kind: 'event' }), task('t1', { template: true }), task('o1', { project: 'p2' }),
  ].map(x => [x.id, x]));
  projects.value = new Map([
    ['p1', { id: 'p1', name: 'Thesis', suit: 'S', where: 'any', goal: 'Hand in the draft', goalBy: null, outcome: 'Hand in the draft', measure: { kind: 'count', target: 10, unit: 'pages' }, start: '2026-10-01', due: '2026-12-15', order: 1, status: 'active' }],
    ['p2', { id: 'p2', name: 'Flat', suit: 'C', where: 'any', goal: null, goalBy: null, due: null, order: 2, status: 'active' }],
  ] as never);
  memory.value = new Map();

  it('names the goal, how it is measured, and each open step of this project with its present answer', () => {
    const { system, user } = goalReviewPrompt('p1');
    expect(user).toContain('Project p1: Thesis (active)');
    expect(user).toContain('goal: Hand in the draft');
    expect(user).toContain('measure: count, 1 of 10 pages');
    expect(user).toMatch(/^s1 \| Open the draft s1 \|.* \| moves the goal$/m);
    expect(user).toMatch(/^s2 \|.* \| does not move it$/m);
    expect(user).toMatch(/^s3 \|.* \| not said$/m);
    // Not another project’s step, a done one, something waited for or a standing step.
    for (const gone of ['o1', 'd1 |', 'w1 |', 't1 |']) expect(user).not.toContain(gone);
    expect(user).toContain('1 steps done, 3 open');
  });

  it('asks it to propose, not to question, and to keep the app’s words out', () => {
    const { system } = goalReviewPrompt('p1');
    expect(system.rest).toContain('do not ask open questions');
    expect(system.rest).toContain('never the words "card" or "suit"');
    expect(system.rest).toContain('"belongs"');
    expect(system.rest).toContain('"moves"');
  });

  it('a later turn carries what was skipped, how the steps stand and what the person said', () => {
    const { user } = goalReviewPrompt('p1', { message: 'Make it smaller', skipped: ['measure', 'drop s3'], answers: ['s1 moves it', 's2 does not move it'] });
    expect(user).toContain('never offer them again: measure, drop s3.');
    expect(user).toContain('s1 moves it; s2 does not move it');
    expect(user).toContain('They say: Make it smaller');
  });
});
