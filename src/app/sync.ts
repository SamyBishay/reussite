// Sync in the app (brief §6): the key and its state in `local`, one round at a time, and the
// moments it runs: on start, when the page becomes visible, two seconds after the last local
// write, and when the network comes back. Failures are quiet (the error log) and retried with
// backoff. The pure parts are in src/sync; the Dexie store is in src/data/syncstore.ts.
import { computed, signal } from '@preact/signals';
import { db, getClock, onLocalWrite, putMerged, readOnly, settings } from './store';
import { getLocal, setLocal } from '../data/db';
import { dexieSyncStore, STATE_KEY } from '../data/syncstore';
import { makeBackup, type BackupFile } from '../data/backup';
import { SYNCED_COLLECTIONS, collectOutgoing } from '../sync/engine';
import { RelayClient, RelayError } from '../sync/client';
import { DecryptError } from '../sync/crypto';
import { deriveInbox, InboxError, openFromInbox, type InboxKeys } from '../sync/inbox';
import { dropPrefix } from '../sync/droplink';
import type { ConnectorStatus } from '../sync/protocol';
import { readChangeSet, type ChangeSet } from '../ai/changeset';
import { b64uDecode, b64uEncode, type Bytes } from '../sync/bytes';
import { decodeRecoveryKey, deriveKeys, encodeRecoveryKey, generateKey, type SpaceKeys } from '../sync/keys';
import { INITIAL_STATE, syncOnce, type SyncState } from '../sync/run';
import { isEncryptedBackup, openBackup, sealBackup } from '../sync/backup';
import { browser, os, registerDiagnostics } from './diagnostics';
import { logError } from './errorlog';

