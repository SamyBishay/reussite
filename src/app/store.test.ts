import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createDoc, exchanges, memory, removeDoc, start, update } from './store';

describe('memory and exchanges in the store', () => {
  it('mirrors notes and exchanges as signals, filled with defaults, and a removed one leaves the signal', async () => {
    await start();
    const id = await createDoc('memory', { name: 'Ibrahim' });
    await createDoc('exchanges', { at: '2026-10-20T09:00:00Z', text: 'hi' }, 'e1');
    await new Promise(r => setTimeout(r, 30));
    expect(memory.value.get(id)).toMatchObject({ id, name: 'Ibrahim', kind: 'topic', aliases: [], lines: [], private: false });
    expect(exchanges.value.get('e1')).toMatchObject({ text: 'hi', turns: [], changes: [], undo: {}, undone: [], src: 'home' });
    await update('memory', id, { lines: [{ id: 'l0', text: 'one', at: '', by: 'me' }] });
    await new Promise(r => setTimeout(r, 30));
    expect(memory.value.get(id)!.lines).toHaveLength(1);
    await removeDoc('memory', id);
    await new Promise(r => setTimeout(r, 30));
    expect(memory.value.has(id)).toBe(false);
  });
});
