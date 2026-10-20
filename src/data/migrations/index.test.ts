import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ReussiteDb, setLocal } from '../db';
import Dexie from 'dexie';
import { runMigrations, migrateData, upgradeEntries, type Migration } from './index';
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

describe('migration 2 → 3', () => {
  // A schema-1 and a schema-2 database as the earlier versions left them: Dexie version 1, no memory or exchanges tables.
  async function oldDb(name: string, schema: number): Promise<void> {
    const old = new Dexie(name);
    old.version(1).stores({ tasks: 'id, status, project, doneDay, due', sessions: 'id, taskId, d', projects: 'id', days: 'id', decisions: 'id', places: 'id', stays: 'id, from', meta: 'id', local: 'key', backups: '++id, at' });
    await old.open();
    await old.table('tasks').put({ id: 't1', _v: schema, _hlc: { title: 'h1' }, title: 'Kept', status: 'open', mystery: { deep: [1, 2] } });
    await old.table('tasks').put({ id: 't2', _v: schema, _hlc: { title: 'h1' }, _del: 'h2', title: 'Gone' });
    await old.table('decisions').put(schema === 1
      ? { id: 'd1', _v: 1, _hlc: { title: 'h1', problem: 'h1' }, title: 'Stay?', problem: 'Rent', chosen: 'Stay', options: [{ name: 'Stay', pros: [['cheap', 3]], cons: [] }] }
      : { id: 'd1', _v: 2, _hlc: { title: 'h1', problem: 'h1' }, title: 'Stay?', problem: { what: 'Rent', should: '', gap: '', constraints: '', deadline: '', control: '' }, status: 'decided', chosen: 'Stay', chosenId: 'o0', options: [{ id: 'o0', name: 'Stay', pros: [{ id: 'i', text: 'cheap', w: 3 }], cons: [], prosNot: [], consNot: [] }] });
    await old.table('meta').put({ id: 'settings', _v: schema, _hlc: { language: 'h1' }, language: 'fr' });
    await old.table('local').put({ key: 'schema', value: schema });
    await old.table('local').put({ key: 'node', value: 'abc12345' });
    old.close();
  }

  for (const from of [1, 2]) {
    it(`brings a schema ${from} database to ${SCHEMA_VERSION}: nothing lost, memory and exchanges empty`, async () => {
      await oldDb('upgrade-' + from, from);
      const db = new ReussiteDb('upgrade-' + from); // Dexie upgrades version 1 to 2 when it opens: the new tables exist before the migration runs
      expect(await runMigrations(db)).toEqual({ status: 'migrated', from });
      expect(await db.tasks.get('t1')).toMatchObject({ title: 'Kept', status: 'open', mystery: { deep: [1, 2] }, _hlc: { title: 'h1' } });
      expect((await db.tasks.get('t2'))!._del).toBe('h2');
      expect(await db.meta.get('settings')).toMatchObject({ language: 'fr' });
      expect(await db.decisions.get('d1')).toMatchObject({ title: 'Stay?', status: 'decided', chosen: 'Stay', problem: { what: 'Rent' } });
      expect(await db.memory.count()).toBe(0);
      expect(await db.exchanges.count()).toBe(0);
      expect(await db.local.get('node')).toEqual({ key: 'node', value: 'abc12345' });
      expect(await db.local.get('schema')).toEqual({ key: 'schema', value: SCHEMA_VERSION });
      expect((await db.backups.toArray()).map(b => b.schema)).toEqual([from]);
      expect(await runMigrations(db)).toEqual({ status: 'current' });
    });
  }

  it('changes no data: the migration is the identity', () => {
    const data = { tasks: [{ id: 'a', _v: 2, _hlc: { title: 'h' }, title: 'x', odd: 1 }], memory: [], exchanges: [] };
    expect(migrateData(structuredClone(data), 2, 3)).toEqual(data);
  });

  it('a note and an exchange survive a later run untouched', async () => {
    const db = fresh();
    await db.memory.put({ id: 'm1', _v: 3, _hlc: { name: 'h1' }, name: 'Ibrahim', futureField: 'kept' });
    await db.exchanges.put({ id: 'e1', _v: 3, _hlc: { text: 'h1' }, text: 'hello' });
    expect(await runMigrations(db)).toEqual({ status: 'current' });
    expect(await db.memory.get('m1')).toMatchObject({ name: 'Ibrahim', futureField: 'kept' });
    expect(await db.exchanges.get('e1')).toMatchObject({ text: 'hello' });
  });

  it('documents from an older device are brought up to date as they are: partial, clocks kept, nothing added', () => {
    const entries = [
      { c: 'tasks', d: { id: 't1', _v: 1, _hlc: { note: 'h5' }, note: 'only this' } },
      { c: 'decisions', d: { id: 'd1', _v: 2, _hlc: { why: 'h6' }, why: 'only this' } },
      { c: 'memory', d: { id: 'm1', _v: 3, _hlc: { name: 'h7' }, name: 'Current' } },
    ];
    const up = upgradeEntries(entries);
    expect(up[0]!.d).toEqual({ id: 't1', _v: SCHEMA_VERSION, _hlc: { note: 'h5' }, note: 'only this' });
    expect(up[1]!.d).toEqual({ id: 'd1', _v: SCHEMA_VERSION, _hlc: { why: 'h6' }, why: 'only this' });
    expect(up[2]).toBe(entries[2]);
  });
});
