import { describe, expect, it } from 'vitest';
import { readChangeSet, type ChangeSet } from './changeset';
import { applyPlanned, createsNote, isLowRisk, planChanges, type Snapshot, type Writer } from './apply';
import type { MemoryNote, Task } from '../data/schema';

const line = (id: string, text: string, by: 'me' | 'ai' = 'me') => ({ id, text, at: '2026-10-01T00:00:00.000Z', by });
const note = (id: string, o: Partial<MemoryNote> = {}): MemoryNote & { id: string } => ({
  id, kind: 'person', name: 'Ibrahim', aliases: ['Ibra'], lines: [line('l1', 'Likes tea'), line('l2', 'Works nights'), line('l3', 'Has a cat')], private: false, updated: '2026-10-01T00:00:00.000Z', ...o,
});
const snap = (notes: (MemoryNote & { id: string })[] = [note('n1'), note('n2', { name: 'Hill House', kind: 'place', aliases: [], lines: [] }), note('n3', { name: 'Secret', private: true, aliases: [] })]): Snapshot => ({
  today: '2026-10-09', tasks: new Map(), projects: new Map(), days: new Map(), decisions: new Map(), places: new Map(), stays: new Map(),
  memory: new Map(notes.map(n => [n.id, n])),
});
let n = 0;
const gen = { id: (p: string) => p + 'x' + n++, now: () => '2026-10-09T10:00:00.000Z', zone: 'Europe/Paris' };
const cs = (changes: unknown[]): ChangeSet => { const r = readChangeSet({ v: 1, changes }); if (!r.ok) throw new Error(r.error); return r.cs; };
const plan = (changes: unknown[], s = snap()) => planChanges(cs(changes), s, gen);

/** A writer over a tiny in-memory store of notes, so applying can be read back. */
function memWriter(s: Snapshot) {
  const docs = new Map<string, Record<string, unknown>>([...s.memory].map(([id, x]) => [id, { ...x }]));
  const w: Writer = {
    createTask: async () => 'x', drop: async () => undefined, finish: async () => undefined, day: async () => undefined, stay: async () => 'x',
    create: async (c, f) => { const id = 'new' + docs.size; if (c === 'memory') docs.set(id, { ...f }); return id; },
    update: async (c, id, p) => { if (c === 'memory') docs.set(id, { ...docs.get(id), ...p }); },
  };
  return { w, docs };
}

