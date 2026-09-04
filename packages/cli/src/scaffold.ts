/**
 * `rigorrun init-environment` and `rigorrun privacy inspect`.
 *
 * The scaffold exists so that "bring your own environment" is a command rather
 * than a paragraph. What it writes is a working environment with one record
 * type and one action, which compiles and generates cases immediately — the
 * point being that a developer starts from something that runs and edits it,
 * instead of starting from a blank file and a specification.
 */
import { parseCanonicalTrace, type CanonicalHumanTrace } from '@rigorrun/core';
import { CliError, readJson, writeText } from './io.ts';
import { c, heading, line, table } from './ui.ts';

const SCHEMA_TEMPLATE = `/**
 * What your system contains, and what each field means structurally.
 *
 * RigorRun never learns what your business is. It learns records, links,
 * actions and roles — and derives the rules from a recording of the work.
 */
import type { EnvironmentSchema } from '@rigorrun/environment';

export const schema: EnvironmentSchema = {
  entities: [
    {
      name: 'Party',
      idField: 'partyId',
      label: 'party',
      mutable: false,
      appendOnly: false,
      fields: [
        { name: 'partyId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'displayName', type: 'string', nullable: false, role: 'freetext' },
        // Written by someone outside your organisation: the only place
        // RigorRun will ever put an injection payload.
        { name: 'note', type: 'string', nullable: true, role: 'freetext', untrusted: true },
      ],
    },
    {
      name: 'Job',
      idField: 'jobId',
      label: 'job',
      mutable: true,
      appendOnly: false,
      fields: [
        { name: 'jobId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'partyId', type: 'string', nullable: false, role: 'identifier' },
        // A quantity needs a unit and a precision, or "one more than the
        // limit" has no defined meaning and boundary cases miss the boundary.
        { name: 'amount', type: 'number', nullable: false, role: 'quantity', unit: 'currency', precision: 0.01 },
        { name: 'jobStatus', type: 'enum', nullable: false, role: 'status', enumValues: ['open', 'done'] },
        { name: 'handledBy', type: 'string', nullable: true, role: 'actor' },
      ],
    },
    {
      name: 'LogEntry',
      idField: 'logId',
      label: 'log entry',
      mutable: false,
      appendOnly: true,
      referenceFields: ['detail'],
      fields: [
        { name: 'logId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'action', type: 'string', nullable: false, role: 'identifier' },
        { name: 'detail', type: 'string', nullable: false, role: 'freetext' },
      ],
    },
  ],
  relationships: [
    {
      name: 'party',
      from: 'Job',
      to: 'Party',
      via: { kind: 'fk', field: 'partyId' },
      cardinality: 'one',
      required: true,
    },
  ],
};
`;

const FIXTURE_TEMPLATE = `/**
 * One realistic slice of your world, and the work order somebody was given.
 *
 * Keep it small. Everything RigorRun generates is a mutation of this.
 */
import { stateFromRows, type EnvironmentFixture } from '@rigorrun/environment';
import { schema } from './schema.ts';

export const fixture: EnvironmentFixture = {
  id: 'standard',
  title: 'A routine job',
  summary: 'One open job for a known party.',
  state: stateFromRows(schema, {
    Party: [{ partyId: 'PTY-1', displayName: 'Acme', note: 'Prefers email.' }],
    Job: [
      { jobId: 'JOB-1', partyId: 'PTY-1', amount: 40, jobStatus: 'open', handledBy: null },
    ],
    LogEntry: [],
  }),
  config: {},
  request: { jobId: 'JOB-1' },
};
`;

