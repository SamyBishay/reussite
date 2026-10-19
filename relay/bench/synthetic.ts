// A synthetic space the size of a heavy user's list, for the connector's CPU benchmark and for
// tests that want a realistic amount of data. Deterministic (a small PRNG), nothing personal.
import { create, patch } from '../../src/data/doc';
import { createClock, tick } from '../../src/data/hlc';
import { DEFAULT_SETTINGS } from '../../src/data/settings';
import { SCHEMA_VERSION } from '../../src/data/schema';
import { addDays } from '../../src/domain/dates';
import type { StoredDoc } from '../../src/sync/protocol';

export interface Sizes { tasks: number; sessions: number; days: number; projects: number; decisions: number; places: number; stays: number }
export const HEAVY: Sizes = { tasks: 1500, sessions: 3000, days: 200, projects: 40, decisions: 20, places: 3, stays: 12 };

export type Docs = Record<string, StoredDoc[]>;

function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}
const WORDS = ['Open', 'Mail', 'reply', 'to', 'the', 'agency', 'about', 'keys', 'call', 'book', 'train', 'pay', 'invoice', 'write', 'draft', 'plan', 'review', 'chapter', 'notes', 'choir', 'rehearsal', 'tax', 'form', 'passport', 'doctor', 'flat', 'insurance'];

/**
 * `today` is the last day covered; the days go back from it. About two thirds of the steps are
 * done (with sessions), the rest open. Every field carries a clock, some of them a later one,
 * as after real use.
 */
export function syntheticSpace(sizes: Sizes = HEAVY, today = '2026-10-19', node = 'phone0001'): Docs {
  const r = rng(7);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const clock = createClock(node);
  const t0 = Date.parse(today + 'T08:00:00Z') - 400 * 86400000;
  let now = t0;
  const at = () => tick(clock, (now += 60_000 + Math.floor(r() * 600_000)));
  const docs: Docs = { tasks: [], sessions: [], projects: [], days: [], decisions: [], places: [], stays: [], meta: [] };

  docs.meta!.push(create('settings', { ...DEFAULT_SETTINGS }, SCHEMA_VERSION, at()) as unknown as StoredDoc);
  const places = Array.from({ length: sizes.places }, (_, i) => `l${i}`);
  places.forEach((id, i) => docs.places!.push(create(id, { name: ['Paris', 'Lyon', 'Rome', 'Oslo'][i % 4]!, timeZone: 'Europe/Paris', order: i }, SCHEMA_VERSION, at()) as unknown as StoredDoc));
  for (let i = 0; i < sizes.stays; i++) {
    const from = addDays(today, -300 + i * 30);
    docs.stays!.push(create('s' + i, { placeId: places[i % places.length]!, from, to: addDays(from, 12), note: '' }, SCHEMA_VERSION, at()) as unknown as StoredDoc);
  }
  const projects = ['inbox'];
  for (let i = 0; i < sizes.projects; i++) {
    const id = 'p' + i;
    projects.push(id);
    docs.projects!.push(create(id, { name: words(2), suit: pick(['S', 'D', 'C', 'H'] as const), where: 'any', goal: words(8), goalBy: null, due: null, order: i, status: 'active', created: new Date(now).toISOString(), smart: null, smartBy: null }, SCHEMA_VERSION, at()) as unknown as StoredDoc);
  }
  for (let i = 0; i < sizes.tasks; i++) {
    const id = 't' + i.toString(36);
    const done = r() < 0.65;
    const day = addDays(today, -Math.floor(r() * 380));
    const est = pick([5, 10, 15, 20, 30, 45]);
    let doc = create(id, <Record<string, unknown>>{
      title: words(4 + Math.floor(r() * 5)), project: pick(projects), suit: pick(['S', 'D', 'C', 'H'] as const), kind: 'task', urgent: r() < 0.1, important: r() < 0.7,
      due: r() < 0.3 ? addDays(today, Math.floor(r() * 60) - 20) : null, est, est0: done ? est : null, estBy: 'me', status: 'open', doneDay: null, doneAt: null,
      started: null, resume: null, carried: Math.floor(r() * 3), where: 'any', template: false, note: r() < 0.3 ? words(10) : '', order: i, created: new Date(now).toISOString(),
      src: 'page', starter: r() < 0.5 ? words(3) : null, app: r() < 0.4 ? pick(['Mail', 'Calendar', 'Notes']) : null, link: null, prompt: null,
    }, SCHEMA_VERSION, at());
    if (done) doc = patch(doc, { status: 'done', doneDay: day, doneAt: day + 'T10:00:00.000Z' }, clock, SCHEMA_VERSION);
    docs.tasks!.push(doc as unknown as StoredDoc);
  }
  const doneIds = docs.tasks!.filter(d => d.status === 'done').map(d => d.id);
  for (let i = 0; i < sizes.sessions; i++) {
    const task = doneIds.length ? pick(doneIds) : 't0';
    docs.sessions!.push(create('x' + i.toString(36), { taskId: task, d: addDays(today, -Math.floor(r() * 380)), m: 3 + Math.floor(r() * 50), why: null, at: new Date(now).toISOString(), source: pick(['timer', 'timer', 'typed', 'corrected'] as const) }, SCHEMA_VERSION, at()) as unknown as StoredDoc);
  }
  const open = docs.tasks!.filter(d => d.status === 'open').map(d => d.id);
  for (let i = 0; i < sizes.days; i++) {
    const date = addDays(today, -i + 1);
    const plan = Array.from({ length: 3 }, () => pick(open.length ? open : ['t0']));
    docs.days!.push(create(date, { date, plan: [...new Set(plan)], launches: [{ t: '09:30', k: 'start' }, { t: '14:00', k: 'restart' }], first: { id: plan[0]!, title: words(4) }, checkin: new Date(now).toISOString(), closed: i ? new Date(now).toISOString() : null, summary: i ? { cards: 3, minutes: 140, ratio: 1.4 } : null }, SCHEMA_VERSION, at()) as unknown as StoredDoc);
  }
  for (let i = 0; i < sizes.decisions; i++) {
    docs.decisions!.push(create('d' + i, {
      title: words(5), projectId: null, taskId: null, problem: { what: words(8), should: words(6), gap: words(6), constraints: '', deadline: '', control: '' },
      options: [{ id: 'o1', name: words(2), screened: null, pros: [{ id: 'i1', text: words(5), w: 3 }], cons: [{ id: 'i2', text: words(5), w: 2 }], prosNot: [], consNot: [] }, { id: 'o2', name: words(2), screened: null, pros: [], cons: [], prosNot: [], consNot: [] }],
      status: 'draft', listClosedAt: null, chosen: null, chosenId: null, why: '', mustBeTrue: '', falsifier: '', date: null, reviewOn: null, taskIds: [], newFacts: [], reviews: [], history: [],
    }, SCHEMA_VERSION, at()) as unknown as StoredDoc);
  }
  return docs;
}
