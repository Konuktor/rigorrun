/**
 * The six steps, as functions.
 *
 * Connect a system. Show it a job. Review what it learned. Rule on it. Build
 * the suite. Run an agent and read the system back. The UI and the CLI both
 * call these and neither contains any of this logic, because two
 * implementations of the same flow drift and the one people use is always the
 * one with the bug.
 *
 * Each step records when it happened. That is how time-to-first-verdict is
 * measured rather than estimated, and it is the only number that says whether
 * this product is actually usable.
 */
import { randomBytes } from 'node:crypto';
import {
  applyReview,
  fromActionLog,
  rulesAwaitingReview,
  type Benchmark,
  type CanonicalHumanTrace,
  type EnvironmentContract,
  type RunResult,
} from '@rigorrun/core';
import { induceContract } from '@rigorrun/compiler';
import { generateBenchmark } from '@rigorrun/generator';
import { runBenchmark } from '@rigorrun/runner';
import {
  clearEnvironments,
  registerEnvironment,
  type EnvironmentFixture,
  type EnvironmentSchema,
} from '@rigorrun/environment';
import type { AgentAdapter } from '@rigorrun/agents';
import { createHttpV2Agent, probeAgent } from './httpAgent.ts';
import type { ProxyServer } from '@rigorrun/proxy';
import type { DiscoveredTool, SchemaQuestion } from '@rigorrun/mcp';
import { newProject, type AgentConfig, type Connector, type Project } from './project.ts';
import type { Listing, ProjectStore } from './store.ts';
import { Workspace } from './workspace.ts';
import { compareRuns, type RunComparison } from './compare.ts';
import { ActivationLog } from './activation.ts';
import { detectDrift, type Discovery, type DriftReport } from './drift.ts';

export interface ServiceOptions {
  store: ProjectStore;
  proxy: ProxyServer;
  now?: () => Date;
  /** Where the funnel is recorded. Defaults to the store's own directory. */
  activation?: ActivationLog;
}

export class Service {
  readonly workspace: Workspace;
  readonly activation: ActivationLog;
  private readonly now: () => Date;

  constructor(private readonly options: ServiceOptions) {
    this.workspace = new Workspace(options.store);
    this.now = options.now ?? (() => new Date());
    this.activation = options.activation ?? new ActivationLog(options.store.path, this.now);
  }

  private get store(): ProjectStore {
    return this.options.store;
  }

  // ------------------------------------------------------------------ projects

  async createProject(input: { name: string; goal?: string }): Promise<Project> {
    const name = input.name.trim();
    if (name.length === 0) throw new Error('A project needs a name.');
    const project = newProject({
      id: `p_${randomBytes(6).toString('hex')}`,
      name,
      ...(input.goal ? { goal: input.goal } : {}),
      now: this.now().toISOString(),
    });
    await this.store.write(project);
    // A2. The clock a person is actually measured against starts here.
    await this.activation.stage('project_created', project.id);
    return project;
  }

  listProjects(): Promise<Project[]> {
    return this.store.list();
  }

  /** Everything on this machine, including what cannot be read. */
  listAllProjects(): Promise<Listing> {
    return this.store.listAll();
  }

  readProject(id: string): Promise<Project> {
    return this.store.read(id);
  }

  // --------------------------------------------------------- step 1: connect

  /**
   * Opens the connection and reports what is actually there.
   *
   * Saving the connector only after a successful handshake is the point. A
   * project that lists a system it has never reached is the sort of thing that
   * looks connected on a dashboard and fails in CI an hour later.
   */
  async connectEnvironment(
    projectId: string,
    connector: Connector,
    safety: Project['safety'],
  ): Promise<{ project: Project; tools: DiscoveredTool[]; latencyMs: number; serverName: string }> {
    const project = await this.store.read(projectId);
    const attempted: Project = { ...project, connector, safety };

    await this.workspace.disconnect(projectId);
    let connection;
    try {
      connection = await this.workspace.connect(attempted);
    } catch (error) {
      // Counted, not described: the message carries a hostname or a command.
      await this.activation.attempt('environment_connection_failed', projectId);
      throw error;
    }

    attempted.timings = {
      ...attempted.timings,
      environmentConnectedAt: attempted.timings.environmentConnectedAt ?? this.now().toISOString(),
    };
    await this.store.write(attempted);
    await this.saveDiscovery(projectId, connection.discovery);
    await this.activation.stage('environment_connected', projectId);

    return {
      project: attempted,
      tools: connection.discovery.tools,
      latencyMs: connection.discovery.latencyMs,
      serverName: connection.discovery.serverName,
    };
  }

