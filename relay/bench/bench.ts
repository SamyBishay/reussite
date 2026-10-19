// CPU benchmark for one connector call (brief §10: the free plan gives 10 ms of CPU per request).
// Run with `npm run bench` (bundles with esbuild, runs in Node). It builds a synthetic space the
// size of a heavy user's list, encrypts it the way the app does, then times what a call does on
// the Worker's CPU: base64 decode, AES-GCM decrypt, gunzip, JSON.parse, folding the batches since,
// and the tool's own work. Database round trips are I/O, not CPU, and are left out. V8 is V8:
// Node's numbers are a fair guide to workerd's, but a cold isolate (no JIT warm-up) is slower, so
// the first run is shown too.
import { createMcpHandler } from 'agents/mcp/server';
import { applyPlanned, isLowRisk, planChanges } from '../../src/ai/apply';
import { ChangeSchema, type ChangeSet } from '../../src/ai/changeset';
import { b64uDecode } from '../../src/sync/bytes';
import { decryptJson, sealToText } from '../../src/sync/crypto';
import { deriveKeys, generateKey } from '../../src/sync/keys';
import { SCHEMA_VERSION } from '../../src/data/schema';
import { create, patch } from '../../src/data/doc';
import { createClock, tick } from '../../src/data/hlc';
import type { ChangeBatch, Snapshot } from '../../src/sync/protocol';
import { resolveChanges } from '../src/connector/resolve';
import { dayText, queryText } from '../src/connector/render';
import { buildSpace, Edits } from '../src/connector/space';
import { buildServer } from '../src/connector/tools';
import { View } from '../src/connector/view';
import { docWriter, newId } from '../src/connector/writer';
import { HEAVY, TODAY, syntheticSpace, type Sizes } from './synthetic';
import { collectOutgoing } from '../../src/sync/engine';
import { encodeBatch, encodeSnapshot } from '../../src/sync/wire';

const BUDGET_MS = 7;
const RUNS = 25;

async function time<T>(f: () => Promise<T> | T, runs = RUNS): Promise<{ first: number; median: number; p95: number; last: T }> {
  let last!: T;
  const t0 = performance.now();
  last = await f();
  const first = performance.now() - t0;
  for (let i = 0; i < 3; i++) await f(); // warm-up
  const a: number[] = [];
  for (let i = 0; i < runs; i++) { const s = performance.now(); last = await f(); a.push(performance.now() - s); }
  a.sort((x, y) => x - y);
  return { first, median: a[a.length >> 1]!, p95: a[Math.floor(a.length * 0.95)]!, last };
}
const ms = (n: number) => n.toFixed(1).padStart(6) + ' ms';
const row = (label: string, r: { first: number; median: number; p95: number }, budget = false) =>
  console.log(`  ${label.padEnd(46)} median ${ms(r.median)}   p95 ${ms(r.p95)}   first run ${ms(r.first)}${budget ? (r.median <= BUDGET_MS ? '   ok' : '   OVER ' + BUDGET_MS + ' ms') : ''}`);

/** Batches after the snapshot: the app snapshots after 8 (SNAPSHOT_EVERY); BENCH_TAIL=30 shows the old tail. */
const TAIL = Number(process.env.BENCH_TAIL) || 8;

async function prepare(sizes: Sizes, batchesAfter = TAIL) {
  const key = generateKey();
  const keys = await deriveKeys(key);
  const docs = syntheticSpace(sizes);
  const snapshot: Snapshot = { v: SCHEMA_VERSION, upto: 100, docs };
  const snapBlob = await sealToText(keys, encodeSnapshot(snapshot), { lean: true });
  // Batches written by the app since: a few edits each, like a day of use.
  const clock = createClock('phone0002');
  clock.wall = Date.parse('2026-10-19T09:00:00Z');
  const tasks = docs.tasks!;
  const rows: { seq: number; blob: string }[] = [];
  for (let i = 0; i < batchesAfter; i++) {
    const t = tasks[(i * 37) % tasks.length]!;
    const edited = patch(t, { note: 'edited ' + i, est: 20 + i }, clock, SCHEMA_VERSION);
    const fresh = create('n' + i, { title: 'New step ' + i, project: 'p1', status: 'open', suit: 'S', est: 10, due: null, important: true, urgent: false, where: 'any', template: false, note: '', order: 1 }, SCHEMA_VERSION, tick(clock));
    const out = collectOutgoing({ tasks: [edited, fresh as never] }, 'phone0002', '');
    const batch: ChangeBatch = { v: SCHEMA_VERSION, device: 'phone0002', docs: out.docs };
    rows.push({ seq: 101 + i, blob: await sealToText(keys, encodeBatch(batch), { lean: true }) });
  }
  const json = JSON.stringify(encodeSnapshot(snapshot));
  return { keys, snapBlob, rows, json, docs };
}

