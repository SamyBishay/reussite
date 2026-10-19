// Sync in the app (brief §6): the key and its state in `local`, one round at a time, and the
// moments it runs: on start, when the page becomes visible, two seconds after the last local
// write, and when the network comes back. Failures are quiet (the error log) and retried with
// backoff. The pure parts are in src/sync; the Dexie store is in src/data/syncstore.ts.
import { signal } from '@preact/signals';
import { db, getClock, onLocalWrite, putMerged, readOnly, settings } from './store';
import { getLocal, setLocal } from '../data/db';
import { dexieSyncStore, STATE_KEY } from '../data/syncstore';
import { makeBackup, type BackupFile } from '../data/backup';
import { SYNCED_COLLECTIONS, collectOutgoing } from '../sync/engine';
import { RelayClient, RelayError } from '../sync/client';
import { DecryptError } from '../sync/crypto';
import { b64uDecode, b64uEncode, type Bytes } from '../sync/bytes';
import { decodeRecoveryKey, deriveKeys, encodeRecoveryKey, generateKey, type SpaceKeys } from '../sync/keys';
import { INITIAL_STATE, syncOnce, type SyncState } from '../sync/run';
import { isEncryptedBackup, openBackup, sealBackup } from '../sync/backup';
import { browser, os, registerDiagnostics } from './diagnostics';
import { logError } from './errorlog';

const K = {
  key: 'sync.key', saved: 'sync.keySaved', last: 'sync.lastAt', err: 'sync.lastError', full: 'sync.full',
  name: 'sync.deviceName', touched: 'sync.touchedAt', devices: 'sync.deviceCount',
  backupAt: 'backup.lastAt', backupSnooze: 'backup.snoozedAt', firstSeen: 'app.firstSeen',
} as const;
const DAY = 86_400_000;
const REMIND_AFTER = 14 * DAY;
const TOUCH_EVERY = 10 * 60_000;

export interface DeviceInfo { device: string; name: string | null; lastSeen: number }

/** A recovery key is on this device: sync is switched on. */
export const syncOn = signal(false);
/** The person has confirmed they saved the recovery key. */
export const keySaved = signal(true);
export const syncBusy = signal(false);
export const lastSyncAt = signal<number | null>(null);
/** The code of the last failure (a relay error code, 'network', 'decrypt'…), null when the last round worked. */
export const syncError = signal<string | null>(null);
/** The space was deleted from another device: sync is paused until the person turns it off here. */
export const spaceGone = signal(false);
export const deviceName = signal('');
export const devices = signal<DeviceInfo[] | null>(null);
/** Sync is off and it has been two weeks since a backup file was saved (or the reminder put off). */
export const backupDue = signal(false);

let session: { recovery: Bytes; keys: SpaceKeys } | null = null;
const store = dexieSyncStore(db, getClock, putMerged);

/** The relay address if it is one we can use: https, or http on this computer. */
export function relayBase(): string {
  const raw = settings.value.relayUrl.trim();
  try {
    const u = new URL(raw);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'https:' || (u.protocol === 'http:' && local) ? u.origin + u.pathname.replace(/\/+$/, '') : '';
  } catch { return ''; }
}
const client = () => new RelayClient(relayBase(), session!.keys);

export function defaultDeviceName(): string {
  const ua = navigator.userAgent ?? '';
  return browser(ua) + ' · ' + os(ua);
}

// ---------- rounds

let running = false, again = false, started = false;
let debounce: ReturnType<typeof setTimeout> | undefined, retry: ReturnType<typeof setTimeout> | undefined, failures = 0;

const codeOf = (e: unknown) => (e instanceof RelayError ? e.code : e instanceof DecryptError ? 'decrypt' : 'error');

