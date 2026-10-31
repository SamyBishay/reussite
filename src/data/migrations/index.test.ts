import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ReussiteDb, setLocal } from '../db';
import Dexie from 'dexie';
import { runMigrations, migrateData, upgradeEntries, type Migration } from './index';
import { ZERO } from '../hlc';
import { merge } from '../doc';
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

describe('migrations 2 → 3, 3 → 4, 4 → 5 and 5 → 6', () => {
  // A schema-1, 2, 3, 4 or 5 database as the earlier versions left them: Dexie version 1 (schemas 1 and 2: no memory or
  // exchanges tables), 2 (schema 3: no addresses or people tables) or 3 (schemas 4 and 5).
  async function oldDb(name: string, schema: number): Promise<void> {
    const old = new Dexie(name);
    old.version(1).stores({ tasks: 'id, status, project, doneDay, due', sessions: 'id, taskId, d', projects: 'id', days: 'id', decisions: 'id', places: 'id', stays: 'id, from', meta: 'id', local: 'key', backups: '++id, at' });
    if (schema >= 3) old.version(2).stores({ memory: 'id, kind', exchanges: 'id, at' });
    if (schema >= 4) old.version(3).stores({ addresses: 'id, placeId, state', people: 'id, placeId' });
    await old.open();
    await old.table('tasks').put({ id: 't1', _v: schema, _hlc: { title: 'h1' }, title: 'Kept', status: 'open', mystery: { deep: [1, 2] } });
    await old.table('tasks').put({ id: 't2', _v: schema, _hlc: { title: 'h1' }, _del: 'h2', title: 'Gone' });
    // A standing obligation that still carries flags (what the app wrote before the matrix ignored them), and one already clear.
    await old.table('tasks').put({ id: 'tm1', _v: schema, _hlc: { title: 'h1', urgent: '0000000000005:0001:abc', important: '0000000000004:0003:abc', template: 'h1' }, title: 'Choir', template: true, urgent: true, important: true, weekdays: [1], at: '19:00', mystery: 'kept' });
    await old.table('tasks').put({ id: 'tm2', _v: schema, _hlc: { title: 'h1', urgent: 'h2' }, title: 'Walk', template: true, urgent: false, important: false });
    await old.table('tasks').put({ id: 't3', _v: schema, _hlc: { title: 'h1', urgent: 'h4' }, title: 'Ordinary', urgent: true, important: true });
    // A step as every version before 6 wrote it, with a kind of its own; and one that never had a kind.
    await old.table('tasks').put({ id: 't4', _v: schema, _hlc: { title: 'h1', kind: 'h1' }, title: 'A decision step', kind: 'decision', status: 'open' });
    await old.table('tasks').put({ id: 't5', _v: schema, _hlc: { title: 'h1' }, title: 'No kind at all', status: 'open' });
    await old.table('decisions').put(schema === 1
      ? { id: 'd1', _v: 1, _hlc: { title: 'h1', problem: 'h1' }, title: 'Stay?', problem: 'Rent', chosen: 'Stay', options: [{ name: 'Stay', pros: [['cheap', 3]], cons: [] }] }
      : { id: 'd1', _v: 2, _hlc: { title: 'h1', problem: 'h1' }, title: 'Stay?', problem: { what: 'Rent', should: '', gap: '', constraints: '', deadline: '', control: '' }, status: 'decided', chosen: 'Stay', chosenId: 'o0', options: [{ id: 'o0', name: 'Stay', pros: [{ id: 'i', text: 'cheap', w: 3 }], cons: [], prosNot: [], consNot: [] }] });
    await old.table('meta').put({ id: 'settings', _v: schema, _hlc: { language: 'h1' }, language: 'fr' });
    if (schema >= 3) {
      await old.table('memory').put({ id: 'm1', _v: 3, _hlc: { name: 'h1' }, name: 'Ibrahim', futureField: 'kept' });
      await old.table('exchanges').put({ id: 'e1', _v: 3, _hlc: { text: 'h1' }, text: 'hello' });
    }
    if (schema >= 4) {
      await old.table('addresses').put({ id: 'a1', _v: 4, _hlc: { name: 'h1' }, name: 'Chez Zed', visits: [], futureField: 'kept' });
      await old.table('people').put({ id: 'p1', _v: 4, _hlc: { name: 'h1' }, name: 'Ibrahim' });
    }
    await old.table('local').put({ key: 'schema', value: schema });
    await old.table('local').put({ key: 'node', value: 'abc12345' });
    old.close();
  }

  for (const from of [1, 2, 3, 4, 5]) {
    it(`brings a schema ${from} database to ${SCHEMA_VERSION}: nothing lost`, async () => {
      await oldDb('upgrade-' + from, from);
      const db = new ReussiteDb('upgrade-' + from); // Dexie upgrades version 1 to 2 when it opens: the new tables exist before the migration runs
      expect(await runMigrations(db)).toEqual({ status: 'migrated', from });
      expect(await db.tasks.get('t1')).toMatchObject({ title: 'Kept', status: 'open', mystery: { deep: [1, 2] }, _hlc: { title: 'h1' } });
      expect((await db.tasks.get('t2'))!._del).toBe('h2');
      expect(await db.meta.get('settings')).toMatchObject({ language: 'fr' });
      expect(await db.decisions.get('d1')).toMatchObject({ title: 'Stay?', status: 'decided', chosen: 'Stay', problem: { what: 'Rent' } });
      expect(await db.memory.count()).toBe(from >= 3 ? 1 : 0);
      expect(await db.exchanges.count()).toBe(from >= 3 ? 1 : 0);
      if (from >= 3) expect(await db.memory.get('m1')).toMatchObject({ name: 'Ibrahim', futureField: 'kept' });
      expect(await db.addresses.count()).toBe(from >= 4 ? 1 : 0);
      expect(await db.people.count()).toBe(from >= 4 ? 1 : 0);
      if (from >= 4) expect(await db.addresses.get('a1')).toMatchObject({ name: 'Chez Zed', futureField: 'kept' });
      // Schema 5: a standing obligation loses its flags, on a clock right after the old one; nothing else changes. A database already at 5 keeps what it wrote.
      const tm1 = (await db.tasks.get('tm1'))!;
      if (from <= 4) {
        expect(tm1).toMatchObject({ title: 'Choir', template: true, urgent: false, important: false, weekdays: [1], at: '19:00', mystery: 'kept' });
        expect(tm1._hlc).toEqual({ title: 'h1', template: 'h1', urgent: '0000000000005:0002:abc', important: '0000000000004:0004:abc' });
      } else {
        expect(tm1).toMatchObject({ title: 'Choir', template: true, urgent: true, important: true, weekdays: [1], at: '19:00', mystery: 'kept' });
      }
      // Schema 6 (event steps): old steps read as tasks. Nothing is added, nothing is rewritten, and no step becomes an event.
      expect(await db.tasks.get('t4')).toMatchObject({ title: 'A decision step', kind: 'decision', _hlc: { title: 'h1', kind: 'h1' } });
      expect(await db.tasks.get('t5')).toMatchObject({ title: 'No kind at all', _hlc: { title: 'h1' } });
      expect(await db.tasks.get('t5')).not.toHaveProperty('kind');
      for (const t of await db.tasks.toArray()) { expect(t.kind).not.toBe('event'); expect(t).not.toHaveProperty('nudge'); }
      expect(await db.tasks.get('tm2')).toMatchObject({ urgent: false, important: false, _hlc: { title: 'h1', urgent: 'h2' } });
      expect(await db.tasks.get('t3')).toMatchObject({ urgent: true, important: true, _hlc: { title: 'h1', urgent: 'h4' } });
      expect((await db.tasks.get('tm1'))).not.toHaveProperty('label');
      expect((await db.places.toArray()).every(p => !('parentId' in p))).toBe(true);
      expect(await db.local.get('node')).toEqual({ key: 'node', value: 'abc12345' });
      expect(await db.local.get('schema')).toEqual({ key: 'schema', value: SCHEMA_VERSION });
      expect((await db.backups.toArray()).map(b => b.schema)).toEqual([from]);
      expect(await runMigrations(db)).toEqual({ status: 'current' });
    });
  }

  it('changes no data: migrations 2 → 3, 3 → 4 and 5 → 6 are the identity', () => {
    const data = { tasks: [{ id: 'a', _v: 2, _hlc: { title: 'h' }, title: 'x', odd: 1 }], memory: [], exchanges: [] };
    expect(migrateData(structuredClone(data), 2, 3)).toEqual(data);
    expect(migrateData(structuredClone(data), 3, 4)).toEqual(data);
    expect(migrateData(structuredClone(data), 5, 6)).toEqual(data);
  });

  it('4 → 5 clears urgent and important on standing obligations only, through their field clocks', () => {
    const c1 = '0000000000005:0001:abc';
    const data = {
      tasks: [
        { id: 'tm', _v: 4, _hlc: { urgent: c1, important: c1, title: c1 }, title: 'Choir', template: true, urgent: true, important: true, odd: [1] },
        { id: 'half', _v: 4, _hlc: { urgent: c1 }, title: 'Walk', template: true, urgent: true, important: false },
        { id: 'noclock', _v: 4, _hlc: {}, title: 'Gym', template: true, urgent: true },
        { id: 'copy', _v: 4, _hlc: { urgent: c1 }, title: 'Choir (Monday)', from: 'tm', urgent: true },
        { id: 'plain', _v: 4, _hlc: { urgent: c1 }, title: 'Pay rent', urgent: true, important: true },
        { id: 'gone', _v: 4, _hlc: { urgent: c1 }, _del: c1, title: 'Old', template: true, urgent: true },
      ],
      places: [{ id: 'pl', _v: 4, _hlc: { name: c1 }, name: 'Paris', timeZone: 'Europe/Paris', order: 0 }],
      days: [{ id: '2026-10-01', _v: 4, _hlc: {}, date: '2026-10-01', plan: [] }],
    };
    const out = migrateData(structuredClone(data), 4, 5);
    const by = (id: string) => out.tasks!.find(t => t.id === id)!;
    expect(by('tm')).toMatchObject({ _v: 5, urgent: false, important: false, odd: [1], _hlc: { title: c1, urgent: '0000000000005:0002:abc', important: '0000000000005:0002:abc' } });
    expect(by('half')).toMatchObject({ urgent: false, important: false, _hlc: { urgent: '0000000000005:0002:abc' } });
    expect((by('half')._hlc as Record<string, string>).important).toBeUndefined();
    expect(by('noclock')).toMatchObject({ urgent: false, _hlc: { urgent: '0000000000000:0001:0' } });
    expect(by('copy')).toEqual(data.tasks[3]);
    expect(by('plain')).toEqual(data.tasks[4]);
    expect(by('gone')).toMatchObject({ urgent: false, _del: c1 });
    expect(out.places).toEqual(data.places);
    expect(out.days).toEqual(data.days);
    expect(migrateData(structuredClone(out), 5, 5)).toEqual(out);
    // The new clock beats the old value wherever it is found, and loses to any later edit.
    const hl = by('tm')._hlc as Record<string, string>;
    expect(hl.urgent! > c1).toBe(true);
    expect('0000000000006:0000:abc' > hl.urgent!).toBe(true);
  });

  it('4 → 5: two devices that each migrate get the same document, and a copy that has not yet migrated loses to it', () => {
    const c1 = '0000000000005:0001:abc';
    const old = { id: 'tm', _v: 4, _hlc: { urgent: c1, title: c1 }, title: 'Choir', template: true, urgent: true } as const;
    const a = migrateData({ tasks: [structuredClone(old)] }, 4, 5).tasks![0]!;
    const b = migrateData({ tasks: [structuredClone(old)] }, 4, 5).tasks![0]!;
    expect(a).toEqual(b);
    const merged = merge(a as never, structuredClone(old) as never) as unknown as Record<string, unknown>;
    expect(merged.urgent).toBe(false);
  });

  it('4 → 5: a whole older document that arrives from another device is brought up the same way; a partial one is left alone', () => {
    const c1 = '0000000000005:0001:abc';
    const [whole, part] = upgradeEntries([
      { c: 'tasks', d: { id: 'tm', _v: 4, _hlc: { urgent: c1, template: c1 }, template: true, urgent: true } },
      { c: 'tasks', d: { id: 'tm', _v: 4, _hlc: { urgent: c1 }, urgent: true } },
    ]);
    expect(whole!.d).toEqual({ id: 'tm', _v: SCHEMA_VERSION, _hlc: { urgent: '0000000000005:0002:abc', template: c1 }, template: true, urgent: false });
    expect(part!.d).toEqual({ id: 'tm', _v: SCHEMA_VERSION, _hlc: { urgent: c1 }, urgent: true });
  });

  it('a step with a label, a place with a parent and a day with areas, written by a later run, survive untouched', async () => {
    const db = fresh();
    await db.tasks.put({ id: 't1', _v: 5, _hlc: { label: 'h1' }, title: 'Go to choir', label: 'Choir · Hill House', futureField: 1 });
    await db.places.put({ id: 'cairo', _v: 5, _hlc: { name: 'h1' }, name: 'Cairo', timeZone: 'Africa/Cairo', order: 0 });
    await db.places.put({ id: 'heli', _v: 5, _hlc: { name: 'h1', parentId: 'h1' }, name: 'Heliopolis', timeZone: 'Africa/Cairo', order: 1, parentId: 'cairo' });
    await db.days.put({ id: '2026-10-01', _v: 5, _hlc: { areas: 'h1' }, date: '2026-10-01', areas: [{ half: 'am', placeId: 'heli' }] });
    expect(await runMigrations(db)).toEqual({ status: 'current' });
    expect(await db.tasks.get('t1')).toMatchObject({ label: 'Choir · Hill House', futureField: 1 });
    expect(await db.places.get('heli')).toMatchObject({ parentId: 'cairo' });
    expect(await db.days.get('2026-10-01')).toMatchObject({ areas: [{ half: 'am', placeId: 'heli' }] });
  });

  it('addresses and people written by a later run survive untouched, with fields this version does not know', async () => {
    const db = fresh();
    await db.addresses.put({ id: 'a1', _v: 4, _hlc: { name: 'h1' }, name: 'Chez Zed', visits: [], futureField: 'kept' });
    await db.people.put({ id: 'p1', _v: 4, _hlc: { name: 'h1' }, name: 'Ibrahim', futureField: 'kept' });
    expect(await runMigrations(db)).toEqual({ status: 'current' });
    expect(await db.addresses.get('a1')).toMatchObject({ name: 'Chez Zed', futureField: 'kept' });
    expect(await db.people.get('p1')).toMatchObject({ name: 'Ibrahim', futureField: 'kept' });
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
      { c: 'tasks', d: { id: 't2', _v: 3, _hlc: { note: 'h8' }, note: 'from schema 3' } },
    ];
    const up = upgradeEntries(entries);
    expect(up[0]!.d).toEqual({ id: 't1', _v: SCHEMA_VERSION, _hlc: { note: 'h5' }, note: 'only this' });
    expect(up[1]!.d).toEqual({ id: 'd1', _v: SCHEMA_VERSION, _hlc: { why: 'h6' }, why: 'only this' });
    expect(up[2]).toEqual({ c: 'memory', d: { id: 'm1', _v: SCHEMA_VERSION, _hlc: { name: 'h7' }, name: 'Current' } });
    expect(up[3]!.d).toEqual({ id: 't2', _v: SCHEMA_VERSION, _hlc: { note: 'h8' }, note: 'from schema 3' });
    const current = { c: 'addresses', d: { id: 'a1', _v: SCHEMA_VERSION, _hlc: { name: 'h9' }, name: 'Now' } };
    expect(upgradeEntries([current])[0]).toBe(current);
  });
});
