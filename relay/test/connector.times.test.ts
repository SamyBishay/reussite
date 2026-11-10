// Deadlines, appointments and slots (plan 10 Nov), through the connector: `dueAt`, `at`/`dur` and `slot` are accepted, kept apart and
// returned by today, get_day, get_task and query_tasks; a slot reaches the list through sync with its log; a step with a slot is not an
// event on the calendar feed; get_method tells an AI to plan work time with slots.
import { beforeAll, describe, expect, it } from 'vitest';
import { newApp, signIn, switchOn, tool, type App } from './connector';

const TODAY = new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const task = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 30, est0: null, estBy: 'me', status: 'open', doneDay: null, doneAt: null,
  started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z', src: 'page', ...o,
});

let app: App;
let access: string;
const seen = async (name: string, args: Record<string, unknown> = {}) => (await tool(access, name, args)).text;
const find = (title: string) => [...(app.device.docs.get('tasks')?.values() ?? [])].find(t => t.title === title)!;

beforeAll(async () => {
  app = await newApp('app00011');
  const d = app.device;
  d.add('meta', 'settings', { dayStart: '00:00', urgencyDays: 21 });
  d.add('projects', 'p1', { name: 'Thesis', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
  d.add('tasks', 'rep', task('Write the report', { order: 1, due: day(3), dueAt: '17:00', slot: { day: TODAY, at: '14:00', dur: 45 }, slotLog: [{ from: null, to: { day: TODAY, at: '14:00', dur: 45 }, at: new Date().toISOString(), by: 'me', why: 'planned' }] }));
  d.add('tasks', 'call', task('Call the dentist', { order: 2, due: TODAY, at: '10:00', dur: 30 }));
  d.add('days', TODAY, { date: TODAY, plan: ['rep', 'call'], launches: [], first: null, checkin: null, closed: null, summary: null });
  await app.sync();
  access = (await signIn((await switchOn(app)).body.code)).access;
});

describe('reading the three times', () => {
  it('get_task says which is which, and the log', async () => {
    const t = await seen('get_task', { id: 'rep' });
    expect(t).toContain(`due time: 17:00 on ${day(3)} (a deadline: it is in no calendar and the step stays on the list)`);
    expect(t).toContain(`slot: ${TODAY} 14:00 for 45m (work time set aside: movable, not an appointment)`);
    expect(t).toMatch(/slot log: .* me planned: none → /);
    expect(t).not.toMatch(/\bat: 14:00/);
    const call = await seen('get_task', { id: 'call' });
    expect(call).toContain('at: 10:00 for 30m (an appointment: it is in the calendar)');
  });
  it('today and get_day mark the slot on the list line and keep the appointment apart', async () => {
    for (const t of [await seen('today'), await seen('get_day', { date: TODAY })]) {
      expect(t).toContain(`Write the report`);
      expect(t).toContain(`[slot ${TODAY} 14:00 for 45m]`);
      expect(t).toContain('[10:00]'); // the appointment
    }
  });
  it('query_tasks shows a deadline with its time', async () => {
    expect(await seen('query_tasks')).toContain(`rep | Write the report | Q`);
    expect(await seen('query_tasks')).toContain(`| ${day(3)} 17:00 |`);
  });
});

describe('writing the three times', () => {
  it('a step made with a deadline, an appointment and a slot keeps each in its own field, and reaches the list', async () => {
    // One low-risk change each (adding one step applies at once).
    for (const set of [
      { title: 'Prepare the talk', project: 'Thesis', due: day(5), dueAt: '12:00', slot: { day: day(1), at: '09:00', dur: 90 } },
      { title: 'Meet the supervisor', project: 'Thesis', due: day(2), at: '15:00', dur: 60 },
    ]) expect((await tool(access, 'apply_changes', { changes: [{ op: 'task.create', set }] })).isError).toBe(false);
    await app.sync();
    expect(find('Prepare the talk')).toMatchObject({ due: day(5), dueAt: '12:00', slot: { day: day(1), at: '09:00', dur: 90 }, slotLog: [{ from: null, by: 'ai', why: 'set' }] });
    expect(find('Prepare the talk').at ?? null).toBeNull();
    expect(find('Meet the supervisor')).toMatchObject({ at: '15:00', dur: 60 });
    expect(find('Meet the supervisor').slot ?? null).toBeNull();
  });

  it('moving a slot keeps the old one in the log; a deadline time without a due is refused', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.update', id: 'rep', set: { slot: { day: TODAY, at: '16:00', dur: 45 } } }] });
    expect(r.text).toContain('This needs the person'); // a slot is the person's to move: it waits for their yes
    expect(r.text).toContain('slot');
    const id = /"confirm": "(c\w+)"/.exec(r.text)![1]!;
    expect((await tool(access, 'apply_changes', { confirm: id })).isError).toBe(false);
    await app.sync();
    const rep = find('Write the report') as unknown as { slot: unknown; slotLog: { from: unknown; to: unknown }[] };
    expect(rep.slot).toEqual({ day: TODAY, at: '16:00', dur: 45 });
    expect(rep.slotLog).toHaveLength(2);
    expect(rep.slotLog[1]!.from).toEqual({ day: TODAY, at: '14:00', dur: 45 });
    const bad = await tool(access, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'A step with a time', project: 'Thesis', dueAt: '09:00' } }] });
    expect(bad.text).toMatch(/dueAt .* needs a due/);
  });

  it('refuses a malformed slot and writes nothing', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.update', id: 'call', set: { slot: { day: 'soon', at: '14:00', dur: 30 } } }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Nothing was written.');
  });
});

describe('what an AI is told', () => {
  it('get_method separates deadlines, appointments and work time, in English and French', async () => {
    const en = await seen('get_method');
    expect(en).toContain('Deadlines, appointments and work time');
    expect(en).toMatch(/Plan the person's work time with slots, never with `at`/);
    const fr = await seen('get_method', { language: 'fr' });
    expect(fr).toContain('Échéances, rendez-vous et temps de travail');
    expect(fr).toMatch(/jamais avec `at`/);
  });
});
