// Undo, the connector's clock, and how a written change behaves as a device among others.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { openFromText, sealToText } from '../../src/sync/crypto';
import { parse } from '../../src/data/hlc';
import { SCHEMA_VERSION } from '../../src/data/schema';
import { newApp, signIn, switchOn, tool } from './connector';
import { call, url } from './helpers';
import { View } from '../src/connector/view';
import { emptyMaps } from '../src/connector/space';

const TODAY = new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const task = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me', status: 'open', doneDay: null, doneAt: null,
  started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z', src: 'page', ...o,
});

async function setup(node = 'app' + Math.random().toString(36).slice(2, 7)) {
  const app = await newApp(node);
  const d = app.device;
  d.add('meta', 'settings', { dayStart: '00:00' });
  d.add('projects', 'p1', { name: 'Move', suit: 'C', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
  d.add('tasks', 't1', task('Call the agency', { due: day(2) }));
  d.add('tasks', 't2', task('Pay the rent', { due: day(1) }));
  d.add('tasks', 't3', task('Water the plants', { repeat: { every: 1, unit: 'week', from: 'due' }, due: TODAY }));
  d.add('days', TODAY, { date: TODAY, plan: ['t1'], launches: [], first: null, checkin: null, closed: null, summary: null });
  await app.sync();
  return { app, tok: (await signIn((await switchOn(app)).body.code)).access };
}
const undoId = (text: string) => /Undo id: (u\w+)/.exec(text)![1]!;

describe('undo', () => {
  it('puts a moved date back, and the app sees it at its next sync', async () => {
    const { app, tok } = await setup();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.update', id: 't1', set: { due: day(9) } }] });
    await app.sync();
    expect(app.device.get('tasks', 't1')!.due).toBe(day(9));
    const u = await tool(tok, 'undo', { id: undoId(r.text) });
    expect(u.isError).toBe(false);
    expect(u.text).toContain('Restored tasks/t1: due');
    await app.sync();
    expect(app.device.get('tasks', 't1')!.due).toBe(day(2));
  });

  it('undoes a creation with a tombstone, never a hard delete', async () => {
    const { app, tok } = await setup();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Choir', at: '19:00', due: day(3) } }] });
    const id = /Created: (t\w+)/.exec(r.text)![1]!;
    await app.sync();
    expect(app.device.get('tasks', id)!._del).toBeUndefined();
    const u = await tool(tok, 'undo', { id: undoId(r.text) });
    expect(u.text).toContain(`Removed tasks/${id}`);
    await app.sync();
    expect(app.device.get('tasks', id)!._del).toBeDefined();
    expect(app.device.get('tasks', id)!.title).toBe('Choir'); // the document is still there
    // And it is gone from the connector's own view.
    expect((await tool(tok, 'get_task', { id })).isError).toBe(true);
  });

  it('keeps a step it made that the person wrote to since, or logged time on', async () => {
    const { app, tok } = await setup();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Call the bank' } }] });
    const id = /Created: (t\w+)/.exec(r.text)![1]!;
    await app.sync();
    app.device.edit('tasks', id, { note: 'ask about the card' });
    await app.sync();
    const u = await tool(tok, 'undo', { id: undoId(r.text) });
    expect(u.text).toContain(`Left tasks/${id} alone: note changed since`);
    await app.sync();
    expect(app.device.get('tasks', id)!._del).toBeUndefined();
    const r2 = await tool(tok, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Book the dentist' } }] });
    const id2 = /Created: (t\w+)/.exec(r2.text)![1]!;
    await app.sync();
    app.device.add('sessions', 'sx', { taskId: id2, d: TODAY, m: 20, why: null, at: new Date().toISOString(), source: 'typed' });
    await app.sync();
    expect((await tool(tok, 'undo', { id: undoId(r2.text) })).text).toContain(`Left tasks/${id2} alone`);
    await app.sync();
    expect(app.device.get('tasks', id2)!._del).toBeUndefined();
  });

  it('puts a ticked step back to open, and removes the next occurrence it made', async () => {
    const { app, tok } = await setup();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.done', id: 't3' }] });
    await app.sync();
    expect(app.device.get('tasks', 't3')).toMatchObject({ status: 'done', doneDay: TODAY });
    const next = [...app.device.docs.get('tasks')!.values()].find(t => t.prev === 't3')!;
    expect(next).toMatchObject({ due: day(7), status: 'open', title: 'Water the plants' });
    await tool(tok, 'undo', { id: undoId(r.text) });
    await app.sync();
    expect(app.device.get('tasks', 't3')).toMatchObject({ status: 'open', doneDay: null, doneAt: null });
    expect(app.device.get('tasks', next.id)!._del).toBeDefined();
  });

  it('reverts a whole confirmed change-set by one id', async () => {
    const { app, tok } = await setup();
    const q = await tool(tok, 'apply_changes', { changes: [{ op: 'task.drop', id: 't1' }, { op: 'task.update', id: 't2', set: { est: 50, due: day(8) } }] });
    const r = await tool(tok, 'apply_changes', { confirm: /"confirm": "(c\w+)"/.exec(q.text)![1] });
    await app.sync();
    expect(app.device.get('tasks', 't1')!.status).toBe('dropped');
    await tool(tok, 'undo', { id: undoId(r.text) });
    await app.sync();
    expect(app.device.get('tasks', 't1')!.status).toBe('open');
    expect(app.device.get('tasks', 't2')).toMatchObject({ est: 10, due: day(1) });
    expect(app.device.get('days', TODAY)!.plan).toEqual(['t1']);
  });

  it('leaves alone what the person changed since', async () => {
    const { app, tok } = await setup();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.update', id: 't2', set: { due: day(8) } }] });
    await app.sync();
    app.device.edit('tasks', 't2', { due: day(20) });
    await app.sync();
    const u = await tool(tok, 'undo', { id: undoId(r.text) });
    expect(u.text).toContain('Left tasks/t2 alone: due changed since');
    await app.sync();
    expect(app.device.get('tasks', 't2')!.due).toBe(day(20));
  });

  it('works once, and only for its own space', async () => {
    const { tok } = await setup();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.update', id: 't1', set: { due: day(9) } }] });
    const id = undoId(r.text);
    const other = await setup();
    expect((await tool(other.tok, 'undo', { id })).isError).toBe(true);
    expect((await tool(tok, 'undo', { id })).isError).toBe(false);
    const twice = await tool(tok, 'undo', { id });
    expect(twice.isError).toBe(true);
    expect(twice.text).toContain('unknown, or it was already used');
  });

  it('the stored undo record is encrypted', async () => {
    const { app, tok } = await setup();
    const q = await tool(tok, 'apply_changes', { changes: [{ op: 'task.update', id: 't1', set: { note: 'a very private note' } }] });
    const r = await tool(tok, 'apply_changes', { confirm: /"confirm": "(c\w+)"/.exec(q.text)![1] });
    const row = await env.DB.prepare('SELECT blob FROM connector_undo WHERE id = ?').bind(undoId(r.text)).first<{ blob: string }>();
    expect(row!.blob).not.toContain('private');
    expect(JSON.stringify(await openFromText(app.keys, row!.blob))).toContain('a very private note');
  });
});

describe('the connector as a device', () => {
  it("its clock is kept per space and stays ahead of what it has seen, even a phone's fast clock", async () => {
    const { app, tok } = await setup();
    // The app's clock is an hour ahead of the relay's.
    const ahead = Date.now() + 3600_000;
    app.device.clock.wall = ahead;
    app.device.edit('tasks', 't2', { due: day(30) });
    await app.sync();
    await tool(tok, 'apply_changes', { changes: [{ op: 'task.update', id: 't2', set: { due: day(31) } }] });
    await app.sync();
    const doc = app.device.get('tasks', 't2')!;
    expect(doc.due).toBe(day(31));
    expect(parse(doc._hlc.due!).wall).toBeGreaterThanOrEqual(ahead);
    const row = await env.DB.prepare('SELECT hlc_wall, hlc_counter FROM connector WHERE space = ?').bind(app.keys.spaceId).first<{ hlc_wall: number; hlc_counter: number }>();
    expect(row!.hlc_wall).toBeGreaterThanOrEqual(ahead);
    // A second write is later still.
    await tool(tok, 'apply_changes', { changes: [{ op: 'task.update', id: 't2', set: { due: day(32) } }] });
    await app.sync();
    expect(app.device.get('tasks', 't2')!._hlc.due! > doc._hlc.due!).toBe(true);
  });

  it('only fields it wrote carry its node id; the app\'s fields are not re-sent', async () => {
    const { app, tok } = await setup();
    await tool(tok, 'apply_changes', { changes: [{ op: 'task.update', id: 't1', set: { due: day(9) } }] });
    const rows = await env.DB.prepare('SELECT device FROM batches WHERE space = ? ORDER BY seq DESC LIMIT 1').bind(app.keys.spaceId).first<{ device: string }>();
    expect(rows!.device).toBe('connector');
    await app.sync();
    const t1 = app.device.get('tasks', 't1')!;
    expect(t1._hlc.due).toMatch(/:connector$/);
    expect(t1._hlc.title).toMatch(/:app/);
  });

  it('the app sees the connector among its devices, and the writes count against the space\'s rate limit', async () => {
    const { app, tok } = await setup();
    const tight = await call('GET', url(app.keys, '/devices'), app.keys);
    expect(tight.body.devices.map((d: { device: string }) => d.device)).toContain('connector');
    await env.DB.prepare('UPDATE spaces SET win = ?, n = 60 WHERE id = ?').bind(Math.floor(Date.now() / 60_000), app.keys.spaceId).run();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.update', id: 't1', set: { due: day(9) } }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Too many changes this minute');
  });

  it('reads and writes nothing when the list was saved by a newer app', async () => {
    const { app, tok } = await setup();
    const blob = await sealToText(app.keys, { v: SCHEMA_VERSION + 1, device: 'future', docs: [] });
    await call('POST', url(app.keys, '/batches'), app.keys, { body: { device: 'future', blob } });
    const r = await tool(tok, 'today');
    expect(r.isError).toBe(true);
    expect(r.text).toContain('newer version of Réussite');
    const w = await tool(tok, 'apply_changes', { changes: [{ op: 'task.done', id: 't1' }] });
    expect(w.isError).toBe(true);
  });

  it('catches up with batches written after the last snapshot', async () => {
    const { app, tok } = await setup();
    await app.client.putSnapshot({ v: SCHEMA_VERSION, upto: 1, docs: Object.fromEntries([...app.device.docs].map(([c, m]) => [c, [...m.values()]])) });
    app.device.add('tasks', 't9', task('Added after the snapshot'));
    await app.sync();
    expect((await tool(tok, 'query_tasks', { text: 'after the snapshot' })).text).toContain('t9 | Added after the snapshot');
  });
});

describe('memory changes', () => {
  const lines = (app: Awaited<ReturnType<typeof setup>>['app'], id: string) => (app.device.get('memory', id)!.lines as { id: string; text: string; by: string }[]);
  async function withNotes() {
    const r = await setup();
    r.app.device.add('memory', 'n1', { kind: 'person', name: 'Ibrahim', aliases: ['Ibra'], lines: [{ id: 'l1', text: 'Likes tea', at: '', by: 'me' }, { id: 'l2', text: 'Works nights', at: '', by: 'me' }], private: false, updated: '2026-10-01T00:00:00.000Z' });
    r.app.device.add('memory', 'n2', { kind: 'person', name: 'Secret', aliases: [], lines: [{ id: 's1', text: 'Hidden', at: '', by: 'me' }], private: true, updated: '' });
    await r.app.sync();
    return r;
  }

  it('asks for a yes, finds the note by name or alias, and lands after the confirmation', async () => {
    const { app, tok } = await withNotes();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'memory.add', note: 'ibra', text: 'Plays oud' }] });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('needs the person');
    expect(r.text).toContain('Remember, in the note "Ibrahim"');
    const id = /"confirm": "(c\w+)"/.exec(r.text)![1]!;
    await app.sync();
    expect(lines(app, 'n1')).toHaveLength(2);
    const done = await tool(tok, 'apply_changes', { confirm: id });
    expect(done.isError).toBe(false);
    await app.sync();
    expect(lines(app, 'n1').map(l => l.text)).toEqual(['Likes tea', 'Works nights', 'Plays oud']);
    expect(lines(app, 'n1')[2]!.by).toBe('ai');
  });

  it('makes a note when given a kind, and undoes the lot', async () => {
    const { app, tok } = await withNotes();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'memory.add', note: 'Alex', kind: 'person', text: 'Moved to Lyon' }, { op: 'memory.remove', note: 'Ibrahim', line: 1 }] });
    const done = await tool(tok, 'apply_changes', { confirm: /"confirm": "(c\w+)"/.exec(r.text)![1]! });
    await app.sync();
    const alex = [...app.device.docs.get('memory')!.values()].find(d => d.name === 'Alex')!;
    expect(lines(app, 'n1').map(l => l.text)).toEqual(['Works nights']);
    const u = await tool(tok, 'undo', { id: undoId(done.text) });
    expect(u.isError).toBe(false);
    await app.sync();
    expect(lines(app, 'n1').map(l => l.text)).toEqual(['Likes tea', 'Works nights']);
    expect(app.device.get('memory', alex.id as string)!._del).toBeDefined();
  });

  it('does not find a private note, and says nothing about it', async () => {
    const { tok } = await withNotes();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'memory.add', note: 'Secret', text: 'x' }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('No memory note');
    // with a kind it is a new note, as for any name no note has: the answer does not tell a private note exists
    const made = await tool(tok, 'apply_changes', { changes: [{ op: 'memory.add', note: 'Secret', kind: 'person', text: 'x' }] });
    const fresh = await tool(tok, 'apply_changes', { changes: [{ op: 'memory.add', note: 'Nobody', kind: 'person', text: 'x' }] });
    const plain = (x: string) => x.replace(/"confirm": "c\w+"/, '');
    expect(plain(made.text).replace('Secret', 'Nobody')).toBe(plain(fresh.text));
    expect(made.text).toContain('Remember, in a new note');
  });

  it('a confirmed line change lands on the line that was shown, even if the lines moved since', async () => {
    const { app, tok } = await withNotes();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'memory.edit', note: 'Ibrahim', line: 2, text: 'Works days now' }, { op: 'memory.add', note: 'Ibrahim', text: 'Plays oud' }] });
    expect(r.text).toContain('Works nights');
    // before the yes, the person forgets line 1 and adds one on their phone
    app.device.edit('memory', 'n1', { lines: [{ id: 'l2', text: 'Works nights', at: '', by: 'me' }, { id: 'l3', text: 'Has a new job', at: '', by: 'me' }] });
    await app.sync();
    const done = await tool(tok, 'apply_changes', { confirm: /"confirm": "(c\w+)"/.exec(r.text)![1]! });
    expect(done.isError).toBe(false);
    await app.sync();
    expect(lines(app, 'n1').map(l => l.text)).toEqual(['Works days now', 'Has a new job', 'Plays oud']);
  });

  it('builds the notes only when a change reads them', () => {
    const v = new View(emptyMaps());
    for (const o of [v.snapshot(), v.data]) expect(typeof Object.getOwnPropertyDescriptor(o, 'memory')?.get).toBe('function');
  });
});