const K = {
  key: 'sync.key', saved: 'sync.keySaved', last: 'sync.lastAt', err: 'sync.lastError', full: 'sync.full',
  name: 'sync.deviceName', touched: 'sync.touchedAt', devices: 'sync.deviceCount',
  conOn: 'connector.on', conUsed: 'connector.lastUsed',
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
/** When this run of the app started: a sync after it means this device's copy of the list is current. */
let startedAt = Date.now();
export const resetSyncStart = (at = Date.now()) => { startedAt = at; };
/** Sync is on, and this device's copy of the list has not been brought up to date since the app started (or cannot be). */
export const syncBehind = computed(() => syncOn.value && (readOnly.value || spaceGone.value || (lastSyncAt.value ?? 0) < startedAt));
/** The first round's chance to succeed before anyone is told, and how old a copy must be to be worth a word. */
export const SYNC_GRACE_MS = 30_000;
export const STALE_SYNC_MS = 6 * 3600_000;
/**
 * Ask the person to act: sync has not succeeded since the app started, the copy here is over STALE_SYNC_MS old,
 * and the device is online (offline, nothing they do helps). The newer-version and deleted-list cases have their own words.
 */
export const syncStale = (now: number): boolean =>
  syncBehind.value && !readOnly.value && !spaceGone.value && now - startedAt > SYNC_GRACE_MS && now - (lastSyncAt.value ?? 0) > STALE_SYNC_MS &&
  !(typeof navigator !== 'undefined' && navigator.onLine === false);
/** The code of the last failure (a relay error code, 'network', 'decrypt'…), null when the last round worked. */
export const syncError = signal<string | null>(null);
/** The space was deleted from another device: sync is paused until the person turns it off here. */
export const spaceGone = signal(false);
export const deviceName = signal('');
export const devices = signal<DeviceInfo[] | null>(null);
/** Sync is off and it has been two weeks since a backup file was saved (or the reminder put off). */
export const backupDue = signal(false);

/** The key has been read from storage (or there is none): what the drop page waits for before it decides. */
export const syncLoaded = signal(false);
/** The connector's state as the relay last said. Null until asked. */
export const connector = signal<ConnectorStatus | null>(null);
/** Change-sets left in the inbox (by the one-tap link on another browser), waiting for the person's ticks. */
export interface InboxDrop { id: string; cs: ChangeSet }
export const inboxQueue = signal<InboxDrop[]>([]);
/** `https://<app>/drop#<space>.<inbox key>.`: the start of every one-tap link for this person. Null with sync off, or where the browser has no X25519. */
export const dropBase = signal<string | null>(null);

let session: { recovery: Bytes; keys: SpaceKeys; inbox?: InboxKeys | null } | null = null;
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
      void pullInbox();
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
    await refreshConnector();
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

// ---------- the connector (docs/dev/connector.md)

/** Ask the relay whether the connector is on and when it was last used. Keeps a copy for diagnostics. */
export async function refreshConnector(): Promise<ConnectorStatus | null> {
  if (!session) return null;
  const st = await client().connectorStatus();
  connector.value = st;
  await setLocal(db, K.conOn, st.on); await setLocal(db, K.conUsed, st.lastUsed);
  return st;
}

/** Switch it on: the relay gets the space's key. Returns the first pairing code (shown once) and the address to add. */
export async function connectorOn(): Promise<{ code: string; expires: number }> {
  if (!session) throw new Error('sync is off');
  const r = await client().connectorOn();
  connector.value = { on: true, lastUsed: null, url: r.url };
  await setLocal(db, K.conOn, true); await setLocal(db, K.conUsed, null);
  void refreshDevices().catch(() => undefined);
  return { code: r.code, expires: r.expires };
}

export async function connectorNewCode(): Promise<{ code: string; expires: number }> {
  if (!session) throw new Error('sync is off');
  return client().connectorCode();
}

/** Switch it off: the relay deletes the key and every AI app is signed out. */
export async function connectorOff(): Promise<void> {
  if (!session) throw new Error('sync is off');
  await client().connectorOff();
  connector.value = { on: false, lastUsed: null, url: connector.value?.url ?? '' };
  await setLocal(db, K.conOn, false); await setLocal(db, K.conUsed, null);
  void refreshDevices().catch(() => undefined);
}

// ---------- the inbox (the one-tap link on a browser that holds nothing)

const queued = new Set<string>(); // every item seen this session, so none is shown twice
const toDelete = new Set<string>(); // reviewed, but the relay could not be told yet
let inboxAt = 0;
const INBOX_EVERY = 5_000;

/** Fetch the inbox, open what is ours, and queue each change-set for review. Items that aren't ours are deleted from the relay. */
async function pullInbox(): Promise<void> {
  if (!session || Date.now() - inboxAt < INBOX_EVERY) return;
  inboxAt = Date.now();
  try {
    const keys = await inboxKeys();
    if (!keys) return;
    const c = client();
    for (const id of [...toDelete]) { await c.deleteInboxItem(id); toDelete.delete(id); }
    const found: InboxDrop[] = [];
    for (const item of await c.inbox()) {
      if (queued.has(item.id)) continue;
      queued.add(item.id);
      let cs: ChangeSet | null = null;
      try {
        const r = readChangeSet(await openFromInbox(session.keys.spaceId, keys, item.blob));
        if (r.ok) cs = r.cs;
      } catch (e) {
        if (!(e instanceof InboxError)) throw e;
      }
      if (cs) found.push({ id: item.id, cs }); else await c.deleteInboxItem(item.id); // not for this key, or not a change-set: nobody can use it
    }
    if (found.length) inboxQueue.value = [...inboxQueue.value, ...found];
  } catch (e) {
    void logError(e, 'inbox');
  }
}

/** The person has applied or dismissed this drop: take it off the queue and off the relay. */
export async function finishDrop(id: string): Promise<void> {
  inboxQueue.value = inboxQueue.value.filter(d => d.id !== id);
  toDelete.add(id);
  try { await client().deleteInboxItem(id); toDelete.delete(id); } catch (e) { void logError(e, 'inbox'); }
}

// ---------- switching on and off

async function open(recovery: Bytes) {
  session = { recovery, keys: await deriveKeys(recovery) };
  syncOn.value = true;
  const inbox = await inboxKeys();
  dropBase.value = inbox ? new URL('./drop', globalThis.document?.baseURI ?? 'https://app.invalid/').href + '#' + dropPrefix({ space: session.keys.spaceId, pub: inbox.publicKey }) : null;
}

/** The inbox key pair, the same on every device that holds the recovery key. Null where the browser has no X25519. */
async function inboxKeys(): Promise<InboxKeys | null> {
  if (!session) return null;
  if (session.inbox === undefined) session.inbox = await deriveInbox(session.recovery).catch(() => null);
  return session.inbox;
}

/** The space this browser syncs with, if any: the drop page opens the review at once when a link is for it. */
export const spaceId = (): string | null => session?.keys.spaceId ?? null;

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
  for (const k of [K.key, K.saved, K.last, K.err, K.full, K.touched, K.devices, K.conOn, K.conUsed, STATE_KEY]) await db.local.delete(k);
  syncOn.value = false; keySaved.value = true; lastSyncAt.value = null; syncError.value = null; spaceGone.value = false; devices.value = null;
  connector.value = null; inboxQueue.value = []; dropBase.value = null; queued.clear(); toDelete.clear(); inboxAt = 0;
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
  registerDiagnostics('connector', async () => ({
    state: session ? ((await getLocal<boolean>(db, K.conOn)) ? 'on' : 'off') : 'off',
    'last used': (await getLocal<number | null>(db, K.conUsed)) ? new Date((await getLocal<number>(db, K.conUsed))!).toISOString() : null,
  }));
  deviceName.value = (await getLocal<string>(db, K.name)) ?? '';
  lastSyncAt.value = (await getLocal<number>(db, K.last)) ?? null;
  syncError.value = (await getLocal<string | null>(db, K.err)) ?? null;
  const saved = await getLocal<string>(db, K.key);
  if (saved) {
    keySaved.value = (await getLocal<boolean>(db, K.saved)) ?? true;
    await open(b64uDecode(saved));
  }
  syncLoaded.value = true;
  await checkBackupDue();
  onLocalWrite(() => requestSync());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { void syncNow(); void checkBackupDue(); } });
  window.addEventListener('online', () => void syncNow());
  void syncNow();
}
