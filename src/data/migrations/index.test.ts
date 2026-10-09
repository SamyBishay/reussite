import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ReussiteDb, setLocal } from '../db';
import { runMigrations, migrateData, type Migration } from './index';

let n = 0;
const fresh = () => new ReussiteDb('test-' + n++);

describe('migrations', () => {
  it('a fresh database is current', async () => {
    expect(await runMigrations(fresh())).toEqual({ status: 'current' });
  });

  it('backs up, migrates and keeps unknown fields', async () => {
    const db = fresh();
    await setLocal(db, 'schema', 1);
    await db.tasks.put({ id: 't', _v: 1, _hlc: {}, title: 'x', mystery: 7 });
    const m: Migration = d => ({ ...d, tasks: (d.tasks ?? []).map(t => ({ ...t, added: true })) });
    const r = await runMigrations(db, [m], 2);
    expect(r).toEqual({ status: 'migrated', from: 1 });
    expect(await db.tasks.get('t')).toMatchObject({ title: 'x', mystery: 7, added: true });
    expect(await db.backups.count()).toBe(1);
  });

  it('refuses data from a newer version', async () => {
    const db = fresh();
    await setLocal(db, 'schema', 9);
    expect(await runMigrations(db)).toEqual({ status: 'newer', found: 9 });
  });

  it('fails loudly on a gap', () => {
    expect(() => migrateData({}, 1, 3, [d => d])).toThrow(/2 to 3/);
  });
});
