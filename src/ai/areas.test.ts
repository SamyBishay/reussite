import { describe, expect, it } from 'vitest';
import { readChangeSet, type ChangeSet } from './changeset';
import { planChanges, applyPlanned, type Snapshot, type Writer } from './apply';
import type { Place, Task } from '../data/schema';

const task = (id: string, o: Partial<Task> = {}): Task & { id: string } => ({
  id, title: 'Step ' + id, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me',
  status: 'open', doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '', ...o,
});
const place = (id: string, o: Partial<Place> = {}): Place & { id: string } => ({ id, name: id[0]!.toUpperCase() + id.slice(1), timeZone: 'Europe/Paris', order: 0, ...o });
function snap(): Snapshot {
  const m = <T extends { id: string }>(xs: T[]) => new Map(xs.map(x => [x.id, x]));
  return {
    today: '2026-10-09', tasks: m([task('t1', { label: 'Old label' }), task('t2')]),
    projects: m([{ id: 'p1', name: 'Thesis', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' }]),
    days: new Map(), decisions: new Map(), stays: new Map(), memory: new Map(),
    places: m([place('paris'), place('cairo', { timeZone: 'Africa/Cairo' }), place('heli', { timeZone: 'Africa/Cairo', parentId: 'cairo' })]),
  };
}
let n = 0;
const gen = { id: (p: string) => p + 'x' + n++, now: () => '2026-10-09T10:00:00.000Z', zone: 'Europe/Paris' };
function fakeWriter() {
  const calls: [string, ...unknown[]][] = [];
  let id = 0;
  const w: Writer = {
    createTask: async f => { calls.push(['createTask', f]); return 'new' + id++; },
    create: async (c, f) => { calls.push(['create', c, f]); return 'new' + id++; },
    update: async (c, i, p) => { calls.push(['update', c, i, p]); },
    finish: async () => undefined, drop: async () => undefined, day: async () => undefined,
    stay: async (i, s) => { calls.push(['stay', i, s]); return 'new' + id++; },
  };
  return { w, calls };
}
const cs = (changes: unknown[]): ChangeSet => { const r = readChangeSet({ v: 1, changes }); if (!r.ok) throw new Error(r.error); return r.cs; };
const run = async (changes: unknown[]) => {
  const p = planChanges(cs(changes), snap(), gen);
  const { w, calls } = fakeWriter();
  await applyPlanned(p, () => true, w);
  return { p, calls };
};

describe('a step\'s label', () => {
  it('is read on task.create and task.update, trimmed and capped at 80 characters', () => {
    const r = readChangeSet({ v: 1, changes: [{ op: 'task.create', set: { title: 'Send the claim letter', label: '  CAF claim letter ' } }, { op: 'task.update', id: 't1', set: { label: 'x'.repeat(200) } }] });
    expect(r.ok && r.cs.bad).toBe(0);
    expect(r.ok && r.cs.changes[0]).toMatchObject({ set: { label: 'CAF claim letter' } });
    expect(r.ok && (r.cs.changes[1] as { set: { label: string } }).set.label).toHaveLength(80);
  });
  it('is written on a new step, and an empty one is not stored', async () => {
    const a = await run([{ op: 'task.create', set: { title: 'Go to choir', label: 'Choir · Hill House' } }]);
    expect(a.calls[0]).toEqual(['createTask', expect.objectContaining({ title: 'Go to choir', label: 'Choir · Hill House' })]);
    const b = await run([{ op: 'task.create', set: { title: 'Go to choir', label: ' ' } }]);
    expect((b.calls[0]![1] as Record<string, unknown>)).not.toHaveProperty('label');
  });
  it('changes on an update, shows as a diff, is cleared by an empty one, and an unchanged one is no change', async () => {
    const a = await run([{ op: 'task.update', id: 't2', set: { label: 'CAF claim letter' } }]);
    expect(a.calls).toEqual([['update', 'tasks', 't2', { label: 'CAF claim letter' }]]);
    expect(a.p.items[0]!.diffs).toEqual([{ field: 'label', before: '', after: 'CAF claim letter' }]);
    const b = await run([{ op: 'task.update', id: 't1', set: { label: '' } }]);
    expect(b.calls).toEqual([['update', 'tasks', 't1', { label: '' }]]);
    expect((await run([{ op: 'task.update', id: 't1', set: { label: 'Old label' } }])).p.items).toHaveLength(0);
    expect((await run([{ op: 'task.update', id: 't2', set: { label: '' } }])).p.items).toHaveLength(0);
  });
});

describe('areas', () => {
  it('place.create with a parent makes an area: the parent\'s zone, the parent\'s id', async () => {
    const { calls, p } = await run([{ op: 'place.create', set: { name: 'Maadi', parent: 'cairo', timeZone: 'Asia/Tokyo' } }]);
    expect(calls[0]).toEqual(['create', 'places', expect.objectContaining({ name: 'Maadi', parentId: 'cairo', timeZone: 'Africa/Cairo', by: 'ai' })]);
    expect(p.items[0]!.diffs).toEqual([{ field: 'area of', before: undefined, after: 'Cairo' }]);
  });
  it('the parent can be named, or made in the same change-set; a place without a parent has none', async () => {
    const a = await run([{ op: 'place.create', set: { name: 'Maadi', parent: 'Cairo' } }]);
    expect(a.calls[0]![2]).toMatchObject({ parentId: 'cairo' });
    const b = await run([{ op: 'place.create', ref: 'ly', set: { name: 'Lyon', timeZone: 'Europe/Paris' } }, { op: 'place.create', set: { name: 'Croix-Rousse', parent: 'ly' } }]);
    expect(b.calls[1]).toEqual(['create', 'places', expect.objectContaining({ name: 'Croix-Rousse', parentId: 'new0' })]);
    expect(b.calls[0]![2] as Record<string, unknown>).not.toHaveProperty('parentId');
  });
  it('one level only: the parent cannot be an area, or an area made earlier in the same change-set, or unknown', async () => {
    expect((await run([{ op: 'place.create', set: { name: 'Deep', parent: 'heli' } }])).p.items).toHaveLength(0);
    expect((await run([{ op: 'place.create', ref: 'a', set: { name: 'Sub', parent: 'cairo' } }, { op: 'place.create', set: { name: 'Deeper', parent: 'a' } }])).p.items).toHaveLength(1);
    expect((await run([{ op: 'place.create', set: { name: 'Nowhere', parent: 'atlantis' } }])).p.items).toHaveLength(0);
  });
  it('the same name in another place is allowed for an area, and not twice under one parent', async () => {
    expect((await run([{ op: 'place.create', set: { name: 'Heli', parent: 'paris' } }])).p.items).toHaveLength(1);
    expect((await run([{ op: 'place.create', set: { name: 'heli', parent: 'cairo' } }])).p.items).toHaveLength(0);
  });
  it('place.update moves a place under another, back to top level, and refuses what would nest two levels', async () => {
    const a = await run([{ op: 'place.update', id: 'paris', set: { parent: 'cairo' } }]);
    expect(a.calls).toEqual([['update', 'places', 'paris', { parentId: 'cairo' }]]);
    const b = await run([{ op: 'place.update', id: 'heli', set: { parent: null } }]);
    expect(b.calls).toEqual([['update', 'places', 'heli', { parentId: null }]]);
    expect((await run([{ op: 'place.update', id: 'cairo', set: { parent: 'paris' } }])).p.items).toHaveLength(0); // cairo holds areas
    expect((await run([{ op: 'place.update', id: 'paris', set: { parent: 'heli' } }])).p.items).toHaveLength(0); // heli is an area
    expect((await run([{ op: 'place.update', id: 'paris', set: { parent: 'paris' } }])).p.items).toHaveLength(0);
    expect((await run([{ op: 'place.update', id: 'heli', set: { parent: 'cairo' } }])).p.items).toHaveLength(0); // no change
  });
  it('an area\'s time zone is not set by hand', async () => {
    expect((await run([{ op: 'place.update', id: 'heli', set: { timeZone: 'Asia/Tokyo' } }])).p.items).toHaveLength(0);
    const b = await run([{ op: 'place.update', id: 'paris', set: { timeZone: 'Asia/Tokyo', name: 'Paris 2' } }]);
    expect(b.calls).toEqual([['update', 'places', 'paris', { name: 'Paris 2', timeZone: 'Asia/Tokyo' }]]);
  });
  it('a step set to an area resolves like any place', async () => {
    const { calls } = await run([{ op: 'task.create', set: { title: 'Go to Heliopolis market', where: 'heli' } }]);
    expect(calls[0]![1]).toMatchObject({ where: 'heli' });
  });
});
