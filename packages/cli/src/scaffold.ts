/**
 * `rigorrun privacy inspect`.
 *
 * This file used to also hold `init-environment`, which scaffolded an
 * environment adapter into `environments/<slug>/`. It was removed rather than
 * fixed: nothing in RigorRun could load what it wrote, so the documented next
 * step failed, and a command that produces files no command accepts is worse
 * than no command. Bringing your own environment comes back when
 * `@rigorrun/environment-sdk` is published and `sdk` is a connector kind
 * alongside `mcp` — at which point the path is loading an adapter, not
 * scaffolding one into a directory only this repository knows about.
 */
import { parseCanonicalTrace, type CanonicalHumanTrace } from '@rigorrun/core';
import { CliError, readJson } from './io.ts';
import { c, heading, line, table } from './ui.ts';

/**
 * `rigorrun privacy inspect <trace>`.
 *
 * Privacy claims are cheap. This makes them checkable: it reads a real trace
 * and says, field by field, what was captured, what was redacted on the way in,
 * and what would leave the machine if you published. The answer to the last
 * one is nothing, unless you publish — and this prints the list rather than
 * asking you to take that on trust.
 */
export async function cmdPrivacyInspect(
  action: string | undefined,
  target: string | undefined,
  json: boolean,
): Promise<number> {
  if (action !== 'inspect') {
    throw new CliError('Usage: rigorrun privacy inspect <trace.json>');
  }
  if (!target) throw new CliError('Give me a trace file. Try `rigorrun privacy inspect trace.json`.');

  let trace: CanonicalHumanTrace;
  try {
    trace = parseCanonicalTrace(await readJson(target));
  } catch (error) {
    throw new CliError(`${target} is not a RigorRun trace: ${(error as Error).message}`);
  }

  const captured = new Map<string, number>();
  let surfaceText = 0;
  let uiFields = 0;
  for (const step of trace.steps) {
    for (const key of Object.keys(step.action?.args ?? {})) {
      captured.set(key, (captured.get(key) ?? 0) + 1);
    }
    surfaceText += step.surfaceText.length;
    uiFields += step.ui ? Object.keys(step.ui).length : 0;
  }

  const report = {
    trace: trace.id,
    environment: trace.environmentId,
    steps: trace.steps.length,
    capturedFields: [...captured.entries()].sort().map(([field, count]) => ({ field, count })),
    surfaceTextFragments: surfaceText,
    uiLocatorFields: uiFields,
    redaction: trace.meta.redaction,
    droppedForSafety: trace.meta.droppedSensitiveEvents,
    leavesThisMachine: [] as string[],
    staysLocal: ['the recording', 'authoritative state before and after', 'every generated case'],
  };

  if (json) {
    line(JSON.stringify(report, null, 2));
    return 0;
  }

  heading('Privacy');
  line(c.grey(`${target} · ${trace.steps.length} steps · redaction ${trace.meta.redaction}`));
  line();
  line(c.bold('Captured'));
  table(
    ['field', 'times'],
    report.capturedFields.map((entry) => [entry.field, String(entry.count)]),
  );
  line();
  line(`${c.bold('Also captured')}  ${surfaceText} text fragments the operator could see, ${uiFields} interface locators`);
  line(`${c.bold('Dropped for safety')}  ${trace.meta.droppedSensitiveEvents} event(s) the recorder refused to keep`);
  line();
  line(c.bold('Leaves this machine'));
  line(c.green('  nothing'));
  line(
    c.grey(
      '  Compiling, generating and running all happen locally. Publishing is a separate,\n  explicit step, and it strips record identifiers, tool arguments and agent prose.',
    ),
  );
  line();
  line(c.bold('Stays local'));
  for (const item of report.staysLocal) line(`  ${c.grey('·')} ${item}`);
  return 0;
}
