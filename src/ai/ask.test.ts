import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { settings, db } from '../app/store';
import { withDefaults } from '../data/settings';
import { ask, askChanges, setKey, pending, seenKinds, monthUsage } from './ask';

const ok = (text: string, usage?: unknown) => vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text }], ...(usage ? { usage } : {}) }), { status: 200 }));
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

describe('spend and the monthly cap', () => {
  const reply = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0 };
  it('counts each call in the month, in dollars for a priced Anthropic model', async () => {
    await db.open();
    settings.value = withDefaults({ aiProvider: 'anthropic', aiModels: { openai: { quick: 'q', thinking: 't' }, anthropic: { quick: 'claude-sonnet-5-5', thinking: 'claude-sonnet-5-5' } } });
    await setKey('anthropic', 'sk-secret');
    const before = await monthUsage();
    const r = await ask('spend', 'quick', 's', 'u', schema, { fetchFn: ok('{"steps":[]}', reply) as never, noPreview: true });
    expect(r.ok).toBe(true);
    const m = await monthUsage();
    expect(m.calls - before.calls).toBe(1);
    expect(m.priced - before.priced).toBe(1);
    expect(m.cacheRead - before.cacheRead).toBe(10_000);
    expect(m.usd - before.usd).toBeCloseTo((1000 * 2 + 500 * 10 + 10_000 * 0.2) / 1e6, 10);
  });
  it('stops at the cap with the cap error, sends nothing and shows no preview', async () => {
    const f = ok('{"steps":[]}', reply);
    settings.value = withDefaults({ ...settings.value, aiMonthlyCap: (await monthUsage()).usd });
    expect(await ask('spend', 'quick', 's', 'u', schema, { fetchFn: f as never })).toMatchObject({ ok: false, error: 'cap', message: expect.stringContaining('limit') });
    expect(await askChanges('home', 'quick', 's', 'u', { fetchFn: f as never })).toMatchObject({ ok: false, error: 'cap' });
    expect(f).not.toHaveBeenCalled();
    expect(pending.value).toBeNull();
    // Raised, or taken off, it goes through again.
    settings.value = withDefaults({ ...settings.value, aiMonthlyCap: (await monthUsage()).usd + 1 });
    expect((await ask('spend', 'quick', 's', 'u', schema, { fetchFn: f as never, noPreview: true })).ok).toBe(true);
    settings.value = withDefaults({ ...settings.value, aiMonthlyCap: null });
    expect((await ask('spend', 'quick', 's', 'u', schema, { fetchFn: f as never, noPreview: true })).ok).toBe(true);
  });
  it('lists the memory notes in the preview', async () => {
    const p = ask('notes', 'quick', 's', 'u', schema, { fetchFn: ok('{"steps":[]}') as never, notes: ['Profile', 'Ibrahim'] });
    await vi.waitFor(() => expect(pending.value).not.toBeNull());
    expect(pending.value!.notes).toEqual(['Profile', 'Ibrahim']);
    pending.value!.done(true);
    await p;
  });
  it('reports an empty reply\'s note, and whether it was out of scope', async () => {
    const out = '{"v":1,"changes":[],"note":"I only help with your list.","outside":true}';
    expect(await askChanges('home', 'quick', 's', 'u', { fetchFn: ok(out) as never, noPreview: true })).toEqual({ ok: false, error: 'empty', message: 'I only help with your list.', outside: true });
    expect(await askChanges('home', 'quick', 's', 'u', { fetchFn: ok('{"v":1,"changes":[],"note":"Tea."}') as never, noPreview: true })).toEqual({ ok: false, error: 'empty', message: 'Tea.' });
  });
});
