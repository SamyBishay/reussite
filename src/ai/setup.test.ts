import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { settings, places, memory } from '../app/store';
import { withDefaults, DEFAULT_SETTINGS } from '../data/settings';
import { DEFAULT_PREFERENCES } from '../domain/preferences';
import { readChangeSet, parseChangeSet, type ChangeSet } from './changeset';
import { planChanges, applyPlanned, shortName, type Snapshot, type Writer } from './apply';
import { setupPrompt, setupPack, readSetup, onlySetup, SETUP_OPS, MAX_EXCHANGES } from './setup';
import type { Settings } from '../data/settings';

const gen = { id: (p: string) => p + '1', now: () => '2026-11-02T08:00:00.000Z', zone: 'Europe/Paris' };
const cs = (changes: unknown[]): ChangeSet => { const r = readChangeSet({ v: 1, changes }); if (!r.ok) throw new Error(r.error); return r.cs; };
const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
  today: '2026-11-02', tasks: new Map(), projects: new Map(), days: new Map(), decisions: new Map(), places: new Map(), stays: new Map(), memory: new Map(),
  settings: { suits: DEFAULT_SETTINGS.suits, language: 'en', aiPreferences: DEFAULT_PREFERENCES }, ...o,
});
const PILLARS = [{ name: 'The thesis' }, { name: 'Money & the flat\'s paperwork' }, { name: 'My kids', short: 'Kids' }, { name: 'Rest' }];

beforeEach(() => {
  settings.value = withDefaults(undefined);
  places.value = new Map();
  memory.value = new Map();
});

