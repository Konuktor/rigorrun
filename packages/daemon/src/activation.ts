/**
 * How far somebody got, and how long it took them.
 *
 * The metric that matters is not how fast RigorRun executes. A benchmark that
 * runs in 0.7s of machine time tells us the machinery is not the bottleneck and
 * nothing whatsoever about whether a person can get through the setup — and it
 * is exactly the number that would let us believe onboarding is fast while
 * every stranger who tries gives up at step three.
 *
 * So this measures *wall-clock human time* from creating a project to a first
 * pass or fail from their own agent against their own system, and it counts the
 * things that go wrong on the way: connection attempts that failed, steps
 * repeated, agents that did not answer.
 *
 * What it never records: task content, tool arguments, tool results, record
 * names, credentials, URLs, commands, project names, goals. A stage id, a
 * timestamp, a counter, and a coarse error *class* — nothing that could
 * describe somebody's business.
 *
 * It writes to a local file. There is no upload, no endpoint and no opt-out to
 * configure, because there is nothing to opt out of yet: if telemetry is ever
 * added, this is the shape it would send, and a person can read the file first.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * The funnel.
 *
 * Ordered, because the useful question is always "how far did they get", and a
 * set of unordered booleans cannot answer it.
 */
export const ACTIVATION_STAGES = [
  'installation_started',
  'runner_started',
  'project_created',
  'environment_connected',
  'workflow_recorded',
  'contract_confirmed',
  'benchmark_built',
  'agent_connected',
  'first_real_verdict',
  'second_run_completed',
] as const;
export type ActivationStage = (typeof ACTIVATION_STAGES)[number];

/** `A0`…`A9`, for reading a funnel at a glance. */
export function stageCode(stage: ActivationStage): string {
  return `A${ACTIVATION_STAGES.indexOf(stage)}`;
}

/**
 * Things that went wrong, counted rather than described.
 *
 * A class, never a message: a connection failure's message contains a
 * hostname, a command line, or somebody's stack trace.
 */
export const ATTEMPT_KINDS = [
  'environment_connection_failed',
  'environment_reconnected',
  'agent_probe_failed',
  'recording_restarted',
  'run_failed',
] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

export interface ActivationEvent {
  at: string;
  /** Which project, so one person's two attempts are not one funnel. */
  project: string | null;
  stage?: ActivationStage;
  attempt?: AttemptKind;
  /** Counts only. Never a name, a path or a message. */
  counts?: Record<string, number>;
}

const LOG_FILE = 'activation.jsonl';

/**
 * Whether a stage came from real work or from the bundled example.
 *
 * The distinction the whole funnel rests on. Somebody clicking through the
 * offline example has not connected anything, and counting it would let us
 * congratulate ourselves on activation we did not earn. The example does not
 * touch a project, so it cannot reach this file at all — but the rule is
 * written down because the next person to add an event will be tempted.
 */
export class ActivationLog {
  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get path(): string {
    return join(this.root, LOG_FILE);
  }

  /** Records a stage. Repeats are kept: reaching one twice is a real signal. */
  async stage(stage: ActivationStage, project: string | null = null): Promise<void> {
    await this.append({ at: this.now().toISOString(), project, stage });
  }

  /** Records something that did not work, as a class with no detail. */
  async attempt(attempt: AttemptKind, project: string | null = null): Promise<void> {
    await this.append({ at: this.now().toISOString(), project, attempt });
  }

  private async append(event: ActivationEvent): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    } catch {
      // Never let measurement break the thing being measured. A funnel that
      // can fail a run is worse than no funnel.
    }
  }

  async read(): Promise<ActivationEvent[]> {
    try {
      const raw = await readFile(this.path, 'utf8');
      return raw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as ActivationEvent);
    } catch {
      return [];
    }
  }

  /** True when nothing has ever happened here — the first observable moment. */
  async isNew(): Promise<boolean> {
    return (await this.read()).length === 0;
  }

  async summary(project?: string): Promise<ActivationSummary> {
    return summarise(await this.read(), project);
  }
}

export interface ActivationSummary {
  /** The furthest stage reached, and how many of the ten that is. */
  reached: ActivationStage | null;
  reachedIndex: number;
  stages: { stage: ActivationStage; code: string; at: string }[];
  /**
   * Wall-clock milliseconds from creating a project to the first verdict.
   *
   * A person's time, including the time they spent reading, deciding and
   * making coffee. That is the point: it is the only number that says whether
   * this is usable, and it is the one nobody can make look good by optimising
   * a loop.
   */
  humanMsToFirstVerdict: number | null;
  /** Failures by class. */
  attempts: Record<string, number>;
}

export function summarise(
  events: readonly ActivationEvent[],
  project?: string,
): ActivationSummary {
  const mine = project ? events.filter((event) => event.project === project) : events;

  const stages: ActivationSummary['stages'] = [];
  for (const stage of ACTIVATION_STAGES) {
    const first = mine.find((event) => event.stage === stage);
    if (first) stages.push({ stage, code: stageCode(stage), at: first.at });
  }

  const attempts: Record<string, number> = {};
  for (const event of mine) {
    if (event.attempt) attempts[event.attempt] = (attempts[event.attempt] ?? 0) + 1;
  }

  const created = stages.find((entry) => entry.stage === 'project_created');
  const verdict = stages.find((entry) => entry.stage === 'first_real_verdict');

  const furthest = [...stages].sort(
    (a, b) => ACTIVATION_STAGES.indexOf(b.stage) - ACTIVATION_STAGES.indexOf(a.stage),
  )[0];

  return {
    reached: furthest?.stage ?? null,
    reachedIndex: furthest ? ACTIVATION_STAGES.indexOf(furthest.stage) : -1,
    stages,
    humanMsToFirstVerdict:
      created && verdict ? Date.parse(verdict.at) - Date.parse(created.at) : null,
    attempts,
  };
}

/** "12m 34s". What a person sees, not what a dashboard aggregates. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
