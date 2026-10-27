// The relay Worker. The OAuth library sits in front (connector sign-in: /oauth/*, the metadata
// documents, and the protected /mcp route); everything else reaches `handle`, which routes
// /v1/spaces/* to the sync and connector-switch handlers, with CORS, and serves /authorize.
// Push (/v1/push/*) and the feed's writes (/v1/feed/*) are routed the same way; the feed is read
// at /cal/<fid>.ics by calendar apps, which send no Origin and get no CORS (src/feed.ts). The
// cron (`scheduled`) sends the push notifications that are due (src/tick.ts).
import { handleAuthorize } from './connector/authorize';
import { handleConnector } from './connector/admin';
import { mcpHandler } from './connector/mcp';
import { oauthProvider } from './connector/oauth';
import { corsHeaders, originAllowed } from './cors';
import type { Env } from './env';
import { fail } from './http';
import { handleFeed, serveFeed } from './feed';
import { handleInbox } from './inbox';
import { handlePush, type Deps } from './push';
import { handleSync } from './sync';
import { runTick } from './tick';

const SYNC_ROUTE = /^\/v1\/spaces\/([^/]+)(?:\/(batches|changes|snapshot|devices|inbox)(?:\/([^/]+))?)?$/;
const PUSH_ROUTE = /^\/v1\/push\/([^/]+)(?:\/(schedule|send))?$/;
const FEED_ROUTE = /^\/v1\/feed\/([^/]+)(?:\/(alias))?$/;
const CAL_ROUTE = /^\/cal\/([^/]+)\.ics$/;
const CONNECTOR_ROUTE = /^\/v1\/spaces\/([^/]+)\/connector(?:\/(code))?$/;

function withCors(res: Response, origin: string | null): Response {
  if (!origin) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(corsHeaders(origin))) out.headers.set(k, v);
  return out;
}

export async function handle(req: Request, env: Env, deps?: Deps): Promise<Response> {
  const url = new URL(req.url);
  const sync = SYNC_ROUTE.exec(url.pathname);
  const connector = CONNECTOR_ROUTE.exec(url.pathname);
  const push = PUSH_ROUTE.exec(url.pathname);
  const feed = FEED_ROUTE.exec(url.pathname);
  const cal = CAL_ROUTE.exec(url.pathname);
  if (cal) return serveFeed(req, env, cal[1]!); // for calendar apps: no Origin check, no CORS
  if (sync || connector || push || feed) {
    // A browser sends Origin; only the app's origins may talk to the relay. Other clients send none.
    const origin = req.headers.get('Origin');
    if (origin && !originAllowed(origin, env)) return fail('origin_not_allowed', 403);
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), origin);
    if (feed) return withCors(await handleFeed(req, env, feed[1]!, feed[2]), origin);
    if (push) return withCors(await handlePush(req, env, push[1]!, push[2] ?? '', deps), origin);
    if (connector) return withCors(await handleConnector(req, env, connector[1]!, connector[2] ?? ''), origin);
    if (sync![2] === 'inbox') return withCors(await handleInbox(req, env, sync![1]!, sync![3]), origin);
    return withCors(await handleSync(req, env, sync![1]!, sync![2] ?? '', sync![3]), origin);
  }
  if (url.pathname === '/authorize') return handleAuthorize(req, env);
  if (url.pathname === '/' || url.pathname === '/health') return new Response('reussite relay', { headers: { 'Content-Type': 'text/plain' } });
  return fail('not_found', 404);
}

const handlers = { apiHandler: mcpHandler, defaultHandler: { fetch: (req: Request, env: Env) => handle(req, env) } };

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => oauthProvider(env, handlers).fetch(req, env, ctx),
  // Cron: every minute (wrangler.jsonc, triggers.crons).
  scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => { ctx.waitUntil(runTick(env, controller.scheduledTime)); },
} satisfies ExportedHandler<Env>;
