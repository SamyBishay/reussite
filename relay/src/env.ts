// The Worker's bindings. Secrets (CONNECTOR_WRAP_KEY, VAPID_PRIVATE_KEY) are never in wrangler.jsonc.
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
  /** VAPID (RFC 8292, docs/dev/push.md). The public key is the 65-byte point in base64url, the same value as the app's VITE_VAPID_PUBLIC_KEY. */
  VAPID_PUBLIC_KEY: string;
  /** Secret: the private scalar `d`, base64url (32 bytes). Made by `scripts/vapid-keygen.mjs`; never logged. */
  VAPID_PRIVATE_KEY?: string;
  /** `sub` of the VAPID token: the relay's https address, so nothing personal reaches a push service. */
  VAPID_SUBJECT: string;
  /** Comma-separated hosts a push endpoint may have: `host`, `*.suffix` (one or more labels), with `:port` or `:*` for the local tests only. */
  PUSH_HOSTS: string;
  /** Push, per minute: new devices per IP (default 5), register updates per device (10), schedule writes per device (10), test sends per device (3). */
  RATE_PUSH_NEW_IP_PER_MIN?: string;
  RATE_PUSH_UPDATE_PER_MIN?: string;
  RATE_PUSH_SCHEDULE_PER_MIN?: string;
  RATE_PUSH_SEND_PER_MIN?: string;
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
