import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * The fresh-user suite.
 *
 * Its own config because it needs its own everything: a runner serving the
 * product on a port it chose, a scratch home so no earlier project can make it
 * pass, and the customer's agent running as a separate process. Folding it into
 * the main config would mean either the demo suite carries this machinery or
 * this one inherits the demo's servers, and both are how a count stops meaning
 * what it says.
 *
 * There is no `webServer` here on purpose: the suite starts the runner itself,
 * because a person's first act is starting it and a test that skipped that
 * would be testing something a person cannot do.
 */
const SYSTEM_CHROMIUM = '/usr/bin/chromium';
const useSystemChromium = !process.env['CI'] && existsSync(SYSTEM_CHROMIUM);

export default defineConfig({
  testDir: '.',
  testMatch: /external-user\.spec\.ts/,
  // A real MCP handshake, a real compile and a real agent run all happen in
  // here. Generous, and still bounded.
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
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