/** Run a round now, or right after the one in progress. Never two at once. */
export async function syncNow(): Promise<void> {
  if (!session || readOnly.value || spaceGone.value || !relayBase()) return;
  if (running) { again = true; return; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  running = true;
  syncBusy.value = true;
  clearTimeout(retry);
  let full = false;
  try {
    do {
      again = false;
      full = !!(await getLocal<boolean>(db, K.full));
      if (full) await setLocal(db, K.full, false);
      const r = await syncOnce(store, client(), { full, stopIfGone: true });
      if (!session) return; // switched off while the round was running
      if (r.newer) { readOnly.value = true; return; }
      if (r.gone) { spaceGone.value = true; return; }
      full = false;
      const at = Date.now();
      lastSyncAt.value = at; syncError.value = null; failures = 0;
      await setLocal(db, K.last, at); await setLocal(db, K.err, null);
      void touch();
    } while (again);
  } catch (e) {
    if (full) await setLocal(db, K.full, true).catch(() => undefined);
    const code = codeOf(e);
    syncError.value = code;
    await setLocal(db, K.err, code).catch(() => undefined);
    void logError(e, 'sync');
    retry = setTimeout(() => void syncNow(), Math.min(300_000, 5_000 * 3 ** failures++));
  } finally {
    running = false;
    syncBusy.value = false;
  }
}

/** Sync soon (default two seconds), restarting the wait on each call. */
export function requestSync(ms = 2000) {
  if (!session) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), ms);
}

/** Documents were written behind store.ts's back (an import, a restore): send everything next round. */
export async function markFull() {
  if (!session) return;
  await setLocal(db, K.full, true);
  requestSync(500);
}

/** Tell the relay this device was seen (at most every 10 minutes, or at once with a new name) and learn who else is there. */
async function touch(force = false) {
  if (!session) return;
  try {
    const last = (await getLocal<number>(db, K.touched)) ?? 0;
    if (!force && Date.now() - last < TOUCH_EVERY && devices.value) return;
    const name = deviceName.value || defaultDeviceName();
    await client().touchDevice(getClock().node, name);
    await setLocal(db, K.touched, Date.now());
    await refreshDevices();
  } catch (e) { void logError(e, 'sync-devices'); }
}

export async function refreshDevices(): Promise<void> {
  if (!session) return;
  const list = await client().devices();
  devices.value = list;
  await setLocal(db, K.devices, list.length);
}

export async function renameDevice(name: string) {
  const n = name.trim().slice(0, 40);
  deviceName.value = n;
  await setLocal(db, K.name, n);
  await touch(true);
}

// ---------- switching on and off

async function open(recovery: Bytes) {
  session = { recovery, keys: await deriveKeys(recovery) };
  syncOn.value = true;
}

/** First device: make a key, keep it here, start pushing. Returns the recovery key to show. */
export async function setupSync(): Promise<string> {
  const recovery = generateKey();
  await setLocal(db, K.key, b64uEncode(recovery));
  await setLocal(db, K.saved, false);
  await setLocal(db, STATE_KEY, { ...INITIAL_STATE });
  keySaved.value = false;
  spaceGone.value = false;
  await open(recovery);
  void navigator.storage?.persist?.().catch(() => undefined);
  void syncNow();
  return encodeRecoveryKey(recovery);
}

export type Probe = { recovery: Bytes; empty: boolean };
/** Check a typed or scanned key and ask the relay if the space exists. Throws RecoveryKeyError, or RelayError('network'). */
export async function probeKey(text: string): Promise<Probe> {
  const recovery = decodeRecoveryKey(text);
  const keys = await deriveKeys(recovery);
  try {
    await new RelayClient(relayBase(), keys).devices();
    return { recovery, empty: false };
  } catch (e) {
    if (e instanceof RelayError && e.code === 'unknown_space') return { recovery, empty: true };
    throw e;
  }
}

/** Another device: keep the key and start syncing. What is on this device is merged with the space, never replaced. */
export async function joinSync(recovery: Bytes): Promise<void> {
  await setLocal(db, K.key, b64uEncode(recovery));
  await setLocal(db, K.saved, true);
  await setLocal(db, STATE_KEY, { ...INITIAL_STATE });
  keySaved.value = true;
  spaceGone.value = false;
  await open(recovery);
  void navigator.storage?.persist?.().catch(() => undefined);
  void syncNow();
}

export const confirmKeySaved = async () => { keySaved.value = true; await setLocal(db, K.saved, true); };

