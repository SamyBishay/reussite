// The warnings a write answer carries (docs/dev/connector.md, "Warnings"): the diff and the "Done" answer say what an AI
// must not miss when it lays out a day.
import { describe, expect, it } from 'vitest';
import { newApp, signIn, switchOn, tool } from './connector';

const TODAY = new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const task = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me', status: 'open', doneDay: null, doneAt: null,
  started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z', src: 'page', ...o,
});

/** A list with two old steps on today's list, one due today, one timed step due tomorrow, and one on no list. */
async function list() {
  const x = await newApp('app0000' + Math.floor(Math.random() * 90 + 10));
  x.device.add('meta', 'settings', { dayStart: '00:00', urgencyDays: 21 });
  x.device.add('projects', 'p1', { name: 'Home', suit: 'C', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
  x.device.add('tasks', 'o1', task('Old photos'));
  x.device.add('tasks', 'o2', task('Old essay', { due: TODAY }));
  x.device.add('tasks', 'o3', task('Priest visit', { at: '10:11', due: day(1) }));
  x.device.add('tasks', 'n1', task('Buy coffee'));
  x.device.add('tasks', 'n2', task('Call the club'));
  x.device.add('days', TODAY, { date: TODAY, plan: ['o1', 'o2', 'o3'], launches: [], first: null, checkin: null, closed: null, summary: null });
  await x.sync();
  return (await signIn((await switchOn(x)).body.code)).access;
}
const confirm = async (tok: string, text: string) => (await tool(tok, 'apply_changes', { confirm: /"confirm": "(c\w+)"/.exec(text)![1]! })).text;

describe('add over a list that already holds steps', () => {
  it('says what was already on the list, in the diff and in the done answer', async () => {
    const tok = await list();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'day.update', date: TODAY, add: ['Buy coffee'] }] });
    const line = "Warning: already on today's list before this: Old photos; Old essay; Priest visit. Keep them, or send `plan` with the whole list to replace it.";
    expect(r.text).toContain(line);
    expect(r.text.indexOf(line)).toBeLessThan(r.text.indexOf('Nothing has been written yet'));
    expect(await confirm(tok, r.text)).toContain(line);
  });

  it('does not name a step the change-set mentions, and says nothing for `plan`', async () => {
    const tok = await list();
    const some = await tool(tok, 'apply_changes', { changes: [{ op: 'day.update', date: TODAY, add: ['Buy coffee'], remove: ['Old photos', 'Old essay'] }] });
    expect(some.text).toContain("already on today's list before this: Priest visit.");
    const whole = await tool(tok, 'apply_changes', { changes: [{ op: 'day.update', date: TODAY, plan: ['Buy coffee', 'Call the club'] }] });
    expect(whole.text).not.toContain('already on');
  });

  it('names a day that is not today by its date, and shortens a long list', async () => {
    const x = await newApp('app0000' + Math.floor(Math.random() * 90 + 10));
    x.device.add('meta', 'settings', { dayStart: '00:00', urgencyDays: 21 });
    x.device.add('projects', 'p1', { name: 'Home', suit: 'C', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
    const ids = Array.from({ length: 8 }, (_, i) => `s${i}`);
    ids.forEach((id, i) => x.device.add('tasks', id, task('Step ' + String.fromCharCode(65 + i))));
    x.device.add('tasks', 'z', task('New one'));
    x.device.add('days', day(3), { date: day(3), plan: ids, launches: [], first: null, checkin: null, closed: null, summary: null });
    await x.sync();
    const tok = (await signIn((await switchOn(x)).body.code)).access;
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'day.update', date: day(3), add: ['New one'] }] });
    expect(r.text).toMatch(/already on (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{4}-\d\d-\d\d's list before this: Step A; Step B; Step C; Step D; Step E; Step F; and 2 more\./);
  });
});

