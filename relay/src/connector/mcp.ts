// /mcp: the protected route. The OAuth library has already checked the token and hands us the
// space it was issued for (props.spaceId). Every call updates the connector's last-used time, and
// fails clearly if the connector has been switched off (the stored key is gone).
import { AsyncLocalStorage } from 'node:async_hooks';
import { createMcpHandler } from 'agents/mcp/server';
import type { Env } from '../env';
import { buildServer, type Row } from './tools';

export const OFF_MESSAGE = 'The connector is switched off in Réussite. Switch it on again in Settings, then Connector, and pair this app with the new code.';

interface Call { env: Env; space: string; row: Row }
const current = new AsyncLocalStorage<Call>();

// Built once per isolate; the server (and its tools) is built per request from the call in flight.
let handler: ReturnType<typeof createMcpHandler> | undefined;
let hostname = '';
function mcp(env: Env) {
  const host = new URL(env.RELAY_URL).hostname;
  if (!handler || host !== hostname) {
    hostname = host;
    handler = createMcpHandler(() => {
      const c = current.getStore()!;
      return buildServer(c.env, c.space, c.row);
    }, { route: '/mcp', corsOptions: false, responseMode: 'json', allowedHostnames: [host] });
  }
  return handler;
}

export const mcpHandler = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const space = (ctx as { props?: { spaceId?: string } }).props?.spaceId;
    // One statement both checks that the connector is on and records the call.
    const row = space
      ? await env.DB.prepare('UPDATE connector SET last_used = ?1 WHERE space = ?2 RETURNING wrapped, hlc_wall AS wall, hlc_counter AS counter').bind(Date.now(), space).first<Row>()
      : null;
    if (!space || !row) {
      return Response.json({ jsonrpc: '2.0', error: { code: -32001, message: OFF_MESSAGE }, id: null }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    return current.run({ env, space, row }, () => mcp(env)(req, env, ctx));
  },
};
