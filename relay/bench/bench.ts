// CPU benchmark for one connector call (brief §10: the free plan gives 10 ms of CPU per request).
// Run with `npm run bench` (bundles with esbuild, runs in Node). It builds a synthetic space the
// size of a heavy user's list, encrypts it the way the app does (a snapshot in two parts, hot and
// cold, with the lean clocks), then times what a call does on the Worker's CPU: base64 decode,
// AES-GCM decrypt, gunzip, JSON.parse, folding the batches since, and the tool's own work.
// Database round trips are I/O, not CPU, and are left out (a stub stands in for D1 where the
// warm path needs one). V8 is V8: Node's numbers are a fair guide to workerd's, but a cold isolate
// (no JIT warm-up) is slower, so the first run is shown too.
//
// Two situations are reported apart:
//   cold isolate  the cache is empty: every call reads the snapshot's hot part and the tail. This
//                 is the guarantee; a new isolate, or one the platform recycled, looks like this.
//   warm isolate  the cache holds the merged list: a call reads only the batches after it.
//
// BENCH_SIZE=today uses the owner's list size; BENCH_TAIL sets the batches after the snapshot
// (default 8, what the app leaves; BENCH_TAIL=30 shows the old tail).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMcpHandler } from 'agents/mcp/server';
import { applyPlanned, isLowRisk, planChanges } from '../../src/ai/apply';
import { ChangeSchema, type ChangeSet } from '../../src/ai/changeset';
import { b64uDecode, b64uEncode } from '../../src/sync/bytes';
import { decryptJson, sealToText } from '../../src/sync/crypto';
import { deriveKeys, generateKey } from '../../src/sync/keys';
import { SCHEMA_VERSION } from '../../src/data/schema';
import { create, patch } from '../../src/data/doc';
import { createClock, tick } from '../../src/data/hlc';
import type { ChangeBatch, Snapshot } from '../../src/sync/protocol';
import { buildParts } from '../../src/sync/parts';
import { collectOutgoing } from '../../src/sync/engine';
import { decodeSnapshot, encodeBatch, encodeSnapshot } from '../../src/sync/wire';
import { resolveChanges } from '../src/connector/resolve';
import { dayText, memoryText, projectText, queryText, taskText } from '../src/connector/render';
import { buildSpace, Edits, loadCold, loadSpace, sealHot, type Loaded } from '../src/connector/space';
import { buildServer } from '../src/connector/tools';
import { cacheGet, remember, setCacheEnabled } from '../src/connector/cache';
import { View } from '../src/connector/view';
import { docWriter, newId } from '../src/connector/writer';
import { HEAVY, TODAY, syntheticSpace, type Sizes } from './synthetic';

const BUDGET_MS = 7;
/** Notes in the space (8 lines each): a heavy user's memory. */
const MEMORY = Number(process.env.BENCH_MEMORY ?? 150);
/** Exchanges in the space over 90 days (ten lines a day on Home): what History holds. */
const EXCHANGES = Number(process.env.BENCH_EXCHANGES ?? 900);
const RUNS = 25;
const TAIL = Number(process.env.BENCH_TAIL) || 8;
const NOW = Date.parse('2026-10-19T09:30:00Z');
const AT = new Date('2026-10-19T10:00:00Z');

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
const kb = (n: number) => (n / 1e3).toFixed(0).padStart(4) + ' KB';
const row = (label: string, r: { first: number; median: number; p95: number }, budget = false) =>
  console.log(`  ${label.padEnd(54)} median ${ms(r.median)}   p95 ${ms(r.p95)}   first run ${ms(r.first)}${budget ? (r.median <= BUDGET_MS ? '   ok' : '   OVER ' + BUDGET_MS + ' ms') : ''}`);

