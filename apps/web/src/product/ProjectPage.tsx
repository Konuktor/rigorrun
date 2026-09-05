/**
 * One project, and the six steps in order.
 *
 * The page rebuilds itself from disk. Everything it needs — what the system
 * published, what was recorded so far, what RigorRun worked out, how far along
 * this is — comes back from one request, so a refresh, a closed laptop or a
 * restarted runner all land where the person left off rather than at the
 * beginning. That was the single largest hole in the first version: setup lived
 * in a browser tab, and a stray reload cost twenty minutes of somebody's real
 * work in a real system.
 *
 * The step you are on is derived from what the project has rather than tracked
 * separately, so the interface cannot think you are further along than your
 * project is. You may go back to any step you have passed; a step with nothing
 * to work with says which thing is missing rather than merely being grey.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Panel, Spinner, Tag } from '../components/primitives.tsx';
import { Problem } from './inputs.tsx';
import {
  api,
  type ActivationView,
  type CaseView,
  type DriftView,
  type ProjectView,
  type SchemaQuestionView,
  type ToolView,
} from './api.ts';
import { ConnectEnvironment, ReviewLearned, RuleOnRules, TeachJob, ToolCatalogue } from './stages.tsx';
import { ConnectAgent, RunAndVerdict } from './run.tsx';

const STEPS = [
  { id: 'connect', label: 'Connect your system' },
  { id: 'teach', label: 'Show it the job' },
  { id: 'learned', label: 'Check what it worked out' },
  { id: 'rules', label: 'Decide the rules' },
  { id: 'agent', label: 'Connect your agent' },
  { id: 'run', label: 'Run it' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

export function ProjectPage({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [problem, setProblem] = useState('');
  const [step, setStep] = useState<StepId | null>(null);

  const [tools, setTools] = useState<ToolView[]>([]);
  const [serverName, setServerName] = useState('');
  const [latencyMs, setLatencyMs] = useState(0);
  const [connected, setConnected] = useState(false);
  const [drift, setDrift] = useState<DriftView | null>(null);
  const [questions, setQuestions] = useState<SchemaQuestionView[]>([]);
  const [cases, setCases] = useState<CaseView[]>([]);
  const [recording, setRecording] = useState<{ tool: string; ok: boolean }[]>([]);
  /**
   * Whether a recording is open, which is not the same as whether anything has
   * been written into it. A recording whose steps so far are all reads still
   * holds the before-state — captured by resetting somebody's system — and
   * offering to start over would throw that away.
   */
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [activation, setActivation] = useState<ActivationView | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.project(projectId);
      setProject(result.project);
      setConnected(result.environment.connected);
      setActivation(result.activation);
      // From the last successful connection, so the catalogue is there even
      // when the session is not.
      if (result.environment.discovery) {
        setTools(result.environment.discovery.tools);
        setServerName(result.environment.discovery.serverName);
        setLatencyMs(result.environment.discovery.latencyMs);
      }
      if (result.questions.length > 0) setQuestions(result.questions);
      if (result.benchmark) setCases(result.benchmark.cases);
      setRecording(result.recording.steps);
      setRecordingOpen(result.recording.inProgress);
      return result.project;
    } catch (error) {
      setProblem((error as Error).message);
      return null;
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reconnect(): Promise<void> {
    setReconnecting(true);
    setProblem('');
    try {
      const result = await api.reconnect(projectId);
      setTools(result.tools);
      setServerName(result.serverName);
      setLatencyMs(result.latencyMs);
      setDrift(result.drift);
      setConnected(true);
      await load();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setReconnecting(false);
    }
  }

  if (!project) {
    return problem ? (
      <Problem>{problem}</Problem>
    ) : (
      <div className="flex items-center gap-2 text-body text-muted">
        <Spinner /> Opening…
      </div>
    );
  }

  const reached = reachedStep(project, questions.length > 0);
  const current = step ?? reached;
  const needsConnection = current !== 'connect' && current !== 'run';

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onBack}
          className="self-start text-meta text-muted hover:text-fg"
        >
          ← All projects
        </button>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-title font-semibold">{project.name}</h1>
          {project.connector ? (
            connected ? (
              <Tag tone="pass">connected</Tag>
            ) : (
              <Tag tone="warn">not connected</Tag>
            )
          ) : (
            <Tag tone="neutral">no system yet</Tag>
          )}
          <Tag tone={project.safety === 'production' ? 'fail' : 'neutral'}>{project.safety}</Tag>
        </div>
        {project.goal ? <p className="text-body text-secondary">{project.goal}</p> : null}
      </header>

      {project.connector && !connected ? (
        <Disconnected onReconnect={reconnect} busy={reconnecting} />
      ) : null}
      {drift ? <Drift drift={drift} onDismiss={() => setDrift(null)} /> : null}

      <nav aria-label="Steps" className="flex flex-wrap gap-2">
        {STEPS.map((entry, index) => {
          const available = index <= indexOf(reached);
          return (
            <button
              key={entry.id}
              type="button"
              disabled={!available}
              onClick={() => setStep(entry.id)}
              data-testid={`step-${entry.id}`}
              aria-current={current === entry.id ? 'step' : undefined}
              className={`rounded-pill border px-3 py-1 text-meta ${
                current === entry.id
                  ? 'border-line-strong bg-raised text-fg'
                  : available
                    ? 'border-line text-secondary hover:text-fg'
                    : 'border-line-soft text-disabled'
              }`}
            >
              {index + 1}. {entry.label}
            </button>
          );
        })}
      </nav>

      {project.nextSteps.length > 0 ? (
        <Panel>
          <p className="text-body text-fg">{project.nextSteps[0]!.what}</p>
          <p className="mt-1 text-meta text-muted">{project.nextSteps[0]!.why}</p>
        </Panel>
      ) : null}

      {problem ? <Problem>{problem}</Problem> : null}

      {needsConnection && project.connector && !connected ? null : (
        <>
          {current === 'connect' ? (
            tools.length === 0 ? (
              <ConnectEnvironment
                project={project}
                onConnected={(next, discovered, name, latency) => {
                  setProject(next);
                  setTools(discovered);
                  setServerName(name);
                  setLatencyMs(latency);
                  setConnected(true);
                }}
              />
            ) : (
              <ToolCatalogue
                project={project}
                tools={tools}
                serverName={serverName}
                latencyMs={latencyMs}
                onConfigured={(next) => {
                  setProject(next);
                  setStep('teach');
                }}
                onStartOver={() => setTools([])}
              />
            )
          ) : null}

          {current === 'teach' ? (
            <TeachJob
              project={project}
              tools={tools}
              alreadyRecorded={recording}
              recordingOpen={recordingOpen}
              onFinished={(next, asked) => {
                setProject(next);
                setQuestions(asked);
                setRecording([]);
                setStep('learned');
              }}
            />
          ) : null}

          {current === 'learned' ? (
            questions.length === 0 ? (
              <NothingYet
                what="RigorRun has not worked out any records yet."
                why="That happens after you have shown it the job once."
                onBack={() => setStep('teach')}
              />
            ) : (
              <ReviewLearned
                project={project}
                questions={questions}
                onAnswered={(next) => {
                  setProject(next);
                  setStep('rules');
                }}
              />
            )
          ) : null}

          {current === 'rules' ? (
            <RuleOnRules
              project={project}
              onGenerated={(built) => {
                setCases(built);
                setStep('agent');
                void load();
              }}
            />
          ) : null}

          {current === 'agent' ? (
            <>
              {cases.length > 0 ? (
                <Panel>
                  <p className="text-body text-secondary" data-testid="suite-size">
                    {cases.length} cases built from what you showed it.
                  </p>
                </Panel>
              ) : null}
              <ConnectAgent project={project} onConnected={setProject} />
            </>
          ) : null}
        </>
      )}

      {current === 'run' ? (
        <RunAndVerdict
          project={project}
          activation={activation}
          onRan={() => void load()}
        />
      ) : null}

      {current === 'agent' && project.agents.some((agent) => agent.lastProbeOk) ? (
        <div>
          <Button onClick={() => setStep('run')} testId="to-run">
            Run the suite
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The state after a restart.
 *
 * An MCP session does not survive the runner going away — a local connector is
 * a child process, and it is gone. Saying so is better than the alternative,
 * which is a page that looks fine until the first thing you click fails.
 */
function Disconnected({ onReconnect, busy }: { onReconnect: () => void; busy: boolean }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-body text-fg">RigorRun is not talking to your system right now.</p>
          <p className="mt-1 text-meta text-muted">
            Your project, your settings and your credentials are all still here. Only the live
            connection needs opening again — it does not survive the runner restarting.
          </p>
        </div>
        <Button onClick={onReconnect} disabled={busy} testId="reconnect">
          {busy ? 'Reconnecting…' : 'Reconnect'}
        </Button>
      </div>
    </Panel>
  );
}

/** What changed in somebody else's system while we were not looking. */
function Drift({ drift, onDismiss }: { drift: DriftView; onDismiss: () => void }) {
  if (drift.unchanged) {
    return (
      <Panel>
        <div className="flex items-center justify-between gap-4">
          <p className="text-body text-secondary">
            Reconnected. Your system is publishing exactly the tools it was before.
          </p>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-body text-fg">Your system has changed since you set this up.</p>
            <p className="mt-1 text-meta text-muted">
              Your suite still runs. Whether it still means the same thing is a judgement about
              your tools, so it is yours to make.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onDismiss} testId="dismiss-drift">
            Dismiss
          </Button>
        </div>
        <ul className="flex flex-col gap-1" data-testid="drift-list">
          {drift.drifts.map((entry, index) => (
            <li key={index} className="flex gap-2 text-meta">
              <Tag tone={entry.serious ? 'warn' : 'neutral'}>
                {entry.serious ? 'check this' : 'harmless'}
              </Tag>
              <span className="text-secondary">{entry.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function NothingYet({
  what,
  why,
  onBack,
}: {
  what: string;
  why: string;
  onBack: () => void;
}) {
  return (
    <Panel>
      <p className="text-body text-fg">{what}</p>
      <p className="mt-1 text-meta text-muted">{why}</p>
      <div className="mt-3">
        <Button variant="secondary" onClick={onBack} testId="go-back">
          Go back a step
        </Button>
      </div>
    </Panel>
  );
}

function indexOf(step: StepId): number {
  return STEPS.findIndex((entry) => entry.id === step);
}

/** The furthest step this project's own state justifies. */
function reachedStep(project: ProjectView, hasQuestions: boolean): StepId {
  if (!project.connector) return 'connect';
  if (project.verifierReads.length === 0) return 'connect';
  if (project.timings['workflowRecordedAt'] === null) return 'teach';
  if (project.timings['benchmarkGeneratedAt'] === null) return hasQuestions ? 'learned' : 'rules';
  if (!project.agents.some((agent) => agent.lastProbeOk)) return 'agent';
  return 'run';
}
