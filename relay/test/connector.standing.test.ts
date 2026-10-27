// Standing steps (`template` with weekdays and `at`) are the series behind a fixed time that comes
// back, and what a calendar feed shows on each of their days: the connector lists them when asked,
// finds them by title, and drops them (ending the series) after the person's yes.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { newApp, signIn, switchOn, tool, type App } from './connector';

const TODAY = new Date().toISOString().slice(0, 10);
const WA = 'Open WhatsApp and answer your messages';
const FEED = { fid: 'F'.repeat(32), secret: 'K'.repeat(43), app: 'https://app.example/', zone: 'Africa/Cairo' };
const feedText = async () => (await env.DB.prepare('SELECT ics FROM feeds WHERE fid = ?1').bind(FEED.fid).first<{ ics: string }>())?.ics ?? '';

const task = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'p1', suit: 'H', kind: 'task', urgent: false, important: true, due: null, est: 20, est0: null, estBy: 'me', status: 'open', doneDay: null, doneAt: null,
  started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z', src: 'page', ...o,
});

let app: App;
let access: string;

beforeAll(async () => {
  app = await newApp('app00003');
  const d = app.device;
  d.add('meta', 'settings', { dayStart: '00:00', urgencyDays: 21, feedDetail: 'full', feedShared: FEED });
  d.add('projects', 'p1', { name: 'Friends', suit: 'H', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
  d.add('tasks', 'wa', task(WA, { template: true, weekdays: [1, 2, 3, 4, 5, 6, 7], at: '20:00', dur: 20, lead: 30, link: 'https://web.whatsapp.com', app: 'WhatsApp' }));
  d.add('tasks', 'choir', task('Choir at Hill House', { template: true, weekdays: [1, 4], at: '19:00' }));
  d.add('tasks', 'choir-c', task('Choir at Hill House', { from: 'choir', at: '19:00', due: TODAY }));
  d.add('tasks', 'gym', task('Gym with Farouk', { template: true, weekdays: [3], at: '07:00', status: 'dropped' }));
  d.add('tasks', 'one', task('Call the agency', { due: TODAY }));
  await app.sync();
  access = (await signIn((await switchOn(app)).body.code)).access;
});

const seen = async (name: string, args: Record<string, unknown> = {}) => (await tool(access, name, args)).text;

describe('query_tasks and standing steps', () => {
  it('leaves them out of the default list', async () => {
    const t = await seen('query_tasks');
    expect(t).toContain('Call the agency');
    expect(t).not.toContain('WhatsApp');
    expect(t).not.toContain('(standing');
  });

  it('lists them, marked, with status all', async () => {
    const t = await seen('query_tasks', { status: 'all' });
    expect(t).toContain(`wa | ${WA} (standing, every day at 20:00) |`);
    expect(t).toContain('choir | Choir at Hill House (standing, Mon Thu at 19:00) |');
    expect(t).toContain('gym | Gym with Farouk (standing, Wed at 07:00) (dropped) |');
    expect(t).toContain('Call the agency');
  });

  it('lists only them with standing: true, open by default', async () => {
    const t = await seen('query_tasks', { standing: true });
    expect(t).toMatch(/^2 steps match/);
    expect(t).toContain('wa | ');
    expect(t).toContain('choir | ');
    expect(t).not.toContain('Call the agency');
    expect(t).not.toContain('choir-c');
    expect(await seen('query_tasks', { standing: true, text: 'whatsapp' })).toMatch(/^1 step match/);
    expect(await seen('query_tasks', { standing: true, status: 'dropped' })).toContain('gym | ');
  });
});

describe('get_task and standing steps', () => {
  it('finds one by its exact title, and says when it comes back', async () => {
    const t = await seen('get_task', { id: WA });
    expect(t).toContain(`wa | ${WA} (standing, every day at 20:00)`);
    expect(t).toContain('standing: every day at 20:00, leave 30m before; drop it to end the series');
    expect(t).toContain('link: https://web.whatsapp.com');
  });

  it('prefers the copy placed on a day to the series of the same title, and the copy names its series', async () => {
    const t = await seen('get_task', { id: 'Choir at Hill House' });
    expect(t).toMatch(/^choir-c \| /);
    expect(t).toContain('copy of: choir Choir at Hill House');
  });
});

describe('apply_changes and standing steps', () => {
  it('a done by the title of a series says what to do instead, and writes nothing', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.done', id: WA }] });
    expect(r.text).toContain(`"${WA}" is a standing step (wa)`);
    expect(r.text).toContain('task.drop');
    await app.sync();
    expect(app.device.get('tasks', 'wa')!.status).toBe('open');
  });

  it('changes a series by its title after the yes: a new time and days, never cleared', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.update', id: WA, set: { at: '21:00', weekdays: [1, 2, 3, 4, 5] } }] });
    expect(r.text).toContain(`Change step "${WA}"`);
    const id = /"confirm": "(c\w+)"/.exec(r.text)![1]!;
    expect((await tool(access, 'apply_changes', { confirm: id })).isError).toBe(false);
    await app.sync();
    expect(app.device.get('tasks', 'wa')).toMatchObject({ at: '21:00', weekdays: [1, 2, 3, 4, 5], template: true });
    // The list's calendar follows the connector's change at once.
    const cal = (await feedText()).replace(/\r\n /g, '');
    expect(cal).toContain('DESCRIPTION:' + WA);
    expect(cal).toMatch(/DTSTART;TZID=Africa\/Cairo:\d{8}T210000/);
    expect(cal).toContain('URL:https://app.example/#task/wa');
    expect(await seen('get_task', { id: 'wa' })).toContain('standing: Mon Tue Wed Thu Fri at 21:00');
    const none = await tool(access, 'apply_changes', { changes: [{ op: 'task.update', id: 'wa', set: { at: null, weekdays: [] } }] });
    expect(none.text).not.toContain('"confirm"');
  });

  it('drops a series by its exact title after the yes, and then the default list and the feed have nothing of it', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.drop', id: WA }] });
    expect(r.isError).toBe(false);
    expect(r.text).toContain(`Drop "${WA}"`);
    const id = /"confirm": "(c\w+)"/.exec(r.text)![1]!;
    expect((await tool(access, 'apply_changes', { confirm: id })).isError).toBe(false);
    await app.sync();
    expect(app.device.get('tasks', 'wa')!.status).toBe('dropped');
    expect(await feedText()).toContain('BEGIN:VCALENDAR');
    expect(await feedText()).not.toContain('WhatsApp');
    expect(await seen('query_tasks', { standing: true })).not.toContain('WhatsApp');
    // Dropped, it is out of title lookup like any dropped step (the Cemetery), but its id still reads.
    expect((await tool(access, 'get_task', { id: WA })).isError).toBe(true);
    expect(await seen('get_task', { id: 'wa' })).toContain('status: dropped');
  });
});
