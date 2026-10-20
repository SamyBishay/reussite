import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDoc, db, exchanges, sessions, start, tasks, update } from './store';
import { sheet, closeSheet } from './sheet';
import { choose, homeCard, openExchange, pruneExchanges, receiptLine, run, saveDuration, submitHome, undoExchange, canUndo, OPEN_MS } from './home';
import { newTaskFields } from '../domain/effects';

const settle = () => new Promise(r => setTimeout(r, 40));
const step = (id: string, title: string, o: Record<string, unknown> = {}) =>
  createDoc('tasks', newTaskFields(title, 'S', 'inbox', { est: 20, ...o }, new Map(), new Date().toISOString(), 1), id);
const titles = () => [...tasks.value.values()].filter(x => x.status === 'open').map(x => x.title).sort();
const only = () => { const all = [...exchanges.value.values()]; expect(all).toHaveLength(1); return all[0]!; };

// The store and the sheets touch a few browser globals; the node environment has none.
beforeAll(async () => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('HTMLElement', class {});
  await start();
});
afterEach(async () => {
  vi.useRealTimers();
  homeCard.value = null;
  closeSheet();
  await settle();
  for (const x of [...exchanges.value.values()]) await db.table_('exchanges').delete(x.id);
  for (const x of [...tasks.value.values()]) await db.table_('tasks').delete(x.id);
  for (const x of [...sessions.value.values()]) await db.table_('sessions').delete(x.id);
  await settle();
});

describe('a line typed on Home', () => {
  it('adds a step at once, with a receipt and an Undo that tombstones it', async () => {
    expect(await submitHome('call the bank tomorrow')).toBe(true);
    await settle();
    expect(titles()).toEqual(['Call the bank']);
    const ex = only();
    expect(ex).toMatchObject({ text: 'call the bank tomorrow', src: 'home', undone: [] });
    expect(ex.turns).toMatchObject([{ kind: 'add', reply: 'Call the bank', n: 1 }]);
    expect(receiptLine(ex)).toBe('Added “Call the bank”');
    expect(canUndo(ex)).toBe(true);
    expect(openExchange()!.id).toBe(ex.id);

    await undoExchange(ex.id);
    await settle();
    expect(titles()).toEqual([]);
    expect((await db.table_('tasks').toArray()).every(d => d._del)).toBe(true);
    expect(canUndo(only())).toBe(false);
    expect(openExchange(Date.now(), true)!.undone).toHaveLength(1);
  });

  it('a follow-up within ten minutes joins the exchange; later, Home starts clean', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T10:00:00Z'));
    await submitHome('call the bank');
    await settle();
    vi.setSystemTime(new Date('2026-10-20T10:09:00Z'));
    await submitHome('book the dentist');
    await settle();
    const ex = only();
    expect(ex.changes).toHaveLength(2);
    expect(ex.turns.map(x => x.text)).toEqual(['call the bank', 'book the dentist']);
    expect(receiptLine(ex)).toBe('2 changes');
    // The ten minutes run from the last turn.
    vi.setSystemTime(new Date('2026-10-20T10:09:00Z').getTime() + OPEN_MS - 1000);
    await submitHome('pay the rent');
    await settle();
    expect(only().changes).toHaveLength(3);
    vi.setSystemTime(new Date('2026-10-20T10:09:00Z').getTime() + 2 * OPEN_MS + 1000);
    await submitHome('water the plants');
    await settle();
    expect([...exchanges.value.values()]).toHaveLength(2);

    // One Undo takes back every change-set of an exchange.
    const first = [...exchanges.value.values()].find(x => x.changes.length === 3)!;
    await undoExchange(first.id);
    await settle();
    expect(titles()).toEqual(['Water the plants']);
  });

  it('done on a step asks how long it took; the time joins the same Undo', async () => {
    await step('s1', 'Call the dentist');
    await step('s2', 'Pay the rent');
    await settle();
    await submitHome('done call the dentist');
    await settle();
    expect(tasks.value.get('s1')!.status).toBe('done');
    const card = homeCard.value;
    expect(card).toMatchObject({ kind: 'duration', task: 's1' });
    await saveDuration(card as never, 25);
    await settle();
    const s = [...sessions.value.values()];
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ taskId: 's1', m: 25, source: 'typed', why: 'done' });
    const ex = only();
    expect(ex.turns.map(x => x.kind)).toEqual(['done', 'duration']);
    expect(receiptLine(ex)).toBe('Done: “Call the dentist”');
    expect(homeCard.value).toBeNull();

    await undoExchange(ex.id);
    await settle();
    expect(tasks.value.get('s1')).toMatchObject({ status: 'open', doneDay: null });
    expect(sessions.value.size).toBe(0);
    expect(tasks.value.get('s2')!.status).toBe('open');
  });

  it('answers the duration question from a typed follow-up', async () => {
    await step('s1', 'Call the dentist');
    await settle();
    await submitHome('done call the dentist');
    await settle();
    await submitHome('1h30');
    await settle();
    expect([...sessions.value.values()][0]).toMatchObject({ m: 90 });
    expect(only().turns.map(x => x.kind)).toEqual(['done', 'duration']);
  });

  it('a step with a running timer is not asked how long', async () => {
    await step('s1', 'Call the dentist', { started: new Date(Date.now() - 12 * 60_000).toISOString() });
    await settle();
    await submitHome('done call the dentist');
    await settle();
    expect(homeCard.value).toBeNull();
    expect([...sessions.value.values()]).toHaveLength(1);
  });

  it('asks which one when several steps match, and a follow-up or a tap picks', async () => {
    await step('a', 'Call the dentist');
    await step('b', 'Call the bank');
    await settle();
    expect(await submitHome('done call')).toBe(true);
    expect(homeCard.value).toMatchObject({ kind: 'pick', intent: 'done' });
    expect(tasks.value.get('a')!.status).toBe('open');
    await submitHome('the bank one');
    await settle();
    expect(tasks.value.get('b')!.status).toBe('done');
    expect(tasks.value.get('a')!.status).toBe('open');
    // A tap does the same.
    await step('c', 'Call mum');
    await settle();
    await submitHome('done call');
    const card = homeCard.value as Extract<NonNullable<typeof homeCard.value>, { kind: 'pick' }>;
    expect(card.candidates.map(c => c.id).sort()).toEqual(['a', 'c']);
    await choose(card, { id: 'c', name: 'Call mum' });
    await settle();
    expect(tasks.value.get('c')!.status).toBe('done');
    expect(tasks.value.get('a')!.status).toBe('open');
  });

  it('a move to a date is low-risk and applies at once', async () => {
    await step('a', 'Pay the rent');
    await settle();
    await submitHome('move pay the rent to 2031-01-05');
    await settle();
    // (an ISO date reads as a date)
    expect(tasks.value.get('a')!.due).toBe('2031-01-05');
    expect(receiptLine(only())).toBe('Moved “Pay the rent”');
  });

  it('a drop opens the review and writes nothing until it is applied', async () => {
    await step('a', 'Play the games');
    await settle();
    expect(await submitHome('drop the games')).toBe(true);
    expect(sheet.value).not.toBeNull();
    expect(tasks.value.get('a')!.status).toBe('open');
    expect(exchanges.value.size).toBe(0);
    expect(homeCard.value).toMatchObject({ kind: 'review', turn: 'drop', title: 'Play the games' });
  });

  it('a question opens the task sheet filled in, and writes nothing', async () => {
    expect(await submitHome('buy milk at the shop?')).toBe(true);
    expect(sheet.value).not.toBeNull();
    expect(tasks.value.size).toBe(0);
    expect(exchanges.value.size).toBe(0);
  });

  it('an empty line, and a change that changes nothing, are not taken', async () => {
    expect(await submitHome('   ')).toBe(false);
    await step('a', 'Pay the rent', { due: '2031-01-05' });
    await settle();
    expect(await submitHome('move pay the rent to 2031-01-05')).toBe(false);
    expect(exchanges.value.size).toBe(0);
  });

  it('a standing obligation from one line: a time, weekdays, and a receipt', async () => {
    await submitHome('choir every Monday 19:00 at Hill House 602');
    await settle();
    const c = [...tasks.value.values()][0]!;
    expect(c).toMatchObject({ title: 'Choir, Hill House 602', template: true, weekdays: [1], at: '19:00' });
    expect(receiptLine(only())).toBe('Added “Choir, Hill House 602” as a standing item');
  });
});

