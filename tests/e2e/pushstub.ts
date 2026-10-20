// Helpers for the push end-to-end tests: a stand-in for a push service (a small HTTP server the
// relay posts to), a way to look at what the e2e relay holds for a device, and the stub that gives
// the page a push subscription without a real push service.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { BrowserContext, Page } from '@playwright/test';
import { decryptPush, type ReceiverKeys } from '../../src/push/encrypt';
import { fromUtf8 } from '../../src/sync/bytes';
import { PUSH_ID } from '../../src/push/protocol';

export interface Received { method: string; path: string; headers: http.IncomingHttpHeaders; body: Buffer }
export interface PushStub { endpoint: string; origin: string; received: Received[]; close(): Promise<void> }

/** A push service: takes every POST, answers 201, remembers it. The relay's PUSH_HOSTS allows 127.0.0.1 on any port. */
export async function startPushStub(): Promise<PushStub> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      received.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = 201;
      res.end();
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  const origin = `http://127.0.0.1:${port}`;
  return { endpoint: origin + '/push/e2e-subscription', origin, received, close: () => new Promise<void>(r => { server.close(() => r()); server.closeAllConnections(); }) };
}

export async function openedText(r: Received, me: ReceiverKeys): Promise<{ title: string; body: string; tag: string; url: string }> {
  return JSON.parse(fromUtf8(await decryptPush(new Uint8Array(r.body), me)));
}

// ---- what the e2e relay holds (its local D1 file; `npm run e2e` starts it from relay/)

const D1 = path.resolve(process.cwd(), 'relay/.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const dbFile = () => path.join(D1, fs.readdirSync(D1).find(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite')!);

export interface Held { id: string; at: number; ttl: number; blob: string }
export function relayHeld(pid: string): Held[] {
  if (!PUSH_ID.test(pid)) throw new Error('not a push id');
  const out = execFileSync('sqlite3', ['-json', dbFile(), `select id, at, ttl, blob from push_items where pid = '${pid}' order by at, id`], { encoding: 'utf8' });
  return out.trim() ? (JSON.parse(out) as Held[]) : [];
}

/** The page's push id, from its `local` table (null until notifications are switched on). */
export async function pushId(page: Page): Promise<string | null> {
  return page.evaluate(() => new Promise<string | null>((res, rej) => {
    const open = indexedDB.open('reussite');
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction('local').objectStore('local').get('push.id');
      get.onsuccess = () => res((get.result?.value as string | undefined) ?? null);
    };
  }));
}

/** Run the relay's cron once, as Cloudflare would each minute. */
export async function runCron(): Promise<void> {
  let r = await fetch('http://localhost:8787/cdn-cgi/handler/scheduled');
  if (r.status === 404) r = await fetch('http://localhost:8787/cdn-cgi/local/scheduled'); // the older spelling
  if (!r.ok) throw new Error('cron trigger ' + r.status);
}

// ---- a subscription for the page

export interface StubSub { endpoint: string; p256dh: string; auth: string }

/** In the page: `PushManager.subscribe` hands back a subscription with these keys and endpoint (it remembers one in localStorage). */
function installPushManager(sub: StubSub) {
  const make = () => ({
    endpoint: sub.endpoint, expirationTime: null,
    toJSON: () => ({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }),
    unsubscribe: async () => { localStorage.removeItem('e2e.sub'); return true; },
  });
  const manager = {
    getSubscription: async () => (localStorage.getItem('e2e.sub') ? make() : null),
    subscribe: async () => { localStorage.setItem('e2e.sub', '1'); return make(); },
    permissionState: async () => 'granted',
  };
  Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', { configurable: true, get: () => manager });
}

export async function stubSubscription(context: BrowserContext, sub: StubSub) {
  await context.grantPermissions(['notifications']);
  await context.addInitScript(installPushManager, sub);
}
