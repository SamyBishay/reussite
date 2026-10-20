// Notifications in the app (docs/dev/push.md): this device's push identity and subscription, and
// the moments the schedule is rebuilt and handed to the relay. The schedule itself is a pure
// function of the list (src/domain/notify.ts); the diff against what was last sent is in
// src/push/reconcile.ts; the service worker that shows the push is src/sw.ts. Push is independent
// of sync: its id, secret, subscription facts and cache live in `local` (device-only, never
// synced, never in a backup), and the relay address is the same one sync uses.
//
// Reconciling runs when the app starts, when the page becomes visible, 3 seconds after the last
// change to the list or the settings, and when the network returns. Failures are quiet (the
// diagnostics, the error line in Settings) and retried with backoff.
import { signal } from '@preact/signals';
import { db, days, decisions, onLocalWrite, places, readOnly, sessions, settings, stays, tasks } from './store';
import { getLocal, setLocal } from '../data/db';
import { relayBase } from './sync';
import { registerDiagnostics } from './diagnostics';
import { logError } from './errorlog';
import { buildSchedule, type Translate } from '../domain/notify';
import { b64uDecode, b64uEncode } from '../sync/bytes';
import { encryptPushBlob, type SubscriptionKeys } from '../push/encrypt';
import { PushError, PushRelay } from '../push/client';
import { APP_TITLE, OPEN_URL, payloadJson } from '../push/notification';
import { planUpload, readSent, type Sent } from '../push/reconcile';
import { isIos, pushSupport, type PushState } from '../push/support';
import { t } from '../i18n';

const K = {
  on: 'push.on', id: 'push.id', secret: 'push.secret', vapid: 'push.vapid', endpoint: 'push.endpoint', sent: 'push.sent',
  last: 'push.lastAt', err: 'push.lastError', held: 'push.held',
} as const;
const DAY = 86_400_000;
/** Without a change, the schedule is still written this often, so the relay's 45-day clock never runs out for a device in use. */
const REFRESH_EVERY = DAY;
const DEBOUNCE = 3000;

/** The VAPID public key this build was made with; empty = notifications are not offered. */
export const vapidKey = (): string => (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim();

export const pushState = signal<PushState>('hidden');
/** The person has switched notifications on, on this device. */
export const pushOn = signal(false);
export const pushBusy = signal(false);
/** A code for the last failure ('network', 'gone', a relay error code…); null when the last attempt worked. */
export const pushError = signal<string | null>(null);
export const pushLastAt = signal<number | null>(null);
/** Items the relay held after the last upload. */
export const pushHeld = signal(0);

// ---------- what this browser can do

function facts() {
  const nav = typeof navigator === 'undefined' ? ({} as Navigator) : navigator;
  const standalone = (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || (nav as Navigator & { standalone?: boolean }).standalone === true;
  return {
    hasKey: !!vapidKey(),
    hasRelay: !!relayBase(),
    capable: 'serviceWorker' in nav && typeof PushManager !== 'undefined' && typeof Notification !== 'undefined',
    ios: isIos(nav.userAgent ?? '', nav.maxTouchPoints ?? 0),
    standalone,
    permission: (typeof Notification === 'undefined' ? 'default' : Notification.permission) as 'default' | 'granted' | 'denied',
  };
}

export function refreshPushState(): PushState {
  return (pushState.value = pushSupport(facts()));
}

async function registration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('no service worker')), 10_000); });
  try { return await Promise.race([navigator.serviceWorker.ready, timeout]); } finally { clearTimeout(timer); }
}

// ---------- identity and subscription

interface Identity { pid: string; secret: string }

async function identity(create: boolean): Promise<Identity | null> {
  const pid = await getLocal<string>(db, K.id);
  const secret = await getLocal<string>(db, K.secret);
  if (pid && secret) return { pid, secret };
  if (!create) return null;
  const fresh = { pid: b64uEncode(crypto.getRandomValues(new Uint8Array(16))), secret: b64uEncode(crypto.getRandomValues(new Uint8Array(32))) };
  await setLocal(db, K.id, fresh.pid);
  await setLocal(db, K.secret, fresh.secret);
  return fresh;
}

const keysOf = (sub: PushSubscription): SubscriptionKeys => {
  const k = sub.toJSON().keys;
  if (!k?.p256dh || !k.auth) throw new Error('subscription has no keys');
  return { p256dh: k.p256dh, auth: k.auth };
};