  /**
   * Opens the connection again, and says what moved while it was closed.
   *
   * An MCP session does not survive a runner restart — a stdio connector is a
   * child process, and it is gone. The project survives, the configuration
   * survives, the credentials survive; the *session* has to be rebuilt, and
   * pretending otherwise would mean discovering it at the worst moment.
   *
   * Reconnecting is also the only chance to notice that somebody else's system
   * changed. A suite compiled against tools that have since been renamed is
   * still runnable, and would produce a confident verdict about a system it no
   * longer describes.
   */
  async reconnect(projectId: string): Promise<{
    project: Project;
    tools: DiscoveredTool[];
    serverName: string;
    latencyMs: number;
    drift: DriftReport | null;
  }> {
    const project = await this.store.read(projectId);
    if (!project.connector) throw new Error(`${project.name} has no system connected yet.`);

    const previous = await this.store.readArtefact<Discovery>(projectId, 'discovery');
    await this.workspace.disconnect(projectId);

    let connection;
    try {
      connection = await this.workspace.connect(project);
    } catch (error) {
      await this.activation.attempt('environment_connection_failed', projectId);
      throw error;
    }
    await this.activation.attempt('environment_reconnected', projectId);

    const current = await this.saveDiscovery(projectId, connection.discovery);
    return {
      project,
      tools: connection.discovery.tools,
      serverName: connection.discovery.serverName,
      latencyMs: connection.discovery.latencyMs,
      // Nothing to compare against on a project connected before discovery was
      // persisted. Silence is honest; an empty report would not be.
      drift: previous ? detectDrift(previous, current) : null,
    };
  }

  /** Whether this runner currently holds an open connection for a project. */
  isConnected(projectId: string): boolean {
    return this.workspace.connectionFor(projectId) !== undefined;
  }

  /** What the last successful connection found, for a page that just loaded. */
  discovery(projectId: string): Promise<Discovery | undefined> {
    return this.store.readArtefact<Discovery>(projectId, 'discovery');
  }

  private async saveDiscovery(
    projectId: string,
    found: {
      serverName: string;
      serverVersion: string;
      protocolVersion: string;
      latencyMs: number;
      tools: DiscoveredTool[];
    },
  ): Promise<Discovery> {
    const discovery: Discovery = {
      serverName: found.serverName,
      serverVersion: found.serverVersion,
      protocolVersion: found.protocolVersion,
      discoveredAt: this.now().toISOString(),
      latencyMs: found.latencyMs,
      tools: found.tools,
    };
    await this.store.writeArtefact(projectId, 'discovery', discovery);
    return discovery;
  }

  /** Which tools only read, which one puts the world back, what to read after. */
  async configureEnvironment(
    projectId: string,
    input: {
      readOnlyTools: string[];
      verifierReads: { tool: string; args?: Record<string, unknown> }[];
      reset: { kind: 'tool' | 'none'; tool?: string };
    },
  ): Promise<Project> {
    const project = await this.store.read(projectId);
    const updated: Project = {
      ...project,
      readOnlyTools: input.readOnlyTools,
      verifierReads: input.verifierReads.map((read) => ({
        tool: read.tool,
        args: read.args ?? {},
      })),
      reset: { kind: input.reset.kind, tool: input.reset.tool ?? '' },
    };
    await this.store.write(updated);
    return updated;
  }

  // ------------------------------------------------------- step 2: teach a job

  async startTeaching(projectId: string): Promise<void> {
    const project = await this.store.read(projectId);
    await this.workspace.connect(project);
    // Starting over throws away a recording somebody may have been halfway
    // through, so it is counted. A person restarting twice is a signal about
    // the interface, not about them.
    if (await this.store.readArtefact(projectId, 'demonstration')) {
      await this.activation.attempt('recording_restarted', projectId);
    }
    await this.workspace.startDemonstration(project);
  }

  /**
   * Picks a half-finished recording back up after a reload.
   *
   * Returns false when there is nothing to resume, which the interface reads as
   * "offer to start" rather than as a failure.
   */
  async resumeTeaching(projectId: string): Promise<boolean> {
    const project = await this.store.read(projectId);
    if (!(await this.store.readArtefact(projectId, 'demonstration'))) return false;
    await this.workspace.connect(project);
    return this.workspace.resumeDemonstration(project);
  }

