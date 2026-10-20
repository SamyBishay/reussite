import { defineConfig, devices } from '@playwright/test';
import { E2E_VAPID } from './tests/e2e/vapid';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  // Every test starts as a device that has been through onboarding (its record in localStorage); tests of onboarding itself ask for a new one.
  use: { baseURL: 'http://localhost:4174', trace: 'retain-on-failure', storageState: { cookies: [], origins: [{ origin: 'http://localhost:4174', localStorage: [{ name: 'reussite.onboarded', value: '1' }] }] } },
  // The app is built for a relay on this computer; the relay (Worker + local D1, no Cloudflare account) starts beside it.
  webServer: [
    { command: `VITE_RELAY_URL=http://localhost:8787 VITE_VAPID_PUBLIC_KEY=${E2E_VAPID.publicKey} npm run build && npx vite preview --port 4174 --strictPort`, url: 'http://localhost:4174', reuseExistingServer: false, timeout: 120_000 },
    // The connector needs its wrap secret: a throwaway for these tests (32 bytes, base64), and the relay's own address.
    // Push needs a VAPID pair (a throwaway too, the app is built with its public half) and a push-host list that
    // allows only this computer, where the tests' push stub listens (http, any port): no real push service is reachable.
    // The push tests run in parallel from one address and register a device each, so the per-address limits are raised.
    { command: `npm run relay:migrate && npm run relay:dev -- --var CONNECTOR_WRAP_KEY:ZTJlLXRlc3Qtd3JhcC1rZXktbm90LXNlY3JldC0wMDE= --var RELAY_URL:http://localhost:8787 --var VAPID_PUBLIC_KEY:${E2E_VAPID.publicKey} --var VAPID_PRIVATE_KEY:${E2E_VAPID.privateKey} --var VAPID_SUBJECT:http://localhost:8787 --var 'PUSH_HOSTS:localhost:*,127.0.0.1:*' --var RATE_PUSH_NEW_IP_PER_MIN:200 --var RATE_PUSH_SCHEDULE_PER_MIN:60 --var RATE_PUSH_SEND_PER_MIN:60 --var RATE_IP_PER_MIN:1000 --var RATE_FEED_NEW_IP_PER_MIN:1000 --var RATE_FEED_MISS_PER_MIN:1000`, url: 'http://localhost:8787/health', reuseExistingServer: false, timeout: 120_000, env: { WRANGLER_SEND_METRICS: 'false' } },
  ],
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    // Android phones run Chrome; not part of the default run.
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
});