async function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  const key = vapidKey();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uDecode(key) as BufferSource });
  await setLocal(db, K.vapid, key);
  return sub;
}

/** Drop the browser's subscription (and what we know of it), so the next `ensureDevice` makes a fresh one. */
async function forgetSubscription(reg: ServiceWorkerRegistration) {
  try { await (await reg.pushManager.getSubscription())?.unsubscribe(); } catch { /* already gone */ }
  await setLocal(db, K.vapid, null);
  await setLocal(db, K.endpoint, null);
  await setLocal(db, K.sent, {});
}

interface Device { relay: PushRelay; sub: PushSubscription; keys: SubscriptionKeys; reg: ServiceWorkerRegistration }

/**
 * Subscription current (made with this build's VAPID key) and known to the relay. Resubscribes when the
 * key differs or the subscription is gone; registers when the endpoint is new to the relay.
 */
async function ensureDevice(): Promise<Device> {
  const base = relayBase();
  if (!base) throw new Error('no relay');
  const id = (await identity(true))!;
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && (await getLocal<string>(db, K.vapid)) !== vapidKey()) { await forgetSubscription(reg); sub = null; }
  sub ??= await subscribe(reg);
  const relay = new PushRelay(base, id.pid, id.secret);
  if ((await getLocal<string>(db, K.endpoint)) !== sub.endpoint) {
    await relay.register(sub.endpoint);
    await setLocal(db, K.endpoint, sub.endpoint);
  }
  return { relay, sub, keys: keysOf(sub), reg };
}

// ---------- reconciling

let running = false, again = false, debounce: ReturnType<typeof setTimeout> | undefined, retry: ReturnType<typeof setTimeout> | undefined, failures = 0;

/** The wanted schedule, made from the list as it is now. */
function wanted(now: number) {
  return buildSchedule({ tasks: tasks.value, days: days.value, decisions: decisions.value, places: places.value, stays: stays.value, sessions: sessions.value }, now, settings.value, t as Translate);
}

async function reconcileOnce(): Promise<void> {
  const dev = await ensureDevice();
  const now = Date.now();
  const list = wanted(now);
  let sent: Sent = readSent(await getLocal<unknown>(db, K.sent));
  const lastAt = (await getLocal<number>(db, K.last)) ?? 0;
  // Two tries: the second after the relay turned out not to know us, or not to hold what we thought it did.
  for (let attempt = 0; ; attempt++) {
    const plan = await planUpload(list, dev.keys, sent, now);
    if (!plan.dirty && now - lastAt < REFRESH_EVERY && attempt === 0) { pushHeld.value = plan.keep.length; return; }
    try {
      const r = await dev.relay.schedule(plan.items, plan.keep);
      if (r.held < plan.items.length + plan.keep.length && attempt === 0) { sent = {}; continue; }
      const at = Date.now();
      await setLocal(db, K.sent, plan.next);
      await setLocal(db, K.last, at); await setLocal(db, K.err, null); await setLocal(db, K.held, r.held);
      pushLastAt.value = at; pushHeld.value = r.held; pushError.value = null; failures = 0;
      return;
    } catch (e) {
      if (attempt === 0 && e instanceof PushError && e.code === 'unknown_device') {
        await dev.relay.register(dev.sub.endpoint);
        sent = {};
        continue;
      }
      throw e;
    }
  }
}

const codeOf = (e: unknown) => (e instanceof PushError ? e.code : 'error');

/** Rebuild the schedule and send what changed, now, or right after the run in progress. Never two at once. */
export async function reconcileNow(): Promise<void> {
  refreshPushState();
  if (!pushOn.value || pushState.value !== 'granted' || readOnly.value) return;
  if (running) { again = true; return; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  running = true;
  clearTimeout(retry);
  try {
    do { again = false; await reconcileOnce(); } while (again);
  } catch (e) {
    const code = codeOf(e);
    pushError.value = code;
    await setLocal(db, K.err, code).catch(() => undefined);
    void logError(e, 'push');
    retry = setTimeout(() => void reconcileNow(), Math.min(600_000, 15_000 * 3 ** failures++));
  } finally {
    running = false;
  }
}

/** Reconcile soon (default 3 seconds), restarting the wait on each call. Does nothing while notifications are off. */
export function requestReconcile(ms = DEBOUNCE) {
  if (!pushOn.value) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => void reconcileNow(), ms);
}

