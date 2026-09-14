#!/usr/bin/env node
/**
 * N-1's numbers, generated from its evidence only, and checked wherever prose quotes them.
 *
 *   node aggregate-n1.mjs          # writes remediation/n1/results.json
 *   node aggregate-n1.mjs --check  # regenerates and compares, then checks every
 *                                  # <!-- n1:KEY -->value<!-- /n1 --> in remediation/*.md,
 *                                  # remediation/n1/*.md and remediation/heldout-worktide-v2/*.md
 *
 * Evidence read: n1/after-fix.json (EH-WT-03 and the sanity cases at the fixed
 * commit), heldout-worktide-v2/{cases,results,freeze}.json, n1/evidence/full-test.log,
 * n1/evidence/tests-before-fix.log, n1/evidence/results-inprocess.json. A missing
 * input is recorded as null, never as zero.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const N1 = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REMEDIATION = resolve(N1, '..');
const V2 = join(REMEDIATION, 'heldout-worktide-v2');
const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const text = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

function suite(log) {
  if (log === null) return null;
  const tests = /Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/.exec(log);
  const files = /Test Files\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/.exec(log);
  if (!tests) return null;
  return {
    failed: Number(tests[1] ?? 0),
    passed: Number(tests[2]),
    total: Number(tests[3]),
    files: files ? Number(files[3]) : null,
    filesFailed: files ? Number(files[1] ?? 0) : null,
  };
}

function attemptsOf(afterFix, id) {
  const attempts = (afterFix?.attempts ?? []).filter((a) => a.id === id);
  const is = (outcome) => attempts.filter((a) => a.actual === outcome).length;
  return {
    attempts: attempts.length,
    completed: is('PASS') + is('FAIL'),
    fail: is('FAIL'),
    pass: is('PASS'),
    timedOut: is('TIMED_OUT'),
    abstain: is('ABSTAIN'),
    oracleFail: attempts.filter((a) => a.oracle === 'FAIL').length,
    duplicateStaged: attempts.filter((a) => a.oracleState?.actualUnassignedDelta === 2).length,
  };
}

// The final measurement, when there is one, is the one reported; the first stays on record in after-fix.json.
const firstFix = read(join(N1, 'after-fix.json'));
const afterFix = read(join(N1, 'after-fix-final.json')) ?? firstFix;
const v2Results = read(join(V2, 'results.json'));
const v2Cases = read(join(V2, 'cases.json'));
const freeze = read(join(V2, 'freeze.json'));
const inprocess = read(join(N1, 'evidence', 'results-inprocess.json'));

const results = {
  commit: afterFix?.rigorrunCommit ?? null,
  measurement: afterFix?.measurement ?? null,
  FIRST_MEASUREMENT: firstFix && firstFix !== afterFix ? { commit: firstFix.rigorrunCommit, EH_WT_03: attemptsOf(firstFix, 'EH-WT-03') } : null,
  EH_WT_03: afterFix ? attemptsOf(afterFix, 'EH-WT-03') : null,
  EH_WT_01: afterFix ? attemptsOf(afterFix, 'EH-WT-01') : null,
  EH_WT_02: afterFix ? attemptsOf(afterFix, 'EH-WT-02') : null,
  V2: v2Cases
    ? {
        defined: v2Cases.length,
        knownGood: v2Cases.filter((c) => c.truth === 'KNOWN_GOOD').length,
        knownBad: v2Cases.filter((c) => c.truth === 'KNOWN_BAD').length,
        frozenAt: freeze?.frozenAt ?? null,
        commit: v2Results?.rigorrunCommit ?? null,
        gate: v2Results?.blocks?.gate ?? null,
        sideChannel: v2Results?.blocks?.['side-channel'] ?? null,
        limitProbe: v2Results?.blocks?.['limit-probe'] ?? null,
      }
    : null,
  TESTS: suite(text(join(N1, 'evidence', 'full-test.log'))),
  TESTS_BEFORE_FIX: suite(text(join(N1, 'evidence', 'tests-before-fix.log'))),
  INPROCESS: inprocess?.totals ?? null,
};

const out = join(N1, 'results.json');
if (process.argv.includes('--check')) {
  const expected = JSON.stringify(results, null, 2);
  const actual = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (actual.trim() !== expected.trim()) {
    console.error('n1/results.json is stale: regenerate with node remediation/n1/scripts/aggregate-n1.mjs');
    process.exit(1);
  }
  const flat = {};
  const walk = (value, path) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
    else flat[path] = value;
  };
  walk(results, '');
  let checked = 0;
  let bad = 0;
  for (const dir of [REMEDIATION, N1, V2]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.md'))) {
      for (const m of readFileSync(join(dir, file), 'utf8').matchAll(/<!-- n1:([^ ]+) -->([^<]*)<!-- \/n1 -->/g)) {
        checked += 1;
        if (flat[m[1]] === undefined || String(flat[m[1]]) !== m[2].trim()) {
          bad += 1;
          console.error(`${file}: n1:${m[1]} is "${m[2].trim()}" in prose, ${flat[m[1]]} in n1/results.json`);
        }
      }
    }
  }
  console.log(`n1/results.json verified; ${checked} numbers checked in prose, ${bad} mismatches`);
  process.exit(bad ? 1 : 0);
} else {
  writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
  console.log(`n1/results.json written: EH-WT-03 ${JSON.stringify(results.EH_WT_03)}; tests ${JSON.stringify(results.TESTS)}`);
}
