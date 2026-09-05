/**
 * One project, and the six steps in order.
 *
 * The step you are on is derived from what the project has, not tracked
 * separately, so a reload, a deep link or coming back tomorrow all land in the
 * same place — and it is impossible for the interface to think you are further
 * along than your project is. You may go back to any step you have passed;
 * you may not skip forward to one that has nothing to work with, and the
 * disabled step says which thing is missing rather than merely being grey.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Panel, Spinner, Tag } from '../components/primitives.tsx';
import { Problem } from './inputs.tsx';
import { api, type CaseView, type ProjectView, type SchemaQuestionView, type ToolView } from './api.ts';
import { ConnectEnvironment, ReviewLearned, RuleOnRules, TeachJob, ToolCatalogue } from './stages.tsx';
import { ConnectAgent, RunAndVerdict } from './run.tsx';

const STEPS = [
  { id: 'connect', label: 'Connect your system' },
  { id: 'teach', label: 'Show it the job' },
  { id: 'learned', label: 'Review what it learned' },
  { id: 'rules', label: 'Rule on the rules' },
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
  const [questions, setQuestions] = useState<SchemaQuestionView[]>([]);
  const [cases, setCases] = useState<CaseView[]>([]);

  const load = useCallback(async () => {
    try {
      const result = await api.project(projectId);
      setProject(result.project);
      if (result.benchmark) setCases(result.benchmark.cases);
      return result.project;
    } catch (error) {
      setProblem((error as Error).message);
      return null;
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!project) {
    return problem ? (
      <Problem>{problem}</Problem>
    ) : (
      <div className="flex items-center gap-2 text-body text-muted">
        <Spinner /> Opening…
      </div>
    );
  }

  const reached = reachedStep(project, tools.length > 0, questions.length > 0);
  const current = step ?? reached;

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
          {project.connector ? <Tag tone="pass">connected</Tag> : <Tag tone="warn">not connected</Tag>}
          <Tag tone={project.safety === 'production' ? 'fail' : 'neutral'}>{project.safety}</Tag>
        </div>
        {project.goal ? <p className="text-body text-secondary">{project.goal}</p> : null}
      </header>

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

      {current === 'connect' ? (
        tools.length === 0 ? (
          <ConnectEnvironment
            project={project}
            onConnected={(next, discovered, name, latency) => {
              setProject(next);
              setTools(discovered);
              setServerName(name);
              setLatencyMs(latency);
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
          />
        )
      ) : null}

      {current === 'teach' ? (
        tools.length === 0 ? (
          <Reconnect onBack={() => setStep('connect')} />
        ) : (
          <TeachJob
            project={project}
            tools={tools}
            onFinished={(next, asked) => {
              setProject(next);
              setQuestions(asked);
              setStep('learned');
            }}
          />
        )
      ) : null}

      {current === 'learned' ? (
        questions.length === 0 ? (
          <Reconnect onBack={() => setStep('teach')} />
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

      {current === 'run' ? <RunAndVerdict project={project} onRan={() => void load()} /> : null}

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
 * A step that needs something this session does not have.
 *
 * Discovery and the recording live in the runner's memory rather than on disk,
 * so a reload loses them. Saying so and offering the way back is better than a
 * screen that looks broken.
 */
function Reconnect({ onBack }: { onBack: () => void }) {
  return (
    <Panel>
      <p className="text-body text-secondary">
        This step needs the connection that was open earlier in this session, and the page has been
        reloaded since. Go back a step to pick it up again — nothing you saved has been lost.
      </p>
      <div className="mt-3">
        <Button variant="secondary" onClick={onBack} testId="go-back">
          Go back
        </Button>
      </div>
    </Panel>
  );
}

function indexOf(step: StepId): number {
  return STEPS.findIndex((entry) => entry.id === step);
}

/** The furthest step this project's own state justifies. */
function reachedStep(project: ProjectView, hasTools: boolean, hasQuestions: boolean): StepId {
  if (!project.connector) return 'connect';
  if (project.verifierReads.length === 0) return hasTools ? 'connect' : 'connect';
  if (project.timings['workflowRecordedAt'] === null) return 'teach';
  if (hasQuestions) return 'learned';
  if (project.timings['benchmarkGeneratedAt'] === null) return 'rules';
  if (!project.agents.some((agent) => agent.lastProbeOk)) return 'agent';
  return 'run';
}
