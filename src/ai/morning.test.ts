import { describe, expect, it } from 'vitest';
import { MorningReply, readMorning, swapOptions, swapItem, setSkipped, keptItems, firstKey, morningChangeSet, type Draft, type Known } from './features';
import { planChanges, type Snapshot } from './apply';
import type { Proposal } from '../domain/propose';

// A proposal: a dentist at 14:00, one step due today, a project with three steps, and the pillars (D has nothing).
const proposal: Proposal = {
  must: [{ id: 'dentist', why: 'fixed' }, { id: 'tax', why: 'dueToday' }, { id: 'mail', why: 'urgent' }, { id: 'ev1', why: 'check' }],
  mustMore: ['form'],
  goals: [{ project: 'thesis', step: 'th1', more: ['th2', 'th3'] }, { project: 'flat', step: 'fl1', more: [] }],
  moreGoals: [{ project: 'garden', step: 'ga1', more: [] }],
  here: { ids: ['buy'], more: ['post'] },
  pillars: {
    S: { pick: 'w1', more: ['w2'], covered: ['th1', 'fl1'] },
    D: { pick: null, more: [], covered: ['tax'] },
    C: { pick: 'f1', more: ['f2'], covered: [] },
    H: { pick: 'h1', more: [], covered: [] },
  },
  selected: [], load: { planned: 0, free: 0, over: 0 },
};
const known: Map<string, Known> = new Map(Object.entries({
  dentist: 'S', tax: 'D', mail: 'D', ev1: 'S', form: 'D', th1: 'S', th2: 'S', th3: 'S', fl1: 'C', ga1: 'H', buy: 'D', post: 'D', w1: 'S', w2: 'S', f1: 'C', f2: 'C', h1: 'H',
}).map(([id, suit]) => [id, { suit: suit as Known['suit'], project: id.startsWith('th') ? 'thesis' : id.startsWith('fl') ? 'flat' : id === 'ga1' ? 'garden' : 'inbox' }]));
const ids = (xs: { id: string | null }[]) => xs.map(x => x.id);

describe('the morning reply, read against the candidates', () => {
  it('with no reply the candidates are the proposal, in the five sections', () => {
    const d = readMorning(null, proposal, known);
    expect(d.must.map(m => m.id + ':' + m.why)).toEqual(['dentist:fixed', 'tax:dueToday', 'mail:urgent', 'ev1:check']);
    expect(d.must.filter(m => m.locked).map(m => m.id)).toEqual(['dentist', 'ev1']);
    expect(d.goals.map(g => g.id + '@' + g.project)).toEqual(['th1@thesis', 'fl1@flat']);
    expect(ids(d.here)).toEqual(['buy']);
    expect(Object.fromEntries(Object.entries(d.pillars).map(([k, v]) => [k, v?.id ?? null]))).toEqual({ S: 'w1', D: null, C: 'f1', H: 'h1' });
  });

  it('takes the AI’s ranking and wording, a cut it proposes, and a new step for an empty pillar', () => {
    const r = MorningReply.parse({
      note: 'A full day.',
      must: [{ id: 'mail', line: 'Due Friday' }, { id: 'tax', line: 'Due today', cut: false }],
      goals: [{ project: 'flat', id: 'fl1', line: 'The agency closes at five' }, { project: 'thesis', id: 'th2', line: 'Start in the middle' }],
      pillars: [{ suit: 'D', new: { title: 'Open the bank site and check the transfer', est: 10 }, line: 'Nothing for papers yet' }, { suit: 'C', id: 'f2', cut: true }],
      here: [{ id: 'post' }],
      first: 'mail',
    });
    const d = readMorning(r, proposal, known);
    expect(ids(d.must)).toEqual(['dentist', 'mail', 'tax', 'ev1']);
    expect(d.must[1]!.line).toBe('Due Friday');
    expect(d.goals.map(g => g.id)).toEqual(['fl1', 'th2']);
    expect(d.pillars.D).toMatchObject({ id: null, key: 'new:1', suit: 'D', step: { title: 'Open the bank site and check the transfer', est: 10 }, line: 'Nothing for papers yet' });
    expect(d.pillars.C).toMatchObject({ id: 'f2', skipped: true });
    expect(ids(d.here)).toEqual(['post']);
    expect(d.first).toBe('mail');
  });

  it('ignores ids it was not given, repeats and a second step for one project; what it leaves out falls back', () => {
    const r = MorningReply.parse({
      must: [{ id: 'ghost' }, { id: 'tax' }, { id: 'tax' }],
      goals: [{ project: 'thesis', id: 'th9' }, { project: 'thesis', id: 'th3' }, { project: 'thesis', id: 'th2' }, { project: 'nowhere', id: 'th1' }],
      pillars: [{ suit: 'S', id: 'fl1' }],
      here: [{ id: 'th1' }],
      first: 'ghost',
    });
    const d = readMorning(r, proposal, known);
    // "ghost" is dropped; the steps it left out come back after its own.
    expect(ids(d.must)).toEqual(['dentist', 'tax', 'mail', 'ev1']);
    // thesis: th9 is not a thesis step (the project gets its first step instead), a second line for the project is ignored, a project it was not given is too.
    expect(d.goals.map(g => g.project + ':' + g.id)).toEqual(['thesis:th1']);
    // Not a candidate for that pillar or section: the candidate stands.
    expect(d.pillars.S?.id).toBe('w1');
    expect(ids(d.here)).toEqual(['buy']);
    expect(d.first).toBeNull();
  });

  it('the fixed items and the events to check stay, whatever the AI sends', () => {
    const d = readMorning(MorningReply.parse({ must: [{ id: 'dentist', cut: true }, { id: 'ev1' }] }), proposal, known);
    expect(d.must.filter(m => m.locked).map(m => [m.id, m.skipped])).toEqual([['dentist', false], ['ev1', false]]);
  });

  it('a step skipped on an earlier turn is not offered again', () => {
    const d = readMorning(null, proposal, known, new Set(['mail', 'f1']));
    expect(ids(d.must)).toEqual(['dentist', 'tax', 'ev1']);
    expect(d.pillars.C).toBeNull();
  });

  it('a garbled reply is not a reply: the schema keeps what is valid and drops the rest', () => {
    const r = MorningReply.parse({ must: 'nope', goals: [{ project: 7, id: 5 }], pillars: [{ suit: 'X', id: 'f1' }], note: 12 });
    expect(r.must).toBeUndefined();
    expect(() => readMorning(r, proposal, known)).not.toThrow();
  });
});