  /** What has been recorded so far, so a resumed page can show the log. */
  async recordedSoFar(projectId: string): Promise<{ tool: string; ok: boolean }[]> {
    const saved = await this.store.readArtefact<{ entries: { action: string; ok?: boolean }[] }>(
      projectId,
      'demonstration',
    );
    return (saved?.entries ?? []).map((entry) => ({ tool: entry.action, ok: entry.ok !== false }));
  }

  async teachStep(
    projectId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const project = await this.store.read(projectId);
    return this.workspace.demonstrate(project, tool, args);
  }

  /**
   * Ends the recording, and turns it into a trace and a draft schema.
   *
   * The trace is written to disk here because it is the raw evidence for
   * everything downstream — and it is customer data, so this is also the last
   * moment it is allowed to be anywhere but this machine.
   */
  async finishTeaching(
    projectId: string,
  ): Promise<{ project: Project; questions: SchemaQuestion[]; schema: EnvironmentSchema }> {
    const project = await this.store.read(projectId);
    const finished = await this.workspace.finishDemonstration(project);

    if (finished.entries.length === 0) {
      throw new Error(
        'Nothing was recorded. A demonstration needs at least one action that changes something, ' +
          'because the contract is derived from what changed.',
      );
    }

    const trace = fromActionLog(finished.entries, {
      environmentId: project.id,
      id: `trace_${project.id}`,
      name: project.goal || `${project.name}: the job`,
      before: finished.before,
      after: finished.after,
    });
    await this.store.writeArtefact(projectId, 'trace', trace);
    // Persisted so the review screen survives a reload. It is the one screen
    // whose content cannot be recomputed without redoing the job.
    await this.store.writeArtefact(projectId, 'induced', finished.induced);
    await this.store.writeArtefact(projectId, 'schema', finished.schema);

    const updated: Project = {
      ...project,
      timings: {
        ...project.timings,
        workflowRecordedAt: this.now().toISOString(),
      },
    };
    await this.store.write(updated);
    await this.activation.stage('workflow_recorded', projectId);
    return { project: updated, questions: finished.induced.questions, schema: finished.schema };
  }

  /** Records what a person said about the records RigorRun guessed at. */
  async answerSchema(
    projectId: string,
    answers: { questionId: string; value: string }[],
  ): Promise<Project> {
    const project = await this.store.read(projectId);
    const merged = new Map(project.schemaAnswers.map((answer) => [answer.questionId, answer.value]));
    for (const answer of answers) merged.set(answer.questionId, answer.value);
    const updated: Project = {
      ...project,
      schemaAnswers: [...merged].map(([questionId, value]) => ({ questionId, value })),
    };
    await this.store.write(updated);
    return updated;
  }

  // ------------------------------------------- steps 3 and 4: learn, then rule

  /** Compiles the demonstration into a contract of proposals, none enforced. */
  async compile(projectId: string): Promise<EnvironmentContract> {
    const project = await this.store.read(projectId);
    const trace = await this.store.readArtefact<CanonicalHumanTrace>(projectId, 'trace');
    if (!trace) throw new Error('There is no recorded job to compile yet.');

    await this.workspace.connect(project);
    const schema = await this.schemaOf(project);
    const adapter = this.workspace.environment(project, schema);
    const draft = induceContract(adapter, trace, {
      contractId: `ec_${project.id}`,
      createdAt: this.now().toISOString(),
    }).contract;
    await this.store.writeArtefact(projectId, 'contract', draft);
    return draft;
  }

  /**
   * Applies a person's decisions.
   *
   * Rules left unmentioned stay proposals and do not gate anything, which is
   * the rule that makes it safe to over-propose in the first place.
   */
  async review(
    projectId: string,
    decisions: { confirmedRuleIds?: string[]; rejectedRuleIds?: string[] },
  ): Promise<EnvironmentContract> {
    const draft = await this.store.readArtefact<EnvironmentContract>(projectId, 'contract');
    if (!draft) throw new Error('There is no contract to review yet.');
    const reviewed = applyReview(draft, {
      confirmedRuleIds: decisions.confirmedRuleIds ?? [],
      rejectedRuleIds: decisions.rejectedRuleIds ?? [],
    });
    await this.store.writeArtefact(projectId, 'contract', reviewed);
    if (rulesAwaitingReview(reviewed).length === 0) {
      await this.activation.stage('contract_confirmed', projectId);
    }
    return reviewed;
  }

  // ------------------------------------------------- step 5: build the suite

