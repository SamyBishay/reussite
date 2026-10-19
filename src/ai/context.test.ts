import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { tasks, projects } from '../app/store';
import { contextPack, changesetContract, dropInstruction, commandPrompt, systemPrompt, methodSummary, calibrationLine, MAX_STEPS } from './context';
import type { Task } from '../data/schema';

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
    expect(system).toContain('The nine rules');
    expect(system).toContain('task.create');
    expect(system).toMatch(/Answer in English\.$/);
  });
  it('builds a context pack with the method summary, the contract and the question', () => {
    const p = contextPack({ kind: 'matrix' }, 'What first?');
    expect(p).toContain('## My question\n\nWhat first?');
    expect(p).toContain('```reussite');
    expect(p.split('\n').filter(l => /^t\d+ \| /.test(l)).length).toBeLessThanOrEqual(MAX_STEPS);
    expect(methodSummary()).not.toContain('Draft for review');
    expect(methodSummary()).not.toContain('## Starters');
    expect(systemPrompt('X', 'fr')).toMatch(/Answer in French\.$/);
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
