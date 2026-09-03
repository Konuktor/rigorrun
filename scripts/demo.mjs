#!/usr/bin/env node
/**
 * `pnpm demo` — the whole product, offline, in one command.
 *
 * It runs the real pipeline in the terminal first (so the result is visible
 * even on a machine with no browser), then starts the two local apps. No
 * account, no API key, no network access is required at any point.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ESC = String.fromCharCode(27);
const dim = (text) => `${ESC}[90m${text}${ESC}[0m`;
const bold = (text) => `${ESC}[1m${text}${ESC}[0m`;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

console.log(`
${bold('RigorRun')} — Do the job once. Test every agent forever.
${dim('Running the full pipeline offline: trace → contract → benchmark → agents → verdict.')}
`);

const tsx = join(root, 'node_modules', '.bin', 'tsx');
const cliExit = await run(tsx, [join(root, 'packages', 'cli', 'src', 'bin.ts'), 'demo', '--quiet']);

if (cliExit !== 0) {
  console.error('\nThe offline demo did not complete. See the error above.');
  process.exit(cliExit);
}

console.log(`
${bold('Starting the local apps')}
${dim('  RigorRun dashboard   http://127.0.0.1:5173')}
${dim('  Northstar Support    http://127.0.0.1:5174   (the app you record)')}

${dim('Open the dashboard and press "Run the live demo". Ctrl+C to stop.')}
`);

const dev = spawn('pnpm', ['dev'], { cwd: root, stdio: 'inherit' });
const stop = () => {
  dev.kill('SIGINT');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
dev.on('exit', (code) => process.exit(code ?? 0));