describe('memory operations in the contract', () => {
  it('reads add, edit, remove and note, with a line by number or by text', () => {
    const r = cs([
      { op: 'memory.add', note: 'Ibrahim', text: 'Plays oud' },
      { op: 'memory.add', note: 'Alex', kind: 'person', text: 'Moved to Lyon' },
      { op: 'memory.edit', note: 'n1', line: 2, text: 'Works days now' },
      { op: 'memory.remove', note: 'n1', line: 'Has a cat' },
      { op: 'memory.note', note: 'Ibrahim', set: { aliases: ['Ibra', 'Bim'], kind: 'person' } },
    ]);
    expect(r.changes).toHaveLength(5);
    expect(readChangeSet({ v: 1, changes: [{ op: 'memory.add', note: 'X', kind: 'planet', text: 'a' }] }).ok).toBe(false);
    expect(readChangeSet({ v: 1, changes: [{ op: 'memory.edit', note: 'X', line: 0, text: 'a' }] }).ok).toBe(false);
  });

  it('keeps a change-set note up to 1,000 characters', () => {
    const r = readChangeSet({ v: 1, note: 'x'.repeat(1200), changes: [{ op: 'task.drop', id: 't1' }] });
    expect(r.ok && r.cs.note.length).toBe(1000);
  });

  it('adds a line to a note found by name or alias, marked as the AI’s', () => {
    for (const who of ['Ibrahim', 'ibra', 'n1']) {
      const p = plan([{ op: 'memory.add', note: who, text: 'Plays oud' }]);
      expect(p.items).toHaveLength(1);
      const it = p.items[0]!;
      expect(it).toMatchObject({ target: 'memory', kind: 'remember', title: 'Ibrahim', diffs: [{ field: 'line', before: undefined, after: 'Plays oud' }] });
      const op = it.ops[0]!;
      expect(op).toMatchObject({ t: 'update', c: 'memory', id: 'n1' });
      const lines = (op as unknown as { patch: { lines: { text: string; by: string; id: string }[] } }).patch.lines;
      expect(lines.map(l => l.text)).toEqual(['Likes tea', 'Works nights', 'Has a cat', 'Plays oud']);
      expect(lines[3]).toMatchObject({ by: 'ai' });
      expect(lines[3]!.id).toBeTruthy();
    }
  });

  it('makes a note when the name is unknown and a kind is given, and not without one', () => {
    const p = plan([{ op: 'memory.add', note: 'Alex', kind: 'person', text: 'Moved to Lyon' }]);
    expect(p.items).toHaveLength(1);
    expect(createsNote(p.items[0]!)).toBe(true);
    expect(p.items[0]!.ops[0]).toMatchObject({ t: 'create', c: 'memory', fields: { kind: 'person', name: 'Alex', aliases: [], private: false, lines: [{ text: 'Moved to Lyon', by: 'ai' }] } });
    expect(plan([{ op: 'memory.add', note: 'Alex', text: 'Moved to Lyon' }]).items).toHaveLength(0);
    // a name that exists is added to, even when a kind is given
    expect(createsNote(plan([{ op: 'memory.add', note: 'Ibrahim', kind: 'person', text: 'Plays oud' }]).items[0]!)).toBe(false);
  });

  it('puts two lines for one new note into that note; with the first unticked, the second makes the note', async () => {
    const s = snap();
    const p = plan([
      { op: 'memory.add', note: 'Alex', kind: 'person', text: 'Moved to Lyon' },
      { op: 'memory.add', note: 'alex', text: 'Has a bike' },
    ], s);
    expect(p.items).toHaveLength(2);
    const both = memWriter(s);
    expect(await applyPlanned(p, () => true, both.w)).toBe(2);
    const made = [...both.docs.values()].find(d => d.name === 'Alex')!;
    expect((made.lines as { text: string }[]).map(l => l.text)).toEqual(['Moved to Lyon', 'Has a bike']);
    const second = memWriter(s);
    expect(await applyPlanned(p, i => i === 1, second.w)).toBe(1);
    const alone = [...second.docs.values()].find(d => d.name === 'Alex')!;
    expect(alone).toMatchObject({ kind: 'person', private: false });
    expect((alone.lines as { text: string }[]).map(l => l.text)).toEqual(['Has a bike']);
    // a third line joins the note the second made
    const three = plan([
      { op: 'memory.add', note: 'Alex', kind: 'person', text: 'Moved to Lyon' },
      { op: 'memory.add', note: 'alex', text: 'Has a bike' },
      { op: 'memory.add', note: 'alex', text: 'Plays chess' },
    ], s);
    const third = memWriter(s);
    expect(await applyPlanned(three, i => i > 0, third.w)).toBe(2);
    expect([...third.docs.values()].filter(d => d.name === 'Alex')).toHaveLength(1);
    expect(([...third.docs.values()].find(d => d.name === 'Alex')!.lines as { text: string }[]).map(l => l.text)).toEqual(['Has a bike', 'Plays chess']);
  });

  it('edits and removes a line by number, id or exact text; the rest stay', async () => {
    const s = snap();
    const p = plan([
      { op: 'memory.edit', note: 'Ibrahim', line: 2, text: 'Works days now' },
      { op: 'memory.remove', note: 'Ibrahim', line: 'Has a cat' },
      { op: 'memory.remove', note: 'Ibrahim', line: '1. Likes tea' },
      { op: 'memory.remove', note: 'Ibrahim', line: 9 },
    ], s);
    expect(p.items).toHaveLength(3);
    expect(p.skippedAt).toEqual([3]);
    expect(p.items[0]!.diffs[0]).toEqual({ field: 'line', before: 'Works nights', after: 'Works days now' });
    expect(p.items[1]!.diffs[0]).toEqual({ field: 'line', before: 'Has a cat', after: undefined });
    const { w, docs } = memWriter(s);
    await applyPlanned(p, () => true, w);
    const lines = docs.get('n1')!.lines as { id: string; text: string; by: string }[];
    expect(lines.map(l => l.text)).toEqual(['Works days now']);
    expect(lines[0]).toMatchObject({ id: 'l2', by: 'ai' });
    // unticked: the others still land on their own
    const w2 = memWriter(s);
    await applyPlanned(p, i => i === 1, w2.w);
    expect((w2.docs.get('n1')!.lines as { text: string }[]).map(l => l.text)).toEqual(['Likes tea', 'Works nights']);
  });

  it('skips what changes nothing: a line already there, the same text, an unknown note', () => {
    expect(plan([{ op: 'memory.add', note: 'Ibrahim', text: 'likes TEA' }]).items).toHaveLength(0);
    expect(plan([{ op: 'memory.edit', note: 'Ibrahim', line: 1, text: 'Likes tea' }]).items).toHaveLength(0);
    expect(plan([{ op: 'memory.edit', note: 'Nobody', line: 1, text: 'a' }]).items).toHaveLength(0);
    expect(plan([{ op: 'memory.remove', note: 'n2', line: 1 }]).items).toHaveLength(0);
  });

  it('never touches a private note, nor one that two notes both match', () => {
    expect(plan([{ op: 'memory.add', note: 'Secret', text: 'a' }]).items).toHaveLength(0);
    expect(plan([{ op: 'memory.add', note: 'Secret', kind: 'person', text: 'a' }]).items).toHaveLength(0);
    expect(plan([{ op: 'memory.remove', note: 'n3', line: 1 }]).items).toHaveLength(0);
    const twice = snap([note('a', { name: 'Sam', aliases: [] }), note('b', { name: 'Other', aliases: ['sam'] })]);
    expect(plan([{ op: 'memory.add', note: 'Sam', text: 'x' }], twice).items).toHaveLength(0);
  });

  it('renames, re-aliases and re-kinds a note, but not onto another note’s name', () => {
    const p = plan([{ op: 'memory.note', note: 'Ibrahim', set: { name: 'Ibrahim K', aliases: ['Ibra', 'Bim', 'bim', 'Ibrahim K'], kind: 'topic' } }]);
    expect(p.items[0]!.diffs.map(d => [d.field, d.after])).toEqual([['name', 'Ibrahim K'], ['aliases', ['Ibra', 'Bim']], ['kind', 'topic']]);
    expect(plan([{ op: 'memory.note', note: 'Ibrahim', set: { name: 'hill house' } }]).items).toHaveLength(0);
    expect(plan([{ op: 'memory.note', note: 'Ibrahim', set: { kind: 'person' } }]).items).toHaveLength(0);
  });

  it('is never low-risk, on its own or beside a low-risk change', () => {
    const low = (changes: unknown[]) => { const c = cs(changes); return isLowRisk(c, planChanges(c, snap(), gen)); };
    expect(low([{ op: 'memory.add', note: 'Ibrahim', text: 'Plays oud' }])).toBe(false);
    expect(low([{ op: 'memory.add', note: 'Alex', kind: 'person', text: 'a' }])).toBe(false);
    expect(low([{ op: 'memory.remove', note: 'Ibrahim', line: 1 }])).toBe(false);
  });
});

