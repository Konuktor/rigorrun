import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Killing the runner and starting it again.
 *
 * Separate from the fresh-user config because it starts and stops the runner
 * several times inside one file, and because it deliberately corrupts a
 * workspace — neither of which belongs in the suite that measures whether a
 * stranger can get to a verdict.
 */
const SYSTEM_CHROMIUM = '/usr/bin/chromium';
const useSystemChromium = !process.env['CI'] && existsSync(SYSTEM_CHROMIUM);

export default defineConfig({
  testDir: '.',
  testMatch: /restart\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(useSystemChromium ? { launchOptions: { executablePath: SYSTEM_CHROMIUM } } : {}),
      },
    },
  ],
});
