import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { importV1, writeImport } from './import-v1';
import { ReussiteDb } from './db';
import { fieldsOf } from './doc';

const task = (o: object) => ({ title: 'Open Mail and reply', project: 'p1', suit: 'D', kind: 'task', urgent: false, important: true,
  due: null, est: 15, estBy: 'samy', spent: 20, sessions: [{ d: '2026-01-02', m: 12, why: 'done', at: 'x' }, { d: '2026-01-03', m: 8, why: 'done', at: 'y', manual: true }],
  status: 'done', where: 'france', template: false, note: '', order: 1, ...o });

const byId = {
  tasks: { t1: task({}), t2: task({ where: 'cairo', estBy: 'claude', sessions: [], spent: 5 }) },
  projects: { p1: { name: 'Papers', suit: 'D', where: 'any', goal: 'g', goalBy: 'claude', status: 'active', order: 1 } },
  days: { '2026-01-02': { date: '2026-01-02', plan: ['t1'], launches: [{ t: '09:00', k: 'start' }] } },
  decisions: { d1: { title: 'Move?', options: [], chosen: 'Stay' } },
  meta: { settings: { here: 'france', ratio: 1.4 } },
  exported: '2026-01-04T00:00:00Z',
};
const asArrays = Object.fromEntries(Object.entries(byId).map(([k, v]) => [k, typeof v === 'object' ? Object.entries(v).map(([id, d]) => ({ id, ...(d as object) })) : v]));
const wrapped = Object.fromEntries(Object.entries(byId).map(([k, v]) => [k, typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([id, d]) => [id, { data: d, version: 3 }])) : v]));

describe('v1 import', () => {
  for (const [name, file] of [['{id: doc}', byId], ['[docs]', asArrays], ['{data, version}', wrapped]] as const) {
    it('reads the ' + name + ' shape', () => {
      const { summary } = importV1(file, 'UTC');
      expect(summary.found).toEqual({ tasks: 2, projects: 1, days: 1, decisions: 1, meta: 1 });
      expect(summary.produced).toMatchObject({ tasks: 2, sessions: 2, projects: 1, days: 1, decisions: 1, places: 2, meta: 1 });
      expect(summary.skipped).toEqual([]);
    });
  }

  it('maps fields to v2', () => {
    const { data, summary } = importV1(byId, 'UTC');
    const t1 = fieldsOf(data.tasks!.find(t => t.id === 't1')!);
    expect(t1).toMatchObject({ est: 15, est0: 15, estBy: 'me', where: 'france' });
    expect(t1).not.toHaveProperty('sessions');
    expect(t1).not.toHaveProperty('spent');
    const ses = data.sessions!.map(fieldsOf);
    expect(ses.map(s => s.source)).toEqual(['timer', 'typed']);
    expect(ses.every(s => s.taskId === 't1' && !('manual' in s))).toBe(true);
    expect(fieldsOf(data.tasks!.find(t => t.id === 't2')!)).toMatchObject({ estBy: 'ai', spentV1: 5 });
    expect(summary.spentMismatch).toBe(1);
    expect(fieldsOf(data.projects![0]!)).toMatchObject({ goalBy: 'ai' });
    expect(data.places!.map(p => [p.id, fieldsOf(p)])).toEqual([
      ['cairo', { name: 'Cairo', timeZone: 'Africa/Cairo', order: 0 }],
      ['france', { name: 'France', timeZone: 'Europe/Paris', order: 1 }],
    ]);
    expect(fieldsOf(data.meta![0]!)).toEqual({ here: 'france', ratio: 1.4 });
  });

  it('reports what it skips', () => {
    const { summary } = importV1({ ...byId, tasks: [{ title: 'no id' }, 'junk', { id: 'ok', title: 'x' }], extra: { a: 1 } }, 'UTC');
    expect(summary.skipped).toEqual(expect.arrayContaining([
      { collection: 'tasks', id: '#0', reason: 'no id' },
      { collection: 'tasks', id: '#1', reason: 'not an object' },
      { collection: 'extra', id: '*', reason: 'unknown collection' },
    ]));
  });

  it('refuses something that is not an export', () => {
    expect(() => importV1({ hello: 1 })).toThrow();
    expect(() => importV1('nope')).toThrow();
  });

  it('writes with a backup, and v2 edits win over a re-import', async () => {
    const db = new ReussiteDb('import-test');
    const { data } = importV1(byId, 'UTC');
    await writeImport(db, data);
    expect(await db.tasks.count()).toBe(2);
    const t = (await db.tasks.get('t1'))!;
    await db.tasks.put({ ...t, title: 'Edited', _hlc: { ...t._hlc, title: '0000000000005:0000:dev' } });
    await writeImport(db, data);
    expect((await db.tasks.get('t1'))!.title).toBe('Edited');
    expect(await db.backups.count()).toBe(2);
  });
});