  async generate(projectId: string): Promise<Benchmark> {
    const project = await this.store.read(projectId);
    const contract = await this.store.readArtefact<EnvironmentContract>(projectId, 'contract');
    if (!contract) throw new Error('There is no contract to generate from yet.');
    if (rulesAwaitingReview(contract).length > 0) {
      throw new Error(
        `${rulesAwaitingReview(contract).length} rule(s) are still waiting on a decision. ` +
          'Nothing RigorRun only inferred can fail an agent until you have confirmed it.',
      );
    }

    const schema = await this.schemaOf(project);
    const { fixture } = await this.registerFor(project, schema);
    const { benchmark } = await generateBenchmark(
      this.workspace.environment(project, schema),
      contract,
      [fixture],
    );
    await this.store.writeArtefact(projectId, 'benchmark', benchmark);

    const updated: Project = {
      ...project,
      timings: { ...project.timings, benchmarkGeneratedAt: this.now().toISOString() },
    };
    await this.store.write(updated);
    await this.activation.stage('benchmark_built', projectId);
    return benchmark;
  }

  // ------------------------------------------------------ step 6: run an agent

  /** Adds an agent, and refuses to call it connected until it answers. */
  async addAgent(
    projectId: string,
    input: { name: string; endpoint: string; allowRemoteHosts?: boolean },
  ): Promise<{ project: Project; agent: AgentConfig }> {
    const project = await this.store.read(projectId);
    const probe = await probeAgent({
      endpoint: input.endpoint,
      ...(input.allowRemoteHosts === undefined ? {} : { allowRemoteHosts: input.allowRemoteHosts }),
    });

    const agent: AgentConfig = {
      id: `a_${randomBytes(4).toString('hex')}`,
      name: input.name || (probe.ok ? probe.name : 'Your agent') || 'Your agent',
      kind: 'http',
      endpoint: input.endpoint,
      command: '',
      args: [],
      lastProbeAt: this.now().toISOString(),
      lastProbeOk: probe.ok,
      lastProbeProblem: probe.ok ? '' : probe.problem,
    };

    const updated: Project = {
      ...project,
      agents: [...project.agents.filter((entry) => entry.endpoint !== input.endpoint), agent],
      timings: {
        ...project.timings,
        agentConnectedAt:
          probe.ok && !project.timings.agentConnectedAt
            ? this.now().toISOString()
            : project.timings.agentConnectedAt,
      },
    };
    await this.store.write(updated);
    if (probe.ok) await this.activation.stage('agent_connected', projectId);
    else await this.activation.attempt('agent_probe_failed', projectId);
    return { project: updated, agent };
  }

  async runAgent(projectId: string, agentId: string): Promise<RunResult> {
    const project = await this.store.read(projectId);
    const benchmark = await this.store.readArtefact<Benchmark>(projectId, 'benchmark');
    if (!benchmark) throw new Error('There is no benchmark to run yet.');

    const config = project.agents.find((entry) => entry.id === agentId);
    if (!config) throw new Error(`No agent "${agentId}" on this project.`);
    if (!config.lastProbeOk) {
      throw new Error(
        `${config.name} has not answered a connection test. ${config.lastProbeProblem}`.trim(),
      );
    }

    const schema = await this.schemaOf(project);
    await this.registerFor(project, schema);

    let result;
    try {
      result = await runBenchmark(benchmark, [this.adapterFor(config)], {
        runId: `run_${randomBytes(6).toString('hex')}`,
      });
    } catch (error) {
      await this.activation.attempt('run_failed', projectId);
      throw error;
    }
    await this.store.writeRun(projectId, result.runId, result);

    const score = result.scores[0];
    const updated: Project = {
      ...project,
      runs: [
        ...project.runs,
        {
          runId: result.runId,
          agentId: config.id,
          agentName: config.name,
          finishedAt: result.finishedAt,
          taskSuccessRate: score?.taskSuccessRate ?? 0,
          policyComplianceRate: score?.policyComplianceRate ?? 0,
          unsafeActions: score?.unsafeActions ?? 0,
          // Counted from the assertion results rather than a per-case tally,
          // which does not exist: severity lives on each failed check.
          criticalFailures: result.caseResults.reduce(
            (total, entry) =>
              total +
              entry.assertions.filter(
                (assertion) => assertion.status === 'FAIL' && assertion.failureSeverity === 'CRITICAL',
              ).length,
            0,
          ),
          thresholdsPassed: score?.thresholdsPassed ?? false,
          verification: result.verification,
          isolation: result.isolation,
          caseCount: benchmark.cases.length,
        },
      ],
      timings: {
        ...project.timings,
        // The clock stops on the first verdict from a real agent against a real
        // system, whichever way that verdict went. A failure is a result.
        firstVerdictAt: project.timings.firstVerdictAt ?? this.now().toISOString(),
      },
      baselineRunId: project.baselineRunId ?? result.runId,
    };
    await this.store.write(updated);

    // A8 whichever way the verdict went — a failure is a result, and a person
    // who got one has activated. A9 is the one that says they came back.
    await this.activation.stage(
      project.runs.length === 0 ? 'first_real_verdict' : 'second_run_completed',
      projectId,
    );
    return result;
  }

