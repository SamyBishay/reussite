// The app's Writer for change-sets: every write goes through store.ts and actions.ts.
import { db, createDoc, update, tasks, today, places, projects, days, decisions, stays, memory, addresses, settings } from '../app/store';
import { createTask, newTaskDoc, finishTask, dropTask, dayPatch, saveStay } from '../app/actions';
import { addressesOn } from '../app/model';
import type { Snapshot, Writer } from './apply';
import { fieldsOf, type Stored } from '../data/doc';

export const appWriter: Writer = {
  createTask: f => { const { title, suit, project, ...extra } = f; return createTask(newTaskDoc(title, suit ?? null, project ?? null, extra)); },
  create: (c, fields) => createDoc(c, fields),
  update: (c, id, patch) => update(c, id, patch),
  finish: async (id, day) => { const tk = tasks.value.get(id); if (tk && tk.status === 'open') await finishTask(tk, null, day); },
  drop: id => dropTask(id),
  day: (k, patch) => dayPatch(k, patch).then(() => undefined),
  stay: (id, s) => saveStay(id, s),
  read: async (c, id) => { const d = await db.table_(c).get(id); return d && !d._del ? fieldsOf(d as Stored<Record<string, unknown>>) : undefined; },
};

export const snapshot = (): Snapshot => ({
  today: today.value, tasks: tasks.value, projects: projects.value, days: days.value, decisions: decisions.value, places: places.value, stays: stays.value, memory: memory.value,
  // With the module off nothing is suggested: the screens are hidden, and a new address would be unseen.
  ...(addressesOn() ? { addresses: addresses.value, categories: settings.value.addressCategories.map(c => c.id) } : {}),
});

export const gen = { id: (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), now: () => new Date().toISOString(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
