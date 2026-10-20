import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, saveSettings, settings } from './store';
import { getLocal } from '../data/db';
import { withDefaults } from '../data/settings';
import { b64uDecode } from '../sync/bytes';
import { newReceiver } from '../push/testing';
import { PUSH_ID, PUSH_SECRET } from '../push/protocol';
import { buildDiagnostics } from './diagnostics';
import { disablePush, enablePush, pushError, pushOn, pushState, reconcileNow, sendTest, startPush } from './push';

const KEY_A = 'BHj_zT3D5NS3lkq8lBUoPaEwB378tQ2Bro0LWn4Bm_WXy5ffwlJ5o_31_EJsN8jkUglHebA086yXZKuq2DZrEFI';
const KEY_B = 'BLLTssPj46tNFuuUXJngbmSQb7vLkwXgo3-ma6Oh4aZoH5zaikMHY-qWV3xQZr5rKYWyC0zy0b5sfAEo4iRDY4Y';

// ---- a browser's push subscription, and a relay that keeps what it is given

interface FakeSub { endpoint: string; keys: { p256dh: string; auth: string }; unsubscribe: ReturnType<typeof vi.fn>; toJSON: () => unknown }
const browser = {
  sub: null as FakeSub | null, n: 0, permission: 'default' as 'default' | 'granted' | 'denied',
  subscribe: vi.fn(), requestPermission: vi.fn(),
};
async function makeSub(): Promise<FakeSub> {
  const keys = await newReceiver();
  const s: FakeSub = {
    endpoint: 'http://localhost:9/push/' + ++browser.n, keys: { p256dh: keys.p256dh, auth: keys.auth },
    unsubscribe: vi.fn(async () => { if (browser.sub === s) browser.sub = null; return true; }),
    toJSON: () => ({ endpoint: s.endpoint, keys: s.keys }),
  };
  return s;
}

const relay = {
  known: false, endpoint: '', secret: '', held: new Map<string, { at: number; blob: string }>(),
  calls: [] as string[], sendStatus: 201 as number, writes: [] as { items: string[]; keep: string[] }[],
  reset() { this.known = false; this.endpoint = ''; this.secret = ''; this.held.clear(); this.calls = []; this.sendStatus = 201; this.writes = []; },
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function relayFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const u = new URL(String(url));
  const method = init?.method ?? 'GET';
  const tail = u.pathname.split('/').slice(4).join('/');
  const auth = new Headers(init?.headers).get('Authorization');
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  relay.calls.push(`${method} ${tail || '/'}`);
  if (method === 'PUT' && !tail) {
    if (relay.known && auth !== 'Bearer ' + relay.secret) return json(401, { error: 'unauthorized' });
    relay.known = true; relay.secret = (auth ?? '').slice(7); relay.endpoint = body.endpoint;
    return json(200, { ok: true });
  }
  if (!relay.known || auth !== 'Bearer ' + relay.secret) return json(404, { error: 'unknown_device' });
  if (method === 'PUT' && tail === 'schedule') {
    relay.writes.push({ items: body.items.map((i: { id: string }) => i.id), keep: body.keep });
    const next = new Map<string, { at: number; blob: string }>();
    for (const id of body.keep as string[]) if (relay.held.has(id)) next.set(id, relay.held.get(id)!);
    for (const i of body.items as { id: string; at: number; blob: string }[]) next.set(i.id, { at: i.at, blob: i.blob });
    relay.held = next;
    return json(200, { stored: body.items.length, held: next.size });
  }
  if (method === 'POST' && tail === 'send') {
    if (relay.sendStatus === 410) { relay.known = false; relay.held.clear(); return json(410, { error: 'gone' }); }
    return json(201, { ok: true, status: 201 });
  }
  if (method === 'DELETE') { relay.known = false; relay.held.clear(); return json(200, { ok: true, deleted: 0 }); }
  return json(400, { error: 'bad_request' });
}