async function prepare(sizes: Sizes) {
  const key = generateKey();
  const keys = await deriveKeys(key);
  const docs = syntheticSpace(sizes);
  const whole: Snapshot = { v: SCHEMA_VERSION, upto: 100, docs };
  const parts = buildParts(docs, 100, { now: NOW });
  const seal = (v: unknown) => sealToText(keys, v, { lean: true });
  const wholeBlob = await seal(encodeSnapshot(whole));
  const hotBlob = process.env.BENCH_PLAIN_HOT ? await sealToText(keys, encodeSnapshot(parts.hot), { lean: true, plain: true }) : await seal(encodeSnapshot(parts.hot));
  const coldBlob = await seal(encodeSnapshot(parts.cold!));
  const oldWholeBlob = await sealToText(keys, whole); // generation 1: whole documents, one clock per field
  // Batches written by the app since: a few edits each, like a day of use.
  const clock = createClock('phone0002');
  clock.wall = NOW;
  const open = docs.tasks!.filter(t => t.status === 'open');
  const rows: { seq: number; blob: string }[] = [];
  for (let i = 0; i < TAIL; i++) {
    const t = open[(i * 37) % open.length]!;
    const edited = patch(t, { note: 'edited ' + i, est: 20 + i }, clock, SCHEMA_VERSION);
    const fresh = create('n' + i, { title: 'New step ' + i, project: 'p1', status: 'open', suit: 'S', est: 10, due: null, important: true, urgent: false, where: 'any', template: false, note: '', order: 1 }, SCHEMA_VERSION, tick(clock));
    const out = collectOutgoing({ tasks: [edited, fresh as never] }, 'phone0002', '');
    const batch: ChangeBatch = { v: SCHEMA_VERSION, device: 'phone0002', docs: out.docs };
    rows.push({ seq: 101 + i, blob: await seal(encodeBatch(batch)) });
  }
  return { key: b64uEncode(key), keys, parts, wholeBlob, oldWholeBlob, hotBlob, coldBlob, rows, hotJson: JSON.stringify(encodeSnapshot(parts.hot)), wholeJson: JSON.stringify(encodeSnapshot(whole)), docs };
}
type Prepared = Awaited<ReturnType<typeof prepare>>;

/** Just enough of D1 for the two statements the warm path makes. */
function stubDb(p: Prepared, upto: number, head: number) {
  const stmt = (sql: string) => ({ bind: (...args: unknown[]) => ({ sql, args }) });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: { sql: string; args: unknown[] }[]) => list.map(l => l.sql.includes('FROM spaces')
      ? { results: [{ upto, head }] }
      : { results: p.rows.filter(r => r.seq > (l.args[1] as number)) }),
  } as never;
}


const viewOf = (s: Loaded) => new View(s.maps, AT, s.split && !s.split.loaded ? { x: s.split.x, from: s.split.from } : null);

/** What each tool does with a loaded space, for the timings. */
const toolsFor = (openId: string): Record<string, (s: Loaded, v: View) => unknown> => ({
  today: (_s, v) => dayText(v, v.today),
  query_tasks: (_s, v) => queryText(v, { quadrant: 1 }, {}),
  get_project: (_s, v) => projectText(v, 'p1'),
  get_task: (_s, v) => taskText(v, v.tasks.get(openId)!),
  // 150 notes of 8 lines (MEMORY): the profile and the index, one note by name with its steps, and a query that reads every line.
  read_memory: (_s, v) => memoryText(v, {}),
  read_memory_name: (_s, v) => memoryText(v, { name: 'm4' }),
  read_memory_query: (_s, v) => memoryText(v, { query: 'choir rehearsal notes' }),
});

/** apply_changes with one low-risk change: plan, write, seal the batch (the database round trips are left out). */
const editFor = (keys: Awaited<ReturnType<typeof deriveKeys>>, openId: string, load: () => Promise<Loaded>) => async (s0?: Loaded) => {
  const s = s0 ?? await load();
  s.own = new Set();
  const v = viewOf(s);
  const parsed = ChangeSchema.parse({ op: 'task.done', id: openId });
  const found = resolveChanges([parsed], v.data);
  const cs: ChangeSet = { v: 1, note: '', changes: found.changes, bad: 0 };
  const plan = planChanges(cs, v.snapshot(), { id: newId, now: () => new Date().toISOString(), zone: 'UTC' });
  if (!isLowRisk(cs, plan)) throw new Error('not low risk');
  const e = new Edits(s);
  await applyPlanned(plan, () => true, docWriter(e, v));
  const batch: ChangeBatch = { v: SCHEMA_VERSION, device: 'connector', docs: e.outgoing() };
  return sealToText(keys, encodeBatch(batch), { lean: true });
};

/**
 * A fresh process, the first call only: nothing warmed up, as in an isolate that has just started.
 * The parent prepares the blobs once and starts this a few times per call.
 */
async function child(name: string) {
  const f = JSON.parse(readFileSync(process.env.BENCH_FILE!, 'utf8')) as { key: string; hotBlob: string; rows: { seq: number; blob: string }[]; openId: string };
  const keys = await deriveKeys(b64uDecode(f.key));
  // Node loads its streams, crypto and Intl lazily on first use, which workerd has ready; touch them once so
  // what is timed is our code running cold, not the platform starting up.
  const gz = await new Response(new Blob(['warm up']).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const iv = new Uint8Array(12);
  await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keys.encKey, await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keys.encKey, new Uint8Array(4)));
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hourCycle: 'h23', hour: '2-digit' }).formatToParts(new Date());
  atob('AAAA'); JSON.parse('{"a":[1]}'); new TextDecoder().decode(new TextEncoder().encode('x'));
  const load = () => buildSpace('s', keys, f.hotBlob, f.rows, { wall: 0, counter: 0 });
  const t0 = performance.now();
  if (name === 'edit') await editFor(keys, f.openId, load)();
  else { const s = await load(); if (name !== 'read') toolsFor(f.openId)[name]!(s, viewOf(s)); }
  console.log(JSON.stringify({ ms: performance.now() - t0 }));
}

