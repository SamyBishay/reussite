import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ReussiteDb } from './db';
import { makeBackup, parseBackup, restoreBackup } from './backup';
import { create } from './doc';
import { SCHEMA_VERSION } from './schema';

describe('backup', () => {
  it('round-trips through JSON, deletions included', async () => {
    const a = new ReussiteDb('bk-a');
    await a.tasks.put(create<Record<string, unknown>>('t1', { title: 'x' }, 1, '0000000000001:0000:a'));
    await a.tasks.put({ ...create<Record<string, unknown>>('t2', { title: 'gone' }, 1, '0000000000001:0000:a'), _del: '0000000000002:0000:a' });
    const file = parseBackup(JSON.parse(JSON.stringify(await makeBackup(a))));
    const b = new ReussiteDb('bk-b');
    const counts = await restoreBackup(b, file);
    expect(counts.tasks).toBe(2);
    expect((await b.tasks.get('t2'))!._del).toBeDefined();
    expect(await b.backups.count()).toBe(1);
  });
  it('carries memory notes and exchanges, and restoring an older backup keeps the ones here', async () => {
    const a = new ReussiteDb('bk-m-a');
    await a.memory.put(create<Record<string, unknown>>('m1', { kind: 'person', name: 'Ibrahim', lines: [{ id: 'l0', text: 'Moves in March', at: '2026-10-01T10:00:00Z', by: 'me' }], futureField: 7 }, SCHEMA_VERSION, '0000000000001:0000:a'));
    await a.exchanges.put({ ...create<Record<string, unknown>>('e1', { at: '2026-10-02T10:00:00Z', text: 'hi', undo: { c1: [{ c: 'tasks', id: 't1', created: true }] } }, SCHEMA_VERSION, '0000000000001:0000:a'), _del: '0000000000002:0000:a' });
    const file = parseBackup(JSON.parse(JSON.stringify(await makeBackup(a))));
    expect(file.schema).toBe(SCHEMA_VERSION);
    const b = new ReussiteDb('bk-m-b');
    const counts = await restoreBackup(b, file);
    expect(counts).toMatchObject({ memory: 1, exchanges: 1 });
    expect(await b.memory.get('m1')).toEqual(await a.memory.get('m1'));
    expect((await b.exchanges.get('e1'))!._del).toBeDefined();

    // a backup from before schema 3 has no such collections: restoring it leaves what is here
    const old = parseBackup({ format: 'reussite-backup', schema: 2, exported: '2026-10-01T00:00:00Z', data: { tasks: [create<Record<string, unknown>>('t9', { title: 'Old' }, 2, '0000000000001:0000:z')] } });
    expect(await restoreBackup(b, old)).toMatchObject({ tasks: 1, memory: 0, exchanges: 0 });
    expect(await b.memory.get('m1')).toMatchObject({ name: 'Ibrahim', futureField: 7 });
    expect((await b.exchanges.get('e1'))!._del).toBeDefined();
    expect(await b.tasks.get('t9')).toBeDefined();
  });
  it('carries addresses and people, deletions included; a restore merges and an older backup leaves them', async () => {
    const a = new ReussiteDb('bk-ap-a');
    const c = '0000000000001:0000:a';
    await a.addresses.put(create<Record<string, unknown>>('a1', { name: 'Chez Zed', state: 'been', visits: [{ id: 'v1', day: '2026-10-01', note: 'good', verdict: 'again' }], futureField: 7 }, SCHEMA_VERSION, c));
    await a.people.put({ ...create<Record<string, unknown>>('p1', { name: 'Ibrahim', reach: 'whatsapp://send?phone=1', lastSeen: '2026-10-01' }, SCHEMA_VERSION, c), _del: '0000000000002:0000:a' });
    const file = parseBackup(JSON.parse(JSON.stringify(await makeBackup(a))));
    const b = new ReussiteDb('bk-ap-b');
    // here, a newer edit of the same address
    await b.addresses.put({ ...create<Record<string, unknown>>('a1', { name: 'Chez Zed', state: 'want', visits: [], note: 'edited here' }, SCHEMA_VERSION, '0000000000009:0000:b') });
    expect(await restoreBackup(b, file)).toMatchObject({ addresses: 1, people: 1 });
    expect(await b.addresses.get('a1')).toMatchObject({ name: 'Chez Zed', note: 'edited here', futureField: 7 });
    expect((await b.people.get('p1'))!._del).toBeDefined();
    const old = parseBackup({ format: 'reussite-backup', schema: 3, exported: '2026-10-01T00:00:00Z', data: { tasks: [] } });
    expect(await restoreBackup(b, old)).toMatchObject({ addresses: 0, people: 0 });
    expect(await b.addresses.get('a1')).toBeDefined();
  });
  it('a schema 4 backup is brought to the current schema and merged: a standing obligation loses its flags, a newer edit here wins', async () => {
    const b = new ReussiteDb('bk-s4');
    const c = '0000000000001:0000:a';
    await b.tasks.put(create<Record<string, unknown>>('tm', { title: 'Choir', template: true, urgent: false }, SCHEMA_VERSION, '0000000000009:0000:b'));
    const file = parseBackup({ format: 'reussite-backup', schema: 4, exported: '2026-10-01T00:00:00Z', data: { tasks: [
      create<Record<string, unknown>>('tm', { title: 'Old choir', template: true, urgent: true, important: true }, 4, c),
      create<Record<string, unknown>>('t1', { title: 'Pay', urgent: true }, 4, c),
    ] } });
    await restoreBackup(b, file);
    expect(await b.tasks.get('tm')).toMatchObject({ title: 'Choir', urgent: false, important: false });
    expect(await b.tasks.get('t1')).toMatchObject({ title: 'Pay', urgent: true });
  });
  it('refuses other files and newer versions', () => {
    expect(() => parseBackup({ tasks: {} })).toThrow();
    expect(() => parseBackup({ format: 'reussite-backup', schema: 999, data: {} })).toThrow(/newer/);
  });
});
