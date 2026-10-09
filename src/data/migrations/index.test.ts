import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ReussiteDb, setLocal } from '../db';
import { runMigrations, migrateData, type Migration } from './index';
import { ZERO } from '../hlc';
import { SCHEMA_VERSION } from '../schema';

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

describe('migration 1 → 2', () => {
  it('gives v1 decisions the structured shape and keeps every field', async () => {
    const db = fresh();
    await setLocal(db, 'schema', 1);
    await db.decisions.put({
      id: 'd1', _v: 1, _hlc: { title: 'h1', problem: 'h1', options: 'h1', chosen: 'h1' },
      title: 'Stay or move?', problem: 'Rent goes up', chosen: 'Stay', why: 'Cheaper', mystery: 1,
      options: [{ name: 'Stay', pros: [['cheaper', 4]], cons: [['small', 2]], prosNot: [], consNot: [], score: 2 }, { name: 'Move', pros: [], cons: [] }],
    });
    await db.decisions.put({ id: 'd2', _v: 1, _hlc: {}, title: 'Later?' });
    expect(await runMigrations(db)).toEqual({ status: 'migrated', from: 1 });
    const d = (await db.decisions.get('d1'))!;
    expect(d).toMatchObject({
      _v: 2, title: 'Stay or move?', mystery: 1, why: 'Cheaper', status: 'decided', chosen: 'Stay', chosenId: 'o0',
      problem: { what: 'Rent goes up', should: '', gap: '', constraints: '', deadline: '', control: '' },
    });
    const o = (d.options as Record<string, unknown>[])[0]!;
    expect(o).toMatchObject({ id: 'o0', name: 'Stay', score: 2, pros: [{ text: 'cheaper', w: 4 }], cons: [{ text: 'small', w: 2 }] });
    // Changed fields keep their clock; new fields get the oldest one.
    expect(d._hlc).toMatchObject({ problem: 'h1', options: 'h1', status: ZERO, chosenId: ZERO });
    expect(await db.decisions.get('d2')).toMatchObject({ status: 'draft', options: [], title: 'Later?' });
    expect(await db.backups.count()).toBe(1);
  });

  it('every earlier version reaches the current one', () => {
    for (let v = 1; v < SCHEMA_VERSION; v++) expect(() => migrateData({ decisions: [{ id: 'x', _v: v, _hlc: {}, title: 't' }] }, v)).not.toThrow();
  });
});
