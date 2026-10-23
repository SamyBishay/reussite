// Addresses and people (phase 4) are in the space the connector reads, but no tool tells an AI about them:
// not by name, not through a step that points at them, not in the memory. Ticking a step that feeds a person
// sets their last seen, as it does by hand.
import { beforeAll, describe, expect, it } from 'vitest';
import { newApp, signIn, switchOn, tool, type App } from './connector';

const TODAY = new Date().toISOString().slice(0, 10);
const SECRETS = ['Théophile Marchand', 'Marchand', 'Brasserie Aubergine', 'Aubergine', 'Impasse des Lilas', 'hazelnuts', 'Philomène', '33612345678', 'Soup was cold'];

const task = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'p1', suit: 'H', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me', status: 'open', doneDay: null, doneAt: null,
  started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z', src: 'page', ...o,
});

let app: App;
let access: string;

beforeAll(async () => {
  app = await newApp('app00001');
  const d = app.device;
  d.add('meta', 'settings', { dayStart: '00:00', urgencyDays: 21 });
  d.add('places', 'pl1', { name: 'Paris', timeZone: 'Europe/Paris', order: 0 });
  d.add('projects', 'p1', { name: 'Life', suit: 'H', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
  d.add('addresses', 'a1', { name: 'Brasserie Aubergine Dorée', category: 'food', placeId: 'pl1', mapsUrl: 'https://maps.apple.com/?q=Brasserie', street: '9 Impasse des Lilas', state: 'been', by: 'me', note: 'Ask for Philomène', visits: [{ id: 'v1', day: '2026-10-01', note: 'Soup was cold', verdict: 'maybe' }] });
  d.add('people', 'pe1', { name: 'Théophile Marchand', placeId: 'pl1', reach: 'whatsapp://send?phone=33612345678', note: 'Allergic to hazelnuts', lastSeen: '2026-09-01' });
  d.add('tasks', 't1', task('Coffee together', { personId: 'pe1', addressId: 'a1', due: TODAY }));
  d.add('tasks', 't2', task('Call back', { personId: 'gone' }));
  d.add('days', TODAY, { date: TODAY, plan: ['t1'], launches: [], first: null, checkin: null, closed: null, summary: null });
  await app.sync();
  access = (await signIn((await switchOn(app)).body.code)).access;
});

describe('people and addresses stay out of the connector', () => {
  it('no read tool says anything about them, even asked by name', async () => {
    const calls: [string, unknown][] = [
      ['today', {}], ['get_day', { date: TODAY }], ['get_task', { id: 't1' }], ['query_tasks', {}], ['get_project', { id: 'p1' }], ['get_method', {}],
      ['read_memory', {}], ['read_memory', { name: 'Théophile Marchand' }], ['read_memory', { query: 'Marchand Brasserie hazelnuts' }],
    ];
    for (const [name, args] of calls) {
      const r = await tool(access, name, args);
      for (const s of SECRETS) expect(r.text, name + ' ' + JSON.stringify(args)).not.toContain(s);
      expect(r.text, name).not.toContain('pe1');
    }
  });

  it('ticking a step that feeds a person sets their last seen, and a step whose person is gone is still ticked', async () => {
    for (const id of ['t1', 't2']) {
      const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.done', id }] });
      expect(r.isError).toBe(false);
      expect(r.text).toContain('Done: one low-risk change');
      for (const s of SECRETS) expect(r.text).not.toContain(s);
    }
    await app.sync();
    expect(app.device.get('tasks', 't1')).toMatchObject({ status: 'done', personId: 'pe1', addressId: 'a1' });
    expect(app.device.get('people', 'pe1')).toMatchObject({ lastSeen: TODAY, name: 'Théophile Marchand' });
    expect(app.device.get('tasks', 't2')).toMatchObject({ status: 'done' });
    expect(app.device.get('addresses', 'a1')).toMatchObject({ state: 'been' });
  });
});

describe('the connector does not take addresses', () => {
  it('refuses an address.create and writes nothing, whatever else is in the change-set', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Open Maps and walk to the park' } }, { op: 'address.create', set: { name: 'Café Mokka', place: 'Paris', note: 'Open Tue to Sat' } }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Nothing was written');
    expect(r.text).toContain('the connector does not handle addresses');
    expect((await tool(access, 'query_tasks', { text: 'walk to the park' })).text).not.toContain('walk to the park');
  });
});
