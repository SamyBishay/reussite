import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { tasks, projects, memory, settings, addresses, people } from '../app/store';
import { withDefaults } from '../data/settings';
import { buildRequest, systemText, type AiConfig } from './adapters';
import { breakDownPrompt, stuckPrompt, reviewPrompt } from './prompts';
import { contextPack, changesetContract, dropInstruction, commandPrompt, homePrompt, memoryFor, systemPrompt, methodSummary, calibrationLine, MAX_STEPS } from './context';
import type { MemoryNote, Task } from '../data/schema';

const task = (i: number): Task & { id: string } => ({
  id: 't' + i, title: 'Open Mail and reply ' + i, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me',
  status: 'open', doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: i, created: '',
});

describe('prompt building', () => {
  tasks.value = new Map(Array.from({ length: 60 }, (_, i) => [('t' + i), task(i)]));
  projects.value = new Map([['p1', { id: 'p1', name: 'Letters | admin', suit: 'D', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' }]]);
  it('sends at most 25 steps, as compact lines', () => {
    const { system, user } = commandPrompt('reply 7 and reply 42');
    const lines = user.split('\n').filter(l => /^t\d+ \| /.test(l));
    expect(lines.length).toBe(MAX_STEPS);
    expect(lines[0]).toMatch(/^t(7|42) \| Open Mail and reply (7|42) \| Q\d \| - \| 10m \| Letters \/ admin$/);
    expect(user).toContain('Calibration:');
    expect(system.stable).toContain('The nine rules');
    expect(system.rest).toContain('task.create');
    expect(system.stable).toMatch(/Answer in English\.$/);
  });
  it('builds a context pack with the method summary, the contract and the question', () => {
    const p = contextPack({ kind: 'matrix' }, 'What first?');
    expect(p).toContain('## My question\n\nWhat first?');
    expect(p).toContain('```reussite');
    expect(p.split('\n').filter(l => /^t\d+ \| /.test(l)).length).toBeLessThanOrEqual(MAX_STEPS);
    expect(methodSummary()).not.toContain('Draft for review');
    expect(methodSummary()).not.toContain('## Starters');
    expect(systemPrompt('X', 'fr').stable).toMatch(/Answer in French\.$/);
    expect(calibrationLine()).toMatch(/^Calibration: not enough timed steps yet/);
  });
  it('asks for the block without a drop address, and for the one-tap link with one', () => {
    const base = 'https://app.example/drop#' + 'S'.repeat(22) + '.' + 'K'.repeat(43) + '.';
    const plain = contextPack({ kind: 'today' }, 'What first?');
    expect(plain).toContain('end your reply with one fenced code block labelled reussite');
    expect(plain).not.toContain('/drop#');
    const link = contextPack({ kind: 'today' }, 'What first?', 'en', base);
    expect(link).toContain(base + 'z.DATA');
    expect(link).toContain(base + 'j.JSON');
    expect(link).toContain('8,000');
    expect(link).toContain('fenced reussite code block'); // the fallback over the size
    expect(link).not.toContain('end your reply with one fenced code block labelled reussite that holds');
    expect(dropInstruction(base)).toContain('raw deflate');
  });
  it('never tells an AI about the link section of CHANGESET.md', () => {
    expect(changesetContract()).toContain('task.create');
    expect(changesetContract()).not.toContain('one-tap');
    expect(changesetContract()).not.toContain('X25519');
  });
});


const line = (id: string, text: string) => ({ id, text, at: '2026-10-01T00:00:00.000Z', by: 'me' as const });
const note = (id: string, o: Partial<MemoryNote>): MemoryNote & { id: string } => ({
  id, kind: 'person', name: 'N', aliases: [], lines: [line('l1', 'a line')], private: false, updated: '2026-10-01T00:00:00.000Z', ...o,
});
const setMemory = (...ns: (MemoryNote & { id: string })[]) => { memory.value = new Map(ns.map(n => [n.id, n])); };
const cfg = (provider: AiConfig['provider']): AiConfig => ({ provider, baseUrl: 'https://openrouter.ai/api/v1', key: 'k', models: { quick: 'anthropic/claude-haiku-5.5', thinking: 'm' } });

describe('memory in prompts', () => {
  beforeEach(() => {
    settings.value = withDefaults(undefined);
    tasks.value = new Map([['t1', { ...task(1), title: 'Open Mail and answer the Ibrahim thread' }], ['t2', task(2)]]);
    projects.value = new Map([['p1', { id: 'p1', name: 'Letters', suit: 'D', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' }]]);
  });
  const profile = note('n0', { kind: 'profile', name: 'Profile', lines: [line('l1', 'Works best before noon')] });
  const ibrahim = note('n1', { name: 'Ibrahim', aliases: ['Ibra'], lines: [line('l1', 'Likes tea'), line('l2', 'Works nights')] });

  it('puts the profile in the stable prefix, with the same bytes in every feature and no date', () => {
    setMemory(profile, ibrahim);
    const a = commandPrompt('add milk').system, b = homePrompt('what is next?').system, c = stuckPrompt('t1', 'start').system, d = breakDownPrompt('t1').system, e = reviewPrompt('p1').system;
    expect(a.stable).toContain('n0 | profile | Profile | -\n1. Works best before noon');
    for (const x of [b, c, d, e]) expect(x.stable).toBe(a.stable);
    expect(a.rest).not.toBe(b.rest);
    expect(a.stable).not.toMatch(/Today is|\d{4}-\d{2}-\d{2}/);
    expect(a.stable).not.toContain('Ibrahim'); // other notes ride in the user message
    // Written to the wire, the stable block is the same string in both requests.
    const ra = buildRequest(cfg('anthropic'), 'quick', a, 'u'), rb = buildRequest(cfg('anthropic'), 'quick', b, 'u');
    expect((ra.body.system as { text: string }[])[0]!.text).toBe((rb.body.system as { text: string }[])[0]!.text);
    expect(systemText(a)).toBe(ra.system);
  });
  it('is byte-identical whatever order the notes were stored in', () => {
    const p2 = note('n9', { kind: 'profile', name: 'Work', lines: [line('l1', 'Teaches Tuesdays')] });
    setMemory(profile, p2);
    const one = systemPrompt('X').stable;
    setMemory(p2, profile);
    expect(systemPrompt('X').stable).toBe(one);
  });
  it('sends a note picked by name, by alias, and through a step title', () => {
    setMemory(profile, ibrahim);
    const byName = commandPrompt('what does Ibrahim have on');
    expect(byName.user).toContain('n1 | person | Ibrahim | Ibra\n1. Likes tea\n2. Works nights');
    expect(byName.notes).toEqual(['Profile', 'Ibrahim']);
    expect(homePrompt("and Ibra's week?").notes).toContain('Ibrahim');
    // No word of it in the message, but the step it points at has his name in its title.
    expect(memoryFor('', [tasks.value.get('t1')!]).names).toEqual(['Profile', 'Ibrahim']);
    tasks.value = new Map([['t2', task(2)]]);
    expect(commandPrompt('add milk').notes).toEqual(['Profile']);
    expect(commandPrompt('add milk').user).not.toContain('Ibrahim\n1.');
  });
  it('keeps the earlier turns of a conversation, and the note they named', () => {
    setMemory(profile, ibrahim);
    const p = homePrompt('and his week?', [{ text: 'what does Ibrahim have on', reply: 'A night shift.' }]);
    expect(p.user).toContain('Person: what does Ibrahim have on\nRéussite: A night shift.');
    expect(p.notes).toContain('Ibrahim');
    expect(p.user).toContain('Message:\nand his week?');
  });
  it('never sends a private note, in any request', () => {
    const secret = note('n5', { name: 'Marta', aliases: ['Mart'], private: true, lines: [line('l1', 'tells nobody about Zeppelin')] });
    const privProfile = note('n6', { kind: 'profile', name: 'Hidden profile', private: true, lines: [line('l1', 'Quietly hates mornings')] });
    setMemory(profile, ibrahim, secret, privProfile);
    tasks.value = new Map([['t1', { ...task(1), title: 'Open Mail and answer Marta' }]]);
    const all = [
      commandPrompt('what does Marta have on, and Mart'), homePrompt('Marta?', [{ text: 'Mart', reply: 'x' }]), stuckPrompt('t1', 'start'), breakDownPrompt('t1'), reviewPrompt('p1'),
    ].map(p => JSON.stringify([systemText(p.system), p.user, p.notes, buildRequest(cfg('anthropic'), 'quick', p.system, p.user).body, buildRequest(cfg('openai'), 'quick', p.system, p.user).body]));
    all.push(contextPack({ kind: 'matrix' }, 'Tell me about Marta and Mart'));
    // (A step's own title may name her; the note, its lines and its name as a note never go.)
    for (const text of all) for (const bad of ['n5 |', 'Zeppelin', 'Hidden profile', 'Quietly hates', 'n6 |']) expect(text).not.toContain(bad);
    for (const p of [commandPrompt('Marta'), homePrompt('Mart')]) expect(p.notes).not.toContain('Marta');
  });
  it('stays within the budget: the profile first, then the most recent notes that fit', () => {
    const big = (id: string, name: string, updated: string) => note(id, { name, updated, lines: [line('l1', 'x'.repeat(400))] }); // about 100 tokens
    setMemory(profile, big('a', 'Alpha', '2026-10-01'), big('b', 'Beta', '2026-10-03'), big('c', 'Gamma', '2026-10-02'));
    const m = (budget: number) => { settings.value = withDefaults({ memoryBudget: budget }); return memoryFor('Alpha Beta Gamma').names; };
    expect(m(3000)).toEqual(['Profile', 'Beta', 'Gamma', 'Alpha']);
    expect(m(260)).toEqual(['Profile', 'Beta', 'Gamma']);
    expect(m(150)).toEqual(['Profile', 'Beta']);
    expect(m(0)).toEqual(['Profile']);
    settings.value = withDefaults(undefined);
  });
  it('gives Ask any AI the profile and the notes the question names', () => {
    setMemory(profile, ibrahim, note('n7', { name: 'Elsewhere', lines: [line('l1', 'unrelated')] }));
    const p = contextPack({ kind: 'matrix' }, 'Should I call Ibrahim?');
    expect(p).toContain('## What I have told Réussite about me and my people');
    expect(p).toContain('Works best before noon');
    expect(p).toContain('1. Likes tea');
    expect(p).not.toContain('Elsewhere');
    setMemory();
    expect(contextPack({ kind: 'matrix' }, 'Q')).not.toContain('What I have told');
  });
  it('tells Home to answer in the note, to stay on the list, memory and method, and to keep memory to their words', () => {
    setMemory();
    const { rest } = homePrompt('hello').system;
    expect(rest).toContain('put the answer in "note"');
    expect(rest).toContain('"outside": true');
    expect(rest).toContain('never write a conclusion about their health, character or anyone\'s private life'.replace('never', 'Never'));
  });
});

describe('addresses and people stay out of ordinary requests', () => {
  it('are in no prompt, pack or request, even when a step, the question or the notes name them', () => {
    settings.value = withDefaults(undefined);
    projects.value = new Map([['p1', { id: 'p1', name: 'Life', suit: 'H', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' }]]);
    tasks.value = new Map([['t1', { ...task(1), title: 'Coffee with Théophile Marchand at Brasserie Aubergine', personId: 'pe1', addressId: 'a1' } as never]]);
    memory.value = new Map([['n1', note('n1', { name: 'Théophile', aliases: ['Marchand'], lines: [line('l1', 'Likes tea')] })]]);
    addresses.value = new Map([['a1', { id: 'a1', name: 'Brasserie Aubergine', category: 'food', placeId: 'any', mapsUrl: null, street: '9 Impasse des Lilas', state: 'been', by: 'me', note: '', visits: [{ id: 'v1', day: '2026-10-01', note: 'Soup was cold', verdict: 'maybe' }] }]]);
    people.value = new Map([['pe1', { id: 'pe1', name: 'Théophile Marchand', placeId: 'any', reach: 'whatsapp://send?phone=33612345678', note: 'Allergic to hazelnuts', lastSeen: '2026-10-02' }]]);
    const q = 'Who should I see, Marchand, and where, Brasserie Aubergine, Impasse des Lilas?';
    const texts = [
      contextPack({ kind: 'today' }, q), contextPack({ kind: 'matrix' }, q), contextPack({ kind: 'project', id: 'p1' }, q),
      JSON.stringify(commandPrompt(q)), JSON.stringify(homePrompt(q, [{ text: 'and him?', reply: 'ok' }])),
      JSON.stringify(stuckPrompt('t1', 'start')), JSON.stringify(breakDownPrompt('t1')), JSON.stringify(reviewPrompt('p1')),
    ].map(t => t.replace(q, ''));
    // The step's own title is the person's words about a step, not the people list; what must be absent is every field of an address or a person.
    for (const t of texts) for (const s of ['Impasse des Lilas', 'hazelnuts', '33612345678', 'Soup was cold', 'whatsapp://', 'pe1', 'a1 |']) expect(t, s).not.toContain(s);
  });
});
