// App state: IndexedDB is the source of truth; signals mirror it for the views.
// Every write goes through here, so it gets field clocks and respects read-only mode.
import { signal, computed, batch } from '@preact/signals';
import { liveQuery } from 'dexie';
import { ReussiteDb, getLocal, setLocal } from '../data/db';
import { create, patch, remove, fieldsOf, type Stored } from '../data/doc';
import { createClock, tick, type Clock } from '../data/hlc';
import { SCHEMA_VERSION, type Collection, type Day, type Project, type Session, type Task, type Place, type Decision } from '../data/schema';
import { withDefaults, type Settings } from '../data/settings';
import { runMigrations } from '../data/migrations';
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
export const settings = signal<Settings>(withDefaults(undefined));
export const ready = signal(false);
/** Data written by a newer version: look but don't touch, and ask to reload. */
export const readOnly = signal(false);
export const toastMsg = signal<string | null>(null);

const now = signal(Date.now());
setInterval(() => (now.value = Date.now()), 30_000);

export const hereZone = computed(() => places.value.get(settings.value.here)?.timeZone);
export const today = computed(() => {
  void now.value;
  return dayKey(new Date(), settings.value.dayStart, hereZone.value);
});

let toastTimer = 0;
export function toast(m: string) {
  toastMsg.value = m;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastMsg.value = null), 3400);
}

const live = <T>(c: Collection) => (docs: Stored<Record<string, unknown>>[]) => {
  const m = new Map<string, WithId<T>>();
  for (const d of docs) if (!d._del) m.set(d.id, { ...(fieldsOf(d) as T), id: d.id });
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

export const newId = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Create a document; returns its id. Every field gets the same fresh clock. */
export async function createDoc<T extends object>(c: Collection, fields: T, id = newId(c[0]!)): Promise<string> {
  if (!guard()) return id;
  await db.table_(c).put(create(id, fields, SCHEMA_VERSION, tick(clock)) as never);
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
  if (cur) await db.table_(c).put(remove(cur, clock) as never);
}

export const saveSettings = (changes: Partial<Settings>) => upsert('meta', 'settings', changes);
