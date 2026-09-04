import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Production API and system-state acceptance.
 *
 * One project: these assertions are about the deployed Worker and the engine,
 * neither of which depends on a viewport. Serial, because workspace creation is
 * rate limited by design.
 */
const SYSTEM_CHROMIUM = '/usr/bin/chromium';
const useSystemChromium = !process.env['CI'] && existsSync(SYSTEM_CHROMIUM);

export default defineConfig({
  testDir: '.',
  testMatch: /api\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env['PUBLIC_URL'] ?? 'https://rigorrun.pages.dev',
    trace: 'retain-on-failure',
    ...(useSystemChromium ? { launchOptions: { executablePath: SYSTEM_CHROMIUM } } : {}),
  },
  projects: [{ name: 'api', use: { ...devices['Desktop Chrome'] } }],
});
