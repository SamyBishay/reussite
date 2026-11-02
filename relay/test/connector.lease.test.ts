// Writes that survive a killed request (docs/dev/connector.md, "Applying a confirmation once"): the lease on a
// confirmation, "Already applied", the batch and its undo record in one transaction, the 25-change cap, and the
// maintenance cron (one space per run, the feed and the compaction taken out of the write).
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyChanges, LEASE_MS, MAX_CHANGES, type Ctx } from '../src/connector/changes';
import { MAINTAIN_CRON, runMaintenance } from '../src/connector/maintain';
import worker from '../src/index';
import config from '../wrangler.jsonc?raw';
import { loadSpace } from '../src/connector/space';
import { View } from '../src/connector/view';
import { appendBatchWith } from '../src/sync';
import type { Env } from '../src/env';
import { freshMinute } from './helpers';
import { maintain, newApp, rpc, signIn, switchOn, tool, type App } from './connector';

const TODAY = new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const task = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me', status: 'open', doneDay: null, doneAt: null,
  started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z', src: 'page', ...o,
});

async function setup(feed?: { fid: string }) {
  const app = await newApp('app' + Math.random().toString(36).slice(2, 7));
  const d = app.device;
  d.add('meta', 'settings', { dayStart: '00:00', ...(feed ? { feedDetail: 'full', feedShared: { fid: feed.fid, secret: 'K'.repeat(43), app: 'https://app.example/', zone: 'UTC' } } : {}) });
  d.add('projects', 'p1', { name: 'Move', suit: 'C', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
  d.add('tasks', 't1', task('Call the agency', { due: day(2) }));
  d.add('tasks', 't2', task('Pay the rent', { due: day(1) }));
  d.add('tasks', 't3', task('Water the plants', { due: TODAY }));
  await app.sync();
  return { app, tok: (await signIn((await switchOn(app)).body.code)).access };
}

const space = (a: App) => a.keys.spaceId;
const nBatches = async (a: App) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM batches WHERE space = ?1').bind(space(a)).first<{ n: number }>())!.n;
const pending = (id: string) => env.DB.prepare('SELECT claimed_until, applied_at, undo_id, seq FROM connector_pending WHERE id = ?1').bind(id).first<{ claimed_until: number | null; applied_at: number | null; undo_id: string | null; seq: number | null }>();
const askedFor = async (tok: string, changes: unknown[]) => /"confirm": "(c\w+)"/.exec((await tool(tok, 'apply_changes', { changes })).text)![1]!;
const manyDrops = ['t1', 't2', 't3'].map(id => ({ op: 'task.update', id, set: { note: 'x' + id } })); // not low risk: it asks first

/** A DB whose batches throw, and whose "let go of the lease" statement does too: what a request killed mid-write leaves behind. */
function killable(kill: { batch: boolean }): Env {
  const db = new Proxy(env.DB, {
    get(t, p) {
      if (p === 'batch') return (list: D1PreparedStatement[]) => { if (kill.batch) throw new Error('killed'); return t.batch(list); };
      if (p === 'prepare') return (sql: string) => { if (kill.batch && /claimed_until = NULL/.test(sql)) throw new Error('killed'); return t.prepare(sql); };
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return { ...(env as unknown as Env), DB: db };
}

/** Call `applyChanges` the way the tool does, but with our own environment. */
async function direct(app: App, withEnv: Env, input: Parameters<typeof applyChanges>[1]) {
  const row = (await env.DB.prepare('SELECT hlc_wall, hlc_counter FROM connector WHERE space = ?1').bind(space(app)).first<{ hlc_wall: number; hlc_counter: number }>())!;
  const s = await loadSpace(env as unknown as Env, space(app), app.keys, { wall: row.hlc_wall, counter: row.hlc_counter }, null);
  s.own = new Set();
  const c: Ctx = { env: withEnv, s, v: new View(s.maps), full: async () => undefined };
  return applyChanges(c, input);
}

describe('a confirmation survives a killed request and is applied once', () => {
  it('a request killed before the write leaves a lease that runs out, and the same id then works once', async () => {
    const { app, tok } = await setup();
    const id = await askedFor(tok, manyDrops);
    const before = await nBatches(app);
    const kill = { batch: true };
    await expect(direct(app, killable(kill), { confirm: id })).rejects.toThrow('killed');
    // The row is still there, claimed, and nothing was written.
    const left = await pending(id);
    expect(left).toMatchObject({ applied_at: null, undo_id: null });
    expect(left!.claimed_until).toBeGreaterThan(Date.now());
    expect(left!.claimed_until).toBeLessThanOrEqual(Date.now() + LEASE_MS);
    expect(await nBatches(app)).toBe(before);

    // While the lease holds, a retry is told it is being applied, and writes nothing.
    const busy = await tool(tok, 'apply_changes', { confirm: id });
    expect(busy.isError).toBe(true);
    expect(busy.text).toContain('being applied right now');
    expect(busy.text).toContain('Nothing was written');
    expect(await nBatches(app)).toBe(before);

    // The lease runs out: the same id works, once.
    await env.DB.prepare('UPDATE connector_pending SET claimed_until = ?1 WHERE id = ?2').bind(Date.now() - 1, id).run();
    const done = await tool(tok, 'apply_changes', { confirm: id });
    expect(done.isError).toBe(false);
    expect(done.text).toContain('3 changes, confirmed');
    expect(await nBatches(app)).toBe(before + 1);
    await app.sync();
    expect(app.device.get('tasks', 't1')!.note).toBe('xt1');
  });

  it('answers "Already applied" with the original undo id when the id comes back, and writes nothing', async () => {
    const { app, tok } = await setup();
    const id = await askedFor(tok, manyDrops);
    const done = await tool(tok, 'apply_changes', { confirm: id });
    const undoId = /Undo id: (u\w+)/.exec(done.text)![1]!;
    const after = await nBatches(app);
    for (let i = 0; i < 2; i++) {
      const again = await tool(tok, 'apply_changes', { confirm: id });
      expect(again.isError).toBe(false);
      expect(again.text).toContain('Already applied');
      expect(again.text).toContain(`Undo id: ${undoId}`);
    }
    expect(await nBatches(app)).toBe(after);
    // and the undo id it names works
    expect((await tool(tok, 'undo', { id: undoId })).text).toContain('Undone.');
  });

  it('the batch, the undo record and the applied mark are one transaction', async () => {
    const { app, tok } = await setup();
    const id = await askedFor(tok, manyDrops);
    const done = await tool(tok, 'apply_changes', { confirm: id });
    const undoId = /Undo id: (u\w+)/.exec(done.text)![1]!;
    const p = await pending(id);
    expect(p).toMatchObject({ undo_id: undoId, claimed_until: null });
    expect(p!.applied_at).toBeGreaterThan(0);
    // the batch the mark points at is the connector's, and the undo record is there
    const b = await env.DB.prepare('SELECT device FROM batches WHERE space = ?1 AND seq = ?2').bind(space(app), p!.seq).first<{ device: string }>();
    expect(b!.device).toBe('connector');
    expect(await env.DB.prepare('SELECT 1 AS x FROM connector_undo WHERE id = ?1 AND space = ?2').bind(undoId, space(app)).first()).toBeTruthy();
    // and the connector's clock and the flags moved with it
    const c = await env.DB.prepare('SELECT hlc_wall, feed_dirty FROM connector WHERE space = ?1').bind(space(app)).first<{ hlc_wall: number; feed_dirty: number }>();
    expect(c!.hlc_wall).toBeGreaterThan(0);
    expect(c!.feed_dirty).toBeGreaterThan(0);
  });

  it('a statement that fails rolls the append back (D1 runs the batch as one transaction)', async () => {
    const { app } = await setup();
    const before = await nBatches(app);
    await expect(appendBatchWith(env as unknown as Env, space(app), 'connector', 'A'.repeat(60), {
      then: () => [env.DB.prepare('INSERT INTO no_such_table (x) VALUES (1)')],
    })).rejects.toThrow();
    expect(await nBatches(app)).toBe(before); // only a seq was used up; no batch row
  });

  it('a condition that no longer holds writes nothing', async () => {
    const { app } = await setup();
    const before = await nBatches(app);
    const r = await appendBatchWith(env as unknown as Env, space(app), 'connector', 'A'.repeat(60), { when: { sql: 'EXISTS (SELECT 1 FROM connector_pending WHERE id = ?7)', args: ['nope'] } });
    expect(r).toBe('skipped');
    expect(await nBatches(app)).toBe(before);
  });

  it('two calls with the same id at once write one batch', async () => {
    const { app, tok } = await setup();
    const id = await askedFor(tok, manyDrops);
    const before = await nBatches(app);
    const both = await Promise.all([tool(tok, 'apply_changes', { confirm: id }), tool(tok, 'apply_changes', { confirm: id })]);
    expect(await nBatches(app)).toBe(before + 1);
    expect(both.filter(r => r.text.startsWith('Done:')).length).toBe(1);
    expect(both.filter(r => /Already applied|being applied right now/.test(r.text)).length).toBe(1);
  });

  it('a clean failure (over the rate limit) lets go of the lease at once', async () => {
    await freshMinute();
    const { app, tok } = await setup();
    const id = await askedFor(tok, manyDrops);
    await env.DB.prepare('UPDATE spaces SET win = ?1, n = 100000 WHERE id = ?2').bind(Math.floor(Date.now() / 60_000), space(app)).run();
    const r = await tool(tok, 'apply_changes', { confirm: id });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Too many changes');
    expect((await pending(id))!.claimed_until).toBeNull();
    await env.DB.prepare('UPDATE spaces SET n = 0 WHERE id = ?1').bind(space(app)).run();
    expect((await tool(tok, 'apply_changes', { confirm: id })).text).toContain('3 changes, confirmed');
  });

  it('an undo is used once, in the same transaction as the batch it writes', async () => {
    const { app, tok } = await setup();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.update', id: 't1', set: { due: day(9) } }] });
    const undoId = /Undo id: (u\w+)/.exec(r.text)![1]!;
    const before = await nBatches(app);
    expect((await tool(tok, 'undo', { id: undoId })).text).toContain('Undone.');
    expect(await nBatches(app)).toBe(before + 1);
    expect(await env.DB.prepare('SELECT 1 AS x FROM connector_undo WHERE id = ?1').bind(undoId).first()).toBeNull();
    const twice = await tool(tok, 'undo', { id: undoId });
    expect(twice.isError).toBe(true);
    expect(await nBatches(app)).toBe(before + 1);
  });

  it('a low-risk change gets its undo record in the same transaction too', async () => {
    const { app, tok } = await setup();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.done', id: 't2' }] });
    const undoId = /Undo id: (u\w+)/.exec(r.text)![1]!;
    expect(await env.DB.prepare('SELECT 1 AS x FROM connector_undo WHERE id = ?1 AND space = ?2').bind(undoId, space(app)).first()).toBeTruthy();
  });
});

describe('at most 25 changes', () => {
  it('refuses 26, naming the limit and the remedy, and writes nothing; 25 are fine', async () => {
    expect(MAX_CHANGES).toBe(25);
    const { app, tok } = await setup();
    const before = await nBatches(app);
    const r = await tool(tok, 'apply_changes', { changes: Array.from({ length: 26 }, (_, i) => ({ op: 'task.create', set: { title: 'Step ' + i } })) });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Nothing was written');
    expect(r.text).toContain('At most 25 changes in one change-set, and this one has 26');
    expect(r.text).toContain('Split it into several change-sets of at most 25');
    expect(await nBatches(app)).toBe(before);
    const ok = await tool(tok, 'apply_changes', { changes: Array.from({ length: 25 }, (_, i) => ({ op: 'task.create', set: { title: 'Step ' + i } })) });
    expect(ok.text).toContain("needs the person's yes");
  });

  it('the tool texts an AI reads say 25', async () => {
    const { tok } = await setup();
    const list = await rpc(tok, 'tools/list');
    const apply = list.body.result.tools.find((t: { name: string }) => t.name === 'apply_changes');
    expect(apply.description).toContain('At most 25 changes');
    const method = (await tool(tok, 'get_method')).text;
    expect(method).toContain('at most 25 changes');
    expect(method).not.toMatch(/at most 80/i);
  });
});

describe('maintenance', () => {
  beforeEach(async () => { await env.DB.prepare('UPDATE connector SET feed_dirty = 0, compact_due = 0').run(); });

  it('a write leaves the feed behind; the cron writes it, one space a run, oldest first', async () => {
    const a = await setup({ fid: 'A'.repeat(32) });
    const b = await setup({ fid: 'B'.repeat(32) });
    for (const x of [a, b]) expect((await tool(x.tok, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Brand new step', due: TODAY, at: '19:00', dur: 30 } }] })).isError).toBe(false);
    const feedOf = async (fid: string) => (await env.DB.prepare('SELECT ics FROM feeds WHERE fid = ?1').bind(fid).first<{ ics: string }>())?.ics ?? '';
    expect(await feedOf('A'.repeat(32))).toBe(''); // the write did not touch the feed
    expect(await feedOf('B'.repeat(32))).toBe('');
    const dirty = (x: App) => env.DB.prepare('SELECT feed_dirty AS d FROM connector WHERE space = ?1').bind(space(x)).first<{ d: number }>().then(r => r!.d);
    expect(await dirty(a.app)).toBeGreaterThan(0);
    expect(await dirty(b.app)).toBeGreaterThan(0);

    // b was looked at longer ago than a: it goes first, whatever the order of their ids
    await env.DB.prepare('UPDATE connector SET last_maintained = ?1 WHERE space = ?2').bind(10, space(a.app)).run();
    await env.DB.prepare('UPDATE connector SET last_maintained = ?1 WHERE space = ?2').bind(5, space(b.app)).run();
    const first = await runMaintenance(env as unknown as Env);
    expect(first).toMatchObject({ space: space(b.app), job: 'feed', done: true });
    expect(await dirty(b.app)).toBe(0);
    expect(await dirty(a.app)).toBeGreaterThan(0); // at most one space per run
    expect(await feedOf('B'.repeat(32))).toContain('Brand new step');
    expect(await feedOf('A'.repeat(32))).toBe('');
    const second = await runMaintenance(env as unknown as Env);
    expect(second).toMatchObject({ space: space(a.app), job: 'feed', done: true });
    expect(await feedOf('A'.repeat(32))).toContain('Brand new step');
    expect(await runMaintenance(env as unknown as Env)).toMatchObject({ space: null }); // nothing left
  });

  it('a space that was picked goes to the back of the line even if its run was killed', async () => {
    const a = await setup({ fid: 'C'.repeat(32) });
    await tool(a.tok, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Another one' } }] });
    const before = await env.DB.prepare('SELECT last_maintained AS l FROM connector WHERE space = ?1').bind(space(a.app)).first<{ l: number }>();
    expect(before!.l).toBe(0);
    // a run whose key can't be opened dies after the pick (as a CPU kill would): the stamp is already set
    await env.DB.prepare('UPDATE connector SET wrapped = ?1 WHERE space = ?2').bind('not a wrapped key', space(a.app)).run();
    await expect(runMaintenance(env as unknown as Env)).rejects.toThrow();
    const after = await env.DB.prepare('SELECT last_maintained AS l, feed_dirty AS d FROM connector WHERE space = ?1').bind(space(a.app)).first<{ l: number; d: number }>();
    expect(after!.l).toBeGreaterThan(0);
    expect(after!.d).toBeGreaterThan(0); // still wanted
    await env.DB.prepare('UPDATE connector SET feed_dirty = 0 WHERE space = ?1').bind(space(a.app)).run();
  });

  it('maintain() finds nothing to do for a space with no tail, no cold read and no write', async () => {
    const a = await setup();
    expect(await maintain(space(a.app))).toEqual([]);
  });
});

describe('the two crons', () => {
  it('the expression in wrangler.jsonc is the one the Worker dispatches on, beside the push tick', async () => {

    const conf = config;
    expect(conf).toContain(`"crons": ["* * * * *", "${MAINTAIN_CRON}"]`);
    expect(conf).toMatch(/"observability": \{ "enabled": true, "head_sampling_rate": 1 \}/);
  });

  it('the maintenance expression runs the maintenance and the other the push tick, never both', async () => {
    const a = await setup({ fid: 'D'.repeat(32) });
    await tool(a.tok, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Seen by the cron', due: TODAY, at: '18:00', dur: 30 } }] });
    const run = async (cron: string) => {
      const waits: Promise<unknown>[] = [];
      worker.scheduled!({ cron, scheduledTime: Date.now(), noRetry() {} } as ScheduledController, env as unknown as Env, { waitUntil: (p: Promise<unknown>) => { waits.push(p); }, passThroughOnException() {} } as unknown as ExecutionContext);
      await Promise.all(waits);
    };
    const dirty = () => env.DB.prepare('SELECT feed_dirty AS d FROM connector WHERE space = ?1').bind(space(a.app)).first<{ d: number }>().then(r => r!.d);
    await run('* * * * *'); // the push tick
    expect(await dirty()).toBeGreaterThan(0);
    await run(MAINTAIN_CRON);
    expect(await dirty()).toBe(0);
  });
});
