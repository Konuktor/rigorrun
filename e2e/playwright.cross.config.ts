import { defineConfig, devices } from '@playwright/test';
import { execSync } from 'node:child_process';

/**
 * WebKit needs host libraries (libicu, libxml2, libjpeg-turbo) that Playwright
 * cannot install without root. Rather than let a machine limitation look like a
 * product failure — or, worse, silently drop an engine — we detect it and say
 * so. CI installs the dependencies, so all three engines run there.
 */
function webkitCanLaunch(): boolean {
  if (process.env['PW_SKIP_WEBKIT']) return false;
  if (process.env['CI']) return true; // CI installs the dependencies.
  try {
    // Actually launch it. Inferring from library names is unreliable: the
    // libraries are present but at versions WebKit does not accept.
    execSync(`node -e "require('@playwright/test').webkit.launch().then(b => b.close())"`, {
      stdio: 'ignore',
      timeout: 60_000,
    });
    return true;
  } catch {
    return false;
  }
}

const includeWebkit = webkitCanLaunch();
if (!includeWebkit) {
  console.warn(
    '[cross-browser] WebKit skipped: host is missing its system libraries ' +
      '(sudo npx playwright install-deps). Chromium and Firefox still run.',
  );
}

/**
 * Cross-browser verification of the critical path.
 *
 * The bundled Playwright browsers are used here rather than the system
 * Chromium, so all three engines are the versions Playwright ships and the
 * result is reproducible.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /critical\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env['PUBLIC_URL'] ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    ...(includeWebkit ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }] : []),
  ],
  // Against a deployed URL there is nothing to start locally.
  ...(process.env['PUBLIC_URL']
    ? {}
    : {
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
      }),
});