export async function main() {
  const sizes = process.env.BENCH_SIZE === 'today' ? TODAY : HEAVY;
  console.log(`Synthetic space: ${sizes.tasks} tasks, ${sizes.sessions} sessions, ${sizes.days} days, ${sizes.projects} projects, ${sizes.decisions} decisions`);
  const { keys, snapBlob, rows, json } = await prepare(sizes);
  console.log(`Snapshot: ${(json.length / 1e6).toFixed(2)} MB of JSON, ${(snapBlob.length / 1e3).toFixed(0)} KB gzipped, encrypted and base64 (what D1 returns)\n`);
  const persisted = { wall: 0, counter: 0 };

  console.log('Phases of reading the space (the cost every call pays):');
  const raw = b64uDecode(snapBlob);
  row('base64 decode of the snapshot', await time(() => b64uDecode(snapBlob)));
  row('AES-GCM decrypt + gunzip + JSON.parse (decryptJson)', await time(() => decryptJson(keys, raw)));
  row('JSON.parse alone (for scale)', await time(() => JSON.parse(json)));
  const read = await time(() => buildSpace('s', keys, snapBlob, rows, persisted));
  row(`whole read: snapshot + ${TAIL} batches, folded`, read, true);
  const noBatches = await time(() => buildSpace('s', keys, snapBlob, [], persisted));
  row('whole read: snapshot only', noBatches, true);
  const loaded = read.last;

  console.log('\nA whole call, read + the tool (database I/O not counted):');
  const view = () => new View(loaded.maps, new Date('2026-10-19T10:00:00Z'));
  const toolWork = {
    today: () => dayText(view(), view().today),
    query_tasks: () => queryText(view(), { quadrant: 1 }, {}),
  };
  for (const [name, work] of Object.entries(toolWork)) {
    row(`${name}: tool work alone`, await time(work));
    row(`${name}: read + tool`, await time(async () => { const s = await buildSpace('s', keys, snapBlob, rows, persisted); const v = new View(s.maps, new Date('2026-10-19T10:00:00Z')); return name === 'today' ? dayText(v, v.today) : queryText(v, { quadrant: 1 }, {}); }), true);
  }
  const open = [...loaded.maps.tasks.values()].find(t => t.status === 'open' && !t._del)!;
  const quickEdit = async () => {
    const s = await buildSpace('s', keys, snapBlob, rows, persisted);
    const v = new View(s.maps, new Date('2026-10-19T10:00:00Z'));
    const parsed = ChangeSchema.parse({ op: 'task.done', id: open.id });
    const found = resolveChanges([parsed], v.data);
    const cs: ChangeSet = { v: 1, note: '', changes: found.changes, bad: 0 };
    const plan = planChanges(cs, v.snapshot(), { id: newId, now: () => new Date().toISOString(), zone: 'UTC' });
    if (!isLowRisk(cs, plan)) throw new Error('not low risk');
    const e = new Edits(s);
    await applyPlanned(plan, () => true, docWriter(e, v));
    const batch: ChangeBatch = { v: SCHEMA_VERSION, device: 'connector', docs: e.outgoing() };
    return sealToText(keys, encodeBatch(batch), { lean: true });
  };
  row('apply_changes (tick one done): read + plan + write', await time(quickEdit), true);

  console.log('\nThe MCP layer (a stateless server is built for every request):');
  const mcp = createMcpHandler(() => buildServer({} as never, 'space', { wrapped: '', wall: 0, counter: 0 }), { route: '/mcp', corsOptions: false, responseMode: 'json', allowedHostnames: ['relay.test'] });
  const call = (method: string, params: unknown) => mcp(new Request('https://relay.test/mcp', {
    method: 'POST', headers: { Host: 'relay.test', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), {} as never, {} as never).then(r => r.text());
  row('tools/call get_method (server built, no list)', await time(() => call('tools/call', { name: 'get_method', arguments: {} })), true);
  row('tools/list', await time(() => call('tools/list', {})), true);

  const worst = Math.min(read.median, 1e9);
  console.log(`\nVerdict: reading a ${sizes.tasks}-task space takes about ${worst.toFixed(0)} ms of CPU before any tool work; the free plan allows 10 ms and the target was ${BUDGET_MS} ms.`);
}

await main();
