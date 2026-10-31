import { describe, expect, it } from 'vitest';
import { chainIndex, isWaiting, nextHeads } from './chains';
import { finishEffects, newTaskFields, projectCompletes } from './effects';
import { liveNextHeads, nudgeAfter, nudgesDue, snoozeNudge, toEventFields, waitingList } from './events';
import { dayOrder } from './dayOrder';
import { blocked, estPointsOf, fixedOn, isEvent, isOpen, planOf, stepLine, type TaskW } from './lists';

const mk = (id: string, p: Partial<TaskW> = {}): [string, TaskW] => [id, { ...newTaskFields(id, 'S', 'p1', {}, new Map(), '2026-10-20T08:00:00.000Z', 1), id, ...p } as TaskW];
const ev = (id: string, p: Partial<TaskW> = {}) => mk(id, { kind: 'event', important: false, ...p });
const map = (...a: [string, TaskW][]) => new Map(a);
const TODAY = '2026-10-31';

describe('a dormant event', () => {
  it('is not open work: not in isOpen, a day’s list, the day’s order or the fixed-time items', () => {
    const e = ev('e')[1];
    expect(isEvent(e)).toBe(true);
    expect(isOpen(e)).toBe(false);
    expect(isOpen(mk('t')[1])).toBe(true);
    const tasks = map(ev('e', { at: '09:00', due: '2026-10-31' }), mk('a'));
    const d = { days: new Map([['2026-10-31', { plan: ['e', 'a'] } as never]]), tasks };
    expect(planOf(d, '2026-10-31')).toEqual(['a']);
    expect(fixedOn(d, '2026-10-31')).toEqual([]);
    const order = (ids: string[]) => dayOrder({ now: 0, floor: 0, end: 1e12, cards: ids.filter(id => isOpen(tasks.get(id))), est: () => null, fixed: [] }).order.map(x => x.id);
    expect(order(planOf(d, '2026-10-31'))).toEqual(['a']);
    expect(order(['e'])).toEqual([]);
  });

  it('is kept out of the estimates even with a stray frozen estimate', () => {
    const e = ev('e', { status: 'done', doneDay: '2026-10-30', est0: 30 })[1];
    const t = mk('t', { status: 'done', doneDay: '2026-10-30', est0: 30 })[1];
    const pts = estPointsOf([e, t], [{ taskId: 'e', m: 20, source: 'timer' }, { taskId: 't', m: 20, source: 'timer' }]);
    expect(pts.map(p => p.id)).toEqual(['t']);
  });

  it('made from a step has no estimate, starter, time, due date, quadrant, standing or repeat', () => {
    const p = toEventFields();
    expect(p).toMatchObject({ kind: 'event', est: null, est0: null, estBy: null, starter: null, due: null, dueRule: null, at: null, dur: null, lead: null, weekdays: null, repeat: null, urgent: false, important: false, template: false });
    // The event keeps everything it was given besides these (the title, the project, a note).
    expect(Object.keys(p)).not.toContain('title');
    expect(Object.keys(p)).not.toContain('note');
  });
});

