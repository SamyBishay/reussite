// The relay Worker. The OAuth library sits in front (connector sign-in: /oauth/*, the metadata
// documents, and the protected /mcp route); everything else reaches `handle`, which routes
// /v1/spaces/* to the sync and connector-switch handlers, with CORS, and serves /authorize.
// Push and the calendar feed are added as further routes in `handle`; each is a function
// (req, env, ctx) => Response in its own file, tried before the 404 at the bottom.
import { handleAuthorize } from './connector/authorize';
import { handleConnector } from './connector/admin';
import { mcpHandler } from './connector/mcp';
import { oauthProvider } from './connector/oauth';
import { corsHeaders, originAllowed } from './cors';
import type { Env } from './env';
import { fail } from './http';
import { handleSync } from './sync';

const SYNC_ROUTE = /^\/v1\/spaces\/([^/]+)(?:\/(batches|changes|snapshot|devices)(?:\/([^/]+))?)?$/;
const CONNECTOR_ROUTE = /^\/v1\/spaces\/([^/]+)\/connector(?:\/(code))?$/;

function withCors(res: Response, origin: string | null): Response {
  if (!origin) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(corsHeaders(origin))) out.headers.set(k, v);
  return out;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const sync = SYNC_ROUTE.exec(url.pathname);
  const connector = CONNECTOR_ROUTE.exec(url.pathname);
  if (sync || connector) {
    // A browser sends Origin; only the app's origins may talk to the relay. Other clients send none.
    const origin = req.headers.get('Origin');
    if (origin && !originAllowed(origin, env)) return fail('origin_not_allowed', 403);
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), origin);
    if (connector) return withCors(await handleConnector(req, env, connector[1]!, connector[2] ?? ''), origin);
    return withCors(await handleSync(req, env, sync![1]!, sync![2] ?? '', sync![3]), origin);
  }
  if (url.pathname === '/authorize') return handleAuthorize(req, env);
  if (url.pathname === '/' || url.pathname === '/health') return new Response('reussite relay', { headers: { 'Content-Type': 'text/plain' } });
  return fail('not_found', 404);
}

const handlers = { apiHandler: mcpHandler, defaultHandler: { fetch: (req: Request, env: Env) => handle(req, env) } };

export default { fetch: (req: Request, env: Env, ctx: ExecutionContext) => oauthProvider(env, handlers).fetch(req, env, ctx) } satisfies ExportedHandler<Env>;
