import { describe, expect, it, vi } from 'vitest';
import { buildRequest, send, classify, masked, ANTHROPIC_URL, type AiConfig } from './adapters';
import { extractJson } from './json';
import { parseChangeSet, readChangeSet, type ChangeSet } from './changeset';
import { planChanges, applyPlanned, type Snapshot, type Writer } from './apply';
import { normDecision } from '../data/normalize';
import type { Task } from '../data/schema';

const cfg = (provider: AiConfig['provider'], baseUrl = 'https://openrouter.ai/api/v1/'): AiConfig =>
  ({ provider, baseUrl, key: 'sk-test', models: { quick: 'q-model', thinking: 't-model' } });
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));

describe('adapters', () => {
  it('builds an OpenAI-compatible request', () => {
    const r = buildRequest(cfg('openai'), 'thinking', 'SYS', 'USER');
    expect(r.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(r.headers.authorization).toBe('Bearer sk-test');
    expect(r.body).toMatchObject({ model: 't-model', messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }] });
    expect(masked(r).headers.authorization).toBe('Bearer ••••');
  });
  it('builds an Anthropic request with the browser header', () => {
    const r = buildRequest(cfg('anthropic'), 'quick', 'SYS', 'USER');
    expect(r.url).toBe(ANTHROPIC_URL);
    expect(r.headers).toMatchObject({ 'x-api-key': 'sk-test', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    expect(r.body).toMatchObject({ model: 'q-model', system: 'SYS', messages: [{ role: 'user', content: 'USER' }] });
    expect(masked(r).headers['x-api-key']).toBe('••••');
  });
  it('sends and reads both providers', async () => {
    const f1 = reply(200, { choices: [{ message: { content: '{"ok":true}' } }] });
    const r1 = buildRequest(cfg('openai'), 'quick', 's', 'u');
    expect(await send(r1, f1 as never)).toEqual({ ok: true, text: '{"ok":true}' });
    const [url, init] = f1.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(r1.url);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body)).model).toBe('q-model');
    const f2 = reply(200, { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":1}' }], stop_reason: 'end_turn' });
    expect(await send(buildRequest(cfg('anthropic'), 'quick', 's', 'u'), f2 as never)).toEqual({ ok: true, text: '{"a":1}' });
  });
  it('classifies errors', async () => {
    const r = buildRequest(cfg('openai'), 'quick', 's', 'u');
    const a = buildRequest(cfg('anthropic'), 'quick', 's', 'u');
    expect((await send(r, reply(402, { error: { message: 'Insufficient credits' } }) as never)).ok).toBe(false);
    expect(await send(r, reply(402, 'x') as never)).toMatchObject({ error: 'noCredit' });
    expect(await send(r, reply(429, 'slow down') as never)).toMatchObject({ error: 'rateLimit' });
    expect(await send(r, reply(429, '{"error":{"type":"insufficient_quota"}}') as never)).toMatchObject({ error: 'noCredit' });
    expect(await send(a, reply(400, '{"type":"error","error":{"message":"Your credit balance is too low"}}') as never)).toMatchObject({ error: 'noCredit' });
    expect(await send(a, reply(401, 'bad key') as never)).toMatchObject({ error: 'auth' });
    expect(await send(a, reply(403, 'no') as never)).toMatchObject({ error: 'auth' });
    expect(await send(a, reply(529, 'overloaded') as never)).toMatchObject({ error: 'server' });
    expect(await send(a, vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as never)).toMatchObject({ error: 'network' });
    expect(await send(a, vi.fn(async () => { throw new DOMException('x', 'AbortError'); }) as never)).toMatchObject({ error: 'cancelled' });
    expect(await send(a, reply(200, { content: [], stop_reason: 'refusal' }) as never)).toMatchObject({ error: 'refused' });
    expect(await send(r, reply(200, { error: { code: 429, message: 'Rate limit exceeded' } }) as never)).toMatchObject({ error: 'rateLimit' });
    expect(await send(r, reply(200, 'not json') as never)).toMatchObject({ error: 'invalid' });
    expect(classify(500, '')).toBe('server');
  });
});

