/**
 * `rigorrun setup <spec.json>` — a project from a file, with no interface.
 *
 * Audit finding R-6: CI could run and gate a project but not create one, so
 * the audit had to drive the runner's HTTP API by hand. This drives the same
 * Service the interface drives, in the same order: create, connect, nominate
 * reads, demonstrate the job, answer the schema questions, compile, decide
 * rules, build the suite, optionally check it, register agents.
 *
 * Two things a spec never contains. Credential *values*: a spec names the
 * environment variable each secret comes from, and the value goes straight to
 * the credential store. And a silent confirmation: a rule RigorRun only
 * inferred is confirmed only if a `review.confirm` pattern names it; every
 * other inferred rule is rejected, so nothing gates an agent because a file
 * forgot to mention it.
 */
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { ProjectStore, Service, storeRoot } from '@rigorrun/daemon';
import { ProxyServer } from '@rigorrun/proxy';
import { CliError } from './io.ts';
import { c, heading, line } from './ui.ts';
import type { Flags } from './commands.ts';

const TeachStepSchema = z.union([
  z.object({ tool: z.string().min(1), args: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ sleepSeconds: z.number().nonnegative() }),
]);

const AgentSpecSchema = z.union([
  z.object({ name: z.string().min(1), command: z.string().min(1), args: z.array(z.string()).default([]), cwd: z.string().optional() }),
  z.object({ name: z.string().min(1), endpoint: z.string().min(1) }),
]);

export const SetupSpecSchema = z.object({
  name: z.string().min(1),
  goal: z.string().default(''),
  connector: z.record(z.string(), z.unknown()),
  /** Required: whether RigorRun may write to a system is never assumed. */
  safety: z.enum(['production', 'staging', 'local', 'ephemeral'], {
    message: 'safety is required: production, staging, local or ephemeral. RigorRun will not guess whether it may write to a system.',
  }),
  /** Secret name → the environment variable its value is read from. */
  secrets: z.record(z.string(), z.string()).default({}),
  readOnlyTools: z.array(z.string()).default([]),
  verifierReads: z
    .array(z.object({ tool: z.string().min(1), args: z.record(z.string(), z.unknown()).default({}) }))
    .default([]),
  reset: z.object({ kind: z.enum(['tool', 'none']), tool: z.string().optional() }).default({ kind: 'none' }),
  budgets: z
    .object({ toolCallMs: z.number().int().positive().optional(), caseMs: z.number().int().positive().optional() })
    .optional(),
  teach: z.array(TeachStepSchema).min(1),
  /** Question-id pattern → answer. Unmatched questions take RigorRun's proposal. */
  answers: z.record(z.string(), z.string()).default({}),
  review: z
    .object({ confirm: z.array(z.string()).default([]), reject: z.array(z.string()).default([]) })
    .default({ confirm: [], reject: [] }),
  quality: z.boolean().default(false),
  agents: z.array(AgentSpecSchema).default([]),
});
export type SetupSpec = z.infer<typeof SetupSpecSchema>;

