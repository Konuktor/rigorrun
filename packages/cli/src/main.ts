/**
 * RigorRun CLI entry point.
 *
 * Exit codes are part of the contract: 0 success or gate passed, 1 benchmark,
 * gate or conformance failure, 2 configuration or runtime error. CI depends on
 * the difference between 1 and 2 — a broken config must not look like a
 * failing agent, and a lying server must not look like a broken config.
 *
 * `verify` adds a fourth: 3 means the verification ran and did not establish
 * enough to be worth much. No other command produces it, so every existing
 * script keeps the contract it was written against.
 */
import { parseArgs } from 'node:util';
import { CliError } from './io.ts';
import { COMMAND_HELP, HELP, VERSION } from './help.ts';
import { errorLine, line } from './ui.ts';
import {
  cmdAgents,
  cmdEnvironments,
  cmdInspectEnvironment,
  cmdWorkflows,
  cmdCompile,
  cmdDemo,
  cmdGate,
  cmdGenerate,
  cmdReport,
  cmdRun,
  type Flags,
} from './commands.ts';
import { cmdPrivacyInspect } from './scaffold.ts';
import {
  cmdBackup,
  cmdExportProject,
  cmdImportProject,
  cmdRestore,
  cmdTrust,
} from './backup.ts';
import { receiveTrace } from './record.ts';
import { cmdServe } from './serve.ts';
import { cmdDoctor as cmdDoctorProduct } from './doctor.ts';
import { cmdFeedbackExport } from './feedback.ts';
import { cmdVerify } from './verify.ts';
import {
  cmdProjectCompare,
  cmdProjectGate,
  cmdProjectRun,
  cmdProjects,
  cmdSecret,
} from './project.ts';

/**
 * Parses arguments, dispatches, and turns every expected failure into an exit
 * code. Returning rather than exiting keeps the whole CLI testable in-process
 * and guarantees the 1-versus-2 distinction CI depends on.
 */
export async function main(argv: string[]): Promise<number> {
  try {
    return await dispatch(argv);
  } catch (error) {
    if (error instanceof CliError) {
      errorLine(error.message);
      return error.exitCode;
    }
    errorLine((error as Error).message);
    if (process.env['RIGORRUN_DEBUG']) console.error(error);
    return 2;
  }
}

