import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * QA against the deployed public site.
 *
 * No webServer: this config never starts anything locally, so a pass here is
 * evidence about the real deployment rather than about a dev server.
 */
const SYSTEM_CHROMIUM = '/usr/bin/chromium';
const useSystemChromium = !process.env['CI'] && existsSync(SYSTEM_CHROMIUM);

export const PUBLIC_URL = process.env['PUBLIC_URL'] ?? 'https://rigorrun.xyz';

export default defineConfig({
  testDir: '.',
  testMatch: /site\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: PUBLIC_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(useSystemChromium ? { launchOptions: { executablePath: SYSTEM_CHROMIUM } } : {}),
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'tablet-820',
      use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 } },
    },
    {
      name: 'mobile-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
});