export async function cmdSetup(specPath: string | undefined, flags: Flags): Promise<number> {
  if (!specPath) throw new CliError('Give a spec: `rigorrun setup project.json`. See `rigorrun setup --help`.');
  let spec: SetupSpec;
  try {
    spec = SetupSpecSchema.parse(JSON.parse(await readFile(specPath, 'utf8')));
  } catch (error) {
    throw new CliError(`${specPath} is not a usable spec: ${(error as Error).message}`);
  }

  // Refused before anything is created: a half-made project is worse than none.
  const missing = Object.entries(spec.secrets)
    .filter(([, variable]) => process.env[variable] === undefined)
    .map(([name, variable]) => `${name} (from $${variable})`);
  if (missing.length > 0) {
    throw new CliError(
      `The spec needs ${missing.join(', ')}, and the environment does not set it. ` +
        'Values are read from the environment, never from the spec.',
    );
  }

  const say = (text: string) => {
    if (!flags.quiet && !flags.json) line(text);
  };
  const store = new ProjectStore(storeRoot(flags.home));
  for (const [name, variable] of Object.entries(spec.secrets)) {
    await store.setSecret(name, process.env[variable]!);
  }

  const proxy = new ProxyServer();
  await proxy.start();
  const service = new Service({ store, proxy });
  try {
    if (!flags.quiet && !flags.json) heading(`Setting up ${spec.name}`);
    const project = await service.createProject({ name: spec.name, goal: spec.goal });
    const connected = await service.connectEnvironment(
      project.id,
      spec.connector as unknown as Parameters<Service['connectEnvironment']>[1],
      spec.safety,
    );
    say(`  connected       ${connected.serverName}, ${connected.tools.length} tool(s)`);

    const budgets: { toolCallMs?: number; caseMs?: number } = {};
    if (spec.budgets?.toolCallMs !== undefined) budgets.toolCallMs = spec.budgets.toolCallMs;
    if (spec.budgets?.caseMs !== undefined) budgets.caseMs = spec.budgets.caseMs;
    const configured = await service.configureEnvironment(project.id, {
      readOnlyTools: spec.readOnlyTools,
      verifierReads: spec.verifierReads,
      reset: spec.reset.tool !== undefined ? { kind: spec.reset.kind, tool: spec.reset.tool } : { kind: spec.reset.kind },
      ...(Object.keys(budgets).length > 0 ? { budgets } : {}),
    });
    if (configured.readsProblem) say(`  ${c.yellow('reads')}           ${configured.readsProblem}`);

    await service.startTeaching(project.id);
    const taught: { tool: string; ok: boolean }[] = [];
    for (const step of spec.teach) {
      if ('sleepSeconds' in step) {
        await sleep(step.sleepSeconds * 1000);
        continue;
      }
      const result = await service.teachStep(project.id, step.tool, step.args);
      taught.push({ tool: step.tool, ok: result.ok });
    }
    const finished = await service.finishTeaching(project.id);
    say(`  demonstrated    ${taught.length} call(s); records: ${finished.schema.entities.map((entity) => entity.name).join(', ') || 'none'}`);

    const answers = finished.questions.map((question) => {
      let value = question.proposed;
      for (const [pattern, chosen] of Object.entries(spec.answers)) {
        if (new RegExp(pattern).test(question.id)) value = chosen;
      }
      return { questionId: question.id, value };
    });
    await service.answerSchema(project.id, answers);

    const draft = await service.compile(project.id);
    const matches = (patterns: string[], text: string) => patterns.some((pattern) => new RegExp(pattern, 'i').test(text));
    const confirmed: string[] = [];
    const rejected: string[] = [];
    for (const rule of draft.rules) {
      if (rule.status !== 'inferred') continue;
      if (matches(spec.review.reject, rule.statement)) rejected.push(rule.id);
      else if (matches(spec.review.confirm, rule.statement)) confirmed.push(rule.id);
      else rejected.push(rule.id);
    }
    await service.review(project.id, { confirmedRuleIds: confirmed, rejectedRuleIds: rejected });
    say(`  compiled        ${draft.rules.length} rule(s): ${confirmed.length} confirmed, ${rejected.length} rejected`);

    const benchmark = await service.generate(project.id);
    say(`  suite           ${benchmark.cases.length} case(s)`);

    const quality = spec.quality ? await service.assessSuite(project.id) : undefined;
    if (quality) say(`  suite check     caught ${Math.round(quality.mutantKillRate * 100)}% of broken agents`);

    const agents: { name: string; ok: boolean; problem: string }[] = [];
    for (const agent of spec.agents) {
      const input =
        'endpoint' in agent
          ? { name: agent.name, endpoint: agent.endpoint }
          : { name: agent.name, command: agent.command, args: agent.args, ...(agent.cwd ? { cwd: agent.cwd } : {}) };
      const added = await service.addAgent(project.id, input);
      agents.push({ name: agent.name, ok: added.agent.lastProbeOk, problem: added.agent.lastProbeProblem });
      say(`  agent           ${agent.name} ${added.agent.lastProbeOk ? c.green('answers') : c.red(added.agent.lastProbeProblem)}`);
    }

    if (flags.json) {
      line(
        JSON.stringify(
          {
            projectId: project.id,
            readsProblem: configured.readsProblem,
            readsIgnored: configured.readsIgnored,
            tools: connected.tools.length,
            records: finished.schema.entities.map((entity) => entity.name),
            rules: { total: draft.rules.length, confirmed: confirmed.length, rejected: rejected.length },
            cases: benchmark.cases.length,
            quality: quality ? { mutantKillRate: quality.mutantKillRate, independentKillRate: quality.independentKillRate } : null,
            agents,
          },
          null,
          2,
        ),
      );
    } else {
      line(project.id);
    }
    return agents.every((agent) => agent.ok) ? 0 : 1;
  } finally {
    await service.workspace.close();
    await proxy.stop();
  }
}