// ---------- switching on and off, testing

/**
 * Switch notifications on. Call it straight from the tap: the permission prompt must come from a
 * user gesture (iOS and Chrome refuse otherwise), so nothing is awaited before it. Returns the
 * state afterwards.
 */
export async function enablePush(): Promise<PushState> {
  const st = refreshPushState();
  if (st !== 'default' && st !== 'granted') return st;
  pushBusy.value = true;
  pushError.value = null;
  try {
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') return refreshPushState();
    await identity(true);
    await setLocal(db, K.on, true);
    pushOn.value = true;
    await reconcileOnce().then(() => { pushLastAt.value = Date.now(); }, async e => {
      // Never got as far as the relay knowing us: leave it off, with the reason on screen.
      pushError.value = codeOf(e);
      void logError(e, 'push');
      if (!(await getLocal<string>(db, K.endpoint))) await disablePush(codeOf(e));
    });
  } catch (e) {
    pushError.value = codeOf(e);
    void logError(e, 'push');
  } finally {
    pushBusy.value = false;
  }
  return refreshPushState();
}

/** Switch off: tell the relay to forget this device, drop the subscription, forget the identity. */
export async function disablePush(keepError: string | null = null): Promise<void> {
  clearTimeout(debounce); clearTimeout(retry);
  pushOn.value = false;
  const id = await identity(false);
  const base = relayBase();
  try { if (id && base) await new PushRelay(base, id.pid, id.secret).remove(); } catch { /* the relay forgets it after 45 days anyway */ }
  try { await forgetSubscription(await registration()); } catch { /* no worker, nothing to drop */ }
  for (const k of [K.on, K.id, K.secret, K.vapid, K.endpoint, K.last, K.err, K.held]) await setLocal(db, k, null);
  await setLocal(db, K.sent, {});
  pushLastAt.value = null; pushHeld.value = 0; pushError.value = keepError;
  refreshPushState();
}

export type TestResult = 'sent' | 'failed';

/** "Send a test notification": one push now, through the relay and the push service, to this device. */
export async function sendTest(): Promise<TestResult> {
  if (!pushOn.value) return 'failed';
  pushBusy.value = true;
  try {
    for (let attempt = 0; ; attempt++) {
      const dev = await ensureDevice();
      const blob = await encryptPushBlob(dev.keys, payloadJson({ title: APP_TITLE, body: t('notifyTest'), tag: 'test', url: OPEN_URL }));
      try {
        await dev.relay.send(blob);
        pushError.value = null;
        return 'sent';
      } catch (e) {
        if (attempt > 0 || !(e instanceof PushError)) throw e;
        // The push service dropped the subscription (the relay deleted the device), or the relay lost us: start over, once.
        if (e.code === 'gone') await forgetSubscription(dev.reg);
        else if (e.code === 'unknown_device') await setLocal(db, K.endpoint, null);
        else throw e;
        await setLocal(db, K.sent, {});
      }
    }
  } catch (e) {
    pushError.value = codeOf(e);
    void logError(e, 'push');
    return 'failed';
  } finally {
    pushBusy.value = false;
    requestReconcile(0);
  }
}

// ---------- start

let started = false;

/** Load what this device remembers and wire the triggers. Call once, after store.start(). */
export async function startPush() {
  if (started) return;
  started = true;
  registerDiagnostics('push', async () => ({
    state: pushOn.value ? pushState.value : vapidKey() ? 'off' : 'not offered',
    items: (await getLocal<number>(db, K.held)) ?? 0,
    'last upload': pushLastAt.value ? new Date(pushLastAt.value).toISOString() : null,
    'last error': (await getLocal<string | null>(db, K.err)) ?? 'none',
  }));
  pushOn.value = !!(await getLocal<boolean>(db, K.on));
  pushLastAt.value = (await getLocal<number>(db, K.last)) ?? null;
  pushHeld.value = (await getLocal<number>(db, K.held)) ?? 0;
  pushError.value = (await getLocal<string | null>(db, K.err)) ?? null;
  refreshPushState();
  // A change to anything the schedule reads (a local write, a merge from sync, a setting) reschedules.
  onLocalWrite(() => requestReconcile());
  for (const s of [tasks, days, decisions, places, stays, sessions, settings]) s.subscribe(() => requestReconcile());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reconcileNow(); });
  window.addEventListener('online', () => void reconcileNow());
  void reconcileNow();
}
