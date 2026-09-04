#!/usr/bin/env node
/**
 * Captures the submission screenshots from the real, deployed application.
 *
 * Nothing here is mocked or composited: the script drives the live site, runs
 * the actual benchmark in the browser, and photographs what a reviewer sees.
 *
 *   node scripts/capture-assets.mjs [baseUrl] [outDir]
 */
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const BASE = process.argv[2] ?? 'https://rigorrun.pages.dev';
const OUT = resolve(process.argv[3] ?? 'docs/submission-assets');
const SYSTEM_CHROMIUM = '/usr/bin/chromium';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch(
  existsSync(SYSTEM_CHROMIUM) ? { executablePath: SYSTEM_CHROMIUM } : {},
);
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(message.text());
});

const shot = async (name, options = {}) => {
  // Animations settle before the shutter so nothing is caught mid-transition.
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, name), animations: 'disabled', ...options });
  console.log(`captured ${name}`);
};

console.log(`capturing from ${BASE}`);

// 01 — landing
await page.goto(BASE, { waitUntil: 'networkidle' });
await shot('01-landing.png');

// 02 — the contract, with observed and inferred side by side
await page.getByTestId('cta-run-demo').click();
await page.getByTestId('step-compile').click();
await page.getByRole('heading', { name: /One recording does not reveal a policy/ }).waitFor();
await shot('02-contract.png', { fullPage: true });

// 03 — the benchmark, with the injection case expanded to show public vs private
await page.getByTestId('step-generate').click();
await page.getByTestId('case-row-case_prompt-injection').click();
const privateLabel = page.getByText(/Private verifier — never sent to the agent/);
await privateLabel.waitFor();
await privateLabel.scrollIntoViewIfNeeded();
await shot('03-benchmark.png');

// 04 — the verdict, from a run that just executed in this browser
await page.getByTestId('step-run').click();
await page.getByTestId('verdict').waitFor({ timeout: 120_000 });
await page.evaluate(() => window.scrollTo({ top: 0 }));
await shot('04-verdict.png', { fullPage: true });

// 05 — the evidence for the injection case
await page.getByTestId('cell-demo-weak-case_prompt-injection').click();
await page.getByTestId('evidence-drawer').waitFor();
await page.getByText('policy_forbid_over_limit FAIL').waitFor();
await shot('05-injection-evidence.png');

if (problems.length > 0) {
  console.error('page problems encountered:', problems);
  process.exitCode = 1;
} else {
  console.log('no console or page errors during capture');
}

await browser.close();
