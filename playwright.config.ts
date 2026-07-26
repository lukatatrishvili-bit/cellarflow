import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT || 4173);
const baseURL = `http://127.0.0.1:${port}`;
const localBrowserChannel = process.env.CI ? {} : { channel: 'msedge' as const };

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results/playwright-artifacts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(port),
      NODE_ENV: 'development',
      E2E_TEST_MODE: 'true',
      DATABASE_URL: '',
      DATABASE_PATH: path.resolve('test-results/e2e-db.json'),
      GCS_BUCKET: '',
      SESSION_SECRET: 'e2e-browser-release-secret-at-least-32-bytes',
      DEMO_LOGIN_ENABLED: 'false',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...localBrowserChannel },
      testIgnore: /.*mobile\.spec\.ts/,
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], ...localBrowserChannel },
      testMatch: /.*mobile\.spec\.ts/,
    },
  ],
});
