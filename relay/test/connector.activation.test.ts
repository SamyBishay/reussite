// Grants are bound to a connector activation (docs/dev/connector.md, "Activations"): a call and a write are accepted only
// while the connector's row still has the id the grant was paired under.
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyChanges, type Ctx } from '../src/connector/changes';
import { mcpHandler } from '../src/connector/mcp';
import { loadSpace } from '../src/connector/space';
import { View } from '../src/connector/view';
import type { Env } from '../src/env';
import { freshMinute } from './helpers';
import { initialize, newApp, signIn, switchOn, tool, type App } from './connector';

beforeEach(async () => { await freshMinute(); });
const activationOf = async (a: App) => (await env.DB.prepare('SELECT activation FROM connector WHERE space = ?1').bind(a.keys.spaceId).first<{ activation: string }>())!.activation;
const nBatches = async (a: App) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM batches WHERE space = ?1').bind(a.keys.spaceId).first<{ n: number }>())!.n;

describe('connector activations', () => {
  it('a fresh pairing works, under a new random id; switching on again while on keeps the id', async () => {
    const app = await newApp('actv0001');
    const { access } = await signIn((await switchOn(app)).body.code);
    const id = await activationOf(app);
    expect(id).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect((await initialize(access)).status).toBe(200);
    const again = await switchOn(app);
    expect(again.status).toBeLessThan(300);
    expect(await activationOf(app)).toBe(id);
    expect((await initialize(access)).status).toBe(200);
  });

  it('a grant of an earlier activation is refused even when OAuth still knows it', async () => {
    const app = await newApp('actv0002');
    const { access } = await signIn((await switchOn(app)).body.code);
    expect((await initialize(access)).status).toBe(200);
    // Switched off and on again, but the grant survived (revocation interrupted, or KV not yet consistent): only the row changes.
    await env.DB.prepare('UPDATE connector SET activation = ?2 WHERE space = ?1').bind(app.keys.spaceId, 'a-later-activation').run();
    expect((await initialize(access)).status).toBe(403);
    expect((await tool(access, 'today')).isError).toBe(true);
  });

  it('a row made before ids existed is "legacy", and a grant without an id is read as legacy', async () => {
    const app = await newApp('actv0003');
    await switchOn(app);
    await env.DB.prepare("UPDATE connector SET activation = 'legacy' WHERE space = ?1").bind(app.keys.spaceId).run(); // what the migration gives an existing row
    const call = (props: Record<string, string>) => mcpHandler.fetch(new Request('https://relay.test/mcp', {
      method: 'POST', headers: { Host: 'relay.test', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
    }), env as unknown as Env, { props } as never);
    expect((await call({ spaceId: app.keys.spaceId })).status).toBe(200); // paired before ids existed
    expect((await call({ spaceId: app.keys.spaceId, activation: 'legacy' })).status).toBe(200);
    expect((await call({ spaceId: app.keys.spaceId, activation: 'other' })).status).toBe(403);
  });

  it('a write already in progress when the connector is switched off writes nothing', async () => {
    const app = await newApp('actv0004');
    app.device.add('meta', 'settings', { dayStart: '00:00' });
    app.device.add('projects', 'p1', { name: 'Move', suit: 'C', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
    await app.sync();
    await switchOn(app);
    const row = (await env.DB.prepare('SELECT hlc_wall, hlc_counter, activation FROM connector WHERE space = ?1').bind(app.keys.spaceId).first<{ hlc_wall: number; hlc_counter: number; activation: string }>())!;
    const s = await loadSpace(env as unknown as Env, app.keys.spaceId, app.keys, { wall: row.hlc_wall, counter: row.hlc_counter }, null);
    s.activation = row.activation; // the request was accepted under this activation…
    s.own = new Set();
    const c: Ctx = { env: env as unknown as Env, s, v: new View(s.maps), full: async () => undefined };
    await env.DB.prepare('DELETE FROM connector WHERE space = ?1').bind(app.keys.spaceId).run(); // …and the connector is switched off before it writes
    const before = await nBatches(app);
    const r = await applyChanges(c, { changes: [{ op: 'task.create', set: { title: 'Too late', project: 'Move' } } as never] });
    expect(JSON.stringify(r)).toContain('switched off');
    expect(await nBatches(app)).toBe(before);
  });
});
