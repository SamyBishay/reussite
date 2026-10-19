import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4174', trace: 'retain-on-failure' },
  // The app is built for a relay on this computer; the relay (Worker + local D1, no Cloudflare account) starts beside it.
  webServer: [
    { command: 'VITE_RELAY_URL=http://localhost:8787 npm run build && npx vite preview --port 4174 --strictPort', url: 'http://localhost:4174', reuseExistingServer: false, timeout: 120_000 },
    // The connector needs its wrap secret: a throwaway for these tests (32 bytes, base64), and the relay's own address.
    { command: 'npm run relay:migrate && npm run relay:dev -- --var CONNECTOR_WRAP_KEY:ZTJlLXRlc3Qtd3JhcC1rZXktbm90LXNlY3JldC0wMDE= --var RELAY_URL:http://localhost:8787', url: 'http://localhost:8787/health', reuseExistingServer: false, timeout: 120_000, env: { WRANGLER_SEND_METRICS: 'false' } },
  ],
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    // Android phones run Chrome; not part of the default run.
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
});
