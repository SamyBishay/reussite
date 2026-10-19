import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, createDoc, putMerged, readOnly, saveSettings, settings, update } from './store';
import { getLocal } from '../data/db';
import { withDefaults } from '../data/settings';
import { RecoveryKeyError, deriveKeys, encodeRecoveryKey, generateKey } from '../sync/keys';
import { RelayClient } from '../sync/client';
import { SCHEMA_VERSION } from '../data/schema';
import { fakeRelay } from '../sync/testing';
import { buildDiagnostics } from './diagnostics';
import { backupText, joinSync, lastSyncAt, probeKey, readBackupFile, recoveryKeyText, relayBase, setupSync, startSync, syncError, syncNow, syncOn, turnOffSync } from './sync';
import { isEncryptedBackup } from '../sync/backup';

const relay = fakeRelay();
beforeAll(() => {
  // The node environment has crypto.subtle, which jsdom lacks; the page events are stubbed.
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  settings.value = withDefaults({ relayUrl: 'http://localhost:8787' });
  vi.stubGlobal('fetch', relay.fetch);
});
afterEach(() => { readOnly.value = false; });

describe('sync in the app', () => {
  it('only accepts https, or http on this computer', () => {
    for (const [u, ok] of [['http://localhost:8787', true], ['https://relay.example/', true], ['http://relay.example', false], ['', false], ['nonsense', false]] as const) {
      settings.value = withDefaults({ relayUrl: u });
      expect(!!relayBase()).toBe(ok);
    }
    settings.value = withDefaults({ relayUrl: 'http://localhost:8787' });
  });

  it('sets up, pushes everything, shows the key, keeps it out of the data, and turns off', async () => {
    const { start } = await import('./store');
    await start();
    await saveSettings({ relayUrl: 'http://localhost:8787' });
    await vi.waitFor(() => expect(relayBase()).toBeTruthy());
    await createDoc('tasks', { title: 'Zebra invoice' }, 'tz1');
    await startSync();
    expect(syncOn.value).toBe(false);
    const text = await setupSync();
    expect(text).toBe(recoveryKeyText());
    expect(text).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
    expect(syncOn.value).toBe(true);
    await vi.waitFor(() => expect(lastSyncAt.value).not.toBeNull());
    expect(syncError.value).toBeNull();
    expect([...relay.spaces.values()]).toHaveLength(1);
    // a later local write goes out on the next round
    await update('tasks', 'tz1', { title: 'Zebra invoice 2' });
    await syncNow();
    expect([...relay.spaces.values()][0]!.batches.length).toBeGreaterThanOrEqual(2);
    // the diagnostics block has the state and none of the key or the titles
    const diag = await buildDiagnostics();
    expect(diag).toContain('[sync]\nstate: on');
    expect(diag).toContain('pending changes: 0');
    expect(diag).not.toContain(text);
    expect(diag).not.toContain('Zebra');
    // the key is in `local`, which is never part of a backup or a batch
    expect(await getLocal(db, 'sync.key')).toBeTruthy();
    // an encrypted backup opens with the key and not without
    const enc = JSON.parse(await backupText(true));
    expect(isEncryptedBackup(enc)).toBe(true);
    expect(JSON.stringify(enc)).not.toContain('Zebra');
    expect(JSON.stringify(await readBackupFile(enc))).toContain('Zebra invoice 2');
    expect(await readBackupFile({ format: 'reussite-backup' })).toEqual({ format: 'reussite-backup' });
    await turnOffSync();
    expect(syncOn.value).toBe(false);
    expect(await getLocal(db, 'sync.key')).toBeUndefined();
    await expect(readBackupFile(enc)).rejects.toThrow('needs-key');
    expect((await db.tasks.get('tz1'))!.title).toBe('Zebra invoice 2'); // the list stays
    expect(JSON.parse(await backupText(true)).format).toBe('reussite-backup'); // no key: plain
  });

  it('a typo shows which kind; an unknown key is "empty"; a known one is not', async () => {
    const key = encodeRecoveryKey(generateKey());
    await expect(probeKey(key.slice(0, -1))).rejects.toMatchObject({ code: 'length' });
    await expect(probeKey(key.slice(0, -1) + (key.endsWith('0') ? '1' : '0'))).rejects.toBeInstanceOf(RecoveryKeyError);
    expect((await probeKey(key)).empty).toBe(true);
    const text = await setupSync();
    await vi.waitFor(() => expect(lastSyncAt.value).not.toBeNull());
    expect((await probeKey(text)).empty).toBe(false);
    await turnOffSync();
  });

  it('joins with the key, pulls what another device wrote, and keeps what is here', async () => {
    const recovery = generateKey();
    const other = new RelayClient(relayBase(), await deriveKeys(recovery));
    await other.push({ v: SCHEMA_VERSION, device: 'other1', docs: [{ c: 'tasks', d: { id: 'tr1', _v: SCHEMA_VERSION, _hlc: { title: '0000099999999:0000:other1' }, title: 'From the other device' } }] });
    const text = encodeRecoveryKey(recovery);
    const probe = await probeKey(text);
    expect(probe.empty).toBe(false);
    await joinSync(probe.recovery);
    await vi.waitFor(async () => expect((await db.tasks.get('tr1'))?.title).toBe('From the other device'));
    expect((await db.tasks.get('tz1'))?.title).toBe('Zebra invoice 2');
    await vi.waitFor(() => expect(lastSyncAt.value).not.toBeNull());
    expect(await getLocal(db, 'sync.keySaved')).toBe(true);
    await turnOffSync();
  });

  it('read-only mode refuses merged writes, so a round never marks them as applied', async () => {
    readOnly.value = true;
    await expect(putMerged([{ c: 'tasks', d: { id: 'x', _v: 2, _hlc: {}, title: 'x' } }])).rejects.toThrow('read-only');
    expect(await db.tasks.get('x')).toBeUndefined();
  });
});