describe('Undo leaves later edits alone', () => {
  it('keeps a field changed since, and says so', async () => {
    await step('a', 'Pay the rent');
    await settle();
    await submitHome('done pay the rent');
    await settle();
    await update('tasks', 'a', { doneDay: '2026-01-01' });
    await undoExchange(only().id);
    await settle();
    expect(tasks.value.get('a')).toMatchObject({ status: 'open', doneDay: '2026-01-01' });
  });
});

describe('a change-set that is not the parser’s', () => {
  it('with several changes opens the review and writes nothing until it is applied', async () => {
    await step('a', 'Pay the rent');
    await settle();
    await run('tidy up', { v: 1, note: 'Tidied', bad: 0, changes: [{ op: 'task.update', id: 'a', set: { due: '2031-01-05' } }, { op: 'task.create', set: { title: 'Another' } }] }, 'changes', '');
    expect(sheet.value).not.toBeNull();
    expect(exchanges.value.size).toBe(0);
  });
});

describe('pruning', () => {
  it('empties and tombstones exchanges over 90 days old, leaves the rest, and can run twice', async () => {
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString(), recent = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const mk = (at: string) => ({ at, text: 'secret ' + at, turns: [{ at, text: 'secret', kind: 'add', n: 1 }], changes: ['c1'], undo: { c1: [{ c: 'tasks', id: 'x', created: true }] }, undone: [], src: 'home' });
    const a = await createDoc('exchanges', mk(old)), b = await createDoc('exchanges', mk(recent));
    await settle();
    await pruneExchanges();
    await pruneExchanges();
    await settle();
    expect(exchanges.value.has(a)).toBe(false);
    expect(exchanges.value.has(b)).toBe(true);
    const gone = (await db.table_('exchanges').get(a))!;
    expect(gone._del).toBeTruthy();
    expect(gone).toMatchObject({ text: '', turns: [], changes: [], undo: {}, undone: [] });
  });
});
