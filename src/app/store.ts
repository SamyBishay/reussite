// App state: IndexedDB is the source of truth; signals mirror it for the views.
// Every write goes through here, so it gets field clocks and respects read-only mode.
import { signal, computed, batch } from '@preact/signals';
import { liveQuery } from 'dexie';
import { ReussiteDb, getLocal, setLocal } from '../data/db';
import { create, patch, remove, fieldsOf, type Stored } from '../data/doc';
import { createClock, tick, type Clock } from '../data/hlc';
import { SCHEMA_VERSION, type Collection, type Day, type Project, type Session, type Task, type Place, type Decision, type Stay } from '../data/schema';
import { normDecision } from '../data/normalize';
import { stayOn } from '../domain/places';
import { withDefaults, type Settings } from '../data/settings';
import { runMigrations } from '../data/migrations';
import { writeMerged, type Write } from '../data/syncstore';
import { dayKey } from '../domain/dates';
import { lang, t } from '../i18n';

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
  const s = settings.value, at = new Date();
  const zone = (id: string) => places.value.get(id)?.timeZone;
  let k = dayKey(at, s.dayStart, zone(s.here));
  let stay = stayOn(stays.value.values(), k);
  if (stay) {
    k = dayKey(at, s.dayStart, zone(stay.placeId));
    stay = stayOn(stays.value.values(), k) ?? stay;
  }
  return { today: k, here: stay?.placeId ?? s.here, stay: stay ?? null };
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
    m.set(d.id, { ...((c === 'decisions' ? normDecision(f) : f) as T), id: d.id });
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

let afterWrite: (() => void) | undefined;
/** Called after every local write (not after merged ones): sync uses it to push soon. */
export const onLocalWrite = (f: () => void) => { afterWrite = f; };
/** This device's clock, for sync. */
export const getClock = () => clock;

export const newId = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Create a document; returns its id. Every field gets the same fresh clock. */
export async function createDoc<T extends object>(c: Collection, fields: T, id = newId(c[0]!)): Promise<string> {
  if (!guard()) return id;
  await db.table_(c).put(create(id, fields, SCHEMA_VERSION, tick(clock)) as never);
  afterWrite?.();
  return id;
}

export async function update<T extends object>(c: Collection, id: string, changes: Partial<T>): Promise<void> {
  if (!guard()) return;
  try {
    await db.transaction('rw', db.table_(c), async () => {
      const cur = await db.table_(c).get(id);
      if (!cur) throw new Error('missing ' + c + '/' + id);
      await db.table_(c).put(patch(cur, changes as Record<string, unknown>, clock, SCHEMA_VERSION) as never);
    });
    afterWrite?.();
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
  if (cur) { await db.table_(c).put(remove(cur, clock) as never); afterWrite?.(); }
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
