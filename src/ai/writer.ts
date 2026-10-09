// The app's Writer for change-sets: every write goes through store.ts and actions.ts.
import { createDoc, update, tasks, today, places, projects, days, decisions, stays } from '../app/store';
import { createTask, newTaskDoc, finishTask, dropTask, dayPatch, saveStay } from '../app/actions';
import type { Snapshot, Writer } from './apply';

export const appWriter: Writer = {
  createTask: f => { const { title, suit, project, ...extra } = f; return createTask(newTaskDoc(title, suit ?? null, project ?? null, extra)); },
  create: (c, fields) => createDoc(c, fields),
  update: (c, id, patch) => update(c, id, patch),
  finish: async (id, day) => { const tk = tasks.value.get(id); if (tk && tk.status === 'open') await finishTask(tk, null, day); },
  drop: id => dropTask(id),
  day: (k, patch) => dayPatch(k, patch).then(() => undefined),
  stay: (id, s) => saveStay(id, s),
};

export const snapshot = (): Snapshot => ({
  today: today.value, tasks: tasks.value, projects: projects.value, days: days.value, decisions: decisions.value, places: places.value, stays: stays.value,
});

export const gen = { id: (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), now: () => new Date().toISOString(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
