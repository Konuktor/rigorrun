import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Visual regression against the local build.
 *
 * Snapshots are engine-specific, so this runs on one browser at two widths.
 * A tiny per-pixel tolerance absorbs font rasterisation differences without
 * hiding a real layout change.
 */
const SYSTEM_CHROMIUM = '/usr/bin/chromium';
const useSystemChromium = !process.env['CI'] && existsSync(SYSTEM_CHROMIUM);

export default defineConfig({
  testDir: '.',
  testMatch: /visual\.spec\.ts/,
  snapshotDir: './__screenshots__',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, threshold: 0.2, animations: 'disabled' },
  },
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
      command: 'pnpm -F @rigorrun/web dev',
      url: 'http://127.0.0.1:5173/',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
