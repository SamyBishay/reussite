// The whole path an AI app takes: switch on in the app, register, sign in with the pairing code,
// initialize, and read what a simulated app device wrote.
import { describe, expect, it } from 'vitest';
import { initialize, newApp, rpc, signIn, switchOn, tool } from './connector';
import { BASE } from './helpers';

const TODAY = new Date().toISOString().slice(0, 10);

async function appWithList() {
  const app = await newApp();
  app.device.add('meta', 'settings', { dayStart: '00:00', urgencyDays: 21 });
  app.device.add('projects', 'p1', { name: 'Choir', suit: 'H', where: 'any', goal: 'Sing', goalBy: null, due: null, order: 1, status: 'active' });
  app.device.add('tasks', 't1', { title: 'Open Mail and reply to the agency', project: 'p1', suit: 'H', kind: 'task', urgent: false, important: true, due: null, est: 10, status: 'open', where: 'any', template: false, note: '', order: 1, carried: 0 });
  app.device.add('days', TODAY, { date: TODAY, plan: ['t1'], launches: [{ t: '09:30', k: 'start' }], first: null, checkin: null, closed: null, summary: null });
  await app.sync();
  return app;
}

describe('the connector end to end', () => {
  it('serves the discovery documents Claude needs', async () => {
    const res = await (await import('cloudflare:workers')).exports.default.fetch(new Request(BASE + '/.well-known/oauth-authorization-server'));
    expect(res.status).toBe(200);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.registration_endpoint).toBe(BASE + '/oauth/register');
    expect(meta.code_challenge_methods_supported).toContain('S256');
    const prm = await (await import('cloudflare:workers')).exports.default.fetch(new Request(BASE + '/.well-known/oauth-protected-resource/mcp'));
    expect(prm.status).toBe(200);
    expect(((await prm.json()) as { resource: string }).resource).toBe(BASE + '/mcp');
    const noToken = await rpc(null, 'initialize');
    expect(noToken.status).toBe(401);
    expect(noToken.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
  });

  it('registers, signs in with the pairing code, and reads what the app wrote', async () => {
    const app = await appWithList();
    const on = await switchOn(app);
    expect(on.status).toBe(201);
    expect(on.body).toMatchObject({ on: true, url: BASE + '/mcp' });
    expect(on.body.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const { access } = await signIn(on.body.code);
    const init = await initialize(access);
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('reussite');
    expect(init.body.result.instructions).toContain('get_method');

    const list = await rpc(access, 'tools/list');
    expect(list.body.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(
      ['apply_changes', 'get_day', 'get_decision', 'get_method', 'get_project', 'get_task', 'query_tasks', 'today', 'undo'],
    );

    const today = await tool(access, 'today');
    expect(today.isError).toBe(false);
    console.log(today.text); expect(today.text).toContain(`Today is`);
    expect(today.text).toContain('t1 | Open Mail and reply to the agency');
    expect(today.text).toContain('09:30 start');
  });
});