describe('settings.update', () => {
  it('is part of the contract: up to four pillars, and the three preference lines', () => {
    const r = parseChangeSet('```reussite\n{"v":1,"changes":[{"op":"settings.update","set":{"pillars":[{"name":"Work"},{"name":"Home","short":"H"}],"preferences":{"detail":"very short","know":"I start better with a time"}}}]}\n```');
    expect(r.ok).toBe(true);
    expect(readChangeSet({ v: 1, changes: [{ op: 'settings.update', set: { pillars: [] } }] })).toEqual({ ok: false, error: 'invalid' });
    expect(readChangeSet({ v: 1, changes: [{ op: 'settings.update', set: { pillars: Array.from({ length: 5 }, (_, i) => ({ name: 'P' + i })) } }] })).toEqual({ ok: false, error: 'invalid' });
    expect(readChangeSet({ v: 1, changes: [{ op: 'settings.update', set: { preferences: { detail: 'verbose' } } }] })).toEqual({ ok: false, error: 'invalid' });
  });

  it('names the pillars in order, in the app\'s language, with a short name each, and shows each as before → after', () => {
    const p = planChanges(cs([{ op: 'settings.update', set: { pillars: PILLARS } }]), snap(), gen);
    expect(p.items).toHaveLength(1);
    const it = p.items[0]!;
    expect(it).toMatchObject({ target: 'settings', kind: 'update' });
    expect(it.diffs.map(d => [d.field, d.before, d.after])).toEqual([
      ['pillar 1', 'Work & studies', 'The thesis'], ['pillar 2', 'Money & papers', 'Money & the flat\'s paperwork'],
      ['pillar 3', 'Family & home', 'My kids'], ['pillar 4', 'Life: people, leisure, health', 'Rest'],
    ]);
    const patch = (it.ops[0] as { t: 'settings'; patch: Partial<Settings> }).patch;
    expect(patch.suits!.S.name.en).toBe('The thesis');
    expect(patch.suits!.S.short.en).toBe('The thesis');
    expect(patch.suits!.D.short.en).toBe('Money'); // a long name gets its first word
    expect(patch.suits!.C.short.en).toBe('Kids'); // the AI's own short name
    expect(patch.suits!.S.glyph).toBe(DEFAULT_SETTINGS.suits.S.glyph); // the piles keep their symbols
    expect(patch.suits!.S.name.fr).toBe(DEFAULT_SETTINGS.suits.S.name.fr); // the other language is left alone
  });

  it('writes the language the app is in', () => {
    const p = planChanges(cs([{ op: 'settings.update', set: { pillars: [{ name: 'Les études' }] } }]), snap({ settings: { suits: DEFAULT_SETTINGS.suits, language: 'fr', aiPreferences: DEFAULT_PREFERENCES } }), gen);
    const patch = (p.items[0]!.ops[0] as { t: 'settings'; patch: Partial<Settings> }).patch;
    expect(patch.suits!.S.name.fr).toBe('Les études');
    expect(patch.suits!.S.name.en).toBe(DEFAULT_SETTINGS.suits.S.name.en);
  });

  it('fewer than four pillars rename the first ones; a name already so is nothing to change', () => {
    const p = planChanges(cs([{ op: 'settings.update', set: { pillars: [{ name: 'Work & studies' }, { name: 'Admin' }] } }]), snap(), gen);
    expect(p.items[0]!.diffs.map(d => d.field)).toEqual(['pillar 2']);
    const none = planChanges(cs([{ op: 'settings.update', set: { pillars: [{ name: 'Work & studies' }] } }]), snap(), gen);
    expect(none.items).toHaveLength(0);
    expect(none.skipped).toBe(1);
  });

  it('rebuilds the preferences from the level of detail and the two free lines', () => {
    const p = planChanges(cs([{ op: 'settings.update', set: { preferences: { detail: 'very short', know: 'I start better with a time', never: 'no emojis' } } }]), snap(), gen);
    const patch = (p.items[0]!.ops[0] as { t: 'settings'; patch: Partial<Settings> }).patch;
    expect(patch.aiPreferences).toContain('Level of detail: very short.');
    expect(patch.aiPreferences).toContain('Things to know about how I work: I start better with a time');
    expect(patch.aiPreferences).toContain('Things never to do: no emojis');
    expect(patch.aiPreferences).toContain('One question at a time'); // the fixed lines stay
    expect(p.items[0]!.diffs[0]).toMatchObject({ field: 'preferences' });
    // The template again is nothing to change.
    expect(planChanges(cs([{ op: 'settings.update', set: { preferences: {} } }]), snap(), gen).items).toHaveLength(0);
  });

  it('comes to nothing where settings are not given (the connector\'s snapshot)', () => {
    const bare = snap();
    delete bare.settings;
    const p = planChanges(cs([{ op: 'settings.update', set: { pillars: PILLARS } }]), bare, gen);
    expect(p.items).toHaveLength(0);
    expect(p.skipped).toBe(1);
  });

  it('writes only when ticked, through the writer\'s settings', async () => {
    const p = planChanges(cs([{ op: 'settings.update', set: { pillars: [{ name: 'Studio' }] } }, { op: 'place.create', ref: 'home', set: { name: 'Home' } }]), snap(), gen);
    expect(p.items.map(i => i.target)).toEqual(['settings', 'place']);
    const wrote: unknown[] = [];
    const w: Writer = {
      createTask: async () => 'x', create: async (c, f) => { wrote.push([c, f]); return 'pl1'; }, update: async () => undefined, finish: async () => undefined, drop: async () => undefined,
      day: async () => undefined, stay: async () => 'x', settings: async patch => { wrote.push(['settings', patch]); },
    };
    expect(await applyPlanned(p, i => i === 0, w)).toBe(1);
    expect(wrote).toHaveLength(1);
    expect(wrote[0]![0]).toBe('settings');
    expect(await applyPlanned(p, () => false, w)).toBe(0);
    expect(wrote).toHaveLength(1);
  });
});

describe('shortName', () => {
  it('keeps a short name and cuts a long one to its first word', () => {
    expect(shortName('Rest')).toBe('Rest');
    expect(shortName('Money & the flat\'s paperwork')).toBe('Money');
    expect(shortName('Life: people, leisure, health')).toBe('Life');
  });
});

