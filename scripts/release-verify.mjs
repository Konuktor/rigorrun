#!/usr/bin/env node
/**
 * Layer D — the release gate.
 *
 * Runs every check that must pass before a deploy, in the order that fails
 * fastest, and exits non-zero if any required stage fails. Stages are not
 * skipped on failure by default: the whole picture is more useful than the
 * first error, and the summary at the end says exactly what broke.
 *
 *   pnpm release:verify              local gates only
 *   pnpm release:verify --prod       also run the production gates
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const includeProd = process.argv.includes('--prod');
const ESC = String.fromCharCode(27);
const dim = (t) => `${ESC}[90m${t}${ESC}[0m`;
const bold = (t) => `${ESC}[1m${t}${ESC}[0m`;
const green = (t) => `${ESC}[32m${t}${ESC}[0m`;
const red = (t) => `${ESC}[31m${t}${ESC}[0m`;

/** Local gates, in fail-fast order. */
const LOCAL = [
  ['contrast', 'node', ['scripts/check-contrast.mjs'], 'design tokens meet WCAG contrast'],
  ['lint', 'pnpm', ['lint'], 'eslint'],
  ['domain', 'node', ['scripts/check-domain-leak.mjs'], 'no workflow leaked into generic code'],
  ['typecheck', 'pnpm', ['typecheck'], 'tsc --noEmit'],
  ['unit', 'pnpm', ['test'], 'unit and integration tests'],
  ['build', 'pnpm', ['build'], 'all apps and the CLI build'],
  ['e2e', 'pnpm', ['e2e'], 'local end-to-end journeys'],
  ['e2e:external', 'pnpm', ['e2e:external'], 'a stranger goes from nothing to a verdict'],
  ['e2e:restart', 'pnpm', ['e2e:restart'], 'their work survives the runner being killed'],
  ['a11y', 'pnpm', ['a11y'], 'WCAG A/AA scans'],
  ['visual', 'pnpm', ['visual'], 'visual regression'],
  ['cross', 'pnpm', ['cross'], 'critical path on chromium and firefox'],
  ['proof', 'node', ['scripts/build-proof.mjs'], 'the evidence page regenerates from real runs'],
];

/** Production gates, only meaningful after a deploy. */
const PROD = [
  ['smoke:prod', 'pnpm', ['smoke:prod'], 'production smoke'],
  ['e2e:prod', 'pnpm', ['e2e:prod'], 'production journeys at 1440 / 820 / 390'],
  ['perf:prod', 'pnpm', ['perf:prod'], 'Core Web Vitals and layout-shift budgets'],
];

const stages = includeProd ? [...LOCAL, ...PROD] : LOCAL;
const results = [];

for (const [name, command, args, description] of stages) {
  process.stdout.write(`\n${bold(`▸ ${name}`)} ${dim(description)}\n`);
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('exit', (exitCode) => resolve(exitCode ?? 1));
  });
  results.push({ name, code, ms: Date.now() - started });
}

process.stdout.write(`\n${bold('Release verification')}\n`);
for (const { name, code, ms } of results) {
  const status = code === 0 ? green('pass') : red('FAIL');
  process.stdout.write(`  ${status}  ${name.padEnd(12)} ${dim(`${(ms / 1000).toFixed(1)}s`)}\n`);
}

const failed = results.filter((r) => r.code !== 0);
if (failed.length > 0) {
  process.stdout.write(
    `\n${red(`${failed.length} gate(s) failed:`)} ${failed.map((f) => f.name).join(', ')}\n`,
  );
  if (!includeProd) {
    process.stdout.write(dim('Production gates were not run. Add --prod after deploying.\n'));
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `\n${green('All gates passed.')}${includeProd ? '' : dim(' Deploy, then re-run with --prod.')}\n`,
  );
}
