// Types for `cloudflare:workers` in tests: the bindings and the Worker's default export.
import type { D1Migration } from '@cloudflare/vitest-plugin';

declare global {
  namespace Cloudflare {
    interface GlobalProps { mainModule: typeof import('../src/index') }
    interface Env {
      DB: D1Database;
      ALLOWED_ORIGINS: string;
      RATE_SPACE_PER_MIN?: string;
      RATE_IP_PER_MIN?: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