describe('the setup conversation', () => {
  it('asks for the pillars, places and preferences, and never the app\'s jargon to the person', () => {
    const { system, user } = setupPrompt([{ who: 'me', text: 'I am finishing a thesis and I live with my kids.' }]);
    expect(system.rest).toContain('four pillars');
    expect(system.rest).toContain('settings.update');
    expect(system.rest).toContain('place.create');
    expect(system.rest).toContain('Never say "card", "suit", "matrix"');
    expect(user).toContain('Person: I am finishing a thesis and I live with my kids.');
    expect(user).toContain('1 message from the person');
    // Nothing of the list or the memory goes: a first run has none.
    expect(user).not.toContain('Memory');
  });

  it('keeps the exchanges in order and tells the AI when it must propose', () => {
    const turns = Array.from({ length: MAX_EXCHANGES }, (_, i) => [{ who: 'me' as const, text: 'answer ' + i }, { who: 'you' as const, text: 'question ' + i }]).flat();
    const { user } = setupPrompt(turns);
    expect(user.indexOf('answer 0')).toBeLessThan(user.indexOf('question 0'));
    expect(user).toContain('propose the change-set now');
  });

  it('reads a reply: what it says, and a change-set only when it holds setup changes', () => {
    expect(readSetup({ say: ' What does a usual week look like? ', changes: [] })).toEqual({ say: 'What does a usual week look like?', cs: null });
    const r = readSetup({ say: 'Here is what I understood.', changes: [{ op: 'settings.update', set: { pillars: PILLARS } }, { op: 'place.create', set: { name: 'Home' } }, { op: 'task.create', set: { title: 'Open Mail' } }] });
    expect(r.cs!.changes.map(c => c.op)).toEqual(['settings.update', 'place.create']); // a setup creates no steps
    expect(r.cs!.note).toBe('Here is what I understood.');
    expect(readSetup({ changes: [{ op: 'task.drop', id: 't1' }] }).cs).toBeNull();
    expect(readSetup(null)).toEqual({ say: '', cs: null });
  });

  it('cuts a pasted change-set back to the setup ops', () => {
    const mixed = cs([{ op: 'task.create', set: { title: 'Open Mail' } }, { op: 'settings.update', set: { pillars: PILLARS } }]);
    expect(onlySetup(mixed)!.changes.map(c => c.op)).toEqual(['settings.update']);
    expect(onlySetup(cs([{ op: 'task.create', set: { title: 'Open Mail' } }]))).toBeNull();
    expect(SETUP_OPS).toEqual(['settings.update', 'place.create']);
  });
});

describe('the pack for any chatbot', () => {
  it('is the same job, ends on the reussite block, and holds nothing of the person\'s', () => {
    settings.value = withDefaults({ ...settings.value, aiPreferences: 'Say it short.' });
    const pack = setupPack('en');
    expect(pack).toContain('four parts of my days');
    expect(pack).toContain('settings.update');
    expect(pack).toContain('fenced code block labelled reussite');
    expect(pack).toContain('Do not call any tool or connector');
    expect(pack).toContain('Say it short.'); // their lines for an AI, if they have any
    expect(pack).toContain('Answer in English.');
    // The block it asks for reads back as a setup change-set.
    const reply = '```reussite\n{"v":1,"note":"Done","changes":[{"op":"settings.update","set":{"pillars":[{"name":"The thesis"},{"name":"Paperwork"},{"name":"My kids"},{"name":"Rest"}]}},{"op":"place.create","set":{"name":"Home"}}]}\n```';
    const r = parseChangeSet(reply);
    expect(r.ok && onlySetup(r.cs)!.changes).toHaveLength(2);
  });

  it('asks in French when the app is', () => {
    expect(setupPack('fr')).toContain('Answer in French.');
  });
});
