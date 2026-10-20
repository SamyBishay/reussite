import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDoc, db, start } from './store';
import { forgetLine, forgetNote } from './memoryActions';
import type { Exchange, MemoryNote } from '../data/schema';

beforeAll(async () => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('HTMLElement', class {});
  await start();
});

const FACT = 'Léa is pregnant, due in March';
async function withExchange(note: string) {
  const lea = { id: 'l2', text: FACT, at: '', by: 'ai' as const };
  await createDoc<MemoryNote>('memory', { kind: 'person', name: 'Léa', aliases: [], lines: [{ id: 'l1', text: 'Sister', at: '', by: 'me' }, lea], private: false, updated: '' }, note);
  const ex: Exchange = {
    at: '2026-10-20T10:00:00.000Z', text: FACT, src: 'home', undone: [], changes: ['c1'],
    turns: [{ at: '2026-10-20T10:00:00.000Z', text: FACT, kind: 'changes', reply: 'Remember: ' + FACT, n: 2 }],
    undo: { c1: [{ c: 'memory', id: note, fields: { lines: { was: [], now: [lea] } } }, { c: 'tasks', id: 't1', created: true }] },
  };
  return createDoc<Exchange>('exchanges', ex);
}
const stored = async (id: string) => JSON.stringify(await db.table_('exchanges').get(id));

describe('Forget', () => {
  it('a line: History and its Undo keep no copy; the rest of the exchange stays', async () => {
    const ex = await withExchange('n1');
    await forgetLine('n1', 'l2');
    const doc = (await db.table_('exchanges').get(ex)) as unknown as Exchange;
    expect(await stored(ex)).not.toContain('pregnant');
    expect(doc.text).toBe('');
    expect(doc.turns).toMatchObject([{ kind: 'changes', n: 2, text: '' }]);
    expect(doc.undo.c1).toEqual([{ c: 'tasks', id: 't1', created: true }]);
  });
  it('a note: the same', async () => {
    const ex = await withExchange('n2');
    await forgetNote('n2');
    expect(await stored(ex)).not.toContain('pregnant');
    expect(JSON.stringify(await db.table_('memory').get('n2'))).not.toContain('pregnant');
  });
});
