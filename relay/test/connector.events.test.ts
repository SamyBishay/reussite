// Event steps (schema 6): something the person waits for. The connector lists them marked, can list only them, shows the ones
// whose check day has come as "Check:" rows, makes one with a nudge, marks one happened on a past day (which frees what waits
// for it), and refuses to give one what only a step has.
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { newApp, signIn, switchOn, tool, type App } from './connector';

const TODAY = new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const task = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me', status: 'open', doneDay: null, doneAt: null,
  started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z', src: 'page', ...o,
});
/** An event as the app stores it: no estimate, not important, a check day or none. */
const event = (title: string, o: Record<string, unknown> = {}) => task(title, { kind: 'event', est: null, important: false, ...o });

let app: App;
let access: string;
const batches = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM batches WHERE space = ?').bind(app.keys.spaceId).first<{ n: number }>())!.n;
const seen = async (name: string, args: Record<string, unknown> = {}) => (await tool(access, name, args)).text;

beforeAll(async () => {
  app = await newApp('app00007');
  const d = app.device;
  d.add('meta', 'settings', { dayStart: '00:00', urgencyDays: 21 });
  d.add('projects', 'p1', { name: 'Wedding', suit: 'H', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
  d.add('tasks', 'a', task('Book the venue', { order: 1 }));
  // A chain: the bellman's call (due to be asked about since last week) holds back the fitting, which holds back the photo.
  d.add('tasks', 'bell', event('The bellman calls back with a tailor', { order: 2, nudge: day(-7) }));
  d.add('tasks', 'fit', task('Book the fitting', { order: 3, after: ['bell'], est: 20 }));
  d.add('tasks', 'photo', task('Send the photo', { order: 4, after: ['fit'] }));
  // An event whose check day has not come, and one with none.
  d.add('tasks', 'later', event('The registry replies', { order: 5, nudge: day(5) }));
  d.add('tasks', 'never', event('The cousin answers', { order: 6 }));
  d.add('tasks', 'conv', task('Phone the florist', { order: 7, est: 5 }));
  d.add('days', TODAY, { date: TODAY, plan: ['a', 'conv'], launches: [], first: null, checkin: null, closed: null, summary: null });
  await app.sync();
  access = (await signIn((await switchOn(app)).body.code)).access;
});

describe('query_tasks and events', () => {
  it('marks an event with its check day, and lists the chain under it as it does under any head', async () => {
    const t = await seen('query_tasks');
    expect(t).toContain(`bell | The bellman calls back with a tailor [waiting for, check ${day(-7)}] (+2 after) | - | - | - | Wedding`);
    expect(t).toContain('never | The cousin answers [waiting for] | - | - | - | Wedding');
    expect(t).not.toContain('Book the fitting');
    expect(t).toContain('Book the venue');
  });

  it('lists only the things waited for with waiting_for, how long and what each holds back', async () => {
    const t = await seen('query_tasks', { waiting_for: true });
    expect(t).toMatch(/^3 things waited for/);
    expect(t).toContain('bell | The bellman calls back with a tailor [waiting for, check');
    expect(t).toContain('holds back: Book the fitting');
    expect(t).toMatch(/waiting \d+ days?/);
    expect(t).toContain('later | The registry replies');
    expect(t).not.toContain('Book the venue');
    expect(await seen('query_tasks', { waiting_for: true, status: 'done' })).toBe('Nothing is being waited for.');
    // a thing waited for has no quadrant
    expect(await seen('query_tasks', { quadrant: 4 })).not.toContain('[waiting for');
  });

  it('get_task says what it is, and the step behind it names it as waiting for', async () => {
    const ev = await seen('get_task', { id: 'bell' });
    expect(ev).toContain("waiting for: something outside the person's hands, not a step to do or schedule; check on " + day(-7));
    expect(ev).not.toContain('quadrant:');
    const fit = await seen('get_task', { id: 'fit' });
    expect(fit).toContain('waiting on: ["bell The bellman calls back with a tailor [waiting for]"]');
  });
});

describe('today and get_day: the Check rows', () => {
  it('shows an event whose check day has come, never as a step on the list', async () => {
    const t = await seen('today');
    expect(t).toContain(`Check: The bellman calls back with a tailor (bell, since ${day(-7)}).`);
    expect(t).not.toContain('Check: The registry replies');
    expect(t).not.toContain('Check: The cousin');
    expect(t.split('List (')[1]!.split('\n\n')[0]).not.toContain('bellman');
    expect(await seen('get_day', { date: TODAY })).toContain('Check: The bellman');
  });

  it('shows it from its check day on, on later days too, and not before', async () => {
    expect(await seen('get_day', { date: day(4) })).not.toContain('Check: The registry replies');
    expect(await seen('get_day', { date: day(5) })).toContain('Check: The registry replies (later, since ' + day(5) + ')');
    expect(await seen('get_day', { date: day(8) })).toContain('Check: The registry replies');
    // a past day is not asked about
    expect(await seen('get_day', { date: day(-3) })).not.toContain('Check:');
  });
});

describe('apply_changes and events', () => {
  it('makes an event with a check day at once (low-risk, like adding a step), and the app pulls it', async () => {
    const before = await batches();
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'The landlord replies', kind: 'event', nudge: day(2), project: 'Wedding' } }] });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('Done: one low-risk change, applied at once.');
    expect(r.text).toContain('Add waiting-for step "The landlord replies"');
    expect(await batches()).toBe(before + 1);
    await app.sync();
    const made = [...(app.device.docs.get('tasks')?.values() ?? [])].find(t => t.title === 'The landlord replies')!;
    expect(made).toMatchObject({ kind: 'event', nudge: day(2), est: null, starter: null, important: false, urgent: false, due: null, at: null, status: 'open', src: 'ai', project: 'p1' });
    expect(await seen('query_tasks', { waiting_for: true })).toContain('The landlord replies [waiting for, check ' + day(2) + ']');
    expect(await seen('get_day', { date: day(2) })).toContain('Check: The landlord replies');
  });

  it('refuses an event given an estimate, a time or a date, and writes nothing', async () => {
    const before = await batches();
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'The mayor writes', kind: 'event', est: 15, due: day(3) } }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Nothing was written.');
    expect(r.text).toContain('Change 1 (task.create): set.kind: an event (kind "event", something the person waits for) has no est, due');
    expect(await batches()).toBe(before);
    // nor a step given a check day, nor an event told it has an estimate later
    const nudge = await tool(access, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'A step', nudge: day(3) } }] });
    expect(nudge.isError).toBe(true);
    expect(nudge.text).toContain('nudge is the check date of an event');
    const upd = await tool(access, 'apply_changes', { changes: [{ op: 'task.update', id: 'never', set: { est: 30 } }] });
    expect(upd.isError).toBe(true);
    expect(upd.text).toContain('Change 1 (task.update): an event (kind "event", something the person waits for) has no est');
    expect(await batches()).toBe(before);
  });

  it('moving the check day waits for the person\'s yes, like any other change', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.update', id: 'never', set: { nudge: day(1) } }] });
    expect(r.text).toContain('This needs the person');
    expect(r.text).toContain('Change step "The cousin answers" (nudge ' + day(1) + ')');
  });

  it('task.done with a past day marks it happened on that day and frees what waits for it', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.done', id: 'The bellman calls back', day: day(-2) }] });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('Done: one low-risk change, applied at once.');
    expect(r.text).toContain('Mark happened: "The bellman calls back with a tailor" (doneDay - → ' + day(-2) + ')');
    // the connector never puts a step on a day's list: it says what was freed instead
    expect(r.text).toContain('Freed by it: fit Book the fitting.');
    await app.sync();
    expect(app.device.get('tasks', 'bell')).toMatchObject({ status: 'done', doneDay: day(-2), kind: 'event' });
    // no work session, no card
    expect([...(app.device.docs.get('sessions')?.values() ?? [])].filter(s => s.taskId === 'bell')).toHaveLength(0);

    const q = await seen('query_tasks');
    expect(q).toContain('fit | Book the fitting (+1 after)');
    expect(q).not.toContain('Book the fitting (waiting)');
    expect(q).not.toContain('The bellman');
    expect(await seen('today')).not.toContain('Check: The bellman');
    // it was done on a past day, as an event happened, not as a step done
    const that = await seen('get_day', { date: day(-2) });
    expect(that).toContain('Happened (things waited for):');
    expect(that).toContain('bell | The bellman calls back with a tailor (happened)');
    expect(that).not.toContain('Done: 1 step');
  });

  it('marking an event happened without a day is today', async () => {
    await tool(access, 'apply_changes', { changes: [{ op: 'task.done', id: 'never' }] });
    await app.sync();
    expect(app.device.get('tasks', 'never')).toMatchObject({ status: 'done', doneDay: TODAY });
  });

  it('turning a step into an event waits for a yes, sets its step fields to nothing and takes it off the list', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.update', id: 'conv', set: { kind: 'event', nudge: day(3) } }] });
    expect(r.text).toContain('This needs the person');
    expect(r.text).toContain('kind task → event');
    await tool(access, 'apply_changes', { confirm: /"confirm": "(c\w+)"/.exec(r.text)![1]! });
    await app.sync();
    expect(app.device.get('tasks', 'conv')).toMatchObject({ kind: 'event', nudge: day(3), est: null, important: false });
    expect(app.device.get('days', TODAY)!.plan).toEqual(['a']);
    expect(await seen('query_tasks', { waiting_for: true })).toContain('Phone the florist [waiting for, check ' + day(3) + ']');
  });
});

describe('the method', () => {
  it('tells an AI about waiting for', async () => {
    const r = await tool(access, 'get_method', {});
    expect(r.text).toContain('"event"');
    expect(r.text).toContain('nudge');
  });
});
