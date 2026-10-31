import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDoc, db, days, sessions, start, tasks, today } from './store';
import { dropTask, finishTask, leaveLists, snoozeEvent, startTask, dayPatch } from './actions';
import { T, cardsOn, allCards, isOpen, nudges, planOf, running, waiting, candidates } from './model';
import { toEventFields } from '../domain/events';
import { newTaskFields } from '../domain/effects';

const settle = () => new Promise(r => setTimeout(r, 40));
const mk = (id: string, title: string, o: Record<string, unknown> = {}) =>
  createDoc('tasks', newTaskFields(title, 'S', 'inbox', { est: 20, ...o }, new Map(), new Date().toISOString(), 1), id);
const event = (id: string, title: string, o: Record<string, unknown> = {}) => mk(id, title, { ...toEventFields(), ...o });
const todayPlan = () => planOf(today.value);

beforeAll(async () => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('HTMLElement', class {});
  await start();
});
afterEach(async () => {
  for (const x of [...tasks.value.values()]) await db.table_('tasks').delete(x.id);
  for (const x of [...sessions.value.values()]) await db.table_('sessions').delete(x.id);
  for (const x of [...days.value.values()]) await db.table_('days').delete(x.id);
  await settle();
});

describe('event steps in the app', () => {
  it('an event is dormant: not open, not a candidate, not on a list, never running, never a played card', async () => {
    await mk('a', 'Ask the bellman');
    await event('e', 'The bellman calls back');
    await settle();
    expect(isOpen(T('e'))).toBe(false);
    expect(candidates(today.value, 'any').map(x => x.id)).toEqual(['a']);
    await dayPatch(today.value, { plan: ['e', 'a'] });
    await settle();
    expect(todayPlan()).toEqual(['a']);
    await startTask('e');
    await settle();
    expect(T('e')!.started).toBeNull();
    expect(running()).toBeUndefined();
    expect(waiting.value.map(w => w.id)).toEqual(['e']);
  });

  it('"it happened" on a past day: done that day, no card, no session, and the freed step goes on today’s list', async () => {
    await mk('a', 'Ask the bellman', { order: 1, status: 'done', doneDay: '2026-10-01' });
    await event('e', 'The bellman calls back', { order: 2, after: 'a' });
    await mk('b', 'Book the tailor', { order: 3, after: 'e' });
    await settle();
    expect(planOf(today.value)).toEqual([]);
    const r = await finishTask(T('e')!, null, '2026-10-27');
    await settle();
    expect(T('e')).toMatchObject({ status: 'done', doneDay: '2026-10-27' });
    expect(r.unlocked).toEqual(['b']);
    expect(planOf(today.value)).toEqual(['b']);
    expect([...sessions.value.values()]).toEqual([]);
    expect(cardsOn('2026-10-27')).toEqual([]);
    expect(allCards()).toBe(1); // only the real step counts
    expect(waiting.value).toEqual([]);
  });

  it('does not put a step on the list when another predecessor is still open', async () => {
    await mk('a', 'Ask the bellman', { order: 1 });
    await event('e', 'The bellman calls back', { order: 2 });
    await mk('b', 'Book the tailor', { order: 3, after: ['a', 'e'] });
    await settle();
    const r = await finishTask(T('e')!, null, today.value);
    await settle();
    expect(r.unlocked).toEqual([]);
    expect(planOf(today.value)).toEqual([]);
  });

  it('dropping an event frees its successors the same way', async () => {
    await event('e', 'The bellman calls back', { order: 1 });
    await mk('b', 'Book the tailor', { order: 2, after: 'e' });
    await settle();
    expect(await dropTask('e')).toEqual(['b']);
    await settle();
    expect(T('e')!.status).toBe('dropped');
    expect(planOf(today.value)).toEqual(['b']);
  });

  it('a dormant event that comes after a step is not put on a list when that step is done', async () => {
    await mk('a', 'Ask the bellman', { order: 1 });
    await event('e', 'The bellman calls back', { order: 2, after: 'a' });
    await mk('b', 'Book the tailor', { order: 3, after: 'e' });
    await dayPatch(today.value, { plan: ['a'] });
    await settle();
    const r = await finishTask(T('a')!, null, today.value);
    await settle();
    expect(r.unlocked).toEqual([]);
    expect(rawIds()).toEqual(['a']);
    expect(planOf(today.value)).toEqual(['a']);
  });

  it('the nudge shows from its day, "still waiting" moves it, and a step turned into an event leaves the lists', async () => {
    await event('e', 'The bellman calls back', { nudge: today.value });
    await settle();
    expect(nudges.value.map(x => x.id)).toEqual(['e']);
    await snoozeEvent('e', today.value); // today would ask again at once: it goes to tomorrow
    await settle();
    expect(nudges.value).toEqual([]);
    await mk('s', 'A step');
    await dayPatch(today.value, { plan: ['s'] });
    await settle();
    await leaveLists('s');
    await settle();
    expect([...days.value.get(today.value)!.plan]).toEqual([]);
  });
});

const rawIds = () => [...(days.value.get(today.value)?.plan ?? [])];
