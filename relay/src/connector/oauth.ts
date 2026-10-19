// The OAuth provider's configuration, and the two places the rest of the relay needs its helpers:
// the /authorize page and switching the connector off (revoking every grant of a space at once).
// The provider is built once per relay address (RELAY_URL), because the protected resource's
// identifier must be an absolute URL.
import { getOAuthApi, OAuthProvider, type OAuthHelpers, type OAuthProviderOptions } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../env';

/** A grant lives while the AI app keeps using it; after three months of silence, pair again. */
const IDLE_SECONDS = 90 * 24 * 3600;

export const MCP_PATH = '/mcp';

export function providerOptions(env: Env, handlers: Pick<OAuthProviderOptions<Env>, 'apiHandler' | 'defaultHandler'>): OAuthProviderOptions<Env> {
  const base = env.RELAY_URL.replace(/\/+$/, '');
  return {
    ...handlers,
    apiRoute: MCP_PATH,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    // Dynamic client registration: AI apps register themselves (Claude's callbacks are
    // https://claude.ai/api/mcp/auth_callback and https://claude.com/api/mcp/auth_callback).
    clientRegistrationEndpoint: '/oauth/register',
    refreshTokenIdleTTL: IDLE_SECONDS,
    resourceMetadata: { resource: base + MCP_PATH, authorization_servers: [base], resource_name: 'Réussite' },
  };
}

let provider: { url: string; instance: OAuthProvider<Env> } | undefined;
/** The provider for this relay address (built on first use, then reused by the isolate). */
export function oauthProvider(env: Env, handlers: Pick<OAuthProviderOptions<Env>, 'apiHandler' | 'defaultHandler'>): OAuthProvider<Env> {
  if (provider?.url !== env.RELAY_URL) provider = { url: env.RELAY_URL, instance: new OAuthProvider<Env>(providerOptions(env, handlers)) };
  return provider.instance;
}

const noHandler = { fetch: () => new Response(null, { status: 404 }) };
/** The OAuth helpers (clients, grants, consent) for code that isn't inside the provider's own dispatch. */
export const oauthApi = (env: Env): OAuthHelpers => env.OAUTH_PROVIDER ?? getOAuthApi(providerOptions(env, { apiHandler: noHandler, defaultHandler: noHandler }), env);

/** Revoke every grant, and so every token, of a space. Returns how many grants there were. */
export async function revokeConnector(env: Env, space: string): Promise<number> {
  if (!env.OAUTH_KV) return 0;
  const api = oauthApi(env);
  let revoked = 0;
  let cursor: string | undefined;
  do {
    const page = await api.listUserGrants(space, { cursor, limit: 100 });
    for (const g of page.items) { await api.revokeGrant(g.id, space); revoked++; }
    cursor = page.cursor;
  } while (cursor);
  return revoked;
}
