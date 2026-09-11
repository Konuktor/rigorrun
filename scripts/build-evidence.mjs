#!/usr/bin/env node
/**
 * Generates the evidence behind the /evidence page.
 *
 * This runs `rigorrun verify` against real, published, third-party MCP servers
 * — software nobody here wrote — and records what came back. It is the only
 * evidence on the public site that involves anything outside this repository.
 *
 *   node scripts/build-evidence.mjs
 *
 * Requires Docker, and the network, because that is what the thing being
 * evidenced requires. Without them it fails loudly rather than emitting a
 * plausible file.
 *
 * Every server is pinned to an exact version. `verify` resolves that version
 * against the registry, takes the sha512 the registry published, and refuses
 * to continue unless the bytes it downloaded hash to it — so the digests below
 * are a property of the artifact, not of this script.
 *
 * What this deliberately does NOT do is round the failures away. `untested`
 * and `undetermined` are carried onto the page with their reasons, because a
 * harness that reports only what it managed is a harness you cannot size.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * One publisher, four servers. Named here rather than discovered, so the page
 * cannot silently start reporting a different population than it claims.
 */
const TARGETS = [
  'npm:@modelcontextprotocol/server-memory@2026.8.31',
  'npm:@modelcontextprotocol/server-filesystem@2026.8.31',
  'npm:@modelcontextprotocol/server-everything@2026.8.31',
  'npm:@modelcontextprotocol/server-sequential-thinking@2026.8.31',
];

const ESC = String.fromCharCode(27);
const red = (t) => `${ESC}[31m${t}${ESC}[0m`;
const green = (t) => `${ESC}[32m${t}${ESC}[0m`;
const dim = (t) => `${ESC}[90m${t}${ESC}[0m`;

const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
});
if (docker.status !== 0) {
  console.error(red('Docker is not answering, and `rigorrun verify` runs every server in a'));
  console.error(red('container. Nothing was written.'));
  process.exit(2);
}

const started = Date.now();
const servers = [];

for (const ref of TARGETS) {
  process.stdout.write(dim(`  verifying ${ref}\n`));
  // The shipped command, through its own JSON output. Anything this page shows
  // is therefore something a reader can reproduce with one command.
  const result = spawnSync(
    join(root, 'node_modules', '.bin', 'tsx'),
    [join(root, 'packages', 'cli', 'src', 'bin.ts'), 'verify', ref, '--json'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  // 0 verified, 1 a declaration was contradicted, 3 too little established.
  // All three are results. 2 is the harness failing, and is not.
  if (result.status === 2 || !result.stdout.trim()) {
    console.error(red(`\n  ${ref} could not be verified:`));
    console.error(result.stderr.trim() || '(no output)');
    process.exit(2);
  }

  const record = JSON.parse(result.stdout);
  servers.push({
    ref: record.target.ref,
    resolvedVersion: record.target.resolvedVersion,
    digest: record.target.digest,
    treeDigest: record.target.treeDigest,
    serverName: record.server.name,
    serverVersion: record.server.version,
    exitCode: result.status,
    toolsDiscovered: record.summary.toolsDiscovered,
    toolsExercised: record.summary.toolsExercised,
    contradicted: record.summary.contradicted,
    undetermined: record.summary.undetermined,
    conforms: record.summary.conforms,
    isolation: record.harness.isolation,
    resets: record.harness.isolationProof.resets,
    networkEgress: record.harness.networkEgress,
    baseImage: record.harness.baseImage,
    harnessVersion: record.harness.version,
    // The mandatory half. Named, with reasons, never rounded away.
    untested: record.untested.map((u) => ({
      tool: u.tool,
      reason: u.reason,
      detail: u.detail,
    })),
    caveats: record.harness.caveats,
  });
}

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
} catch {
  /* not a git checkout — the measurements still stand */
}

const discovered = servers.reduce((n, s) => n + s.toolsDiscovered, 0);
const exercised = servers.reduce((n, s) => n + s.toolsExercised, 0);

const evidence = {
  generatedAt: new Date().toISOString(),
  commit,
  generationMs: Date.now() - started,
  rigorrunVersion: servers[0]?.harnessVersion ?? 'unknown',
  dockerVersion: docker.stdout.trim(),
  publisher: '@modelcontextprotocol',
  totals: {
    servers: servers.length,
    toolsDiscovered: discovered,
    toolsExercised: exercised,
    toolsUntested: discovered - exercised,
    contradicted: servers.reduce((n, s) => n + s.contradicted, 0),
    undetermined: servers.reduce((n, s) => n + s.undetermined, 0),
  },
  servers,
};

const out = join(root, 'apps', 'site', 'src', 'data', 'evidence.json');
await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`);

console.log(
  green(`\nEvidence regenerated`) +
    ` from ${servers.length} third-party servers at ${commit}, ` +
    `${exercised}/${discovered} tools exercised.`,
);
for (const s of servers) {
  console.log(
    `  ${s.ref.replace('npm:@modelcontextprotocol/', '').padEnd(34)} ` +
      `${String(s.toolsExercised).padStart(2)}/${String(s.toolsDiscovered).padEnd(2)} exercised · ` +
      `exit ${s.exitCode} · ${s.isolation}`,
  );
}
