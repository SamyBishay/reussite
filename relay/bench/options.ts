// What would fit in 10 ms? Reads of three smaller shapes of the same space, to compare with
// bench.ts. These are measurements for the product owner's decision, not code the relay uses.
//   1. the whole space as it is stored today (documents with a clock for every field)
//   2. the same documents without their per-field clocks (a clock past the newest is enough for the connector to write)
//   3. only what a chat needs: open steps, projects, places, stays, settings, decisions, the last and next 14 days,
//      without clocks, and the personal-estimate points precomputed
// Sessions and done steps would be read on demand from a second blob.
import { decryptJson, sealToText } from '../../src/sync/crypto';
import { deriveKeys, generateKey } from '../../src/sync/keys';
import { b64uDecode } from '../../src/sync/bytes';
import { addDays } from '../../src/domain/dates';
import { estPointsOf } from '../../src/domain/lists';
import { fieldsOf } from '../../src/data/doc';
import { HEAVY, syntheticSpace } from './synthetic';

async function measure(label: string, value: unknown, keys: Awaited<ReturnType<typeof deriveKeys>>) {
  const json = JSON.stringify(value);
  const blob = await sealToText(keys, value);
  const run = async () => { const s = performance.now(); const raw = b64uDecode(blob); await decryptJson(keys, raw); return performance.now() - s; };
  await run();
  const a: number[] = [];
  for (let i = 0; i < 20; i++) a.push(await run());
  a.sort((x, y) => x - y);
  console.log(`  ${label.padEnd(58)} ${(json.length / 1e6).toFixed(2)} MB json  ${(blob.length / 1e3).toFixed(0).padStart(4)} KB stored  read ${a[10]!.toFixed(1).padStart(5)} ms`);
}

const keys = await deriveKeys(generateKey());
const docs = syntheticSpace(HEAVY);
const today = '2026-10-19';
console.log('Reading one blob (base64 decode, decrypt, gunzip, parse):');
await measure('1. everything, with clocks (today)', { docs }, keys);

const plain = (d: Record<string, unknown>) => fieldsOf(d as never);
const noClocks = Object.fromEntries(Object.entries(docs).map(([c, xs]) => [c, xs.filter(d => !d._del).map(plain)]));
await measure('2. everything, without clocks', { docs: noClocks }, keys);

const open = docs.tasks!.filter(d => d.status === 'open' && !d._del).map(plain);
const near = (k: unknown) => typeof k === 'string' && k >= addDays(today, -14) && k <= addDays(today, 14);
const lean = {
  tasks: open,
  days: docs.days!.filter(d => near(d.date)).map(plain),
  projects: noClocks.projects, places: noClocks.places, stays: noClocks.stays, decisions: noClocks.decisions, meta: noClocks.meta,
  estPoints: estPointsOf(docs.tasks! as never, docs.sessions as never),
};
await measure('3. open steps and near days only, no clocks, estimate points', lean, keys);
await measure('   3b. the same with 400 open steps instead of ~520', { ...lean, tasks: open.slice(0, 400) }, keys);
console.log(`\n  (${open.length} open steps of ${HEAVY.tasks})`);
