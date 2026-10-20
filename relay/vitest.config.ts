import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// What wrangler's `rules` do in the Worker: a .md import is its text.
const markdownAsText = { name: 'markdown-as-text', transform: (code: string, id: string) => (id.endsWith('.md') ? `export default ${JSON.stringify(code)};` : undefined) };

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      markdownAsText,
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ALLOWED_ORIGINS: 'https://app.example,https://*.app-test.pages.dev,http://localhost:*',
            RELAY_URL: 'https://relay.test',
            CONNECTOR_WRAP_KEY: 'dGVzdC13cmFwLWtleS1mb3ItdGhlLXRlc3RzLW9ubHk=', // 32 bytes; a throwaway for tests
            VAPID_PUBLIC_KEY: 'BHj_zT3D5NS3lkq8lBUoPaEwB378tQ2Bro0LWn4Bm_WXy5ffwlJ5o_31_EJsN8jkUglHebA086yXZKuq2DZrEFI', // a throwaway pair for tests
            VAPID_PRIVATE_KEY: 'l49ay23HyFPmbj4lTnc0SOSUT4G04DFgR5Xa4FA-CoI',
            VAPID_SUBJECT: 'https://relay.test',
            PUSH_HOSTS: 'push.test,*.push.test,old.push.test,localhost:*', // the stub hosts of the push tests
            RATE_PUSH_NEW_IP_PER_MIN: '100000',
            RATE_PUSH_UPDATE_PER_MIN: '100000',
            RATE_PUSH_SCHEDULE_PER_MIN: '100000',
            RATE_PUSH_SEND_PER_MIN: '100000',
            RATE_IP_PER_MIN: '100000', // the rate-limit tests pass their own
            RATE_PAIR_IP_PER_MIN: '100000',
            RATE_PAIR_ALL_PER_MIN: '100000',
          },
        },
      }),
    ],
    resolve: { alias: { zod: new URL('./node_modules/zod', import.meta.url).pathname } },
    test: { include: ['test/**/*.test.ts'], setupFiles: ['./test/setup.ts'] },
  };
});
