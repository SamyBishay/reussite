import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { PAGE_BATCHES, PAGE_BYTES } from '../../src/sync/protocol';
import type { Env } from '../src/env';
import { BATCH_KEEP_MS, MAX_SPACE_BATCH_BYTES, storeSnapshot } from '../src/sync';
import { prune } from '../src/tick';
import { blobOf, call, newSpace, push, url } from './helpers';

const bindings = env as unknown as Env;

it('starts retention when covered, keeps uncovered batches, and preserves pull pages', async () => {
  const keys = await newSpace();
  expect((await push(keys)).status).toBe(201);
  expect((await push(keys)).status).toBe(201);
  const space = keys.spaceId;
  // Both uploads are already more than seven days old when the first is covered.
  await env.DB.prepare('UPDATE batches SET at = 1 WHERE space = ?1').bind(space).run();
  const blob = await blobOf(keys);
  expect(await storeSnapshot(bindings, space, { upto: 1, blob, part: 'hot', cold: { upto: 1, blob } })).toEqual({ upto: 1, pruned: 0 });
  const firstCover = (await env.DB.prepare('SELECT covered_at FROM batches WHERE space = ?1 AND seq = 1').bind(space).first<number>('covered_at'))!;
  expect(firstCover).toBeGreaterThan(1);
  await prune(bindings, firstCover + BATCH_KEEP_MS - 1);

  const seqs = async () => (await env.DB.prepare('SELECT seq FROM batches WHERE space = ?1 ORDER BY seq').bind(space).all<{ seq: number }>()).results.map(r => r.seq);
  expect(await seqs()).toEqual([1, 2]);

  // Fill the tail so both row- and byte-limited paging paths can be checked.
  await env.DB.prepare(`WITH RECURSIVE seqs(n) AS (VALUES (3) UNION ALL SELECT n + 1 FROM seqs WHERE n < ?2)
    INSERT INTO batches (space, seq, device, blob, size, at)
    SELECT ?1, n, 'dev1', ?3, ?4, 1 FROM seqs`).bind(space, PAGE_BATCHES + 3, blob, Math.ceil(PAGE_BYTES / 3)).run();
  await env.DB.prepare('UPDATE spaces SET head = ?2 WHERE id = ?1').bind(space, PAGE_BATCHES + 3).run();
  const pull = async (after: number) => (await call('GET', url(keys, '/changes?after=' + after), keys)).body;

  const split = await pull(0);
  expect(split.snapshot.upto).toBe(1);
  expect(split.cold.upto).toBe(1);
  expect(split.batches[0].seq).toBe(2);
  expect(split.more).toBe(true);
  const bytes = await pull(2);
  expect(bytes.batches.map((r: { seq: number }) => r.seq)).toEqual([3, 4, 5]);
  expect(bytes.more).toBe(true);

  // Valid split writes maintain cold.upto <= hot.upto. Seed the otherwise
  // unreachable cold-only branch to prove it also starts above covered history.
  await env.DB.prepare("UPDATE snapshots SET upto = 2 WHERE space = ?1 AND kind = 'cold'").bind(space).run();
  const coldOnly = await pull(1);
  expect(coldOnly.snapshot).toBeNull();
  expect(coldOnly.cold.upto).toBe(2);
  expect(coldOnly.batches[0].seq).toBe(2);

  await prune(bindings, firstCover + BATCH_KEEP_MS);
  expect((await seqs()).slice(0, 2)).toEqual([2, 3]);
  expect(await pull(1)).toEqual(coldOnly);
  expect(await pull(2)).toEqual(bytes);

  await env.DB.prepare("UPDATE snapshots SET upto = 1 WHERE space = ?1 AND kind = 'cold'").bind(space).run();
  expect(await pull(0)).toEqual(split);
  await env.DB.prepare('UPDATE batches SET size = 1 WHERE space = ?1').bind(space).run();
  const rows = await pull(0);
  expect(rows.batches).toHaveLength(PAGE_BATCHES);
  expect(rows.batches[0].seq).toBe(2);
  expect(rows.more).toBe(true);
  const end = await pull(rows.batches.at(-1).seq);
  expect(end.batches.map((r: { seq: number }) => r.seq)).toEqual([PAGE_BATCHES + 2, PAGE_BATCHES + 3]);
  expect(end.more).toBe(false);
});

it('rejects a batch over the per-space byte cap and accepts more after covered rows expire', async () => {
  const keys = await newSpace();
  expect((await push(keys)).status).toBe(201);
  const blob = await blobOf(keys);
  const space = keys.spaceId;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO batches VALUES (?1, 2, 'dev1', ?2, ?3, 1, NULL)").bind(space, blob, MAX_SPACE_BATCH_BYTES),
    env.DB.prepare('UPDATE spaces SET head = 2 WHERE id = ?1').bind(space),
  ]);
  expect(await push(keys)).toMatchObject({ status: 507, body: { error: 'storage_full' } });
  expect(await storeSnapshot(bindings, space, { upto: 2, blob })).toEqual({ upto: 2, pruned: 0 });
  await prune(bindings, Date.now() + BATCH_KEEP_MS);
  expect(await push(keys)).toMatchObject({ status: 201, body: { seq: 3 } });
});

it('at the cap, drops the oldest covered history to take a push, and never the live tail', async () => {
  const keys = await newSpace();
  for (let i = 0; i < 4; i++) expect((await push(keys)).status).toBe(201);
  const space = keys.spaceId;
  const blob = await blobOf(keys);
  // Batches 1 to 3 are covered history, 4 is the live tail; together they fill the byte cap.
  expect(await storeSnapshot(bindings, space, { upto: 3, blob })).toEqual({ upto: 3, pruned: 0 });
  const third = Math.floor(MAX_SPACE_BATCH_BYTES / 4);
  await env.DB.prepare('UPDATE batches SET size = ?2 WHERE space = ?1').bind(space, third).run();
  await env.DB.prepare('UPDATE spaces SET batch_bytes = (SELECT SUM(size) FROM batches WHERE space = ?1) WHERE id = ?1').bind(space).run();
  const seqs = async () => (await env.DB.prepare('SELECT seq FROM batches WHERE space = ?1 ORDER BY seq').bind(space).all<{ seq: number }>()).results.map(r => r.seq);

  expect(await push(keys)).toMatchObject({ status: 201, body: { seq: 5 } });
  expect(await seqs()).toEqual([2, 3, 4, 5]); // only the oldest covered row went

  // A live tail over the cap is never dropped: the push is refused.
  await env.DB.prepare('UPDATE batches SET size = ?2 WHERE space = ?1 AND seq = 5').bind(space, MAX_SPACE_BATCH_BYTES).run();
  await env.DB.prepare('UPDATE spaces SET batch_bytes = (SELECT SUM(size) FROM batches WHERE space = ?1) WHERE id = ?1').bind(space).run();
  expect(await push(keys)).toMatchObject({ status: 507, body: { error: 'storage_full' } });
  expect(await seqs()).toEqual([2, 3, 4, 5]);
});