beforeAll(async () => {
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal('PushManager', class {});
  const notification = Object.assign(function () {}, { requestPermission: browser.requestPermission });
  Object.defineProperty(notification, 'permission', { get: () => browser.permission });
  vi.stubGlobal('Notification', notification);
  const reg = { pushManager: { getSubscription: async () => browser.sub, subscribe: browser.subscribe } };
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', maxTouchPoints: 0, onLine: true, serviceWorker: { ready: Promise.resolve(reg) } });
  vi.stubGlobal('fetch', relayFetch);
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', KEY_A);
  const { start } = await import('./store');
  await start();
  settings.value = withDefaults({ relayUrl: 'http://localhost:8787' });
  await saveSettings({ relayUrl: 'http://localhost:8787' });
  await startPush();
});
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

beforeEach(async () => {
  if (pushOn.value) await disablePush();
  relay.reset();
  await saveSettings({ notify: withDefaults(undefined).notify });
  browser.sub = null; browser.n = 0; browser.permission = 'default';
  browser.subscribe.mockReset().mockImplementation(async () => (browser.sub = await makeSub()));
  browser.requestPermission.mockReset().mockImplementation(async () => { browser.permission = 'granted'; return 'granted'; });
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', KEY_A);
});

describe('notifications on this device', () => {
  it('asks permission from the call, subscribes with the build’s VAPID key, registers, and uploads the schedule', async () => {
    expect(await enablePush()).toBe('granted');
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    const arg = browser.subscribe.mock.calls[0]![0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(arg.userVisibleOnly).toBe(true);
    expect(Array.from(arg.applicationServerKey)).toEqual(Array.from(b64uDecode(KEY_A)));
    expect(relay.calls[0]).toBe('PUT /');
    expect(relay.endpoint).toBe(browser.sub!.endpoint);
    expect(relay.held.size).toBeGreaterThan(5);
    expect(pushOn.value).toBe(true);
    expect(pushError.value).toBeNull();
  });

  it('keeps its id, secret and VAPID key in local only, and the id and secret have the relay’s shapes', async () => {
    await enablePush();
    expect(await getLocal<string>(db, 'push.id')).toMatch(PUSH_ID);
    expect(await getLocal<string>(db, 'push.secret')).toMatch(PUSH_SECRET);
    expect(await getLocal<string>(db, 'push.vapid')).toBe(KEY_A);
    expect(await getLocal<boolean>(db, 'push.on')).toBe(true);
    const sent = (await getLocal<Record<string, [string, number]>>(db, 'push.sent')) ?? {};
    expect(Object.keys(sent).sort()).toEqual([...relay.held.keys()].sort());
    // not in the synced collections
    for (const c of ['tasks', 'days', 'meta'] as const) {
      expect(JSON.stringify(await db.table_(c).toArray())).not.toContain(await getLocal<string>(db, 'push.secret') as string);
    }
  });

  it('does nothing when permission is refused, and says it is denied', async () => {
    browser.requestPermission.mockImplementation(async () => { browser.permission = 'denied'; return 'denied'; });
    expect(await enablePush()).toBe('denied');
    expect(pushOn.value).toBe(false);
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(relay.calls).toEqual([]);
    expect(await getLocal(db, 'push.id')).toBeFalsy();
  });

  it('uploads only what changed, and names the rest in keep', async () => {
    await enablePush();
    const before = relay.held.size;
    await saveSettings({ notify: { ...settings.value.notify, close: false } });
    await reconcileNow();
    const w = relay.writes.at(-1)!;
    expect(w.items).toEqual([]);
    expect(w.keep.length).toBe(relay.held.size);
    expect(relay.held.size).toBeLessThan(before);
    expect([...relay.held.keys()].some(id => id.startsWith('close:'))).toBe(false);
    await saveSettings({ notify: { ...settings.value.notify, close: true } });
    await reconcileNow();
    expect(relay.writes.at(-1)!.items.every(id => id.startsWith('close:'))).toBe(true);
    expect(relay.held.size).toBe(before);
  });

  it('does not write again when nothing changed', async () => {
    await enablePush();
    const n = relay.writes.length;
    await reconcileNow();
    expect(relay.writes.length).toBe(n);
  });

  it('subscribes again when the build’s VAPID key differs from the stored one, and re-sends everything', async () => {
    await enablePush();
    const first = browser.sub!;
    const held = relay.held.size;
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', KEY_B);
    await reconcileNow();
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(browser.subscribe).toHaveBeenCalledTimes(2);
    expect(Array.from((browser.subscribe.mock.calls[1]![0] as { applicationServerKey: Uint8Array }).applicationServerKey)).toEqual(Array.from(b64uDecode(KEY_B)));
    expect(await getLocal<string>(db, 'push.vapid')).toBe(KEY_B);
    expect(browser.sub).not.toBe(first);
    expect(relay.endpoint).toBe(browser.sub!.endpoint);
    expect(relay.writes.at(-1)!.keep).toEqual([]);
    expect(relay.held.size).toBe(held);
  });

  it('registers again, and re-sends everything, when the relay no longer knows the device', async () => {
    await enablePush();
    const held = relay.held.size;
    relay.known = false; relay.held.clear();
    await saveSettings({ notify: { ...settings.value.notify, review: false } });
    await reconcileNow();
    expect(relay.known).toBe(true);
    expect(relay.held.size).toBeGreaterThanOrEqual(held - 3);
    expect(relay.held.size).toBeGreaterThan(5);
  });

  it('re-sends everything when the relay holds fewer items than it was told to keep', async () => {
    await enablePush();
    const held = relay.held.size;
    const gone = [...relay.held.keys()].find(id => id.startsWith('checkin:'));
    relay.held.delete(gone!);
    await saveSettings({ notify: { ...settings.value.notify, review: false } });
    await reconcileNow();
    expect(relay.held.has(gone!)).toBe(true);
    expect(relay.held.size).toBeGreaterThanOrEqual(held - 3);
  });

  it('a test send that finds the subscription gone subscribes again, registers and sends', async () => {
    await enablePush();
    const first = browser.sub!;
    relay.sendStatus = 410;
    const calls: string[] = [];
    const real = relayFetch;
    vi.stubGlobal('fetch', async (u: string, i?: RequestInit) => { const r = await real(u, i); calls.push(`${i?.method} ${r.status}`); relay.sendStatus = 201; return r; });
    expect(await sendTest()).toBe('sent');
    vi.stubGlobal('fetch', relayFetch);
    expect(calls).toContain('POST 410');
    expect(first.unsubscribe).toHaveBeenCalled();
    expect(browser.subscribe).toHaveBeenCalledTimes(2);
    expect(relay.endpoint).toBe(browser.sub!.endpoint);
  });

  it('switching off deletes the device at the relay, drops the subscription and forgets the ids', async () => {
    await enablePush();
    const sub = browser.sub!;
    await disablePush();
    expect(relay.calls).toContain('DELETE /');
    expect(relay.known).toBe(false);
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(pushOn.value).toBe(false);
    expect(await getLocal(db, 'push.id')).toBeNull();
    expect(await getLocal(db, 'push.secret')).toBeNull();
    expect(await getLocal(db, 'push.on')).toBeNull();
  });

  it('is hidden in a build with no VAPID key, and needs a relay address', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
    await reconcileNow();
    expect(pushState.value).toBe('hidden');
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', KEY_A);
    settings.value = withDefaults({ relayUrl: '' });
    await reconcileNow();
    expect(pushState.value).toBe('norelay');
    settings.value = withDefaults({ relayUrl: 'http://localhost:8787' });
  });

  it('diagnostics carry a state, a count and times, never an endpoint or a key', async () => {
    await enablePush();
    const out = await buildDiagnostics();
    const section = out.split('[push]')[1]!.split('\n\n')[0]!;
    expect(section).toMatch(/state: granted/);
    expect(section).toMatch(/items: \d+/);
    expect(section).toMatch(/last upload: 20\d\d-/);
    expect(section).toMatch(/last error: none/);
    for (const secret of [await getLocal<string>(db, 'push.secret'), await getLocal<string>(db, 'push.id'), browser.sub!.endpoint, browser.sub!.keys.auth, KEY_A]) {
      expect(out).not.toContain(secret as string);
    }
  });
});