describe('JSON extraction', () => {
  it('reads fenced, labelled and bare JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Here:\n```json\n{"a":2}\n```\nThanks')).toEqual({ a: 2 });
    expect(extractJson('```\n{"a":3}\n```')).toEqual({ a: 3 });
    expect(extractJson('Sure! {"a": "b}"} and more text')).toEqual({ a: 'b}' });
    expect(extractJson('```json\n{"x":1}\n```\n```reussite\n{"y":2}\n```', 'reussite')).toEqual({ y: 2 });
    expect(extractJson('no json here {oops')).toBeUndefined();
  });
});

describe('change-set parser', () => {
  it('finds the reussite block in a pasted reply', () => {
    const r = parseChangeSet('I suggest:\n\n```reussite\n{"v":1,"changes":[{"op":"task.drop","id":"t1"}]}\n```\nGood luck!');
    expect(r.ok && r.cs.changes).toEqual([{ op: 'task.drop', id: 't1' }]);
  });
  it('accepts bare JSON and a bare array', () => {
    expect(parseChangeSet('{"changes":[{"op":"task.done","id":"t1"}]}').ok).toBe(true);
    expect(readChangeSet([{ op: 'task.drop', id: 't1' }]).ok).toBe(true);
  });
  it('rejects garbage, other versions and empty sets', () => {
    expect(parseChangeSet('Just do it.')).toEqual({ ok: false, error: 'noJson' });
    expect(parseChangeSet('{"foo": 1}')).toEqual({ ok: false, error: 'invalid' });
    expect(parseChangeSet('{"v":2,"changes":[{"op":"task.drop","id":"t1"}]}')).toEqual({ ok: false, error: 'version' });
    expect(parseChangeSet('{"v":1,"changes":[{"op":"explode"}]}')).toEqual({ ok: false, error: 'invalid' });
    expect(parseChangeSet('{"v":1,"changes":[]}')).toEqual({ ok: false, error: 'empty' });
  });
  it('keeps the good changes and counts the bad ones', () => {
    const r = parseChangeSet('{"v":1,"changes":[{"op":"task.drop","id":"t1"},{"op":"task.update","id":"t2","set":{"due":"Friday"}}]}');
    expect(r.ok && r.cs.bad).toBe(1);
  });
  it('drops weights from decision items', () => {
    const r = readChangeSet({ v: 1, changes: [{ op: 'decision.update', id: 'd1', set: { options: [{ name: 'A', pros: [{ text: 'cheap', w: 5 }, 'near'] }] } }] });
    expect(r.ok && r.cs.changes[0]).toEqual({ op: 'decision.update', id: 'd1', set: { options: [{ name: 'A', pros: ['cheap', 'near'] }] } });
  });
});