describe('what a step waits for', () => {
  it('an open event holds the step back; the step is freed when it is done or dropped', () => {
    const tasks = map(ev('e'), mk('b', { after: 'e' }));
    expect(blocked(tasks.get('b')!, tasks)).toBe(true);
    expect(isWaiting(chainIndex(tasks), 'b')).toBe(true);
    for (const status of ['done', 'dropped'] as const) {
      const after = map(ev('e', { status }), mk('b', { after: 'e' }));
      expect(blocked(after.get('b')!, after)).toBe(false);
      expect(isWaiting(chainIndex(after), 'b')).toBe(false);
    }
  });

  it('a successor unlocks only when ALL its predecessors, events and tasks, are resolved', () => {
    // b waits for the task a and the event e (a is the first in order, so the chain is e, then b).
    const open = map(mk('a', { order: 1 }), ev('e', { order: 2 }), mk('b', { after: ['a', 'e'], order: 3 }));
    // The event happens first: a task is still open, so b stays behind it.
    expect(liveNextHeads(open, 'e')).toEqual([]);
    const afterE = map(mk('a', { order: 1 }), ev('e', { order: 2, status: 'done', doneDay: TODAY }), mk('b', { after: ['a', 'e'], order: 3 }));
    expect(isWaiting(chainIndex(afterE), 'b')).toBe(true);
    // Then the task is done: b is freed.
    expect(liveNextHeads(afterE, 'a')).toEqual(['b']);
    // The other way round: the task first, the event last.
    const afterA = map(mk('a', { order: 1, status: 'done' }), ev('e', { order: 2 }), mk('b', { after: ['a', 'e'], order: 3 }));
    expect(liveNextHeads(afterA, 'e')).toEqual(['b']);
  });

  it('with two events, the step is freed by the one that happens last', () => {
    const open = map(ev('e1', { order: 1 }), ev('e2', { order: 2 }), mk('b', { after: ['e1', 'e2'], order: 3 }));
    expect(liveNextHeads(open, 'e1')).toEqual([]);
    expect(liveNextHeads(open, 'e2')).toEqual([]);
    expect(liveNextHeads(map(ev('e1', { order: 1, status: 'done' }), ev('e2', { order: 2 }), mk('b', { after: ['e1', 'e2'], order: 3 })), 'e2')).toEqual(['b']);
    expect(liveNextHeads(map(ev('e1', { order: 1 }), ev('e2', { order: 2, status: 'done' }), mk('b', { after: ['e1', 'e2'], order: 3 })), 'e1')).toEqual(['b']);
  });

  it('a task that comes before an event does not free the event as a step: it stays dormant', () => {
    const tasks = map(mk('a', { order: 1 }), ev('e', { order: 2, after: 'a' }), mk('b', { order: 3, after: 'e' }));
    expect(nextHeads(tasks, 'a')).toEqual(['e']);
    expect(liveNextHeads(tasks, 'a')).toEqual([]);
    // Once the event has happened, the step that waited for it is the live head.
    expect(liveNextHeads(map(mk('a', { order: 1, status: 'done' }), ev('e', { order: 2, after: 'a' }), mk('b', { order: 3, after: 'e' })), 'e')).toEqual(['b']);
  });

  it('happened on a past day is done on that day, and frees what waited for it', () => {
    const e = ev('e')[1];
    const f = finishEffects(e, { today: TODAY, day: '2026-10-27', nowIso: '2026-10-31T09:00:00.000Z', nowMs: Date.parse('2026-10-31T09:00:00.000Z') });
    expect(f.patch).toMatchObject({ status: 'done', doneDay: '2026-10-27', started: null });
    expect(f.session).toBeNull();
    const tasks = map(ev('e', f.patch as Partial<TaskW>), mk('b', { after: 'e' }));
    expect(tasks.get('e')).toMatchObject({ status: 'done', doneDay: '2026-10-27' });
    expect(isWaiting(chainIndex(tasks), 'b')).toBe(false);
  });

  it('dropping an event frees its successors exactly as done does (the existing no-wait rule)', () => {
    const open = map(ev('e', { order: 1 }), mk('b', { after: 'e', order: 2 }), mk('c', { after: 'b', order: 3 }));
    expect(liveNextHeads(open, 'e')).toEqual(['b']);
    const dropped = map(ev('e', { order: 1, status: 'dropped' }), mk('b', { after: 'e', order: 2 }), mk('c', { after: 'b', order: 3 }));
    expect(isWaiting(chainIndex(dropped), 'b')).toBe(false);
    expect(isWaiting(chainIndex(dropped), 'c')).toBe(true);
  });
});

