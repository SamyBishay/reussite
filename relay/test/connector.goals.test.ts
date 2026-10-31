// SMART goals v2 through the connector: get_project shows the outcome, the measure and the steps that move it; apply_changes
// writes outcome, measure, start, advances and advanceBy; ticking an advancing step done moves a count; Undo puts it back;
// a project an older app wrote (no outcome, no measure) still reads, and a device on either shape syncs with the other.
import { describe, expect, it } from 'vitest';
import { newApp, signIn, switchOn, tool } from './connector';

const TODAY = new Date().toISOString().slice(0, 10);
const task = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me', status: 'open', doneDay: null, doneAt: null,
  started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z', src: 'page', ...o,
});

async function setup(project: Record<string, unknown> = {}) {
  const app = await newApp('app' + Math.random().toString(36).slice(2, 7));
  const d = app.device;
  d.add('meta', 'settings', { dayStart: '00:00' });
  d.add('projects', 'p1', { name: 'Thesis', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active', created: '2026-09-03T08:00:00.000Z', ...project });
  d.add('tasks', 't1', task('Write the intro', { order: 1 }));
  d.add('tasks', 't2', task('Write the methods', { order: 2 }));
  d.add('tasks', 't3', task('Answer the email', { order: 3 }));
  d.add('days', TODAY, { date: TODAY, plan: [], launches: [], first: null, checkin: null, closed: null, summary: null });
  await app.sync();
  return { app, tok: (await signIn((await switchOn(app)).body.code)).access };
}
const confirmId = (text: string) => /"confirm": "(c\w+)"/.exec(text)![1]!;
const undoId = (text: string) => /Undo id: (u\w+)/.exec(text)![1]!;

describe('reading a project with a goal', () => {
  it('an older project (a goal, no outcome, no measure) reads as it did, with "no bar"', async () => {
    const { tok } = await setup({ goal: 'Hand in by December' });
    const p = await tool(tok, 'get_project', { id: 'p1' });
    expect(p.text).toContain('goal: Hand in by December');
    expect(p.text).toContain('measure: none (no bar)');
    expect(p.text).toContain('starts: 2026-09-03');
    expect(p.text).not.toContain('moves the goal');
  });

  it('a project with a count says where the bar is and which open steps move it', async () => {
    const { app, tok } = await setup({ outcome: 'Thesis drafted', goal: 'Old words', measure: { kind: 'count', target: 10, unit: 'pages' }, start: '2026-10-01' });
    app.device.edit('tasks', 't1', { advances: true, advanceBy: 4, status: 'done', doneDay: TODAY });
    app.device.edit('tasks', 't2', { advances: true });
    app.device.edit('tasks', 't3', { advances: false });
    await app.sync();
    const p = await tool(tok, 'get_project', { id: 'p1' });
    expect(p.text).toContain('goal: Thesis drafted');
    expect(p.text).not.toContain('Old words');
    expect(p.text).toContain('measure: count, 4 of 10 pages');
    expect(p.text).toContain('starts: 2026-10-01');
    expect(p.text).toContain('moves the goal: t2 Write the methods');
  });

  it('milestones are listed with what is done and what is open', async () => {
    const { tok } = await setup({ outcome: 'Moved', measure: { kind: 'milestones', items: [{ id: 'a', text: 'Booked', done: '2026-10-02' }, { id: 'b', text: 'Packed', done: null }] } });
    expect((await tool(tok, 'get_project', { id: 'p1' })).text).toContain('measure: milestones, 1 of 2 (done: Booked; open: Packed)');
  });
});

describe('writing a goal', () => {
  it('sets the outcome, a count, the start and the steps that move it, after a yes; the app sees it; Undo puts it back', async () => {
    const { app, tok } = await setup({ goal: 'Old words' });
    const q = await tool(tok, 'apply_changes', { changes: [
      { op: 'project.update', id: 'p1', set: { outcome: 'Thesis drafted by December', measure: { kind: 'count', target: 12, unit: 'pages' }, start: '2026-10-01' } },
      { op: 'task.update', id: 't1', set: { advances: true, advanceBy: 3 } },
      { op: 'task.update', id: 't3', set: { advances: false } },
    ] });
    expect(q.isError).toBe(false);
    expect(q.text).toContain('"confirm"');
    expect(q.text).toContain('outcome');
    // Nothing is written before the yes.
    await app.sync();
    expect(app.device.get('projects', 'p1')!.outcome).toBeUndefined();
    const r = await tool(tok, 'apply_changes', { confirm: confirmId(q.text) });
    expect(r.isError).toBe(false);
    await app.sync();
    expect(app.device.get('projects', 'p1')).toMatchObject({ goal: 'Old words', outcome: 'Thesis drafted by December', measure: { kind: 'count', target: 12, unit: 'pages' }, start: '2026-10-01' });
    expect(app.device.get('tasks', 't1')).toMatchObject({ advances: true, advanceBy: 3 });
    expect(app.device.get('tasks', 't3')).toMatchObject({ advances: false });
    expect(app.device.get('tasks', 't2')!.advances).toBeUndefined();

    const u = await tool(tok, 'undo', { id: undoId(r.text) });
    expect(u.isError).toBe(false);
    await app.sync();
    expect(app.device.get('projects', 'p1')!.outcome ?? null).toBeNull();
    expect(app.device.get('projects', 'p1')!.goal).toBe('Old words');
    expect(app.device.get('tasks', 't1')!.advances ?? null).toBeNull();
  });

  it('the old name still works: goal sets the outcome and leaves the stored goal', async () => {
    const { app, tok } = await setup({ goal: 'Old words' });
    const q = await tool(tok, 'apply_changes', { changes: [{ op: 'project.update', id: 'p1', set: { goal: 'New words' } }] });
    await tool(tok, 'apply_changes', { confirm: confirmId(q.text) });
    await app.sync();
    expect(app.device.get('projects', 'p1')).toMatchObject({ goal: 'Old words', outcome: 'New words' });
  });

  it('a new step that says it moves the goal waits for a yes, even on its own', async () => {
    const { tok } = await setup();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Write the conclusion', project: 'p1', advances: true } }] });
    expect(r.text).toContain('"confirm"');
    expect(r.text).not.toContain('Undo id');
  });

  it('refuses a measure that makes no sense, and an event that moves a goal, writing nothing', async () => {
    const { tok } = await setup();
    const a = await tool(tok, 'apply_changes', { changes: [{ op: 'project.update', id: 'p1', set: { measure: { kind: 'count', target: 0 } } }] });
    expect(a.isError).toBe(true);
    const b = await tool(tok, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'The call back', kind: 'event', advances: true, project: 'p1' } }] });
    expect(b.isError).toBe(true);
  });

  it('milestones: the list keeps ticks by text and a tick through done:true lands today', async () => {
    const { app, tok } = await setup({ measure: { kind: 'milestones', items: [{ id: 'a', text: 'Booked', done: '2026-10-02' }, { id: 'b', text: 'Packed', done: null }] } });
    const q = await tool(tok, 'apply_changes', { changes: [{ op: 'project.update', id: 'p1', set: { measure: { kind: 'milestones', items: ['Booked', { text: 'Packed', done: true }, 'Keys back'] } } }] });
    await tool(tok, 'apply_changes', { confirm: confirmId(q.text) });
    await app.sync();
    const m = app.device.get('projects', 'p1')!.measure as { items: { id: string; text: string; done: string | null }[] };
    expect(m.items.map(i => [i.text, i.done])).toEqual([['Booked', '2026-10-02'], ['Packed', TODAY], ['Keys back', null]]);
    expect(m.items[0]!.id).toBe('a');
    expect(m.items[1]!.id).toBe('b');
  });
});

describe('ticking an advancing step done through the connector', () => {
  it('moves the count by its amount; a step that does not advance leaves it', async () => {
    const { app, tok } = await setup({ measure: { kind: 'count', target: 10, unit: 'pages' } });
    app.device.edit('tasks', 't1', { advances: true, advanceBy: 3 });
    app.device.edit('tasks', 't3', { advances: false });
    await app.sync();
    await tool(tok, 'apply_changes', { changes: [{ op: 'task.done', id: 't3' }] });
    expect((await tool(tok, 'get_project', { id: 'p1' })).text).toContain('measure: count, 0 of 10 pages');
    await tool(tok, 'apply_changes', { changes: [{ op: 'task.done', id: 't1' }] });
    expect((await tool(tok, 'get_project', { id: 'p1' })).text).toContain('measure: count, 3 of 10 pages');
  });
});
