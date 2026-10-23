import { defineConfig, devices } from '@playwright/test';

// The manual's screenshots (docs/dev/manual.md): `npm run manual:shots`. One browser, a build for a relay on this computer
// (so Settings shows the sync section; nothing talks to it), and its own port so it can run beside the end-to-end tests.
const PORT = 4175;
export default defineConfig({
  testDir: 'tests/manual',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, storageState: { cookies: [], origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'reussite.onboarded', value: '1' }] }] } },
  webServer: { command: `VITE_RELAY_URL=http://localhost:8787 npm run build && npx vite preview --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: false, timeout: 120_000 },
  projects: [{ name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: { 'media.volume_scale': '0.0' } } } }],
});