describe('the nudge', () => {
  const e = (id: string, nudge: string | null, p: Partial<TaskW> = {}) => ev(id, { nudge, ...p });
  const due = (m: Map<string, TaskW>, today = TODAY) => nudgesDue(m.values(), today).map(x => x.id);

  it('surfaces from its day and not before', () => {
    const m = map(e('e', '2026-11-02'));
    expect(due(m, '2026-11-01')).toEqual([]);
    expect(due(m, '2026-11-02')).toEqual(['e']);
  });

  it('stays after its day until it is answered, so a missed one is not lost', () => {
    const m = map(e('e', '2026-10-28'));
    expect(due(m)).toEqual(['e']);
    expect(due(map(e('e', '2026-10-28', { status: 'done', doneDay: TODAY })))).toEqual([]);
    expect(due(map(e('e', '2026-10-28', { status: 'dropped' })))).toEqual([]);
  });

  it('never comes by itself without a day, and a step with a stray nudge is not an event', () => {
    expect(due(map(e('e', null), e('f', ''), mk('t', { nudge: '2026-10-01' })))).toEqual([]);
  });

  it('orders by day', () => {
    expect(due(map(e('late', '2026-10-30'), e('early', '2026-10-25')))).toEqual(['early', 'late']);
  });

  it('"still waiting" moves it to three days or a week from today, or a later day', () => {
    expect(snoozeNudge(TODAY, '3d')).toBe('2026-11-03');
    expect(snoozeNudge(TODAY, '1w')).toBe('2026-11-07');
    expect(nudgeAfter(TODAY, '2026-12-01')).toBe('2026-12-01');
    expect(nudgeAfter(TODAY, TODAY)).toBe('2026-11-01'); // today would ask again at once
    expect(nudgeAfter(TODAY, '2026-10-01')).toBe('2026-11-01');
    // Moved past today, it is no longer due.
    expect(due(map(e('e', snoozeNudge(TODAY, '3d'))))).toEqual([]);
  });
});

describe('the Waiting for screen', () => {
  it('lists open events with the days waited and the steps each one holds back', () => {
    const tasks = map(
      ev('e1', { title: 'The bellman calls back', created: '2026-10-24T09:00:00.000Z', order: 1, nudge: '2026-11-05' }),
      ev('e2', { title: 'The parcel', created: '2026-10-31T07:00:00.000Z', order: 2 }),
      ev('gone', { status: 'done' }),
      mk('b', { title: 'Book the tailor', after: 'e1', order: 3 }),
      mk('c', { title: 'Collect the suit', after: ['b', 'e1'], order: 4 }),
      mk('x', { title: 'Done already', after: 'e1', status: 'done' }),
    );
    expect(waitingList(tasks.values(), TODAY)).toEqual([
      { id: 'e1', title: 'The bellman calls back', days: 7, nudge: '2026-11-05', unlocks: [{ id: 'b', title: 'Book the tailor' }, { id: 'c', title: 'Collect the suit' }] },
      { id: 'e2', title: 'The parcel', days: 0, nudge: null, unlocks: [] },
    ]);
  });
});

describe('events and the counts', () => {
  const p = new Map([['p1', { status: 'active' as const }]]);
  const t = (status: TaskW['status'], kind?: TaskW['kind']) => ({ project: 'p1', template: false, status, kind });
  it('do not count towards a project, and a pending one holds it back', () => {
    expect(projectCompletes('p1', p, [t('done'), t('done'), t('open', 'event')])).toBe(false);
    expect(projectCompletes('p1', p, [t('done'), t('done'), t('done', 'event')])).toBe(true);
    // Two real steps are still needed: an event is not one of them.
    expect(projectCompletes('p1', p, [t('done'), t('done', 'event'), t('done', 'event')])).toBe(false);
    expect(projectCompletes('p1', p, [t('done'), t('done'), t('dropped', 'event')])).toBe(true);
  });
});

describe('an event as a line for an AI', () => {
  const d = { today: TODAY, urgencyDays: 21, projects: new Map([['p1', { name: 'Wedding' }]]) as never };
  it('says it is waited for, with its check day, and has no quadrant, due date or estimate', () => {
    expect(stepLine(ev('e', { title: 'The bellman calls back', nudge: '2026-11-05' })[1], d)).toBe('e | The bellman calls back [waiting for, check 2026-11-05] | - | - | - | Wedding');
    expect(stepLine(ev('e', { title: 'A reply' })[1], d, { after: 2, due: '2026-11-02' })).toBe('e | A reply [waiting for] (+2 after, chain due 2026-11-02) | - | - | - | Wedding');
    expect(stepLine(ev('e', { title: 'A reply', status: 'done', doneDay: '2026-10-30' })[1], d)).toBe('e | A reply (happened) | - | - | - | Wedding');
    expect(stepLine(mk('t', { title: 'A step', est: 5 })[1], d)).toBe('t | A step | Q2 | - | 5m | Wedding');
  });
});
