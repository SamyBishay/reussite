import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db, tasks, projects, places, decisions, memory, exchanges, settings } from './store';
import { setLocal } from '../data/db';
import { withDefaults } from '../data/settings';
import { setKey } from '../ai/ask';
import { buildDiagnostics, registerDiagnostics } from './diagnostics';
import { logError, noteAiError, readErrors } from './errorlog';

const SEEDS = ['Ibrahimovic Cousin', 'Prefers the quiet carriage', 'Ask Marguerite about the lease', 'Zebra Invoice Quarterly', 'Private note about Wendeline', 'Project Quokka Moonshot', 'Rue des Glycines 12', 'Whether to adopt Pangolin', 'Hortensia Credit Line'];
const KEY = 'sk-ant-SECRETKEY-12345';
const RECOVERY = 'amber-falcon-violet-orbit-meadow-lantern';

describe('diagnostics', () => {
  it('contains none of the seeded text, keys or recovery key', async () => {
    tasks.value = new Map([['t1', { id: 't1', title: SEEDS[0]!, note: SEEDS[1]!, project: 'p1' } as never]]);
    projects.value = new Map([['p1', { id: 'p1', name: SEEDS[2]!, goal: SEEDS[5]! } as never]]);
    places.value = new Map([['pl1', { id: 'pl1', name: SEEDS[3]!, timeZone: 'Europe/Paris' } as never]]);
    decisions.value = new Map([['d1', { id: 'd1', title: SEEDS[4]!, problem: { what: 'x' } } as never]]);
    memory.value = new Map([['m1', { id: 'm1', kind: 'person', name: SEEDS[0]!, aliases: ['Cousin Ibra'], lines: [{ id: 'l0', text: SEEDS[1]!, at: '', by: 'me' }], private: false, updated: '' } as never]]);
    exchanges.value = new Map([['e1', { id: 'e1', at: '', text: SEEDS[2]!, turns: [{ at: '', text: 'follow-up about Sesquipedalian', reply: 'The Hortensia answer', kind: 'say' }], changes: [], undo: {}, undone: [], src: 'home' } as never]]);
    settings.value = withDefaults({ aiProvider: 'anthropic', aiBaseUrl: 'https://x.test/v1?key=' + KEY });
    await setKey('anthropic', KEY);
    await setLocal(db, 'recoveryKey', RECOVERY);
    await logError(new Error('missing tasks/t1 while saving "' + SEEDS[0] + '" in ' + SEEDS[2]), 'test');
    await logError('plain failure ' + SEEDS[4], 'promise');
    await noteAiError('rateLimit', 429);
    registerDiagnostics('sync', async () => ({ 'last sync': '2026-10-19T08:00:00Z', pending: 2, devices: 3 }));

    const out = await buildDiagnostics();
    for (const s of [...SEEDS, KEY, RECOVERY, 'Wendeline', 'Quokka', 'Cousin Ibra', 'Sesquipedalian', 'Hortensia answer']) expect(out).not.toContain(s);
    expect(out).toContain('version: ' + __APP_VERSION__);
    expect(out).toContain('missing tasks/t1');
    expect(out).toContain('‹…›');
    expect(out).toContain('rateLimit 429');
    expect(out).toContain('devices: 3');
    expect(out).toContain('[push]\nnot set up');
    expect(out).toContain('[connector]\noff');
  });

  it('keeps only the last 50 errors', async () => {
    for (let i = 0; i < 55; i++) await logError('e' + i, 'loop');
    const all = await readErrors();
    expect(all).toHaveLength(50);
    expect(all.at(-1)!.message).toBe('e54');
  });
});
