import { defineConfig, devices } from '@playwright/test';
// Runs the app on the real export in private/. Reports counts and errors only, never contents.
export default defineConfig({
  testDir: 'tests/private',
  testMatch: '*.pw.ts',
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4174' },
  webServer: { command: 'npm run build && npx vite preview --port 4174 --strictPort', url: 'http://localhost:4174', reuseExistingServer: false },
  projects: [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }],
});
