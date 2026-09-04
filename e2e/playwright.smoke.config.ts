import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/** Layer B: production smoke. No local server, one browser, seconds to run. */
const SYSTEM_CHROMIUM = '/usr/bin/chromium';
const useSystemChromium = !process.env['CI'] && existsSync(SYSTEM_CHROMIUM);

export default defineConfig({
  testDir: '.',
  testMatch: /smoke\.spec\.ts/,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 2,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env['PUBLIC_URL'] ?? 'https://rigorrun.pages.dev',
    trace: 'retain-on-failure',
    ...(useSystemChromium ? { launchOptions: { executablePath: SYSTEM_CHROMIUM } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
