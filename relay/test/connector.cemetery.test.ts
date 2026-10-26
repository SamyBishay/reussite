// A dropped step (the app's Cemetery) is never shown by the connector, wherever it is reachable from.
import { beforeAll, describe, expect, it } from 'vitest';
import { newApp, signIn, switchOn, tool, type App } from './connector';

const TODAY = new Date().toISOString().slice(0, 10);

const task = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me', status: 'open', doneDay: null, doneAt: null,
  started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z', src: 'page', ...o,
});

let app: App;
let access: string;

beforeAll(async () => {
  app = await newApp('app00002');
  const d = app.device;
  d.add('meta', 'settings', { dayStart: '00:00', urgencyDays: 21 });
  d.add('projects', 'p1', { name: 'Move out', suit: 'C', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
  d.add('tasks', 'live1', task('Call Ibrahim about the keys', { due: TODAY }));
  d.add('tasks', 'live2', task('Book the van after the grave head', { after: ['g3'], order: 2 }));
  d.add('tasks', 'g1', task('GRAVE planned errand', { status: 'dropped', due: TODAY, at: '10:00' }));
  d.add('tasks', 'g2', task('GRAVE Ibrahim keys', { status: 'dropped', note: 'Ibrahim keys' }));
  d.add('tasks', 'g3', task('GRAVE head of a chain', { status: 'dropped' }));
  d.add('tasks', 'g4', task('GRAVE in a decision', { status: 'dropped' }));
  d.add('days', TODAY, { date: TODAY, plan: ['live1', 'g1', 'g2'], launches: [], first: { id: 'g2', title: 'GRAVE Ibrahim keys' }, checkin: null, closed: null, summary: null, optional: ['g4'] });
  d.add('decisions', 'd1', { title: 'Stay or move?', problem: { what: 'Rent' }, options: [], status: 'draft', chosen: null, taskIds: ['g4', 'live1'] });
  d.add('memory', 'm1', { kind: 'person', name: 'Ibrahim', aliases: [], lines: [{ id: 'l1', text: 'Likes tea', at: '2026-10-01T00:00:00.000Z', by: 'me' }], private: false, updated: '2026-10-03T00:00:00.000Z' });
  await app.sync();
  access = (await signIn((await switchOn(app)).body.code)).access;
});

const seen = async (name: string, args: Record<string, unknown> = {}) => (await tool(access, name, args)).text;

describe('the Cemetery stays out of the connector', () => {
  it('today, get_day, query_tasks (default, by text, by project) and read_memory never name a dropped step', async () => {
    for (const [n, a] of [['today', {}], ['get_day', {}], ['get_day', { date: TODAY }], ['query_tasks', {}], ['query_tasks', { text: 'GRAVE' }], ['query_tasks', { text: 'keys' }], ['query_tasks', { project: 'Move out' }], ['read_memory', {}], ['read_memory', { name: 'Ibrahim' }]] as const) {
      expect(await seen(n, a), n + ' ' + JSON.stringify(a)).not.toContain('GRAVE');
    }
  });
  it('get_project, get_decision and the step that waited on a dropped head do not name one', async () => {
    expect(await seen('get_project', { id: 'p1' })).not.toContain('GRAVE');
    expect(await seen('get_decision', { id: 'd1' })).not.toContain('GRAVE');
    const t = await seen('get_task', { id: 'live2' });
    expect(t).toContain('Book the van');
    expect(t).not.toContain('GRAVE');
    expect(t).not.toContain('waiting');
  });
  it('a name that matches only a dropped step is unknown', async () => {
    expect(await seen('get_task', { id: 'GRAVE planned errand' })).not.toContain('Q');
  });
});