describe('keep, swap, skip', () => {
  const d0 = readMorning(null, proposal, known);
  it('swaps a pillar for another candidate of the same pillar, not one already in the draft', () => {
    const opts = swapOptions(d0, 'pillars', d0.pillars.C!, proposal);
    expect(opts).toEqual([{ id: 'f2' }]);
    const d = swapItem(d0, 'f1', opts[0]!, known);
    expect(d.pillars.C).toMatchObject({ id: 'f2', key: 'f2', suit: 'C', skipped: false });
    expect(swapOptions(d, 'pillars', d.pillars.C!, proposal)).toEqual([{ id: 'f1' }]);
  });

  it('swaps a goal’s first step for another step of the project, or for another project’s', () => {
    const opts = swapOptions(d0, 'goals', d0.goals[0]!, proposal);
    expect(opts).toEqual([{ id: 'th2', project: 'thesis' }, { id: 'th3', project: 'thesis' }, { id: 'ga1', project: 'garden' }]);
    const d1 = swapItem(d0, 'th1', opts[0]!, known);
    expect(d1.goals.map(g => g.project + ':' + g.id)).toEqual(['thesis:th2', 'flat:fl1']);
    const d2 = swapItem(d0, 'th1', opts[2]!, known);
    expect(d2.goals[0]).toMatchObject({ project: 'garden', id: 'ga1', suit: 'H' });
  });

  it('swaps a due step for one that did not fit; a fixed item cannot be skipped or swapped', () => {
    expect(swapOptions(d0, 'must', d0.must[1]!, proposal)).toEqual([{ id: 'form' }]);
    expect(setSkipped(d0, 'dentist', true).must[0]!.skipped).toBe(false);
    expect(setSkipped(d0, 'tax', true).must[1]!.skipped).toBe(true);
    expect(setSkipped(setSkipped(d0, 'tax', true), 'tax', false).must[1]!.skipped).toBe(false);
  });

  it('keeps the first the AI chose while it is kept, then the first step that is', () => {
    const d = { ...d0, first: 'mail' };
    expect(firstKey(d)).toBe('mail');
    expect(firstKey(setSkipped(d, 'mail', true))).toBe('tax');
    expect(keptItems(setSkipped(d, 'mail', true)).map(i => i.key)).toEqual(['tax', 'th1', 'fl1', 'buy', 'w1', 'f1', 'h1']);
  });
});

