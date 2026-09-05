/**
 * Connecting an agent, running it, and reading what happened.
 *
 * The two rules that shape these screens. An agent is not connected because
 * somebody typed a URL — it is connected when it has answered, and until then
 * the screen says what went wrong and offers to try again. And a verdict never
 * appears without how it was reached beside it: a pass against a system nothing
 * could be read back from is a different claim from a pass against one that
 * could, and only one of them is worth acting on.
 */
import { useState } from 'react';
import { Button, Metric, Panel, SectionLabel, StatusMark, Tag } from '../components/primitives.tsx';
import { Field, Problem, TextInput } from './inputs.tsx';
import { api, type ActivationView, type ComparisonView, type ProjectView, type RunView } from './api.ts';

export function ConnectAgent({
  project,
  onConnected,
}: {
  project: ProjectView;
  onConnected: (project: ProjectView) => void;
}) {
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:8900/');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function add(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await api.addAgent(project.id, name.trim(), endpoint.trim());
      if (!result.agent.lastProbeOk) {
        // Saved, because the endpoint is worth keeping while it is fixed, but
        // never presented as connected.
        setProblem(result.agent.lastProbeProblem);
      }
      onConnected(result.project);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <div className="flex max-w-2xl flex-col gap-4">
          <p className="text-body text-secondary">
            RigorRun gives your agent one task at a time, and a URL to work through. Your agent
            connects to that URL, works however it normally works, and says when it is done.
          </p>
          <div className="rounded-panel border border-line bg-inset px-3 py-2.5">
            <p className="text-meta font-medium text-secondary">What you need</p>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-meta text-muted">
              <li>
                Your agent running and listening on an address — on this machine by default.
              </li>
              <li>
                It has to answer one small request saying it is there. If it already speaks MCP,
                that plus about ten lines is the whole integration.
              </li>
            </ul>
            <p className="mt-2 text-meta text-muted">
              Next: RigorRun sends a test request and waits. It will not call your agent connected
              until it answers.
            </p>
          </div>
          <Field label="What is it called?">
            {({ id }) => (
              <TextInput id={id} value={name} onChange={setName} placeholder="Support agent" testId="agent-name" />
            )}
          </Field>
          <Field
            label="Where does it listen?"
            hint="On this machine by default, because an agent under test usually holds credentials for the system it is being tested against."
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                describedBy={describedBy}
                value={endpoint}
                onChange={setEndpoint}
                testId="agent-endpoint"
              />
            )}
          </Field>
          {problem ? <Problem>{problem}</Problem> : null}
          <div>
            <Button onClick={add} disabled={busy} testId="add-agent">
              {busy ? 'Trying it…' : 'Check it answers'}
            </Button>
          </div>
        </div>
      </Panel>

      {project.agents.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>Connected</SectionLabel>
          {project.agents.map((agent) => (
            <Panel key={agent.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-body text-fg">{agent.name}</span>
                  <span className="font-mono text-meta text-muted">{agent.endpoint}</span>
                </div>
                {agent.lastProbeOk ? (
                  <Tag tone="pass">answering</Tag>
                ) : (
                  <div className="flex flex-col items-end gap-1">
                    <Tag tone="fail">not answering</Tag>
                    <span className="max-w-md text-right text-meta text-muted">
                      {agent.lastProbeProblem}
                    </span>
                  </div>
                )}
              </div>
            </Panel>
          ))}
        </section>
      ) : null}
    </div>
  );
}

