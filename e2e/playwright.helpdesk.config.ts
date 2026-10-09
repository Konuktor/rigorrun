import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// This suite launches the public CLI itself, with a fresh workspace and real twin.
const chromium = '/usr/bin/chromium';
export default defineConfig({
  testDir: '.',
  testMatch: /helpdesk-onboarding\.spec\.ts/,
  timeout: 150_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: '/tmp/rigorrun-helpdesk-browser-results',
  use: { actionTimeout: 10_000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(!process.env['CI'] && existsSync(chromium)
          ? { launchOptions: { executablePath: chromium } }
          : {}),
      },
    },
  ],
});
