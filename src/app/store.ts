// App state: IndexedDB is the source of truth; signals mirror it for the views.
// Every write goes through here, so it gets field clocks and respects read-only mode.
import { signal, computed, batch } from '@preact/signals';
import { liveQuery } from 'dexie';
import { ReussiteDb, getLocal, setLocal } from '../data/db';
import { create, patch, remove, fieldsOf, type Stored } from '../data/doc';
import { createClock, tick, type Clock } from '../data/hlc';
import { SCHEMA_VERSION, type UndoDoc, type Collection, type Day, type Project, type Session, type Task, type Place, type Decision, type Stay, type MemoryNote, type Exchange, type Address, type Person } from '../data/schema';
import { normAddress, normDecision, normExchange, normNote, normPerson } from '../data/normalize';
import { whereNow } from '../domain/places';
import { withDefaults, type Settings } from '../data/settings';
import { runMigrations } from '../data/migrations';
import { writeMerged, type Write } from '../data/syncstore';
import { lang, t } from '../i18n';
import { UndoLog, undoWrites } from '../ai/undo';

export type WithId<T> = T & { id: string };

export const db = new ReussiteDb();
let clock: Clock = createClock('pending');

export const tasks = signal(new Map<string, WithId<Task>>());
export const sessions = signal(new Map<string, WithId<Session>>());
export const projects = signal(new Map<string, WithId<Project>>());
export const days = signal(new Map<string, WithId<Day>>());
export const decisions = signal(new Map<string, WithId<Decision>>());
export const places = signal(new Map<string, WithId<Place>>());
export const stays = signal(new Map<string, WithId<Stay>>());
export const memory = signal(new Map<string, WithId<MemoryNote>>());
export const exchanges = signal(new Map<string, WithId<Exchange>>());
export const addresses = signal(new Map<string, WithId<Address>>());
export const people = signal(new Map<string, WithId<Person>>());
export const settings = signal<Settings>(withDefaults(undefined));
export const ready = signal(false);
/** Data written by a newer version: look but don't touch, and ask to reload. */
export const readOnly = signal(false);
export const toastMsg = signal<string | null>(null);

const now = signal(Date.now());
setInterval(() => (now.value = Date.now()), 30_000);

/** Ticks every 30 seconds, so day changes and long timers are noticed. */
export const clockNow = now;

/**
 * Today, in the current place's time zone, and the current place: the stay that day belongs
 * to, else the place chosen by hand (brief §5, Places and stays).
 */
const where = computed(() => {
  void now.value;
  const s = settings.value;
  return whereNow(new Date(), s, id => places.value.get(id)?.timeZone, stays.value.values());
});
export const today = computed(() => where.value.today);
/** The place the person is in now: the planner and reminders follow it. */
export const here = computed(() => where.value.here);
export const currentStay = computed(() => where.value.stay);
export const hereZone = computed(() => places.value.get(here.value)?.timeZone);

/** The place page being looked at (brief §5): Today, Matrix, Projects and Calendar follow it. Device-local. */
const viewed = signal<string | null>(null);
export const pagePlace = computed(() => (viewed.value && (viewed.value === 'any' || places.value.has(viewed.value)) ? viewed.value : here.value));
export const viewingElsewhere = computed(() => pagePlace.value !== here.value);
export function viewPlace(id: string | null) { viewed.value = id && id !== here.value ? id : null; }

let toastTimer = 0;
export function toast(m: string) {
  toastMsg.value = m;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastMsg.value = null), 3400);
}

const live = <T>(c: Collection) => (docs: Stored<Record<string, unknown>>[]) => {
  const m = new Map<string, WithId<T>>();
  for (const d of docs) {
    if (d._del) continue;
    const f = fieldsOf(d);
    const norm = c === 'decisions' ? normDecision : c === 'memory' ? normNote : c === 'exchanges' ? normExchange : c === 'addresses' ? normAddress : c === 'people' ? normPerson : null;
    m.set(d.id, { ...((norm ? norm(f) : f) as T), id: d.id });
  }
  return m;
};

export async function start(): Promise<void> {
  const m = await runMigrations(db);
  if (m.status === 'newer') readOnly.value = true;
  let node = await getLocal<string>(db, 'node');
  if (!node) {
    node = Math.random().toString(36).slice(2, 10);
    await setLocal(db, 'node', node);
  }
  clock = createClock(node);
  const subs: [Collection, (m: Map<string, never>) => void][] = [
    ['tasks', v => (tasks.value = v)],
    ['sessions', v => (sessions.value = v)],
    ['projects', v => (projects.value = v)],
    ['days', v => (days.value = v)],
    ['decisions', v => (decisions.value = v)],
    ['places', v => (places.value = v)],
    ['stays', v => (stays.value = v)],
    ['memory', v => (memory.value = v)],
    ['exchanges', v => (exchanges.value = v)],
    ['addresses', v => (addresses.value = v)],
    ['people', v => (people.value = v)],
  ];
  const first: Promise<void>[] = [];
  for (const [c, set] of subs) {
    first.push(new Promise(res => {
      liveQuery(() => db.table_(c).toArray()).subscribe({ next: docs => { set(live(c)(docs) as never); res(); }, error: e => console.error(e) });
    }));
  }
  first.push(new Promise(res => {
    liveQuery(() => db.meta.get('settings')).subscribe({
      next: d => { const s = withDefaults(d ? (fieldsOf(d) as Partial<Settings>) : undefined); batch(() => { settings.value = s; lang.value = s.language; }); res(); },
      error: e => console.error(e),
    });
  }));
  await Promise.all(first);
  ready.value = true;
}