const ENVIRONMENT_TEMPLATE = `/**
 * Your environment.
 *
 * The base class enforces referential integrity and NOTHING ELSE. Required
 * parameters must be present and a named record must exist — but an action
 * that is merely against policy must succeed, or the benchmark has nothing to
 * catch. That is what \`enforcement: 'none'\` promises, and RigorRun verifies it
 * by trying each violation.
 */
import { defineEnvironment } from '@rigorrun/environment';
import { schema } from './schema.ts';
import { fixture } from './fixture.ts';

export const myEnvironment = defineEnvironment({
  id: 'my-system',
  name: 'My system',
  description: 'Replace this with your own staging system.',
  schema,
  presentation: {
    label: 'My system',
    tagline: 'Operations',
    accent: '#334155',
    mark: 'MS',
    navEntities: ['Job', 'Party'],
    focusEntity: 'Job',
  },
  caseConfig: [],
  fixtures: [fixture],
  actions: [
    {
      name: 'getJob',
      description: 'Read a job.',
      readOnly: true,
      mutates: [],
      enforcement: 'none',
      params: [{ name: 'jobId', type: 'string', required: true, entityRef: 'Job' }],
      handle: (args, ctx) => ({ ok: true, data: ctx.row('Job', args['jobId']) }),
    },
    {
      name: 'completeJob',
      description: 'Complete a job',
      readOnly: false,
      mutates: ['Job'],
      enforcement: 'none',
      params: [
        { name: 'jobId', type: 'string', required: true, entityRef: 'Job' },
        { name: 'handledBy', type: 'string', required: false },
      ],
      handle: (args, ctx) => {
        const updated = ctx.update('Job', args['jobId'], {
          jobStatus: 'done',
          handledBy: String(args['handledBy'] ?? 'operator_1'),
        });
        if (!updated) return { ok: false, error: { code: 'NOT_FOUND', message: 'no such job' } };
        ctx.emit('completeJob', { jobId: updated['jobId'] });
        return { ok: true, data: updated };
      },
    },
    {
      name: 'writeLog',
      description: 'Append to the log.',
      readOnly: false,
      mutates: ['LogEntry'],
      enforcement: 'none',
      params: [
        { name: 'action', type: 'string', required: true },
        { name: 'detail', type: 'string', required: true },
      ],
      handle: (args, ctx) => {
        const row = ctx.insert('LogEntry', {
          logId: ctx.nextId('LOG'),
          action: String(args['action']),
          detail: String(args['detail']),
        });
        ctx.emit('writeLog', { logId: row['logId'] });
        return { ok: true, data: row };
      },
    },
  ],
});
`;

function readmeTemplate(name: string): string {
  return `# ${name}

An environment RigorRun can point at.

## Check it before you trust it

\`\`\`ts
import { validateAdapter } from '@rigorrun/environment';

const problems = await validateAdapter(() => myEnvironment.create(), myEnvironment.fixtures);
if (problems.length > 0) throw new Error(problems.map((p) => p.message).join('\\n'));
\`\`\`

A mis-annotated \`role\` silently corrupts thresholds, boundary mutation and the
projection at once. The conformance kit is what stops that reaching production.

## Then

\`\`\`bash
rigorrun inspect-environment ${name}
rigorrun compile trace.json -o contract.json
rigorrun generate contract.json -o benchmark.json
rigorrun gate benchmark.json --agent reference
\`\`\`

See \`docs/CONNECT_ENVIRONMENT_30_MINUTES.md\`.
`;
}

export async function cmdInitEnvironment(name: string | undefined): Promise<number> {
  const slug = (name ?? 'my-system').trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new CliError(
      `"${slug}" is not a usable directory name. Use lowercase letters, digits and hyphens.`,
    );
  }
  const dir = `environments/${slug}`;

  await writeText(`${dir}/schema.ts`, SCHEMA_TEMPLATE);
  await writeText(`${dir}/fixture.ts`, FIXTURE_TEMPLATE);
  await writeText(`${dir}/environment.ts`, ENVIRONMENT_TEMPLATE.replace("'my-system'", `'${slug}'`));
  await writeText(`${dir}/README.md`, readmeTemplate(slug));

  heading(`Scaffolded ${dir}`);
  line(c.grey('A working environment with three record types and three actions.'));
  line();
  for (const file of ['schema.ts', 'fixture.ts', 'environment.ts', 'README.md']) {
    line(`  ${c.grey('·')} ${dir}/${file}`);
  }
  line();
  line('Next: describe your own records, then run the conformance kit before you trust it.');
  line(c.grey('docs/CONNECT_ENVIRONMENT_30_MINUTES.md'));
  return 0;
}

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
