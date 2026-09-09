import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Performance budgets against the deployed site.
 *
 * Its own config because it must not run in parallel with anything: a shared
 * machine under load produces numbers about the machine, not about the site.
 * Three cold measurements are taken per metric and the median is asserted, so
 * one unlucky sample cannot fail the gate and one lucky one cannot pass it.
 */
const SYSTEM_CHROMIUM = '/usr/bin/chromium';
const useSystemChromium = !process.env['CI'] && existsSync(SYSTEM_CHROMIUM);

export default defineConfig({
  testDir: '.',
  testMatch: /perf\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env['PUBLIC_URL'] ?? 'https://rigorrun.xyz',
    trace: 'retain-on-failure',
    ...(useSystemChromium ? { launchOptions: { executablePath: SYSTEM_CHROMIUM } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
});
