// Types for `cloudflare:workers` in tests: the bindings and the Worker's default export.
import type { D1Migration } from '@cloudflare/vitest-plugin';

declare global {
  namespace Cloudflare {
    interface GlobalProps { mainModule: typeof import('../src/index') }
    interface Env {
      DB: D1Database;
      OAUTH_KV: KVNamespace;
      ALLOWED_ORIGINS: string;
      RELAY_URL: string;
      CONNECTOR_WRAP_KEY: string;
      RATE_SPACE_PER_MIN?: string;
      RATE_IP_PER_MIN?: string;
      RATE_PAIR_IP_PER_MIN?: string;
      RATE_PAIR_ALL_PER_MIN?: string;
      RATE_INBOX_IP_PER_MIN?: string;
      RATE_INBOX_SPACE_PER_MIN?: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
