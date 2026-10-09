import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ReussiteDb } from './db';
import { makeBackup, parseBackup, restoreBackup } from './backup';
import { create } from './doc';

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
  it('refuses other files and newer versions', () => {
    expect(() => parseBackup({ tasks: {} })).toThrow();
    expect(() => parseBackup({ format: 'reussite-backup', schema: 999, data: {} })).toThrow(/newer/);
  });
});