function guard(): boolean {
  if (readOnly.value) return false;
  return true;
}

const afterWrites: (() => void)[] = [];
/** Called after every local write (not after merged ones): sync uses it to push soon, notifications to refresh the schedule. */
export const onLocalWrite = (f: () => void) => { afterWrites.push(f); };
const afterWrite = () => { for (const f of afterWrites) f(); };
/** This device's clock, for sync. */
export const getClock = () => clock;

export const newId = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Set while `recordWrites` runs: local writes are noted here (never merged ones; `putMerged` doesn't look). */
let recording: UndoLog | null = null;
let recordQueue: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` (an applied change-set) and keep what its local writes replaced, as `UndoDoc` records for
 * `applyUndo` (src/ai/undo.ts). Only the writes made while `fn` runs are noted, so wrap just the apply,
 * never anything the person can do at the same time. Two runs never overlap. Forget in Memory must not
 * go through here: a record holds the text it replaced.
 */
export function recordWrites<T>(fn: () => Promise<T>): Promise<{ result: T; undo: UndoDoc[] }> {
  const run = async () => {
    const log = (recording = new UndoLog());
    try {
      const result = await fn();
      return { result, undo: log.docs };
    } finally {
      recording = null;
    }
  };
  const next = recordQueue.then(run, run);
  recordQueue = next.catch(() => undefined);
  return next;
}

/**
 * Put back what recorded writes replaced. A field changed since is left alone; something the change-set
 * created is tombstoned. Returns how many documents were touched and how many fields were kept.
 */
export async function applyUndo(undo: UndoDoc[], at = Date.now()): Promise<{ restored: number; kept: number }> {
  const cur = new Map<string, Stored<Record<string, unknown>>>();
  for (const d of undo) {
    const doc = await db.table_(d.c).get(d.id);
    if (doc && !doc._del) cur.set(d.c + '/' + d.id, doc as Stored<Record<string, unknown>>);
  }
  // A step it made that has sessions logged since, or a project that has steps added since, stays.
  const made = new Set(undo.filter(d => d.created).map(d => d.c + '/' + d.id));
  const used = (c: Collection, id: string) =>
    c === 'tasks' ? [...sessions.value.values()].some(s => s.taskId === id && !made.has('sessions/' + s.id))
      : c === 'projects' ? [...tasks.value.values()].some(x => x.project === id && !made.has('tasks/' + x.id))
        // An address or a person a step made since feeds stays: taking it away would leave that step pointing at nothing.
        : c === 'addresses' ? [...tasks.value.values()].some(x => x.addressId === id && !made.has('tasks/' + x.id))
          : c === 'people' ? [...tasks.value.values()].some(x => x.personId === id && !made.has('tasks/' + x.id))
            : false;
  let restored = 0, kept = 0;
  for (const u of undoWrites(undo, (c, id) => cur.get(c + '/' + id), { now: at, used })) {
    if (u.remove) { await removeDoc(u.c, u.id); restored++; }
    if (u.patch) { await update(u.c, u.id, u.patch); restored++; }
    kept += (u.kept?.length ?? 0) + (u.inUse ? 1 : 0);
  }
  return { restored, kept };
}

/** Create a document; returns its id. Every field gets the same fresh clock. */
export async function createDoc<T extends object>(c: Collection, fields: T, id = newId(c[0]!)): Promise<string> {
  if (!guard()) return id;
  const doc = create(id, fields, SCHEMA_VERSION, tick(clock));
  await db.table_(c).put(doc as never);
  recording?.created(c, id, doc as never);
  afterWrite();
  return id;
}

export async function update<T extends object>(c: Collection, id: string, changes: Partial<T>): Promise<void> {
  if (!guard()) return;
  try {
    let was: unknown, now: unknown;
    await db.transaction('rw', db.table_(c), async () => {
      const cur = await db.table_(c).get(id);
      if (!cur) throw new Error('missing ' + c + '/' + id);
      const next = patch(cur, changes as Record<string, unknown>, clock, SCHEMA_VERSION);
      await db.table_(c).put(next as never);
      was = cur; now = next;
    });
    recording?.updated(c, id, was as never, now as never, Object.keys(changes));
    afterWrite();
  } catch (e) {
    console.error(e);
    toast(t('saveFailed'));
  }
}

/** Create the document if it's missing, otherwise patch it. */
export async function upsert<T extends object>(c: Collection, id: string, fields: T): Promise<void> {
  if (!guard()) return;
  const cur = await db.table_(c).get(id);
  if (cur && !cur._del) await update(c, id, fields);
  else await createDoc(c, fields, id);
}

export async function removeDoc(c: Collection, id: string): Promise<void> {
  if (!guard()) return;
  const cur = await db.table_(c).get(id);
  if (cur) { await db.table_(c).put(remove(cur, clock) as never); recording?.removed(c, id); afterWrite(); }
}

/**
 * Documents received from another device, already merged and carrying their own clocks: put
 * as they are (sync's only way in, invariant 4). Throws in read-only mode, so a sync round
 * stops without marking what it pulled as applied.
 */
export async function putMerged(writes: Write[]): Promise<void> {
  if (readOnly.value) throw new Error('read-only');
  await writeMerged(db, writes);
}

export const saveSettings = (changes: Partial<Settings>) => upsert('meta', 'settings', changes);
