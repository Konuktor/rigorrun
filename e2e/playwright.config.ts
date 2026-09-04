import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * The bundled Playwright browser is used when present; otherwise we fall back
 * to the system Chromium so a clean clone can still run the E2E suite without
 * a download.
 */
const SYSTEM_CHROMIUM = '/usr/bin/chromium';
const useSystemChromium = !process.env['CI'] && existsSync(SYSTEM_CHROMIUM);

export default defineConfig({
  testDir: '.',
  // The public suite runs against the deployed URL and has its own config, so
  // the two never mix and each count means what it says.
  // Each layer has its own config so every count means what it says.
  testIgnore: /(public|prod|smoke|a11y|visual|critical|perf|api)\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
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
  webServer: [
    {
      command: 'pnpm -F @rigorrun/demo-crm dev',
      url: 'http://127.0.0.1:5174/',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm -F @rigorrun/web dev',
      url: 'http://127.0.0.1:5173/',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
