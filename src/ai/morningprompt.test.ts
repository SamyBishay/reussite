import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { tasks, projects, settings, days, places, today, memory } from '../app/store';
import { proposalFor } from '../app/model';
import { withDefaults } from '../data/settings';
import { morningPrompt } from './prompts';
import type { MemoryNote, Task } from '../data/schema';

const task = (id: string, o: Partial<Task> = {}): Task & { id: string } => ({
  id, title: 'Open the file for ' + id, project: 'inbox', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 20, est0: null, estBy: 'me',
  status: 'open', doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: Number(id.replace(/\D/g, '')) || 1, created: '', ...o,
});
const set = (ts: (Task & { id: string })[]) => { tasks.value = new Map(ts.map(x => [x.id, x])); };
const proj = (id: string, name: string, o: Record<string, unknown> = {}) => [id, { id, name, suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active', ...o }] as const;

describe('the morning request', () => {
  const k = today.value;
  settings.value = withDefaults({ ...settings.value, suits: { ...settings.value.suits, C: { ...settings.value.suits.C, short: { en: 'Kin', fr: 'Proches' } } } });
  projects.value = new Map([proj('inbox', 'Inbox'), proj('pt', 'Thesis', { goal: 'Hand in by June', due: '2027-06-01' })] as never);
  places.value = new Map();
  days.value = new Map();
  set([
    task('t1', { due: k, urgent: true }), task('t2', { project: 'pt', order: 1, title: 'Open the draft and read page one' }), task('t3', { project: 'pt', order: 2 }),
    task('t4', { suit: 'C', title: 'Open Messages and text Sam' }), task('t5', { suit: 'H' }), task('w1', { after: ['t2'], project: 'pt' }),
  ]);

  it('gathers the sections from the list: what is due, the project with its first step, a step for the pillars, and nothing that waits', () => {
    const { proposal: p, known } = proposalFor(k);
    expect(p.must.map(m => m.id + ':' + m.why)).toEqual(['t1:dueToday']);
    expect(p.goals).toEqual([{ project: 'pt', step: 't2', more: ['t3'] }]);
    expect(p.pillars.C.pick).toBe('t4');
    expect(p.pillars.H.pick).toBe('t5');
    expect(p.pillars.D.pick).toBeNull();
    expect(JSON.stringify(p)).not.toContain('w1');
    expect(known.get('t4')).toEqual({ suit: 'C', project: 'inbox' });
    expect(p.load.planned).toBeGreaterThan(0);
  });

  it('puts the five sections in the request, with the person’s own names for the pillars', () => {
    const { proposal } = proposalFor(k);
    const { system, user } = morningPrompt(proposal);
    for (const head of ['1. Must happen', '2. Projects to move today', '3. Pillars', '4. Where the person is today']) expect(user).toContain(head);
    expect(user).toContain('C = Kin');
    expect(user).toMatch(/^t1 \| Open the file for t1 \| Q1 \| /m);
    expect(user).toContain('first step: t2 | Open the draft and read page one');
    expect(user).toMatch(/planned of .* free|The room the day has: /);
    // The AI proposes; it asks nothing open, and the app's own jargon stays out of what the person reads.
    expect(system.rest).toContain('do not ask open questions');
    expect(system.rest).toContain('never the words "card" or "suit"');
  });

  it('a later turn carries what was kept, what was skipped and what the person said', () => {
    const { proposal } = proposalFor(k);
    const { user } = morningPrompt(proposal, { message: 'Lighter on work', kept: ['t1', 't4'], skipped: ['t5'] });
    expect(user).toContain('Kept: t1, t4. Skipped, so never offer them again: t5.');
    expect(user).toContain('They say: Lighter on work');
  });

  it('sends the profile, which is where a call to someone they care about comes from', () => {
    const profile: MemoryNote & { id: string } = { id: 'n1', kind: 'profile', name: 'About me', aliases: [], lines: [{ id: 'l1', text: 'Calls Mum on Sundays', at: '2026-10-01T00:00:00.000Z', by: 'me' }] } as never;
    memory.value = new Map([['n1', profile]]);
    const { system } = morningPrompt(proposalFor(k).proposal);
    expect(system.stable).toContain('Calls Mum on Sundays');
    memory.value = new Map();
  });
});
