import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/** Accessibility scans, run against the local build before deploying. */
const SYSTEM_CHROMIUM = '/usr/bin/chromium';
const useSystemChromium = !process.env['CI'] && existsSync(SYSTEM_CHROMIUM);

export default defineConfig({
  testDir: '.',
  testMatch: /a11y\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    ...(useSystemChromium ? { launchOptions: { executablePath: SYSTEM_CHROMIUM } } : {}),
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: [
    {
      command: 'pnpm -F @rigorrun/demo-crm dev',
      url: 'http://127.0.0.1:5174/',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm -F @rigorrun/app dev',
      url: 'http://127.0.0.1:5173/',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
