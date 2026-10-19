// The Worker's bindings. Secrets (CONNECTOR_WRAP_KEY, VAPID…) are added here as they arrive.
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface Env {
  DB: D1Database;
  /** Connector sign-ins: the OAuth library's clients, grants and tokens. */
  OAUTH_KV: KVNamespace;
  /** Set by the OAuth library on requests it hands to our handlers. */
  OAUTH_PROVIDER?: OAuthHelpers;
  /** Comma-separated origins; `*` matches one DNS label or one port. */
  ALLOWED_ORIGINS: string;
  /** The relay's public address without a trailing slash: the connector's OAuth issuer and `/mcp` URL. */
  RELAY_URL: string;
  /** Secret: base64 of 32 random bytes. Wraps the space keys the connector holds. Never logged. */
  CONNECTOR_WRAP_KEY: string;
  /** Writes per space per minute (default 60) and writes plus failed sign-ins per IP per minute (default 120). */
  RATE_SPACE_PER_MIN?: string;
  RATE_IP_PER_MIN?: string;
  /** Pairing-code attempts per IP per minute (default 10) and failed attempts overall per minute (default 60). */
  RATE_PAIR_IP_PER_MIN?: string;
  RATE_PAIR_ALL_PER_MIN?: string;
  /** Drop-page posts to an inbox per IP per minute (default 10) and per space per minute (default 20). */
  RATE_INBOX_IP_PER_MIN?: string;
  RATE_INBOX_SPACE_PER_MIN?: string;
}
