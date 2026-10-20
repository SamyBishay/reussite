// CPU benchmark for one push tick (the free plan gives a cron run 10 ms of CPU; target < 6 ms).
// Run with `npm run bench:push` (bundles with esbuild, runs in Node, like `npm run bench`). It runs
// the real `runTick` with 36 due items against a stub D1 (one canned select, writes accepted) and a
// stub push service that answers 201, so what is timed is what the Worker's CPU does: the VAPID
// import and one signature per push-service audience, base64 decoding of 36 payloads, building the
// 36 requests, and the JSON for the write batch. Database and network waits are I/O, not CPU, and
// are left out; so is workerd's own cost of a `fetch` (a few tenths of a millisecond a call is
// plausible; not measurable here). The first run is shown too: a fresh isolate has no JIT warm-up.
import { encryptPush } from '../../src/push/encrypt';
import { b64uEncode, utf8 } from '../../src/sync/bytes';
import { generateVapidKeys } from '../../src/push/vapid';
import { newReceiver } from '../../src/push/testing';
import type { Env } from '../src/env';
import { runTick, TICK_LIMIT } from '../src/tick';

const BUDGET_MS = 6;
const RUNS = 40;
const NOW = Date.parse('2026-10-20T18:30:00Z');

const ms = (n: number) => n.toFixed(2).padStart(6) + ' ms';

async function main() {
  const vapid = await generateVapidKeys();
  const me = await newReceiver();
  // A typical notification, padded to one 256-byte block: what the app sends.
  const blob = b64uEncode(await encryptPush(me, utf8(JSON.stringify({ title: 'Leave now · 19:00', body: 'Choir 19:00, Hill House 602 · leave at 18:30', tag: 'fixed:ab12cd34ef56:2026-10-20', url: './#today' }))));

  const hosts = ['https://fcm.googleapis.com/fcm/send/', 'https://web.push.apple.com/', 'https://updates.push.services.mozilla.com/wpush/v2/'];
  const due = (audiences: number) => Array.from({ length: TICK_LIMIT }, (_, i) => ({
    pid: 'pid' + (i % 12), id: 'launch:2026-10-20:' + i, at: NOW - i * 1000, ttl: 600, urgency: 'high', blob, tries: 0,
    endpoint: hosts[i % audiences] + 'token' + 'x'.repeat(150) + (i % 12),
  }));

  const stubDb = (rows: unknown[]) => {
    const stmt = { bind: () => stmt, all: async () => ({ results: rows }), first: async () => null, run: async () => ({}) };
    return { prepare: (sql: string) => (sql.includes('FROM push_items i') ? stmt : { bind: () => ({}) }), batch: async () => [] };
  };
  const stubFetch = (async () => new Response(null, { status: 201 })) as unknown as typeof fetch;
  const hostsList = 'fcm.googleapis.com,updates.push.services.mozilla.com,*.push.apple.com';

  console.log(`one push tick: ${TICK_LIMIT} due items, 6 sends at a time, payloads of ${Math.floor((blob.length * 3) / 4)} bytes (budget ${BUDGET_MS} ms)`);
  for (const audiences of [1, 3]) {
    const env = { DB: stubDb(due(audiences)), VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'https://relay.test', PUSH_HOSTS: hostsList } as unknown as Env;
    const once = async () => {
      const cpu = process.cpuUsage(), t = performance.now();
      const r = await runTick(env, NOW, { fetch: stubFetch });
      if (r.sent !== TICK_LIMIT) throw new Error('tick did not send everything: ' + JSON.stringify(r));
      const c = process.cpuUsage(cpu);
      return { wall: performance.now() - t, cpu: (c.user + c.system) / 1000 };
    };
    const first = await once();
    for (let i = 0; i < 5; i++) await once();
    const runs: { wall: number; cpu: number }[] = [];
    for (let i = 0; i < RUNS; i++) runs.push(await once());
    const med = (k: 'wall' | 'cpu') => runs.map(r => r[k]).sort((a, b) => a - b)[RUNS >> 1]!;
    const p95 = (k: 'wall' | 'cpu') => runs.map(r => r[k]).sort((a, b) => a - b)[Math.floor(RUNS * 0.95)]!;
    const verdict = med('cpu') <= BUDGET_MS ? 'ok' : 'OVER ' + BUDGET_MS + ' ms';
    console.log(`  ${audiences} push service${audiences > 1 ? 's' : ' '}: median cpu ${ms(med('cpu'))} (wall ${ms(med('wall'))})   p95 cpu ${ms(p95('cpu'))}   first run ${ms(first.cpu)}   ${verdict}`);
  }
}

await main();