async function dispatch(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        workflow: { type: 'string', short: 'w' },
        agent: { type: 'string', multiple: true, default: [] },
        repeats: { type: 'string' },
        report: { type: 'string' },
        json: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        published: { type: 'boolean', default: false },
        port: { type: 'string' },
        project: { type: 'string' },
        home: { type: 'string' },
        baseline: { type: 'string' },
        // Prints the URL and exits, so a script can check the runner comes up.
        once: { type: 'boolean', default: false },
        // Opening a browser is right on a laptop and wrong over SSH, in a
        // container, and in CI. It is on by default because the laptop is the
        // common case and the printed URL is the fallback either way.
        'no-open': { type: 'boolean', default: false },
        // Export and import. `--with-secrets` is never a default: a bundle
        // with a production token in it cannot be un-emailed.
        'with-secrets': { type: 'boolean', default: false },
        'with-runs': { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        yes: { type: 'boolean', default: false },
        as: { type: 'string' },
        'min-success': { type: 'string' },
        'min-policy': { type: 'string' },
        'max-policy-violations': { type: 'string' },
        'max-unsafe': { type: 'string' },
        // verify only.
        'max-undetermined': { type: 'string' },
        'min-exercised': { type: 'string' },
        strict: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error) {
    errorLine((error as Error).message);
    line('Run `rigorrun --help` for usage.');
    return 2;
  }

  const [command, target] = parsed.positionals;
  const values = parsed.values;

  if (values.version) {
    line(VERSION);
    return 0;
  }
  if (values.help && !command) {
    line(HELP);
    return 0;
  }
  if (values.help) {
    line((command ? COMMAND_HELP[command] : undefined) ?? HELP);
    return 0;
  }

  const flags: Flags = {
    out: values.out,
    workflow: values.workflow,
    agent: values.agent ?? [],
    repeats: numberFlag(values.repeats, 'repeats'),
    report: values.report,
    json: values.json ?? false,
    quiet: values.quiet ?? false,
    published: values.published ?? false,
    port: numberFlag(values.port, 'port'),
    project: values.project,
    home: values.home,
    baseline: values.baseline,
    minSuccess: rateFlag(values['min-success'], 'min-success'),
    minPolicy: rateFlag(values['min-policy'], 'min-policy'),
    maxPolicyViolations: numberFlag(values['max-policy-violations'], 'max-policy-violations'),
    maxUnsafe: numberFlag(values['max-unsafe'], 'max-unsafe'),
  };

  switch (command) {
    // The bare command starts the runner, because everything a person wants to
    // do first happens in the interface and the interface only exists while it
    // is running.
    case undefined:
    case 'serve':
      return cmdServe({
        ...(flags.port === undefined ? {} : { port: flags.port }),
        ...(flags.home ? { home: flags.home } : {}),
        ...(values.once ? { once: true } : {}),
        ...(values['no-open'] ? { open: false } : {}),
      });
    case 'projects':
      return cmdProjects(flags);
    case 'feedback':
      if (target !== 'export') throw new CliError('Try `rigorrun feedback export`.');
      return cmdFeedbackExport(flags);
    // `secret` was the original spelling and still works: somebody's shell
    // history and somebody's CI script should not break over a plural.
    case 'secrets':
    case 'secret':
      return cmdSecret(target, parsed.positionals[2], flags);
    case 'backup':
      return cmdBackup(flags);
    case 'restore':
      return cmdRestore(target, { ...flags, force: values.force });
    case 'export-project':
      return cmdExportProject(target, {
        ...flags,
        withSecrets: values['with-secrets'],
        withRuns: values['with-runs'],
      });
    case 'import-project':
      return cmdImportProject(target, {
        ...flags,
        ...(values.as ? { as: values.as } : {}),
      });
    case 'trust':
      return cmdTrust(target, { ...flags, yes: values.yes });
    case 'compare-runs':
      return cmdProjectCompare(flags.project, target, flags);
    case 'demo':
      return cmdDemo(flags);
    case 'record':
      return receiveTrace(flags.port ?? 8787, flags.out);
    case 'compile':
      return cmdCompile(target, flags);
    case 'generate':
      return cmdGenerate(target, flags);
    case 'run':
      // `--project` is the product path; a benchmark file is the older one,
      // kept because CI written against it should not break.
      return flags.project ? cmdProjectRun(flags.project, flags) : cmdRun(target, flags);
    case 'compare':
      return cmdRun(target, {
        ...flags,
        agent: flags.agent.length > 0 ? flags.agent : ['naive', 'careful'],
      });
    case 'gate':
      return flags.project ? cmdProjectGate(flags.project, flags) : cmdGate(target, flags);
    case 'report':
      return cmdReport(target, flags);
    case 'agents':
      return cmdAgents(flags);
    case 'workflows':
      return cmdWorkflows(flags);
    case 'environments':
      return cmdEnvironments(flags);
    case 'inspect-environment':
      return cmdInspectEnvironment(target, flags);
    case 'privacy':
      return cmdPrivacyInspect(target, parsed.positionals[2], flags.json);
    case 'verify':
      return cmdVerify(target, {
        json: flags.json,
        quiet: flags.quiet,
        out: flags.out,
        maxUndetermined: numberFlag(values['max-undetermined'], 'max-undetermined'),
        minExercised: numberFlag(values['min-exercised'], 'min-exercised'),
        strict: values.strict === true,
      });
    case 'doctor':
      return cmdDoctorProduct(flags);
    default:
      errorLine(`Unknown command "${command}".`);
      line('Run `rigorrun --help` to see the available commands.');
      return 2;
  }
}

function numberFlag(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new CliError(`--${name} must be a non-negative number, got "${raw}"`);
  }
  return value;
}

function rateFlag(raw: string | undefined, name: string): number | undefined {
  const value = numberFlag(raw, name);
  if (value !== undefined && value > 1) {
    throw new CliError(`--${name} is a rate between 0 and 1, got "${raw}" (use 0.95, not 95)`);
  }
  return value;
}
