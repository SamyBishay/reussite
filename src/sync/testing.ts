// An in-memory device for tests: a clock, documents edited with the same functions the app
// uses (create / patch / remove), and a SyncStore over them. Not used by the app.
import { type Clock, createClock, tick } from '../data/hlc';
import { create, patch, remove } from '../data/doc';
import { SCHEMA_VERSION, type Collection } from '../data/schema';
import { INITIAL_STATE, type SyncState, type SyncStore } from './run';
import { SYNCED_COLLECTIONS, type DocSet } from './engine';
import type { StoredDoc } from './protocol';
import { hashAuthSecret } from './keys';

export class FakeDevice implements SyncStore {
  clock: Clock;
  docs = new Map<Collection, Map<string, StoredDoc>>();
  state: SyncState = { ...INITIAL_STATE };
  /** What putMany was asked to write, for assertions. */
  writes = 0;

  constructor(node: string) { this.clock = createClock(node); }

  private coll(c: Collection) {
    if (!this.docs.has(c)) this.docs.set(c, new Map());
    return this.docs.get(c)!;
  }
  get(c: Collection, id: string): StoredDoc | undefined { return this.docs.get(c)?.get(id); }

  // Timestamps come from Date.now(): tests move it with vi.setSystemTime.
  add(c: Collection, id: string, fields: Record<string, unknown>) {
    this.coll(c).set(id, create(id, fields, SCHEMA_VERSION, tick(this.clock)));
  }
  edit(c: Collection, id: string, changes: Record<string, unknown>) {
    this.coll(c).set(id, patch(this.get(c, id)!, changes, this.clock, SCHEMA_VERSION));
  }
  del(c: Collection, id: string) { this.coll(c).set(id, remove(this.get(c, id)!, this.clock)); }

  /** The whole state, ordered, for comparing two devices. */
  dump(): Record<string, StoredDoc[]> {
    const out: Record<string, StoredDoc[]> = {};
    for (const c of SYNCED_COLLECTIONS) out[c] = [...(this.docs.get(c)?.values() ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
    return JSON.parse(JSON.stringify(out, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v)));
  }

  async loadState() { return { ...this.state }; }
  async saveState(s: SyncState) { this.state = { ...s }; }
  async all(): Promise<DocSet> { return Object.fromEntries(SYNCED_COLLECTIONS.map(c => [c, [...(this.docs.get(c)?.values() ?? [])]])); }
  async getMany(c: Collection, ids: string[]) { return ids.flatMap(id => this.get(c, id) ?? []); }
  async putMany(writes: { c: Collection; d: StoredDoc }[]) {
    this.writes += writes.length;
    for (const { c, d } of writes) this.coll(c).set(d.id, d);
  }
}

/**
 * An in-memory relay behind a `fetch`, speaking the real protocol (same URLs, same errors) without
 * pruning of anything but batches. Paging is not simulated. For tests of the app's sync; the real one is in `relay/`.
 */
export function fakeRelay() {
  interface Space { hash: string; batches: { seq: number; device: string; blob: string; at: number }[]; snapshot: { upto: number; blob: string; at: number } | null; cold: { upto: number; blob: string; at: number } | null; devices: Map<string, { label: string | null; lastSeen: number }> }
  const spaces = new Map<string, Space>();
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const m = /^\/v1\/spaces\/([^/]+)(?:\/([a-z]+)(?:\/([^/]+))?)?$/.exec(url.pathname);
    if (!m) return reply(404, { error: 'not_found' });
    const [, id, route = '', device] = m;
    const method = init?.method ?? 'GET';
    const token = /^Bearer (.+)$/.exec(new Headers(init?.headers).get('Authorization') ?? '')?.[1];
    if (!token) return reply(401, { error: 'unauthorized' });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let sp = spaces.get(id!);
    const hash = await hashAuthSecret(token);
    if (!sp) {
      if (method === 'POST' && route === 'batches') spaces.set(id!, (sp = { hash, batches: [], snapshot: null, cold: null, devices: new Map() }));
      else return reply(404, { error: 'unknown_space' });
    }
    if (sp.hash !== hash) return reply(403, { error: 'forbidden' });
    if (method === 'DELETE' && route === '') { spaces.delete(id!); return reply(200, { ok: true }); }
    if (route === 'batches') {
      const seq = (sp.batches.at(-1)?.seq ?? sp.snapshot?.upto ?? 0) + 1;
      sp.batches.push({ seq, device: body.device, blob: body.blob, at: Date.now() });
      return reply(201, { seq });
    }
    if (route === 'changes') {
      const after = Number(url.searchParams.get('after') ?? 0);
      const snap = sp.snapshot && after < sp.snapshot.upto ? sp.snapshot : null;
      const from = Math.max(after, sp.snapshot?.upto ?? 0);
      const cold = sp.cold && after < sp.cold.upto ? sp.cold : null;
      return reply(200, { head: sp.batches.at(-1)?.seq ?? 0, more: false, snapshot: snap, cold, batches: sp.batches.filter(b => b.seq > from) });
    }
    if (route === 'snapshot') {
      if (sp.snapshot && sp.snapshot.upto >= body.upto) return reply(200, { upto: sp.snapshot.upto, pruned: 0 });
      if (body.part === 'hot' && !body.cold && !(sp.cold && sp.cold.upto >= (body.coldUpto ?? Infinity))) return reply(409, { error: 'bad_parts' });
      sp.snapshot = { upto: body.upto, blob: body.blob, at: Date.now() };
      if (body.part !== 'hot') sp.cold = null;
      else if (body.cold) sp.cold = { ...body.cold, at: Date.now() };
      const before = sp.batches.length;
      sp.batches = sp.batches.filter(b => b.seq > body.upto);
      return reply(200, { upto: body.upto, pruned: before - sp.batches.length });
    }
    if (route === 'devices') {
      if (device) { sp.devices.set(device, { label: body.label ?? sp.devices.get(device)?.label ?? null, lastSeen: Date.now() }); return reply(200, { ok: true }); }
      return reply(200, { devices: [...sp.devices].map(([d, v]) => ({ device: d, label: v.label, lastSeen: v.lastSeen })) });
    }
    return reply(404, { error: 'not_found' });
  };
  return { fetch: fetchFn, spaces };
}
