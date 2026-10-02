#!/usr/bin/env node
/**
 * The claims gate: public copy may state as fact only what docs/context/CLAIMS.md
 * lists as QUALIFIED or RECORDED.
 *
 * The rules live in CLAIMS.md itself (the `json claims-config` block), so the
 * ledger and the check cannot drift apart. A matching line passes when its
 * claim is allowed, when a hedge ("being built", "looking for", …) is on the
 * same line or the one beside it, or when the line carries `claims-ok`.
 * NEVER rules and rules marked noHedge ignore hedges.
 *
 *   node scripts/check-claims.mjs                 the site, docs, READMEs, CLI help
 *   node scripts/check-claims.mjs FILE…           those files as well (e.g. email templates)
 *   node scripts/check-claims.mjs --self-test     the rules against known-good and known-bad lines
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, extname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(root, 'docs', 'context', 'CLAIMS.md');

/** Where public copy lives. docs/context and docs/archive are about claims, not claims. */
const SCAN = [
  { dir: 'apps/site/src', ext: ['.astro', '.ts', '.tsx', '.md', '.mdx'] },
  { dir: 'apps/site/public', ext: ['.txt'] },
  { dir: 'apps/docs/src/content', ext: ['.md', '.mdx'] },
  { file: 'README.md' },
  { file: 'packages/cli/README.md' },
  { file: 'packages/cli/src/help.ts' },
];

function loadConfig() {
  const text = readFileSync(LEDGER, 'utf8');
  const match = text.match(/```json claims-config\n([\s\S]*?)\n```/);
  if (!match) throw new Error(`${relative(root, LEDGER)} has no \`json claims-config\` block.`);
  const config = JSON.parse(match[1]);
  const rules = config.rules.map((rule) => {
    const status = config.status[rule.claim];
    if (status === undefined) throw new Error(`Rule for ${rule.claim}: no status in the ledger.`);
    return { ...rule, status, regex: new RegExp(rule.pattern, 'i') };
  });
  return {
    allowed: new Set(config.allowed),
    hedges: config.hedges.map((h) => h.toLowerCase()),
    rules,
  };
}

function walk(dir, ext, out) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, ext, out);
    else if (ext.includes(extname(name))) out.push(path);
  }
  return out;
}

/** Every violation in one text: [{ line, claim, status, text }]. */
export function check(text, config) {
  const lines = text.split('\n');
  const found = [];
  const hedged = (index) =>
    [index - 1, index, index + 1].some((i) => {
      const line = (lines[i] ?? '').toLowerCase();
      return config.hedges.some((hedge) => line.includes(hedge));
    });
  lines.forEach((line, index) => {
    if (line.includes('claims-ok')) return;
    for (const rule of config.rules) {
      if (!rule.regex.test(line)) continue;
      if (config.allowed.has(rule.status)) continue;
      const noHedge = rule.status === 'NEVER' || rule.noHedge === true;
      if (!noHedge && hedged(index)) continue;
      found.push({ line: index + 1, claim: rule.claim, status: rule.status, text: line.trim() });
    }
  });
  return found;
}

function selfTest(config) {
  const bad = [
    'RigorRun never reads another customer’s data.',
    'Your agent never sends another customer’s records anywhere.',
    "It detects leaks of another tenant's records.",
    'Built with our design partners.',
    'Being built with design partners: reads and leaks.',
    'The first open-source tool for agent permissions.',
    'Plant a canary in tenant B and watch for leaks.',
    'Works with QuickBooks and NetSuite.',
    'RigorRun catches what LLM judges miss.',
    'RigorRun guarantees your agent is safe.',
  ];
  const good = [
    'Reads and leaks are being built: RigorRun will check it never reads another customer’s data.',
    'Looking for 3–5 design partners.',
    'One small full refund, so the first verdict you read is a simple one.',
    'It catches a refund made on another customer’s payment.',
    'QuickBooks and NetSuite packs are not built yet.',
    'It is not a guarantee that your agent is safe.',
    'Cases repeat and never see each other.',
    'Never send from Gmail or from any other address.',
  ];
  let failures = 0;
  for (const line of bad) {
    if (check(line, config).length === 0) {
      failures += 1;
      process.stdout.write(`self-test: should FAIL but passed: ${line}\n`);
    }
  }
  for (const line of good) {
    const found = check(line, config);
    if (found.length > 0) {
      failures += 1;
      process.stdout.write(`self-test: should pass but failed (${found[0].claim}): ${line}\n`);
    }
  }
  process.stdout.write(
    failures === 0 ? 'claims self-test: ok\n' : `claims self-test: ${failures} wrong\n`,
  );
  return failures === 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadConfig();
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    process.exitCode = selfTest(config) ? 0 : 1;
  } else {
    const files = [];
    for (const target of SCAN) {
      if (target.file) {
        const path = join(root, target.file);
        if (existsSync(path)) files.push(path);
      } else walk(join(root, target.dir), target.ext, files);
    }
    for (const extra of args) files.push(resolve(extra));
    let total = 0;
    for (const path of files) {
      for (const v of check(readFileSync(path, 'utf8'), config)) {
        total += 1;
        process.stdout.write(
          `${relative(root, path)}:${v.line}  ${v.claim} (${v.status})\n    ${v.text.slice(0, 160)}\n`,
        );
      }
    }
    if (total > 0) {
      process.stdout.write(
        `\n${total} line(s) state as fact what docs/context/CLAIMS.md does not list as qualified.\n` +
          'Hedge them ("being built", "looking for …"), or qualify the claim first.\n',
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(`claims: ${files.length} files, nothing unqualified stated as fact\n`);
    }
  }
}
