// A reader must never see a batch with a higher seq while a lower one is still on its way (docs/dev/sync.md, "Order").
// Clients advance their cursor to the highest seq they read and snapshots prune up to it, so a later-arriving lower seq
// would be lost. The test holds one writer back at its insert and reads while the other has finished.
import { env } from 'cloudflare:workers';
import { describe, expect, it, beforeEach } from 'vitest';
import type { Env } from '../src/env';
import { appendBatch } from '../src/sync';
import { blobOf, call, freshMinute, newSpace, push, url } from './helpers';

/** A DB whose writes of batch rows wait for `release` (the statement text is remembered through `prepare` and `bind`). */
function heldDb(release: Promise<void>, held: { hit: boolean }) {
  const sqlOf = new WeakMap<object, string>();
  const rawOf = new WeakMap<object, D1PreparedStatement>();
  const wrap = (st: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const p: D1PreparedStatement = new Proxy(st, {
      get(t, k) {
        if (k === 'bind') return (...a: unknown[]) => wrap(t.bind(...a), sql);
        if (k === 'run') return async () => { if (/INSERT INTO batches/.test(sql)) { held.hit = true; await release; } return t.run(); };
        const v = (t as any)[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    sqlOf.set(p, sql);
    rawOf.set(p, st);
    return p;
  };
  return new Proxy(env.DB, {
    get(t, k) {
      if (k === 'prepare') return (sql: string) => wrap(t.prepare(sql), sql);
      if (k === 'batch') return async (stmts: D1PreparedStatement[]) => {
        if (stmts.some(s => /INSERT INTO batches/.test(sqlOf.get(s) ?? ''))) { held.hit = true; await release; }
        return t.batch(stmts.map(s => rawOf.get(s) ?? s));
      };
      const v = (t as any)[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  }) as D1Database;
}

describe('sync order', () => {
  beforeEach(() => freshMinute());
  it('a write still in flight never leaves a gap below what a reader sees', async () => {
    const k = await newSpace();
    expect((await push(k)).status).toBe(201); // the space exists, head 1
    let go!: () => void;
    const held = { hit: false };
    const slow = { ...(env as unknown as Env), DB: heldDb(new Promise<void>(r => (go = r)), held) } as Env;

    const a = appendBatch(slow, k.spaceId, 'devA', await blobOf(k)); // held at its insert
    await new Promise(r => setTimeout(r, 50));
    expect((await push(k, 'devB')).status).toBe(201); // another device's write goes through meanwhile

    const seen = await call('GET', url(k, '/changes?after=0'), k);
    const seqs: number[] = seen.body.batches.map((b: any) => b.seq);
    const top = Math.max(...seqs);
    for (let s = 1; s <= top; s++) expect(seqs, `seq ${s} is missing below ${top} while its writer is still running`).toContain(s);

    go();
    await a;
    expect(held.hit).toBe(true);
    const after = await call('GET', url(k, '/changes?after=0'), k);
    const all: number[] = after.body.batches.map((b: any) => b.seq);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(3);
  });

  it('many writers at once get distinct seqs with no gap, and the head matches', async () => {
    const k = await newSpace();
    expect((await push(k)).status).toBe(201);
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => push(k, 'dev' + i)));
    expect(rs.map(r => r.status)).toEqual(Array(6).fill(201));
    const seqs = rs.map(r => r.body.seq as number).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 6 }, (_, i) => i + 2));
    const ch = await call('GET', url(k, '/changes?after=0'), k);
    expect(ch.body.head).toBe(7);
    expect(ch.body.batches.map((b: any) => b.seq)).toEqual(Array.from({ length: 7 }, (_, i) => i + 1));
  });
});
