// The relay Worker. Routes /v1/spaces/* to the sync handlers, with CORS. The connector (/mcp,
// /authorize…), push and the calendar feed are added as further routes here; each is a function
// (req, env, ctx) => Response in its own file, tried before the 404 at the bottom.
import { corsHeaders, originAllowed } from './cors';
import type { Env } from './env';
import { fail } from './http';
import { handleSync } from './sync';

const SYNC_ROUTE = /^\/v1\/spaces\/([^/]+)(?:\/(batches|changes|snapshot|devices)(?:\/([^/]+))?)?$/;

function withCors(res: Response, origin: string | null): Response {
  if (!origin) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(corsHeaders(origin))) out.headers.set(k, v);
  return out;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const sync = SYNC_ROUTE.exec(url.pathname);
  if (sync) {
    // A browser sends Origin; only the app's origins may talk to the relay. Other clients send none.
    const origin = req.headers.get('Origin');
    if (origin && !originAllowed(origin, env)) return fail('origin_not_allowed', 403);
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), origin);
    return withCors(await handleSync(req, env, sync[1]!, sync[2] ?? '', sync[3]), origin);
  }
  if (url.pathname === '/' || url.pathname === '/health') return new Response('reussite relay', { headers: { 'Content-Type': 'text/plain' } });
  return fail('not_found', 404);
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
