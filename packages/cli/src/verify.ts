/**
 * `rigorrun verify <server-ref>` — what does this server actually do?
 *
 * The whole of it: a reference in, a verification record out, no browser, no
 * agent, no project, nothing to configure first.
 *
 * The exit code is the part that has to be exact, because CI reads it and
 * cannot ask a follow-up question. A container that would not start and a
 * server that lies about its own tools are opposite results, and the number
 * has to tell them apart:
 *
 *   0  verified, nothing contradicted
 *   1  the server declared something its behaviour contradicts
 *   2  RigorRun could not run the verification at all
 *   3  verified, but too little was established to mean much
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DEFAULT_THRESHOLDS, exitCodeFor, exitReason } from '@rigorrun/conformance';
import { canonicalJson, type VerificationRecord } from '@rigorrun/core';
import { reapOrphans, verifyServer, VerifyError } from '@rigorrun/sandbox';
import { ReferenceError as RefError } from '@rigorrun/sandbox';
import { RegistryError } from '@rigorrun/sandbox';
import { DockerError } from '@rigorrun/sandbox';
import { StageError } from '@rigorrun/sandbox';
import { CliError, workspaceDir } from './io.ts';
import { errorLine, line, table } from './ui.ts';

export interface VerifyFlags {
  json: boolean;
  quiet: boolean;
  out?: string | undefined;
  maxUndetermined?: number | undefined;
  minExercised?: number | undefined;
  strict: boolean;
}

/** Every way the harness itself can fail. All of them are exit code 2. */
const RUNTIME_FAILURES = [RefError, RegistryError, DockerError, StageError, VerifyError];

function isRuntimeFailure(error: unknown): boolean {
  return RUNTIME_FAILURES.some((type) => error instanceof type);
}

export async function cmdVerify(reference: string | undefined, flags: VerifyFlags): Promise<number> {
  if (!reference) {
    throw new CliError(
      'Give a server to verify, for example:\n' +
        '  rigorrun verify npm:@modelcontextprotocol/server-memory@2026.8.31',
    );
  }

  // Anything a previous run left behind, before starting another.
  await reapOrphans().catch(() => []);

  let record: VerificationRecord;
  try {
    record = await verifyServer(reference, {
      ...(flags.quiet || flags.json
        ? {}
        : { onProgress: (phase, detail) => line(`  ${phase.padEnd(10)} ${detail}`) }),
    });
  } catch (error) {
    if (isRuntimeFailure(error)) {
      // A configuration or infrastructure problem. Never a finding about the
      // server, and never dressed up as one.
      throw new CliError((error as Error).message, 2);
    }
    throw error;
  }

  const outPath = flags.out ?? join(workspaceDir(), 'records', `${record.recordId}.json`);
  await mkdir(dirname(outPath), { recursive: true });
  // Canonical form, so two runs of the same digest differ only where they must.
  await writeFile(outPath, `${canonicalJson(record)}\n`, 'utf8');

  const code = exitCodeFor(record, {
    ...DEFAULT_THRESHOLDS,
    ...(flags.maxUndetermined !== undefined ? { maxUndetermined: flags.maxUndetermined } : {}),
    ...(flags.minExercised !== undefined ? { minExercised: flags.minExercised } : {}),
    strict: flags.strict,
  });

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return code;
  }

  render(record, outPath);
  line('');
  (code === 0 ? line : errorLine)(exitReason(code, record));
  return code;
}

function render(record: VerificationRecord, outPath: string): void {
  line('');
  line(`${record.target.ref}`);
  line(`  resolved   ${record.target.resolvedVersion}`);
  line(`  digest     ${record.target.digest}`);
  line(`  runtime    ${record.harness.runtime}${record.harness.rootless ? ' (rootless)' : ''}`);
  line(`  isolation  ${record.harness.isolation}`);
  line(`  egress     ${record.harness.networkEgress ? 'permitted' : 'none'}`);
  line('');

  const rows = record.tools.flatMap((tool) =>
    tool.conformance.length === 0
      ? [[tool.name, '—', 'no annotation to check', tool.verification]]
      : tool.conformance.map((c) => [tool.name, c.claim, c.verdict, tool.verification]),
  );

  if (rows.length > 0) {
    line('Declared, versus what it did');
    table(['tool', 'declared', 'result', 'verification'], rows);
  }

  const contradictions = record.tools.flatMap((tool) =>
    tool.conformance
      .filter((c) => c.verdict === 'CONTRADICTED')
      .map((c) => ({ tool: tool.name, c, wrote: tool.observed.wrote })),
  );

  for (const { tool, c, wrote } of contradictions) {
    line('');
    errorLine(`${tool} — ${c.claim} is CONTRADICTED${c.permissionRelevant ? ', and that widens what an agent may do without asking' : ''}`);
    line(`  ${c.because}.`);
    if (wrote.length > 0) line(`  wrote ${wrote.join(', ')}`);
  }

  // The mandatory half. A record that hides what it could not reach is worth
  // less than one that says so.
  line('');
  if (record.untested.length === 0) {
    line('Every discovered tool was exercised.');
  } else {
    line('Not exercised');
    table(
      ['tool', 'why'],
      record.untested.map((u) => [u.tool, `${u.reason} — ${u.detail}`]),
    );
  }

  line('');
  for (const caveat of record.harness.caveats) line(`  · ${caveat}`);
  line('');
  line(`Record written to ${outPath}`);
}
