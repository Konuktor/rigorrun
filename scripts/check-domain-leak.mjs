#!/usr/bin/env node
/**
 * The anti-hardcoding gate.
 *
 * RigorRun's claim is that one compiler handles any workflow. That claim is
 * only worth anything if it stays true, and the way it stops being true is
 * gradual: somebody adds `if (entity === 'Invoice')` to fix one case, and six
 * months later the "generic" pipeline is a pile of special cases again. This
 * fails the build when that starts.
 *
 * It scans *code*, not comments. A comment explaining why the refund compiler
 * was wrong is documentation and is worth keeping; a string literal or an
 * identifier naming a refund is coupling. Stripping comments first is what
 * lets the source explain itself without tripping its own gate.
 *
 * Domain packages, demo apps, fixtures and tests are exempt by design — that
 * is where a workflow is *supposed* to be described.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Packages that must not know what business they are testing. */
const GENERIC = [
  'packages/core/src',
  'packages/environment/src',
  'packages/compiler/src',
  'packages/generator/src',
  'packages/verifier/src',
  'packages/scoring/src',
  'packages/runner/src',
  'packages/report/src',
  'packages/agents/src',
  'packages/providers/src',
  'packages/quality/src',
  'packages/mcp/src',
  // The schema-driven renderer is held to the same standard as the compiler.
  // Four products that look nothing alike, and one implementation with no idea
  // which of them it is drawing.
  'apps/demo-ops/src',
];

/**
 * Words that name a business object rather than a structure.
 *
 * Deliberately includes the five demo domains and the hidden sixth: if any of
 * them appears in generic code, the generalisation has leaked.
 */
const DOMAIN_TERMS = [
  'refund',
  'invoice',
  'vendor',
  'shipment',
  'northstar',
  'ticket',
  'customer',
  'purchase order',
  'equipment',
  'borrower',
  'checkout',
  'lead',
  'employee',
  'access grant',
  'accessgrant',
  // The dogfood fixture's business. It exists precisely so that a domain no
  // product code has ever seen can be connected from outside; if one of its
  // nouns turns up in generic code, that stopped being true.
  'venue',
  'booking',
  'organiser',
  'deposit',
];

const pattern = new RegExp(`\\b(${DOMAIN_TERMS.join('|')})s?\\b`, 'gi');

/**
 * Removes comments and leaves code.
 *
 * Not a parser — it does not need to be. It errs towards keeping text, so a
 * genuine leak inside an unusual construct is reported rather than hidden.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let quote = null;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (inLine) {
      if (source[i] === '\n') {
        inLine = false;
        out += '\n';
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (two === '*/') {
        inBlock = false;
        i += 2;
        continue;
      }
      if (source[i] === '\n') out += '\n';
      i += 1;
      continue;
    }
    if (quote) {
      if (source[i] === '\\') {
        out += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (source[i] === quote) quote = null;
      out += source[i];
      i += 1;
      continue;
    }
    if (two === '//') {
      inLine = true;
      i += 2;
      continue;
    }
    if (two === '/*') {
      inBlock = true;
      i += 2;
      continue;
    }
    if (source[i] === '"' || source[i] === "'" || source[i] === '`') quote = source[i];
    out += source[i];
    i += 1;
  }
  return out;
}

async function sourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const findings = [];
for (const dir of GENERIC) {
  for (const file of await sourceFiles(join(root, dir))) {
    const code = stripComments(await readFile(file, 'utf8'));
    code.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(pattern)) {
        findings.push({
          file: relative(root, file),
          line: index + 1,
          term: match[0],
          text: line.trim().slice(0, 110),
        });
      }
    });
  }
}

const ESC = String.fromCharCode(27);
const red = (t) => `${ESC}[31m${t}${ESC}[0m`;
const green = (t) => `${ESC}[32m${t}${ESC}[0m`;
const dim = (t) => `${ESC}[90m${t}${ESC}[0m`;

if (findings.length > 0) {
  console.log(red(`\n${findings.length} domain term(s) leaked into generic code:\n`));
  for (const finding of findings) {
    console.log(`  ${finding.file}:${finding.line}  ${red(finding.term)}`);
    console.log(dim(`    ${finding.text}`));
  }
  console.log(
    dim(
      '\nA workflow belongs in an environment adapter, a fixture or a demo app.\nIf the compiler needs to know about it, the compiler is not generic.\n',
    ),
  );
  process.exitCode = 1;
} else {
  console.log(
    green(`No domain terms in generic code.`) +
      dim(` ${GENERIC.length} package(s) checked against ${DOMAIN_TERMS.length} terms.`),
  );
}