function fresh(file: string, name: string, n = 7): number[] {
  const me = fileURLToPath(import.meta.url);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(JSON.parse(execFileSync('node', [me], { env: { ...process.env, BENCH_CHILD: name, BENCH_FILE: file }, encoding: 'utf8' }).trim().split('\n').at(-1)!).ms);
  return out.sort((a, b) => a - b);
}

export async function main() {
  if (process.env.BENCH_CHILD) return child(process.env.BENCH_CHILD);
  const sizes = { ...(process.env.BENCH_SIZE === 'today' ? TODAY : HEAVY), memory: MEMORY, exchanges: EXCHANGES };
  console.log(`Synthetic space: ${sizes.tasks} tasks, ${sizes.sessions} sessions, ${sizes.days} days, ${sizes.projects} projects, ${sizes.decisions} decisions; ${sizes.memory} memory notes; ${sizes.exchanges} exchanges; ${TAIL} batches after the snapshot`);
  const p = await prepare(sizes);
  const { keys, rows } = p;
  const persisted = { wall: 0, counter: 0 };
  setCacheEnabled(false);
  const hot = async () => buildSpace('s', keys, p.hotBlob, rows, persisted);
  if (process.env.BENCH_PROFILE) { // for `node --cpu-prof`: loop one thing so the profile is about it
    for (let i = 0; i < 200; i++) {
      const s = await hot();
      if (process.env.BENCH_PROFILE === 'today') dayText(viewOf(s), viewOf(s).today);
      if (process.env.BENCH_PROFILE === 'query') queryText(viewOf(s), { quadrant: 1 }, {});
    }
    return;
  }
  console.log(`Before: one whole snapshot, whole documents (generation 1): ${(JSON.stringify({ docs: p.docs }).length / 1e6).toFixed(2)} MB of JSON, ${kb(p.oldWholeBlob.length)} stored`);
  console.log(`Whole snapshot, lean clocks:                        ${(p.wholeJson.length / 1e6).toFixed(2)} MB of JSON, ${kb(p.wholeBlob.length)} stored`);
  console.log(`After: hot part ${(p.hotJson.length / 1e6).toFixed(2)} MB of JSON, ${kb(p.hotBlob.length)} stored (${p.parts.hot.docs.tasks!.length} steps, ${p.parts.hot.docs.sessions!.length} sessions); cold part ${kb(p.coldBlob.length)}\n`);

  console.log('Phases of reading the hot part (the cost every call pays on a cold isolate):');
  const raw = b64uDecode(p.hotBlob);
  row('base64 decode of the hot part', await time(() => b64uDecode(p.hotBlob)));
  row('AES-GCM decrypt + gunzip + JSON.parse (decryptJson)', await time(() => decryptJson(keys, raw)));
  {
    const aad = new Uint8Array([raw[0]!, ...new TextEncoder().encode(keys.spaceId)]);
    const sealed = raw.slice(13);
    const gz = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(1, 13), additionalData: aad }, keys.encKey, sealed));
    const gunzip = (d: Uint8Array) => new Response(new Blob([d as never]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const text = new TextDecoder().decode(new Uint8Array(await gunzip(gz)));
    const bytes = new TextEncoder().encode(text);
    row('  of which AES-GCM decrypt alone', await time(() => crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(1, 13), additionalData: aad }, keys.encKey, sealed)));
    row('  of which gunzip alone', await time(() => gunzip(gz)));
    row('  of which UTF-8 decode alone', await time(() => new TextDecoder().decode(bytes)));
    row('  of which JSON.parse alone', await time(() => JSON.parse(text)));
    row('  then decodeSnapshot (rebuild _hlc)', await time(() => decodeSnapshot(JSON.parse(text))));
  }
  row('BEFORE  whole read: old snapshot + tail, folded', await time(() => buildSpace('s', keys, p.oldWholeBlob, rows, persisted)));
  const read = await time(hot);
  row(`AFTER   hot read: hot + ${TAIL} batches, folded`, read, true);
  row('        hot read: hot part only', await time(() => buildSpace('s', keys, p.hotBlob, [], persisted)), true);
  const loaded = read.last;

  console.log('\nA whole call on a cold isolate (read + the tool; database I/O not counted):');
  const open = [...loaded.maps.tasks.values()].find(t => t.status === 'open' && !t._del)!;
  const oldTask = [...p.docs.tasks!].find(t => t.status === 'done')!;
  const tools = toolsFor(open.id);
  const quickEdit = editFor(keys, open.id, hot);
  const results: Record<string, { median: number; first: number; p95?: number }> = {};
  for (const [name, work] of Object.entries(tools)) {
    row(`${name}: tool work alone`, await time(() => work(loaded, viewOf(loaded))));
    const r = await time(async () => { const s = await hot(); return work(s, viewOf(s)); });
    row(`${name}: read + tool`, r, true);
    results[name] = r;
  }
  results.edit = await time(() => quickEdit());
  row('apply_changes (tick one done): read + plan + write', results.edit as never, true);

  const fresh1: Record<string, number> = {};
  {
    const file = fileURLToPath(new URL('./cold.json', import.meta.url)); // next to the bundle (bench/.out)
    writeFileSync(file, JSON.stringify({ key: p.key, hotBlob: p.hotBlob, rows, openId: open.id }));
    console.log('\nA fresh process, first call only (nothing warmed up; 7 runs, min / median / max):');
    for (const name of ['read', ...Object.keys(tools), 'edit']) {
      const a = fresh(file, name);
      console.log(`  ${name.padEnd(54)} ${a[0]!.toFixed(1).padStart(6)} / ${a[a.length >> 1]!.toFixed(1).padStart(6)} / ${a.at(-1)!.toFixed(1).padStart(6)} ms`);
      fresh1[name] = a[a.length >> 1]!;
    }
  }

  console.log('\nThe same on a warm isolate (the cache holds the merged list; only later batches are read):');
  setCacheEnabled(true);
  const base = await buildSpace('s', keys, p.hotBlob, rows.slice(0, TAIL - 1), persisted);
  base.wrapped = 'w';
  remember(base);
  const db = stubDb(p, 100, 100 + TAIL);
  const warm = async () => { const e = cacheGet('s', 'w')!; remember({ ...base, wrapped: 'w' } as Loaded); return loadSpace({ DB: db } as never, 's', keys, persisted, e); };
  row(`warm read: cache + the ${1} batch since`, await time(warm), true);
  const wr: Record<string, { median: number }> = {};
  for (const [name, work] of Object.entries(tools)) {
    const r = await time(async () => { const s = await warm(); return work(s, viewOf(s)); });
    row(`${name}: warm read + tool`, r, true);
    wr[name] = r;
  }
  const wedit = await time(async () => quickEdit(await warm()));
  row('apply_changes (tick one done): warm read + plan + write', wedit, true);
  setCacheEnabled(false);

  console.log('\nWhen a call needs the cold part (an old finished step; reads hot, then cold):');
  const coldDb = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ blob: p.coldBlob }] }) }) }) } as never;
  const full = await time(async () => { const s = await hot(); await loadCold({ DB: coldDb } as never, s); return taskText(viewOf(s), s.maps.tasks.get(oldTask.id)! as never); });
  row('get_task on a step finished months ago', full);

  console.log('\nCompacting the hot part after a write (best effort, once the tail passes COMPACT_TAIL):');
  const sealed = await time(() => sealHot(loaded, 100 + TAIL));
  row('rewrite the hot part: encode + gzip + encrypt', { ...sealed, p95: sealed.median });

  console.log('\nThe MCP layer (a stateless server is built for every request):');
  const mcp = createMcpHandler(() => buildServer({} as never, 'space', { wrapped: '', wall: 0, counter: 0 }), { route: '/mcp', corsOptions: false, responseMode: 'json', allowedHostnames: ['relay.test'] });
  const call = (method: string, params: unknown) => mcp(new Request('https://relay.test/mcp', {
    method: 'POST', headers: { Host: 'relay.test', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), {} as never, {} as never).then(r => r.text());
  const layer = await time(() => call('tools/call', { name: 'get_method', arguments: {} }));
  row('tools/call get_method (server built, no list)', layer, true);
  row('tools/list', await time(() => call('tools/list', {})), true);

  console.log(`\nSummary, ms of CPU, without the MCP layer (${layer.median.toFixed(1)} ms warm) that every call adds:`);
  console.log('  call                 cold isolate: first call / steady     warm isolate (cache hit)');
  for (const name of ['today', 'query_tasks', 'get_project', 'get_task', 'read_memory', 'read_memory_name', 'read_memory_query']) console.log(`  ${name.padEnd(18)}   ${fresh1[name]!.toFixed(1).padStart(8)} / ${results[name]!.median.toFixed(1).padStart(5)}                  ${wr[name]!.median.toFixed(1).padStart(5)}`);
  console.log(`  ${'one-step edit'.padEnd(18)}   ${fresh1.edit!.toFixed(1).padStart(8)} / ${results.edit!.median.toFixed(1).padStart(5)}                  ${wedit.median.toFixed(1).padStart(5)}`);
  console.log(`\nVerdict: a hot read of the ${sizes.tasks}-task space takes about ${read.median.toFixed(0)} ms of CPU before any tool work; the free plan allows 10 ms and the target was ${BUDGET_MS} ms.`);
}

await main();
