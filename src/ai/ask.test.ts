import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { settings, db } from '../app/store';
import { withDefaults } from '../data/settings';
import { ask, askChanges, setKey, pending, seenKinds } from './ask';

const ok = (text: string) => vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 }));
const schema = z.object({ steps: z.array(z.string()) });
afterAll(() => vi.useRealTimers());

describe('ask', () => {
  it('needs a provider and a key, and sends nothing without them', async () => {
    const f = ok('{}');
    settings.value = withDefaults(undefined);
    expect(await ask('x', 'quick', 's', 'u', schema, { fetchFn: f as never })).toMatchObject({ ok: false, error: 'off' });
    settings.value = withDefaults({ aiProvider: 'anthropic' });
    expect(await ask('x', 'quick', 's', 'u', schema, { fetchFn: f as never })).toMatchObject({ ok: false, error: 'noKey' });
    expect(f).not.toHaveBeenCalled();
  });
  it('shows the request before the first call of each kind, then remembers', async () => {
    await db.open();
    settings.value = withDefaults({ aiProvider: 'anthropic' });
    await setKey('anthropic', 'sk-secret');
    const f = ok('Here you go:\n```json\n{"steps":["Open Mail"]}\n```');
    const p = ask('breakdown', 'thinking', 'SYS', 'USER', schema, { fetchFn: f as never });
    await vi.waitFor(() => expect(pending.value).not.toBeNull());
    expect(pending.value!.req.user).toBe('USER');
    expect(pending.value!.req.model).toBe('claude-sonnet-5-5');
    expect(JSON.stringify(pending.value!.req)).not.toContain('sk-secret');
    expect(f).not.toHaveBeenCalled();
    pending.value!.done(true);
    expect(await p).toMatchObject({ ok: true, data: { steps: ['Open Mail'] } });
    expect(await seenKinds()).toEqual(['breakdown']);
    // Second call of the same kind: no preview.
    expect(await ask('breakdown', 'thinking', 'SYS', 'USER', schema, { fetchFn: f as never })).toMatchObject({ ok: true });
    expect(pending.value).toBeNull();
  });
  it('Cancel sends nothing', async () => {
    const f = ok('{}');
    const p = ask('stuck', 'quick', 's', 'u', schema, { fetchFn: f as never });
    await vi.waitFor(() => expect(pending.value).not.toBeNull());
    pending.value!.done(false);
    expect(await p).toMatchObject({ ok: false, error: 'cancelled' });
    expect(f).not.toHaveBeenCalled();
  });
  it('rejects output that fails the schema', async () => {
    const r = await ask('breakdown', 'thinking', 's', 'u', schema, { fetchFn: ok('{"steps": "not a list"}') as never });
    expect(r).toMatchObject({ ok: false, error: 'invalid', message: expect.stringContaining('nothing was changed') });
    const c = await askChanges('command', 'quick', 's', 'u', { fetchFn: ok('I would drop the games.') as never, noPreview: true });
    expect(c).toMatchObject({ ok: false, error: 'invalid' });
    const e = await askChanges('command', 'quick', 's', 'u', { fetchFn: ok('{"v":1,"note":"Which games?","changes":[]}') as never, noPreview: true });
    expect(e).toEqual({ ok: false, error: 'empty', message: 'Which games?' });
  });
});
