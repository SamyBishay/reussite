// A standing series ends on a day (`until`), the connector says so, and a day it comes on shows it in `get_day` even before the app
// has put its copy on the list (the calendar had it; `today` and `get_day` did not).
import { beforeAll, describe, expect, it } from 'vitest';
import { newApp, signIn, switchOn, tool, type App } from './connector';

const DAY = 86_400_000;
const at = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const TOMORROW = at(1), IN3 = at(3), YESTERDAY = at(-1);

const task = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'p1', suit: 'H', kind: 'task', urgent: false, important: true, due: null, est: 20, est0: null, estBy: 'me', status: 'open', doneDay: null, doneAt: null,
  started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z', src: 'page', ...o,
});
const EVERY = [1, 2, 3, 4, 5, 6, 7];

let app: App;
let access: string;
const titled = (title: string) => [...app.device.docs.get('tasks')!.values()].find(t => t.title === title);

beforeAll(async () => {
  app = await newApp('app00007');
  const d = app.device;
  d.add('meta', 'settings', { dayStart: '00:00', urgencyDays: 21 });
  d.add('projects', 'p1', { name: 'Music', suit: 'H', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
  d.add('tasks', 'open', task('Open rehearsal', { template: true, weekdays: EVERY, at: '19:00', dur: 90 }));
  d.add('tasks', 'ends', task('Ends in three days', { template: true, weekdays: EVERY, at: '18:00', until: IN3 }));
  d.add('tasks', 'ended', task('Ended yesterday', { template: true, weekdays: EVERY, at: '17:00', until: YESTERDAY }));
  d.add('tasks', 'last', task('Last day is tomorrow', { template: true, weekdays: EVERY, at: '16:00', until: TOMORROW }));
  // A one-off with a series' words and time, made by hand for tomorrow: it stands in for the series that day.
  d.add('tasks', 'twin', task('Twin rehearsal', { template: true, weekdays: EVERY, at: '15:00' }));
  d.add('tasks', 'twin-1', task('Twin rehearsal', { at: '15:00', due: TOMORROW }));
  await app.sync();
  access = (await signIn((await switchOn(app)).body.code)).access;
});
const seen = async (name: string, args: Record<string, unknown> = {}) => (await tool(access, name, args)).text;

describe('how a standing series is written', () => {
  it('says when it ends', async () => {
    const t = await seen('query_tasks', { standing: true });
    expect(t).toContain('Ends in three days (standing, every day at 18:00 until ' + IN3 + ')');
    expect(t).toContain('Open rehearsal (standing, every day at 19:00) ');
    expect(await seen('get_task', { id: 'ends' })).toContain(`standing: every day at 18:00 until ${IN3}`);
  });
});

describe('get_day shows the series that come on the day', () => {
  it('a day a series comes on lists it under Fixed times, marked as not on the list yet', async () => {
    const t = await seen('get_day', { date: TOMORROW });
    expect(t).toMatch(/19:00 \(1h30\) open \| Open rehearsal \(standing, every day at 19:00\)[^\n]*no card on the day yet/);
    expect(t).toMatch(/18:00 [^\n]*Ends in three days/);
  });

  it('shows the last day it comes and none after it', async () => {
    expect(await seen('get_day', { date: TOMORROW })).toContain('Last day is tomorrow');
    expect(await seen('get_day', { date: at(2) })).not.toContain('Last day is tomorrow');
    expect(await seen('get_day', { date: at(2) })).toContain('Ends in three days');
    expect(await seen('get_day', { date: at(4) })).not.toContain('Ends in three days');
  });

  it('shows nothing of a series that ended before the day, and nothing on a past day', async () => {
    expect(await seen('get_day', { date: TOMORROW })).not.toContain('Ended yesterday');
    expect(await seen('get_day', { date: YESTERDAY })).not.toContain('Open rehearsal');
  });

  it('a one-off with the same words and time stands in for the series that day: one line, no second copy', async () => {
    const t = await seen('get_day', { date: TOMORROW });
    expect(t.match(/Twin rehearsal/g)).toHaveLength(1);
    expect(t).toMatch(/15:00 twin-1 \| Twin rehearsal \|/);
    // The next day the series is the only one.
    expect(await seen('get_day', { date: at(2) })).toMatch(/15:00 twin \| Twin rehearsal \(standing/);
  });
});

describe('apply_changes and an end date', () => {
  it('makes a series with an end date at once and stores it', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Choir', template: true, weekdays: [2], at: '18:00', until: '2026-12-31' } }] });
    expect(r.isError).toBe(false);
    expect(r.text).not.toContain('"confirm"');
    await app.sync();
    expect(titled('Choir')).toMatchObject({ template: true, weekdays: [2], at: '18:00', until: '2026-12-31' });
  });

  it('moves the end date of a series after the yes, and clears it', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.update', id: 'open', set: { until: '2026-12-31' } }] });
    const id = /"confirm": "(c\w+)"/.exec(r.text)![1]!;
    expect((await tool(access, 'apply_changes', { confirm: id })).isError).toBe(false);
    await app.sync();
    expect(app.device.get('tasks', 'open')).toMatchObject({ until: '2026-12-31', template: true });
    const clear = await tool(access, 'apply_changes', { changes: [{ op: 'task.update', id: 'open', set: { until: null } }] });
    const cid = /"confirm": "(c\w+)"/.exec(clear.text)![1]!;
    expect((await tool(access, 'apply_changes', { confirm: cid })).isError).toBe(false);
    await app.sync();
    expect(app.device.get('tasks', 'open')!.until ?? null).toBeNull();
  });

  it('an end date on a step that is not standing is refused with the reason, and nothing is written', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Plain step', until: '2026-12-31' } }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('not standing');
    await app.sync();
    expect(titled('Plain step')).toBeUndefined();
  });
});
