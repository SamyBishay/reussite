import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { tasks, projects, places, stays, days, memory, settings, addresses, people } from '../app/store';
import { withDefaults } from '../data/settings';
import { tripPack } from './trip';
import { commandPrompt, contextPack, homePrompt } from './context';
import { breakDownPrompt, stuckPrompt, reviewPrompt } from './prompts';
import { planChanges, applyPlanned, type Snapshot, type Writer } from './apply';
import { readChangeSet, parseChangeSet, type ChangeSet } from './changeset';
import { tripData, tripDays, MAX_TRIP_DAYS, type TripInput } from '../domain/trip';
import type { Address, MemoryNote, Person, Task } from '../data/schema';

const task = (id: string, o: Partial<Task> = {}): Task & { id: string } => ({
  id, title: 'Step ' + id, project: 'p1', suit: 'H', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me',
  status: 'open', doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '', ...o,
});
const address = (id: string, name: string, o: Partial<Address> = {}): Address & { id: string } => ({
  id, name, category: 'food', placeId: 'lyon', mapsUrl: 'https://maps.example/' + id, street: null, state: 'want', visits: [], by: 'me', note: '', ...o,
});
const person = (id: string, name: string, o: Partial<Person> = {}): Person & { id: string } => ({ id, name, placeId: 'lyon', reach: 'whatsapp://send?phone=33699999999', note: '', lastSeen: null, ...o });
const note = (name: string, text: string): MemoryNote & { id: string } => ({
  id: 'n-' + name, kind: 'place', name, aliases: [], lines: [{ id: 'l1', text, at: '2026-10-01T00:00:00.000Z', by: 'me' }], private: false, updated: '2026-10-01T00:00:00.000Z',
});

