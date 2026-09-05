#!/usr/bin/env node
/**
 * The executable, and nothing else.
 *
 * This file exists to be *parseable by every Node that might run it*. `engines`
 * in package.json produces a warning that npm prints and nobody reads, and if
 * the real bundle is loaded directly on an old runtime the failure is a syntax
 * error pointing at a minified line — which tells somebody nothing about what
 * to do.
 *
 * So: no optional chaining, no nullish coalescing, no top-level await, and the
 * bundle is reached through a dynamic import that only happens after the check
 * has passed.
 */
var MINIMUM = [20, 11];

function tooOld() {
  var parts = String(process.versions.node).split('.');
  var major = parseInt(parts[0], 10);
  var minor = parseInt(parts[1], 10);
  if (isNaN(major)) return false;
  if (major > MINIMUM[0]) return false;
  if (major < MINIMUM[0]) return true;
  return isNaN(minor) ? false : minor < MINIMUM[1];
}

if (tooOld()) {
  process.stderr.write(
    '\nRigorRun needs Node ' +
      MINIMUM.join('.') +
      ' or newer, and this is Node ' +
      process.versions.node +
      '.\n\n' +
      'Node 20 is the oldest release still receiving security fixes, and\n' +
      'RigorRun uses its built-in test-friendly fetch and stream APIs.\n\n' +
      'Install a newer Node from https://nodejs.org, or with a version manager:\n' +
      '  nvm install 22 && nvm use 22\n' +
      '  fnm install 22 && fnm use 22\n\n',
  );
  process.exit(2);
}

import('../dist/rigorrun.mjs').catch(function (error) {
  process.stderr.write('\nRigorRun could not start: ' + error.message + '\n');
  if (process.env.RIGORRUN_DEBUG) console.error(error);
  process.exit(2);
});