export function RunAndVerdict({
  project,
  activation,
  onRan,
}: {
  project: ProjectView;
  activation: ActivationView | null;
  onRan: () => void;
}) {
  const [run, setRun] = useState<RunView | null>(null);
  const [comparison, setComparison] = useState<ComparisonView | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const ready = project.agents.filter((agent) => agent.lastProbeOk);

  async function go(agentId: string): Promise<void> {
    setBusy(true);
    setProblem('');
    setComparison(null);
    try {
      const result = await api.run(project.id, agentId);
      setRun(result.run);
      // A first run has nothing to compare against, and the runner says so by
      // failing rather than by inventing an empty diff. That is not an error
      // worth showing anybody.
      const compared = await api.compare(project.id, result.run.runId).catch(() => null);
      if (compared) setComparison(compared.comparison);
      onRan();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {ready.length === 0 ? (
        <Panel>
          <p className="text-body text-secondary">
            Your tests are ready and nothing is missing except an agent that answers. Go back a
            step to connect one.
          </p>
        </Panel>
      ) : (
        <Panel>
          <div className="flex flex-wrap items-center gap-3">
            {ready.map((agent) => (
              <Button
                key={agent.id}
                onClick={() => go(agent.id)}
                disabled={busy}
                testId={`run-${agent.id}`}
              >
                {busy ? 'Running…' : `Run ${agent.name}`}
              </Button>
            ))}
          </div>
        </Panel>
      )}

      {problem ? <Problem>{problem}</Problem> : null}
      {run ? <Verdict run={run} /> : null}
      {run && activation?.humanMsToFirstVerdict !== null && activation !== null ? (
        <TimeToFirstVerdict activation={activation} />
      ) : null}
      {comparison ? <Comparison comparison={comparison} /> : null}
    </div>
  );
}

function Verdict({ run }: { run: RunView }) {
  const score = run.scores[0];
  const passed = score?.thresholdsPassed ?? false;

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`text-title font-semibold ${passed ? 'text-pass' : 'text-fail'}`}
              data-testid="verdict"
            >
              {passed ? 'PASS' : 'FAIL'}
            </span>
            {/* How it was reached, next to what it says. Never one without the other. */}
            <Tag tone={run.verification === 'AUTHORITATIVE' ? 'pass' : 'warn'}>
              verified: {run.verification}
            </Tag>
            <Tag tone={run.isolation === 'RESET' ? 'pass' : 'warn'}>
              isolation: {run.isolation}
            </Tag>
          </div>

          <div className="flex flex-wrap gap-8">
            <Metric label="Task success" value={`${((score?.taskSuccessRate ?? 0) * 100).toFixed(1)}%`} />
            <Metric
              label="Policy compliance"
              value={`${((score?.policyComplianceRate ?? 0) * 100).toFixed(1)}%`}
            />
            <Metric label="Unsafe actions" value={String(score?.unsafeActions ?? 0)} />
            <Metric label="Cases" value={String(run.caseResults.length)} />
          </div>
        </div>
      </Panel>

      {run.limits.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>What this system stopped RigorRun doing</SectionLabel>
          {run.limits.map((limit) => (
            <Panel key={limit.id}>
              <p className="text-body text-secondary">{limit.limit}</p>
              {limit.remedy ? <p className="mt-1 text-meta text-muted">{limit.remedy}</p> : null}
            </Panel>
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <SectionLabel>Case by case</SectionLabel>
        <ul className="flex flex-col gap-1">
          {run.caseResults.map((entry) => (
            <li
              key={entry.caseId}
              className="flex flex-wrap items-center gap-3 rounded-control bg-inset px-3 py-2"
              data-testid={`case-${entry.caseId}`}
            >
              <StatusMark status={entry.taskSuccess && entry.policyCompliant ? 'pass' : 'fail'} />
              <span className="min-w-0 flex-1 truncate text-body text-fg">{entry.caseName}</span>
              <Tag tone="neutral">{entry.category}</Tag>
              {entry.unsafeActions > 0 ? (
                <Tag tone="fail">{entry.unsafeActions} unsafe</Tag>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {run.notTestable.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>Not covered, and why</SectionLabel>
          <ul className="flex flex-col gap-1">
            {run.notTestable.map((entry, index) => (
              <li key={index} className="text-meta text-muted">
                {entry.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Comparison({ comparison }: { comparison: ComparisonView }) {
  if (!comparison.comparable) {
    return (
      <Panel>
        <p className="text-body text-secondary">{comparison.incomparableReason}</p>
      </Panel>
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>Against the last run</SectionLabel>
      <Panel>
        <p className="text-body text-fg" data-testid="comparison-headline">
          {comparison.headline}
        </p>
        <ul className="mt-3 flex flex-col gap-1">
          {comparison.regressed.map((entry) => (
            <li key={entry.caseId} className="text-meta">
              <span className="text-fail">regressed</span>{' '}
              <span className="text-fg">{entry.caseName}</span>{' '}
              <span className="text-muted">— {entry.detail}</span>
            </li>
          ))}
          {comparison.improved.map((entry) => (
            <li key={entry.caseId} className="text-meta">
              <span className="text-pass">improved</span>{' '}
              <span className="text-fg">{entry.caseName}</span>{' '}
              <span className="text-muted">— {entry.detail}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}

/**
 * How long this took a person.
 *
 * Not how long the run took — that number is small, flattering and useless.
 * This is wall-clock time from making the project to holding a verdict, which
 * includes reading, deciding, getting a connector wrong once, and going to make
 * coffee. It is the only number that says whether this product is usable, and
 * the only one nobody can improve by optimising a loop.
 */
function TimeToFirstVerdict({ activation }: { activation: ActivationView }) {
  const ms = activation.humanMsToFirstVerdict;
  if (ms === null) return null;

  const retries = Object.values(activation.attempts).reduce((total, count) => total + count, 0);

  return (
    <Panel>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="text-meta text-muted">First real verdict</p>
          <p className="mt-1 text-metric font-semibold text-fg" data-testid="time-to-verdict">
            {formatElapsed(ms)}
          </p>
        </div>
        <p className="max-w-md text-meta text-muted">
          From creating this project to a pass or fail from your own agent against your own system.
          {retries > 0
            ? ` Including ${retries} thing${retries === 1 ? '' : 's'} that had to be tried twice.`
            : ''}
        </p>
      </div>
    </Panel>
  );
}

/** "12m 34s". The same shape the CLI prints, so the two never disagree. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