  /** What changed since the baseline, or since a named run. */
  async compare(projectId: string, currentRunId: string, baselineRunId?: string): Promise<RunComparison> {
    const project = await this.store.read(projectId);
    const baselineId = baselineRunId ?? project.baselineRunId;
    if (!baselineId) throw new Error('There is nothing to compare against yet.');

    const [baseline, current] = await Promise.all([
      this.store.readRun<RunResult>(projectId, baselineId),
      this.store.readRun<RunResult>(projectId, currentRunId),
    ]);
    if (!baseline) throw new Error(`No stored run "${baselineId}".`);
    if (!current) throw new Error(`No stored run "${currentRunId}".`);
    return compareRuns(baseline, current);
  }

  async setBaseline(projectId: string, runId: string): Promise<Project> {
    const project = await this.store.read(projectId);
    const updated: Project = { ...project, baselineRunId: runId };
    await this.store.write(updated);
    return updated;
  }

  /** A stored artefact, for callers that only want to display it. */
  artefact<T>(projectId: string, name: string): Promise<T | undefined> {
    return this.store.readArtefact<T>(projectId, name);
  }

  /** A stored run in full, including every step and assertion. */
  run(projectId: string, runId: string): Promise<RunResult | undefined> {
    return this.store.readRun<RunResult>(projectId, runId);
  }

  adapterFor(config: AgentConfig): AgentAdapter {
    return createHttpV2Agent({
      id: config.id,
      name: config.name,
      endpoint: config.endpoint,
      proxy: this.options.proxy,
    });
  }

  // ------------------------------------------------------------------ helpers

  /** The confirmed schema, re-derived from the recorded observations. */
  private async schemaOf(project: Project): Promise<EnvironmentSchema> {
    const induced = this.workspace.inducedFor(project.id);
    if (induced) return this.workspace.schemaFor(project, induced);

    const saved = await this.store.readArtefact<EnvironmentSchema>(project.id, 'schema');
    if (saved) return saved;
    throw new Error(
      'RigorRun has not worked out what records this system has yet. Record a job first.',
    );
  }

  /**
   * Registers the environment and captures the world cases will start from.
   *
   * Resetting first matters: the fixture has to be the world the reset
   * produces, or every case would be generated against a world no case will
   * ever actually see.
   */
  private async registerFor(
    project: Project,
    schema: EnvironmentSchema,
  ): Promise<{ fixture: EnvironmentFixture }> {
    // A fresh process has nothing open. Connecting here rather than requiring
    // callers to remember is what lets `rigorrun run --project` work cold, from
    // a build server, with no interface ever having existed.
    await this.workspace.connect(project);
    const build = () => this.workspace.environment(project, schema);
    const environment = build();
    await environment.reset();
    const state = await environment.getState();

    const trace = await this.store.readArtefact<CanonicalHumanTrace>(project.id, 'trace');
    const request = firstActionArgs(trace);

    const fixture: EnvironmentFixture = {
      id: 'live',
      title: 'The system as its reset leaves it',
      summary: `Whatever ${project.reset.kind === 'tool' ? project.reset.tool : 'this system'} restores.`,
      state,
      config: {},
      request,
    };

    clearEnvironments();
    registerEnvironment({
      id: project.id,
      name: project.name,
      description: project.goal || project.name,
      fixtures: [fixture],
      create: build,
    });
    await this.store.writeArtefact(project.id, 'schema', schema);
    return { fixture };
  }
}

/**
 * The arguments the operator was working with.
 *
 * Taken from the last action of the demonstration rather than the first: the
 * job's target is whatever the closing move was about, and an opening read is
 * frequently about something else entirely.
 */
function firstActionArgs(trace: CanonicalHumanTrace | undefined): Record<string, unknown> {
  const actions = trace?.steps.filter((step) => step.kind === 'action') ?? [];
  const combined: Record<string, unknown> = {};
  for (const step of actions) Object.assign(combined, step.action?.args ?? {});
  return combined;
}