describe('steps due a day that end up on no list', () => {
  it('names a step made for today and put nowhere (the one low-risk change is applied at once)', async () => {
    const tok = await list();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Pick up the keys', due: TODAY } }] });
    expect(r.text).toContain('Done:');
    expect(r.text).toContain('Warning: due today but on no list: Pick up the keys. The person may want them on that day\'s list.');
  });

  it('is silent when the same change-set puts the step on that day\'s list', async () => {
    const tok = await list();
    const r = await tool(tok, 'apply_changes', { changes: [
      { op: 'task.create', ref: 'k', set: { title: 'Pick up the keys', due: TODAY } },
      { op: 'day.update', date: TODAY, plan: ['k'] },
    ] });
    expect(r.text).not.toContain('on no list');
  });

  it('names two steps and, for a step changed to a date, the day', async () => {
    const tok = await list();
    const r = await tool(tok, 'apply_changes', { changes: [
      { op: 'task.create', set: { title: 'Pick up the keys', due: TODAY } },
      { op: 'task.update', id: 'Buy coffee', set: { due: day(1) } },
      { op: 'task.update', id: 'Call the club', set: { due: TODAY } },
    ] });
    expect(r.text).toContain('Warning: due today but on no list: Pick up the keys; Call the club.');
    expect(r.text).toContain('Warning: due tomorrow but on no list: Buy coffee.');
  });

  it('does not name a timed step due that day (it shows among the fixed times), a far date, or a step with no date', async () => {
    const tok = await list();
    const r = await tool(tok, 'apply_changes', { changes: [
      { op: 'task.create', set: { title: 'Dinner', due: TODAY, at: '20:00' } },
      { op: 'task.create', set: { title: 'Next month', due: day(30) } },
      { op: 'task.create', set: { title: 'Someday' } },
    ] });
    expect(r.text).not.toContain('on no list');
  });

  it('names a timed step with no day', async () => {
    const tok = await list();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Dinner', at: '20:00' } }] });
    expect(r.text).toContain('Warning: a time but no day, and on no list: Dinner (20:00).');
  });
});

describe('steps taken off a day that stay due on it', () => {
  it('says they are still due, and stops when the change-set clears the date', async () => {
    const tok = await list();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'day.update', date: TODAY, plan: ['Old photos', 'Priest visit'] }] });
    const line = "Warning: off today's list but still due today: Old essay. Clear `due` if they should leave the day.";
    expect(r.text).toContain(line);
    expect(await confirm(tok, r.text)).toContain(line);
    const cleared = await tool(tok, 'apply_changes', { changes: [
      { op: 'day.update', date: TODAY, remove: ['Old essay'] },
      { op: 'task.update', id: 'Old essay', set: { due: null } },
    ] });
    expect(cleared.text).not.toContain('still due');
    expect(cleared.text).not.toContain('on no list');
  });

  it('does not say it of a step that was not due that day', async () => {
    const tok = await list();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'day.update', date: TODAY, remove: ['Old photos'] }] });
    expect(r.text).not.toContain('still due');
  });
});

describe('a timed step put on an earlier day than its own', () => {
  it('says it shows on its own day, not on this list', async () => {
    const tok = await list();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'day.update', date: TODAY, plan: ['Buy coffee', 'Old photos'] }] });
    expect(r.text).not.toContain('fixed for a later day'); // taking it off is not putting it on
    const put = await tool(tok, 'apply_changes', { changes: [{ op: 'day.update', date: day(0), add: ['Priest visit'] }] });
    expect(put.text).not.toContain('fixed for a later day'); // it is already on today's list: not new
    const x = await newApp('app0000' + Math.floor(Math.random() * 90 + 10));
    x.device.add('projects', 'p1', { name: 'Home', suit: 'C', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
    x.device.add('tasks', 'o3', task('Priest visit', { at: '10:11', due: day(1) }));
    await x.sync();
    const tok2 = (await signIn((await switchOn(x)).body.code)).access;
    const r2 = await tool(tok2, 'apply_changes', { changes: [{ op: 'day.update', date: TODAY, add: ['Priest visit'] }] });
    expect(r2.text).toContain("Warning: on today's list but fixed for a later day: Priest visit (tomorrow 10:11). It will show on both days. Change its due date if it belongs here, or leave it off this list.");
  });
});

describe('reading a timed step that is due tomorrow but was written on today\'s list', () => {
  it('the list line says it is fixed for the later day', async () => {
    const tok = await list();
    const today = (await tool(tok, 'today')).text;
    expect(today).toMatch(/Priest visit.*\[10:11, fixed for /);
    expect(today).toContain(`fixed for ${day(1)}]`);
    // A timed step due today carries no such note.
    const plain = (await tool(tok, 'get_day', { date: day(1) })).text;
    expect(plain).toContain('10:11 o3 | Priest visit');
  });
});