describe('a standing obligation in the contract', () => {
  const choir = { title: 'Choir, Hill House 602', template: true, weekdays: [1], at: '19:00', dur: 90, lead: 30 };
  it('is one low-risk create', () => {
    const c = cs([{ op: 'task.create', set: choir }]);
    const p = planChanges(c, snap(), gen);
    expect(isLowRisk(c, p)).toBe(true);
    expect(p.items[0]!.ops[0]).toMatchObject({ t: 'task', fields: { template: true, weekdays: [1], at: '19:00', lead: 30, by: 'ai' } });
    expect(p.items[0]!.diffs.map(d => d.field)).toEqual(expect.arrayContaining(['template', 'weekdays', 'lead']));
  });
  it('sorts the days and keeps them once; without a time or days it is an ordinary step', () => {
    const f = (set: object) => (planChanges(cs([{ op: 'task.create', set }]), snap(), gen).items[0]!.ops[0] as { fields: Partial<Task> }).fields;
    expect(f({ ...choir, weekdays: [5, 1, 5] }).weekdays).toEqual([1, 5]);
    expect(f({ title: 'Choir', template: true, weekdays: [1] }).template).toBeUndefined();
    expect(f({ title: 'Choir', template: true, at: '19:00' }).template).toBeUndefined();
    expect(f({ ...choir, lead: '15' }).lead).toBe(15);
    expect(f({ ...choir, lead: 0 }).lead).toBe(0);
  });
  it('rejects days outside 1 to 7', () => {
    expect(readChangeSet({ v: 1, changes: [{ op: 'task.create', set: { ...choir, weekdays: [0] } }] }).ok).toBe(false);
    expect(readChangeSet({ v: 1, changes: [{ op: 'task.create', set: { ...choir, weekdays: [8] } }] }).ok).toBe(false);
  });
  it('is not applied to an existing step by an update', () => {
    const s = snap();
    s.tasks.set('t1', { id: 't1', title: 'A', project: 'inbox', template: false, status: 'open', at: null } as never);
    const p = planChanges(cs([{ op: 'task.update', id: 't1', set: { template: true, weekdays: [1], at: '19:00' } }]), s, gen);
    expect(p.items[0]!.diffs.map(d => d.field)).not.toContain('template');
  });
  it('still drops weights from decisions', () => {
    const p = plan([{ op: 'decision.create', set: { title: 'Move?', options: [{ name: 'Yes', pros: [{ text: 'cheap', w: 5 }] }] } }]);
    expect(JSON.stringify(p.items[0]!.ops)).not.toContain('"w":5');
  });
});
