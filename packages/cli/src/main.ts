/**
 * RigorRun CLI entry point.
 *
 * Exit codes are part of the contract: 0 success or gate passed, 1 benchmark
 * or gate failed, 2 configuration or runtime error. CI depends on the
 * difference between 1 and 2 — a broken config must not look like a failing
 * agent.
 */
import { parseArgs } from 'node:util';
import { CliError } from './io.ts';
import { COMMAND_HELP, HELP, VERSION } from './help.ts';
import { errorLine, line } from './ui.ts';
import {
  cmdAgents,
  cmdCompile,
  cmdDemo,
  cmdDoctor,
  cmdGate,
  cmdGenerate,
  cmdReport,
  cmdRun,
  type Flags,
} from './commands.ts';
import { receiveTrace } from './record.ts';

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
        agent: { type: 'string', multiple: true, default: [] },
        repeats: { type: 'string' },
        report: { type: 'string' },
        json: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        published: { type: 'boolean', default: false },
        port: { type: 'string' },
        'min-success': { type: 'string' },
        'min-policy': { type: 'string' },
        'max-policy-violations': { type: 'string' },
        'max-unsafe': { type: 'string' },
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
  if (!command || (values.help && !command)) {
    line(HELP);
    return command ? 0 : values.help ? 0 : 2;
  }
  if (values.help) {
    line(COMMAND_HELP[command] ?? HELP);
    return 0;
  }

  const flags: Flags = {
    out: values.out,
    agent: values.agent ?? [],
    repeats: numberFlag(values.repeats, 'repeats'),
    report: values.report,
    json: values.json ?? false,
    quiet: values.quiet ?? false,
    published: values.published ?? false,
    port: numberFlag(values.port, 'port'),
    minSuccess: rateFlag(values['min-success'], 'min-success'),
    minPolicy: rateFlag(values['min-policy'], 'min-policy'),
    maxPolicyViolations: numberFlag(values['max-policy-violations'], 'max-policy-violations'),
    maxUnsafe: numberFlag(values['max-unsafe'], 'max-unsafe'),
  };

  switch (command) {
    case 'demo':
      return cmdDemo(flags);
    case 'record':
      return receiveTrace(flags.port ?? 8787, flags.out);
    case 'compile':
      return cmdCompile(target, flags);
    case 'generate':
      return cmdGenerate(target, flags);
    case 'run':
      return cmdRun(target, flags);
    case 'compare':
      return cmdRun(target, {
        ...flags,
        agent: flags.agent.length > 0 ? flags.agent : ['demo-weak', 'demo-robust'],
      });
    case 'gate':
      return cmdGate(target, flags);
    case 'report':
      return cmdReport(target, flags);
    case 'agents':
      return cmdAgents(flags);
    case 'doctor':
      return cmdDoctor(flags);
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