// ---------- apply ----------
const task = (id: string, o: Partial<Task> = {}): Task & { id: string } => ({
  id, title: 'Step ' + id, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me',
  status: 'open', doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: Number(id.slice(1)), created: '', ...o,
});
function snap(): Snapshot {
  const m = <T extends { id: string }>(xs: T[]) => new Map(xs.map(x => [x.id, x]));
  return {
    today: '2026-10-09',
    tasks: m([task('t1'), task('t2'), task('t3', { status: 'dropped' })]),
    projects: m([{ id: 'p1', name: 'Thesis', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' }]),
    days: m([{ id: '2026-10-09', date: '2026-10-09', plan: ['t1'], launches: [], first: null, checkin: null, closed: null, summary: null }]),
    decisions: m([{ ...normDecision({ title: 'Stay or move?', options: [{ id: 'o1', name: 'Stay', pros: [{ id: 'i1', text: 'cheap', w: 4 }] }] }), id: 'd1' }]),
    places: m([{ id: 'home', name: 'Paris', timeZone: 'Europe/Paris', order: 0 }]),
    stays: new Map(), memory: new Map(),
  };
}
let n = 0;
const gen = { id: (p: string) => p + 'x' + n++, now: () => '2026-10-09T10:00:00.000Z', zone: 'Europe/Paris' };
function fakeWriter() {
  const calls: [string, ...unknown[]][] = [];
  let id = 0;
  const w: Writer = {
    createTask: async f => { calls.push(['createTask', f]); return 'new' + id++; },
    create: async (c, f) => { calls.push(['create', c, f]); return 'new' + id++; },
    update: async (c, i, p) => { calls.push(['update', c, i, p]); },
    finish: async (i, d) => { calls.push(['finish', i, d]); },
    drop: async i => { calls.push(['drop', i]); },
    day: async (k, p) => { calls.push(['day', k, p]); },
    stay: async (i, s) => { calls.push(['stay', i, s]); return 'new' + id++; },
  };
  return { w, calls };
}
const cs = (changes: unknown[]): ChangeSet => { const r = readChangeSet({ v: 1, changes }); if (!r.ok) throw new Error(r.error); return r.cs; };

describe('planning and applying change-sets', () => {
  it('writes only the ticked changes', async () => {
    const p = planChanges(cs([
      { op: 'task.update', id: 't1', set: { due: '2026-10-16', est: 25 } },
      { op: 'task.drop', id: 't2' },
      { op: 'task.done', id: 't1', day: '2026-10-08' },
    ]), snap(), gen);
    expect(p.items.map(i => i.kind)).toEqual(['update', 'drop', 'done']);
    const { w, calls } = fakeWriter();
    expect(await applyPlanned(p, i => i !== 1, w)).toBe(2);
    expect(calls).toEqual([
      ['update', 'tasks', 't1', { due: '2026-10-16', est: 25, estBy: 'ai', dueRule: null }],
      ['finish', 't1', '2026-10-08'],
    ]);
  });
  it('marks what an AI made, resolves refs, and skips what changes nothing', async () => {
    const p = planChanges(cs([
      { op: 'project.create', ref: 'mv', set: { name: 'Move out', goal: 'Keys back by November' } },
      { op: 'task.create', ref: 'a', set: { title: 'Open Mail and ask for the date', project: 'mv', est: 10, link: 'javascript:alert(1)' } },
      { op: 'task.create', set: { title: 'Block the morning', project: 'mv', after: ['a', 'zzz'] } },
      { op: 'day.update', date: '2026-10-09', add: ['a'] },
      { op: 'task.update', id: 't2', set: { title: 'Step t2' } },
      { op: 'task.drop', id: 't3' },
      { op: 'task.update', id: 'nope', set: { due: '2026-10-10' } },
    ]), snap(), gen);
    expect(p.items).toHaveLength(4);
    expect(p.skipped).toBe(3);
    const { w, calls } = fakeWriter();
    await applyPlanned(p, () => true, w);
    expect(calls[0]).toMatchObject(['create', 'projects', { name: 'Move out', goal: 'Keys back by November', goalBy: 'ai', by: 'ai' }]);
    expect(calls[1]![1]).toMatchObject({ title: 'Open Mail and ask for the date', project: 'new0', est: 10, estBy: 'ai', by: 'ai' });
    expect(calls[1]![1]).not.toHaveProperty('link');
    expect(calls[2]![1]).toMatchObject({ project: 'new0', after: ['new1'] });
    expect(calls[3]).toEqual(['day', '2026-10-09', { plan: ['t1', 'new1'] }]);
  });
  it('falls back when a referenced creation is unticked', async () => {
    const p = planChanges(cs([
      { op: 'project.create', ref: 'mv', set: { name: 'Move out' } },
      { op: 'task.create', set: { title: 'Pack', project: 'mv' } },
    ]), snap(), gen);
    const { w, calls } = fakeWriter();
    await applyPlanned(p, i => i === 1, w);
    expect(calls).toEqual([['createTask', expect.objectContaining({ title: 'Pack', project: 'inbox' })]]);
  });
  it('gives AI items weight 3 and never takes its weights', async () => {
    const raw = { v: 1, changes: [{ op: 'decision.update', id: 'd1', set: { options: [{ name: 'stay', pros: [{ text: 'quiet', w: 5 }, 'cheap'], cons: ['small'] }, { name: 'Move', prosNot: [{ text: 'relief', w: 1 }] }], chosen: 'Move' } }] };
    const p = planChanges(cs(raw.changes), snap(), gen);
    const { w, calls } = fakeWriter();
    await applyPlanned(p, () => true, w);
    const patch = calls[0]![3] as { options: { id: string; name: string; by?: string; pros: { text: string; w: number; by?: string }[]; prosNot: { w: number; by?: string }[] }[]; chosen: string; chosenId: string; status: string };
    const [stay, move] = patch.options;
    expect(stay!.pros).toEqual([{ id: 'i1', text: 'cheap', w: 4 }, expect.objectContaining({ text: 'quiet', w: 3, by: 'ai' })]);
    expect(move).toMatchObject({ name: 'Move', by: 'ai', prosNot: [expect.objectContaining({ text: 'relief', w: 3, by: 'ai' })] });
    expect(patch).toMatchObject({ chosen: 'Move', chosenId: move!.id, status: 'decided' });
  });
  it('creates a whole decision with steps', async () => {
    const p = planChanges(cs([{ op: 'decision.create', set: { title: 'Which bank?', project: 'p1', problem: { what: 'Fees went up' }, options: [{ name: 'Stay' }, { name: 'Switch' }], steps: [{ title: 'Open the bank app and list the fees', est: 15 }] } }]), snap(), gen);
    const { w, calls } = fakeWriter();
    await applyPlanned(p, () => true, w);
    expect(calls[0]).toEqual(['createTask', expect.objectContaining({ title: 'Open the bank app and list the fees', project: 'p1', estBy: 'ai', by: 'ai' })]);
    expect(calls[1]).toMatchObject(['create', 'decisions', { title: 'Which bank?', projectId: 'p1', status: 'draft', by: 'ai', taskIds: ['new0'], problem: { what: 'Fees went up', gap: '' } }]);
  });
  it('edits projects, places and stays', async () => {
    const p = planChanges(cs([
      { op: 'project.update', id: 'p1', set: { smart: { measurable: '20 pages' }, due: '2026-12-01' } },
      { op: 'place.create', ref: 'ly', set: { name: 'Lyon', timeZone: 'Mars/Olympus' } },
      { op: 'stay.create', set: { place: 'ly', from: '2026-11-02', to: '2026-11-01' } },
      { op: 'stay.create', set: { place: 'paris', from: '2026-12-20', to: '2026-12-24' } },
    ]), snap(), gen);
    const { w, calls } = fakeWriter();
    await applyPlanned(p, () => true, w);
    expect(calls[0]).toMatchObject(['update', 'projects', 'p1', { smart: { measurable: '20 pages', specific: '' }, smartBy: 'ai', due: '2026-12-01' }]);
    expect(calls[1]).toMatchObject(['create', 'places', { name: 'Lyon', timeZone: 'Europe/Paris', by: 'ai' }]);
    expect(calls[2]).toEqual(['stay', null, { placeId: 'new0', from: '2026-11-02', to: '2026-11-02', note: '', by: 'ai' }]);
    expect(calls[3]).toMatchObject(['stay', null, { placeId: 'home' }]);
  });
  it('reorders steps within their existing slots', async () => {
    const p = planChanges(cs([{ op: 'task.reorder', ids: ['t2', 't1'] }]), snap(), gen);
    const { w, calls } = fakeWriter();
    await applyPlanned(p, () => true, w);
    expect(calls).toEqual([['update', 'tasks', 't2', { order: 1 }], ['update', 'tasks', 't1', { order: 2 }]]);
  });
});
