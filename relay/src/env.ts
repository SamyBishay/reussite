// The Worker's bindings. Secrets (CONNECTOR_WRAP_KEY, VAPID…) are added here as they arrive.
export interface Env {
  DB: D1Database;
  /** Comma-separated origins; `*` matches one DNS label or one port. */
  ALLOWED_ORIGINS: string;
  /** Writes per space per minute (default 60) and writes plus failed sign-ins per IP per minute (default 120). */
  RATE_SPACE_PER_MIN?: string;
  RATE_IP_PER_MIN?: string;
}
