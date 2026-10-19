// An in-memory device for tests: a clock, documents edited with the same functions the app
// uses (create / patch / remove), and a SyncStore over them. Not used by the app.
import { type Clock, createClock, tick } from '../data/hlc';
import { create, patch, remove } from '../data/doc';
import { SCHEMA_VERSION, type Collection } from '../data/schema';
import { INITIAL_STATE, type SyncState, type SyncStore } from './run';
import { SYNCED_COLLECTIONS, type DocSet } from './engine';
import type { StoredDoc } from './protocol';

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