describe('the change-set the morning ends in', () => {
  const full: Draft = readMorning(MorningReply.parse({
    note: 'Dentist, the tax, one thesis step.',
    pillars: [{ suit: 'D', new: { title: 'Open the bank site and check the transfer', starter: 'Open the bank site', est: 10 } }],
    goals: [{ project: 'thesis', id: 'th1' }, { project: 'flat', id: 'fl1' }],
    split: [{ id: 'th1', steps: [{ title: 'Open the draft and read the last page', est: 5 }, { title: 'Write the next paragraph', est: 20 }] }],
    first: 'th1',
  }), proposal, known);
  const ctx = { date: '2026-11-02', existing: ['old', 'dentist', 'tax'], known: new Map([['th1', { project: 'thesis' }]]) };

  it('creates the new steps and splits the big one, then one day.update with the plan, the first step leading', () => {
    const cs = morningChangeSet(full, ctx)!;
    expect(cs.note).toBe('Dentist, the tax, one thesis step.');
    const ops = cs.changes.map(c => c.op);
    expect(ops).toEqual(['task.create', 'task.update', 'task.create', 'day.update']);
    expect(cs.changes[0]).toMatchObject({ op: 'task.create', ref: 'n1', set: { title: 'Open the bank site and check the transfer', suit: 'D', project: 'inbox', important: true, starter: 'Open the bank site' } });
    const day = cs.changes[3] as { plan: string[]; first: string };
    expect(day.first).toBe('th1');
    // The list it already had stays where it is (old, the dentist) unless the step was in the draft; then the first, and the sections in order.
    expect(day.plan).toEqual(['old', 'dentist', 'th1', 'tax', 'mail', 'fl1', 'buy', 'w1', 'n1', 'f1', 'h1']);
  });

  it('leaves out what the person skipped and takes a skipped step off the list it was on', () => {
    const d = setSkipped(setSkipped(full, 'tax', true), 'f1', true);
    const cs = morningChangeSet(d, ctx)!;
    const day = cs.changes.at(-1) as { plan: string[] };
    expect(day.plan).not.toContain('tax');
    expect(day.plan).not.toContain('f1');
    expect(day.plan).toContain('dentist');
  });

  it('a new step that is skipped is not created', () => {
    const d = setSkipped(full, 'new:1', true);
    expect(JSON.stringify(morningChangeSet(d, ctx))).not.toContain('bank site');
  });

  it('is nothing when nothing is kept', () => {
    let d = full;
    for (const i of keptItems(full)) d = setSkipped(d, i.key, true);
    expect(morningChangeSet(d, ctx)).toBeNull();
  });

  it('is a valid change-set for the review: the new step is created, then put on the day and first', () => {
    const snap: Snapshot = {
      today: '2026-11-02',
      tasks: new Map(['old', 'dentist', 'tax', 'mail', 'th1', 'fl1', 'buy', 'w1', 'f1', 'h1'].map(id => [id, { id, title: id, project: 'inbox', suit: 'S', status: 'open', kind: 'task' } as never])),
      projects: new Map([['inbox', { id: 'inbox', name: 'Inbox', suit: 'S', where: 'any', status: 'active' } as never]]),
      days: new Map([['2026-11-02', { id: '2026-11-02', date: '2026-11-02', plan: ['old', 'dentist', 'tax'], launches: [], first: null, checkin: null, closed: null, summary: null } as never]]),
      decisions: new Map(), places: new Map(), stays: new Map(), memory: new Map(),
    };
    const p = planChanges(morningChangeSet(full, ctx)!, snap, { id: (x: string) => x + '1', now: () => '2026-11-02T08:00:00Z', zone: 'Europe/Paris' });
    const day = p.items.find(i => i.target === 'day')!;
    expect(day).toBeTruthy();
    expect(day.diffs.map(x => x.field)).toEqual(['plan', 'first']);
    expect(p.items.filter(i => i.kind === 'create').map(i => i.title)).toContain('Open the bank site and check the transfer');
  });
});
