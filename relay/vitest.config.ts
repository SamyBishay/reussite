import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ALLOWED_ORIGINS: 'https://app.example,https://*.app-test.pages.dev,http://localhost:*',
            RATE_IP_PER_MIN: '100000', // the rate-limit tests pass their own
          },
        },
      }),
    ],
    test: { include: ['test/**/*.test.ts'], setupFiles: ['./test/setup.ts'] },
  };
});