beforeEach(() => {
  settings.value = withDefaults(undefined);
  projects.value = new Map([['p1', { id: 'p1', name: 'Life', suit: 'H', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' }]]);
  places.value = new Map([['lyon', { id: 'lyon', name: 'Lyon', timeZone: 'Europe/Paris', order: 0 }], ['paris', { id: 'paris', name: 'Paris', timeZone: 'Europe/Paris', order: 1 }]]);
  stays.value = new Map([['s1', { id: 's1', placeId: 'lyon', from: '2026-11-12', to: '2026-11-14', note: 'With a friend, long weekend' }]]);
  days.value = new Map();
  tasks.value = new Map([
    ['t1', task('t1', { title: 'Book a table for Friday', where: 'lyon' })],
    ['t2', task('t2', { title: 'Buy a gift', due: '2026-11-13' })],
    ['t3', task('t3', { title: 'Pay the rent', where: 'paris' })],
    ['t4', task('t4', { title: 'Train to Lyon', at: '08:10', dur: 120, due: '2026-11-12', where: 'lyon' })],
  ]);
  addresses.value = new Map([
    ['a1', address('a1', 'Chez Louise', { street: '5 rue des Lilas', state: 'been', note: 'Cash only', visits: [{ id: 'v1', day: '2026-03-02', note: 'Lovely quenelles', verdict: 'again' }] })],
    ['a2', address('a2', 'Musée Gadagne', { category: 'museum' })],
    ['a3', address('a3', 'Paris bakery', { placeId: 'paris' })],
  ]);
  people.value = new Map([['pe1', person('pe1', 'Théophile Marchand', { note: 'Allergic to hazelnuts', lastSeen: '2026-09-01' })]]);
  memory.value = new Map([['n1', note('Lyon', 'Likes the old town at night')]]);
});

describe('the trip pack', () => {
  const pack = (people_?: boolean, q = 'Three slow days please') => tripPack('s1', q, { people: people_, l: 'en' })!;

  it('holds the stay, its place\'s addresses with their notes and last verdict, the open steps and the fixed times', () => {
    const p = pack();
    expect(p.days).toBe(3);
    const t = p.text;
    expect(t).toContain('The trip: Lyon (place id lyon), from Thursday 2026-11-12 to Saturday 2026-11-14');
    expect(t).toContain('My note: With a friend, long weekend');
    expect(t).toContain('Thu 2026-11-12, Fri 2026-11-13, Sat 2026-11-14');
    expect(t).toContain('Chez Louise | Food | been | 5 rue des Lilas | 2026-03-02 again, "Lovely quenelles" | Cash only');
    expect(t).toContain('Musée Gadagne');
    expect(t).not.toContain('Paris bakery'); // another place's
    expect(t).toContain('Book a table for Friday'); // the stay's place
    expect(t).toContain('Buy a gift'); // due on a day of the stay
    expect(t).not.toContain('Pay the rent'); // another place
    expect(t).toMatch(/2026-11-12 \| 08:10 \| 120 \| Train to Lyon/);
    expect(t).toContain('check opening hours');
    expect(t).toContain('address.create');
    expect(t).toContain('never an hourly grid');
    expect(t).toContain('## My question\n\nThree slow days please');
    expect(t).toContain('Likes the old town at night'); // the memory note the stay's place picks
    expect(p.notes).toEqual(['Lyon']);
  });

  it('adds the people there only when ticked, and never how to reach them', () => {
    const off = pack().text;
    for (const s of ['Théophile', 'hazelnuts', '33699999999', 'People I know here']) expect(off, s).not.toContain(s);
    const on = pack(true).text;
    expect(on).toContain('People I know here, shared for this trip only');
    expect(on).toContain('Théophile Marchand | 2026-09-01 | Allergic to hazelnuts');
    for (const s of ['33699999999', 'whatsapp://', 'pe1']) expect(on, s).not.toContain(s);
  });

  it('puts the answer\'s link into the instructions when there is a drop address', () => {
    const t = tripPack('s1', '', { drop: 'https://app.example/drop#SPACE.KEY.' })!.text;
    expect(t).toContain('https://app.example/drop#SPACE.KEY.z.DATA');
    expect(t).toContain('Plan this trip for me.');
  });

  it('is null for a stay that is gone', () => {
    expect(tripPack('nope', '')).toBeNull();
  });

  it('keeps people and addresses out of every other request, trip packs aside', () => {
    const q = 'Who should I see in Lyon, Chez Louise?';
    const texts = [
      contextPack({ kind: 'today' }, q), contextPack({ kind: 'matrix' }, q), JSON.stringify(commandPrompt(q)), JSON.stringify(homePrompt(q)),
      JSON.stringify(stuckPrompt('t1', 'start')), JSON.stringify(breakDownPrompt('t1')), JSON.stringify(reviewPrompt('p1')),
    ].map(t => t.replace(q, ''));
    for (const t of texts) for (const s of ['Théophile', 'hazelnuts', '33699999999', '5 rue des Lilas', 'Lovely quenelles', 'Cash only']) expect(t, s).not.toContain(s);
  });
});

describe('tripData (pure)', () => {
  const base: TripInput = { place: { id: 'x', name: 'Xville' }, from: '2026-11-01', to: '2026-11-02', note: '', categories: [{ id: 'food', name: 'Food' }], addresses: [], steps: [], fixed: [], planned: [] };
  it('says so when there is nothing saved, and lists no people unless given', () => {
    const t = tripData(base);
    expect(t).toContain('I have no addresses saved for this place yet.');
    expect(t).toContain('I have no open steps for this trip.');
    expect(t).not.toContain('People');
    expect(tripData({ ...base, people: [] })).toContain('there are none saved');
  });
  it('lists at most 21 days and says so', () => {
    expect(tripDays('2026-11-01', '2027-02-01')).toHaveLength(MAX_TRIP_DAYS);
    expect(tripData({ ...base, to: '2027-02-01' })).toContain('(the first 21 of the stay)');
  });
});

// ---------- the reply ----------
const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
  today: '2026-11-01', tasks: new Map([['t1', task('t1')]]), projects: projects.value, days: new Map(), decisions: new Map(),
  places: places.value, stays: new Map(), memory: new Map(),
  addresses: new Map([['a1', address('a1', 'Chez Louise')]]), categories: ['food', 'museum', 'other'], ...o,
});
const gen = { id: (p: string) => p + 'x', now: () => '2026-11-01T10:00:00.000Z', zone: 'Europe/Paris' };
const cs = (changes: unknown[]): ChangeSet => { const r = readChangeSet({ v: 1, changes }); if (!r.ok) throw new Error(r.error); return r.cs; };
function writer() {
  const calls: [string, ...unknown[]][] = [];
  const w: Writer = {
    createTask: async f => { calls.push(['createTask', f]); return 'new' + calls.length; },
    create: async (c, f) => { calls.push(['create', c, f]); return 'new' + calls.length; },
    update: async () => undefined, finish: async () => undefined, drop: async () => undefined, day: async () => undefined, stay: async () => 'x',
  };
  return { w, calls };
}

describe('address.create', () => {
  it('reads as part of the contract (the version does not move) and is one bad line for a reader that does not know it', () => {
    const r = parseChangeSet('```reussite\n{"v":1,"changes":[{"op":"address.create","set":{"name":"Café Mokka","category":"food","place":"lyon","note":"Open Tuesday to Saturday"}}]}\n```');
    expect(r.ok).toBe(true);
    expect(readChangeSet({ v: 1, changes: [{ op: 'address.create', set: {} }] })).toEqual({ ok: false, error: 'invalid' }); // no name: counted bad, nothing to apply
  });

  it('saves a suggestion as want to go, by the AI, in the stay\'s place, with its reason in the note', async () => {
    const p = planChanges(cs([{ op: 'address.create', set: { name: 'Café Mokka', category: 'museum', place: 'Lyon', mapsUrl: 'https://maps.apple.com/?q=Mokka', street: '1 rue X', note: 'Open Tue to Sat, checked' } }]), snap(), gen);
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ target: 'address', kind: 'create', title: 'Café Mokka' });
    expect(p.items[0]!.diffs.map(d => d.field)).toEqual(['place', 'category', 'mapsUrl', 'street', 'state', 'note']);
    const { w, calls } = writer();
    expect(await applyPlanned(p, () => true, w)).toBe(1);
    expect(calls).toEqual([['create', 'addresses', { name: 'Café Mokka', category: 'museum', placeId: 'lyon', mapsUrl: 'https://maps.apple.com/?q=Mokka', street: '1 rue X', state: 'want', visits: [], by: 'ai', note: 'Open Tue to Sat, checked' }]]);
  });

  it('writes nothing when it is unticked', async () => {
    const p = planChanges(cs([{ op: 'address.create', set: { name: 'Café Mokka' } }]), snap(), gen);
    const { w, calls } = writer();
    expect(await applyPlanned(p, () => false, w)).toBe(0);
    expect(calls).toEqual([]);
  });

  it('puts an unknown place in Anywhere, an unknown category in other, and drops an unsafe link', () => {
    const p = planChanges(cs([{ op: 'address.create', set: { name: 'Café Mokka', category: 'spaceport', place: 'Atlantis', mapsUrl: 'javascript:alert(1)' } }]), snap(), gen);
    const op = p.items[0]!.ops[0]!;
    expect(op).toMatchObject({ t: 'create', c: 'addresses', fields: { placeId: 'any', category: 'other', mapsUrl: null } });
  });

  it('leaves out one the person has (same name in the place or Anywhere, or same link), and one named twice', () => {
    const s = snap({ addresses: new Map([['a1', address('a1', 'Chez Louise', { mapsUrl: 'https://maps.example/louise' })]]) });
    const p = planChanges(cs([
      { op: 'address.create', set: { name: 'chez  louise', place: 'lyon' } },
      { op: 'address.create', set: { name: 'Louise again', mapsUrl: 'https://maps.example/louise' } },
      { op: 'address.create', set: { name: 'Café Mokka', place: 'lyon' } },
      { op: 'address.create', set: { name: 'Café MOKKA', place: 'lyon' } },
    ]), s, gen);
    expect(p.items.map(i => i.title)).toEqual(['Café Mokka']);
    expect(p.skipped).toBe(3);
  });

  it('comes to nothing where addresses are not read (the connector) or the module is off', () => {
    const { addresses: _a, categories: _c, ...bare } = snap();
    void _a; void _c;
    const p = planChanges(cs([{ op: 'address.create', set: { name: 'Café Mokka' } }]), bare, gen);
    expect(p.items).toEqual([]);
    expect(p.skipped).toBe(1);
  });

  it('plans a three-day trip: day lists with new steps, a train at a set time, and suggestions, all in one review', async () => {
    const p = planChanges(cs([
      { op: 'task.create', ref: 'a', set: { title: 'Open Maps and walk to the old town', where: 'lyon', est: 30 } },
      { op: 'task.create', ref: 'train', set: { title: 'Train to Paris', at: '17:40', dur: 120, due: '2026-11-14', where: 'lyon' } },
      { op: 'day.update', date: '2026-11-12', add: ['a', 't1'] },
      { op: 'address.create', set: { name: 'Café Mokka', place: 'lyon' } },
    ]), snap(), gen);
    expect(p.items.map(i => i.target)).toEqual(['task', 'task', 'day', 'address']);
    expect(p.items[2]!.diffs[0]!.after).toEqual(['\u0000ref:a', 't1']);
  });
});