/** The recovery key, for Show recovery key. */
export const recoveryKeyText = (): string => (session ? encodeRecoveryKey(session.recovery) : '');

/** Forget the key on this device. The list stays; the space on the relay is untouched. */
export async function turnOffSync() {
  clearTimeout(debounce); clearTimeout(retry);
  session = null;
  for (const k of [K.key, K.saved, K.last, K.err, K.full, K.touched, K.devices, STATE_KEY]) await db.local.delete(k);
  syncOn.value = false; keySaved.value = true; lastSyncAt.value = null; syncError.value = null; spaceGone.value = false; devices.value = null;
}

/** Delete the space on the relay, then forget the key. Other devices find the space gone and pause. */
export async function deleteEverywhere() {
  if (!session) return;
  await client().deleteSpace();
  await turnOffSync();
}

// ---------- backups

/** A backup file's text for saving: plain JSON, or sealed with the space key. */
export async function backupText(encrypted: boolean): Promise<string> {
  const file = await makeBackup(db);
  const text = encrypted && session ? JSON.stringify(await sealBackup(session.keys, file)) : JSON.stringify(file);
  await noteBackup();
  return text;
}

/** The plain backup inside a file that may be encrypted. Throws 'needs-key' when it is and sync is off. */
export async function readBackupFile(raw: unknown): Promise<unknown> {
  if (!isEncryptedBackup(raw)) return raw;
  if (!session) throw new Error('needs-key');
  return openBackup(session.keys, raw);
}

export async function noteBackup() {
  await setLocal(db, K.backupAt, Date.now());
  backupDue.value = false;
}
export async function snoozeBackupReminder() {
  await setLocal(db, K.backupSnooze, Date.now());
  backupDue.value = false;
}
async function checkBackupDue() {
  const first = (await getLocal<number>(db, K.firstSeen)) ?? Date.now();
  await setLocal(db, K.firstSeen, first);
  const since = Math.max(first, (await getLocal<number>(db, K.backupAt)) ?? 0, (await getLocal<number>(db, K.backupSnooze)) ?? 0);
  backupDue.value = !session && Date.now() - since >= REMIND_AFTER;
}

export type { BackupFile };

// ---------- start

export async function pendingChanges(): Promise<number> {
  const state = (await getLocal<SyncState>(db, STATE_KEY)) ?? INITIAL_STATE;
  const all = Object.fromEntries(await Promise.all(SYNCED_COLLECTIONS.map(async c => [c, await db.table_(c).toArray()] as const)));
  const out = collectOutgoing(all, getClock().node, state.watermark, { imported: state.watermark === '' });
  return out.docs.reduce((n, d) => n + Object.keys(d.d._hlc).length + (d.d._del ? 1 : 0), 0);
}

/** Load the saved key and wire the triggers. Call once, after store.start(). */
export async function startSync() {
  if (started) return;
  started = true;
  registerDiagnostics('sync', async () => ({
    state: session ? (spaceGone.value ? 'paused (space deleted elsewhere)' : readOnly.value ? 'read-only (newer data)' : 'on') : 'off',
    'last successful sync': lastSyncAt.value ? new Date(lastSyncAt.value).toISOString() : null,
    'pending changes': session ? await pendingChanges() : 0,
    'paired devices': (await getLocal<number>(db, K.devices)) ?? null,
    'last error': (await getLocal<string | null>(db, K.err)) ?? 'none',
  }));
  deviceName.value = (await getLocal<string>(db, K.name)) ?? '';
  lastSyncAt.value = (await getLocal<number>(db, K.last)) ?? null;
  syncError.value = (await getLocal<string | null>(db, K.err)) ?? null;
  const saved = await getLocal<string>(db, K.key);
  if (saved) {
    keySaved.value = (await getLocal<boolean>(db, K.saved)) ?? true;
    await open(b64uDecode(saved));
  }
  await checkBackupDue();
  onLocalWrite(() => requestSync());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { void syncNow(); void checkBackupDue(); } });
  window.addEventListener('online', () => void syncNow());
  void syncNow();
}
