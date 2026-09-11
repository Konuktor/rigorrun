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
import { useEffect, useState } from 'react';
import { Button, Panel, SectionLabel, StatusMark, Tag } from '../components/primitives.tsx';
import { Field, Problem, Select, TextArea, TextInput } from './inputs.tsx';
import {
  api,
  type ActivationView,
  type CaseResultView,
  type ComparisonView,
  type ImportedTraceView,
  type ProjectView,
  type RunView,
  type WaitingView,
} from './api.ts';

export function ConnectAgent({
  project,
  onConnected,
}: {
  project: ProjectView;
  onConnected: (project: ProjectView) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'http' | 'process' | 'external'>('http');
  /** Shown once, when the agent is made. There is no way to read it back. */
  const [key, setKey] = useState('');
  const [keyFor, setKeyFor] = useState('');
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:8900/');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function add(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await api.addAgent(
        project.id,
        kind === 'external'
          ? { name: name.trim(), driven: true }
          : kind === 'process'
            ? {
                name: name.trim(),
                command: command.trim(),
                args: args
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              }
            : { name: name.trim(), endpoint: endpoint.trim() },
      );
      if (result.key) {
        setKey(result.key);
        setKeyFor(result.agent.id);
      }
      else if (!result.agent.lastProbeOk) {
        // Saved, because the endpoint is worth keeping while it is fixed, but
        // never presented as connected. A driven agent is a different case:
        // there is nothing to probe, so not answering yet is not a problem.
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
          <Field label="How does RigorRun reach it?">
            {({ id }) => (
              <Select
                id={id}
                value={kind}
                onChange={(value) => setKind(value as 'http' | 'process' | 'external')}
                testId="agent-kind"
                options={[
                  { value: 'http', label: 'It listens on an address' },
                  { value: 'process', label: 'It is a command on this machine' },
                  { value: 'external', label: 'RigorRun cannot start it — I will drive it' },
                ]}
              />
            )}
          </Field>
          <div className="rounded-panel border border-line bg-inset px-3 py-2.5">
            <p className="text-meta font-medium text-secondary">What you need</p>
            {kind === 'external' ? (
              <>
                <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-meta text-muted">
                  <li>
                    Something that can ask RigorRun for work — a loop of about twenty lines, in
                    whatever language your agent is already in.
                  </li>
                  <li>
                    It asks what to do, works through the address it is handed, and says when it is
                    finished. RigorRun never calls it, so it can live behind a login, in a
                    notebook, or anywhere that will not take a request from this machine.
                  </li>
                </ul>
                <p className="mt-2 text-meta text-muted">
                  Next: RigorRun gives you a key. It is shown once, and it is what your loop uses
                  to ask for work.
                </p>
              </>
            ) : (
              <>
                <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-meta text-muted">
                  <li>
                    Your agent running and listening on an address — on this machine by default.
                  </li>
                  <li>
                    It has to answer one small request saying it is there. If it already speaks
                    MCP, that plus about ten lines is the whole integration.
                  </li>
                </ul>
                <p className="mt-2 text-meta text-muted">
                  Next: RigorRun sends a test request and waits. It will not call your agent
                  connected until it answers.
                </p>
              </>
            )}
          </div>
          <Field label="What is it called?">
            {({ id }) => (
              <TextInput
                id={id}
                value={name}
                onChange={setName}
                placeholder="Support agent"
                testId="agent-name"
              />
            )}
          </Field>
          {kind === 'external' ? null : kind === 'http' ? (
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
          ) : (
            <>
              <Field
                label="Command"
                hint="Just the program. RigorRun runs it directly rather than through a shell, so nothing here is interpreted as shell syntax — and only what you type here is ever run."
              >
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    describedBy={describedBy}
                    value={command}
                    onChange={setCommand}
                    placeholder="/usr/local/bin/my-agent"
                    testId="agent-command"
                  />
                )}
              </Field>
              <Field label="Arguments" hint="One per line. RigorRun starts it once per case.">
                {({ id, describedBy }) => (
                  <TextArea
                    id={id}
                    describedBy={describedBy}
                    value={args}
                    onChange={setArgs}
                    rows={2}
                    testId="agent-args"
                  />
                )}
              </Field>
            </>
          )}
          {problem ? <Problem>{problem}</Problem> : null}
          {key ? <TheKey value={key} agentId={keyFor} /> : null}
          <div>
            <Button onClick={add} disabled={busy} testId="add-agent">
              {busy
                ? 'Trying it…'
                : kind === 'external'
                  ? 'Make a key'
                  : 'Check it answers'}
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
                  <span className="font-mono text-meta text-muted">
                    {agent.kind === 'http'
                      ? agent.endpoint
                      : agent.kind === 'external'
                        ? 'driven by you'
                        : [agent.command, ...agent.args].join(' ')}
                  </span>
                </div>
                {agent.lastProbeOk ? (
                  <Tag tone="pass">{agent.kind === 'external' ? 'checked in' : 'answering'}</Tag>
                ) : agent.kind === 'external' ? (
                  <div className="flex flex-col items-end gap-1">
                    {/* Not a failure. Nothing has gone wrong until a run starts
                        and nobody comes. */}
                    <Tag tone="warn">waiting for it to check in</Tag>
                    <span className="max-w-md text-right text-meta text-muted">
                      Start your loop; it becomes connected the first time it asks for work.
                    </span>
                  </div>
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

/**
 * What the person's own agent is being asked to do, while it does it.
 *
 * A run against an agent RigorRun cannot start looks identical to a hung run
 * unless somebody can see which case is open and how far along it is. This is
 * the difference between "it is stuck" and "it is on case nine of twelve".
 */
function Waiting({ projectId, agentId }: { projectId: string; agentId: string }) {
  const [waiting, setWaiting] = useState<WaitingView | null>(null);

  useEffect(() => {
    let live = true;
    const tick = async (): Promise<void> => {
      const answer = await api.waiting(projectId, agentId).catch(() => null);
      if (live && answer) setWaiting(answer.waiting);
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [projectId, agentId]);

  return (
    <Panel>
      <div className="flex flex-col gap-1" data-testid="waiting-for-agent" aria-live="polite">
        <p className="text-body text-fg">
          {waiting
            ? `Waiting for your agent — case ${waiting.index} of ${waiting.total}.`
            : 'Waiting for your agent.'}
        </p>
        <p className="text-meta text-muted">
          {waiting
            ? waiting.task.instruction
            : 'Your loop should be asking RigorRun for work. Nothing is wrong yet.'}
        </p>
      </div>
    </Panel>
  );
}

/**
 * The key, shown once.
 *
 * There is deliberately no way to read it back — the same rule every other
 * credential in RigorRun follows, and the reason a project file can be copied
 * without carrying anything. If it is lost, make another agent.
 */
function TheKey({ value, agentId }: { value: string; agentId: string }) {
  return (
    <div className="rounded-panel border border-line bg-inset px-3 py-2.5">
      <p className="text-meta font-medium text-secondary">Your agent&rsquo;s key</p>
      <p
        className="mt-1 break-all font-mono text-meta text-fg"
        data-testid="agent-key"
        tabIndex={0}
        role="region"
        aria-label="Your agent's key"
      >
        {value}
      </p>
      <p className="mt-2 text-meta text-muted">
        Copy it now. It is not stored anywhere you can read it back, and it is not in the project
        file. It lets your agent ask for work and say it is finished, and nothing else.
      </p>
      <p className="mt-2 text-meta text-muted">
        Your loop asks{' '}
        <code className="font-mono text-fg">GET /api/drive/{agentId}</code> for work and posts to{' '}
        <code className="font-mono text-fg">/api/drive/{agentId}/finished</code> when it is done,
        both with that key as a bearer header.
      </p>
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
  /** Which agent is being run, so a driven one can be watched while it works. */
  const [running, setRunning] = useState<string>('');

  const ready = project.agents.filter((agent) => agent.lastProbeOk);
  const driven = ready.find((agent) => agent.id === running && agent.kind === 'external');

  async function go(agentId: string): Promise<void> {
    setRunning(agentId);
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
      setRunning('');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {driven && busy ? <Waiting projectId={project.id} agentId={driven.id} /> : null}
      {ready.length === 0 ? (
        <Panel>
          <p className="text-body text-secondary">
            Your tests are ready and nothing is missing except an agent that answers. Go back a step
            to connect one.
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

/**
 * The decision, and how much of it RigorRun can stand behind.
 *
 * `PASS` used to sit here with the verification strength as a tag beside it,
 * which meant the most common real outcome — thresholds met, but only some of
 * the system readable — looked exactly like the strongest one. Nothing forced
 * anybody to read the caveat.
 *
 * So the caveat is the headline. `CONDITIONAL` is not a softer pass: it says
 * the numbers are fine and RigorRun could not see enough to promise they mean
 * what they look like.
 */
function safeToShip(run: RunView): {
  answer: 'YES' | 'CONDITIONAL' | 'NO';
  tone: 'pass' | 'warn' | 'fail';
  because: string;
} {
  if (!(run.scores[0]?.thresholdsPassed ?? false)) {
    return { answer: 'NO', tone: 'fail', because: 'This run missed the bar you set.' };
  }
  if (run.verification !== 'AUTHORITATIVE') {
    return {
      answer: 'CONDITIONAL',
      tone: 'warn',
      because:
        run.verification === 'OBSERVATIONAL'
          ? 'Every check passed, and none of them looked at your system — RigorRun watched what your agent did and could not read back what changed.'
          : 'Every check passed against the parts of your system RigorRun can read. It cannot speak for the parts it was not given a read for.',
    };
  }
  if (run.isolation === 'NONE') {
    return {
      answer: 'CONDITIONAL',
      tone: 'warn',
      because:
        'Every check passed, but the cases could not be isolated from each other — without a way to put your system back, a later case starts wherever the previous one left it.',
    };
  }
  return {
    answer: 'YES',
    tone: 'pass',
    because: 'Every check passed, read back from your own system, with each case starting clean.',
  };
}

function Verdict({ run }: { run: RunView }) {
  const score = run.scores[0];
  const shipping = safeToShip(run);

  /*
   * Written out rather than interpolated: Tailwind generates the classes it can
   * see in the source, and `text-${tone}` is not one it can see.
   */
  const tone =
    shipping.tone === 'pass'
      ? { text: 'text-pass', border: 'border-pass-line', bg: 'bg-pass-bg' }
      : shipping.tone === 'warn'
        ? { text: 'text-warn', border: 'border-warn-line', bg: 'bg-warn-bg' }
        : { text: 'text-fail', border: 'border-fail-line', bg: 'bg-fail-bg' };

  return (
    <div className="flex flex-col gap-4">
      {/*
       * The answer, at the size of an answer.
       *
       * This used to be 22px in a row of tags, which made the single most
       * important word in the product smaller than the project title above it.
       * The verification strength and the isolation level sit inside the same
       * bordered block, because a verdict read without them is a verdict
       * misread — CONDITIONAL is not a softer PASS, and PARTIAL is not a
       * footnote on YES.
       */}
      <section className={`rounded-panel border ${tone.border} ${tone.bg}`}>
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <SectionLabel>Safe to ship?</SectionLabel>
              <p
                className={`mt-1.5 text-verdict font-medium ${tone.text}`}
                data-testid="verdict"
              >
                {shipping.answer}
              </p>
            </div>

            <dl className="flex shrink-0 gap-3">
              {[
                {
                  term: 'Verified',
                  testId: 'verdict-verification',
                  value: run.verification,
                  ok: run.verification === 'AUTHORITATIVE',
                },
                {
                  term: 'Isolation',
                  testId: 'verdict-isolation',
                  value: run.isolation,
                  ok: run.isolation === 'RESET',
                },
              ].map((item) => (
                <div
                  key={item.term}
                  className="rounded-control border border-line bg-canvas px-3 py-2"
                >
                  <dt className="text-micro font-semibold uppercase text-muted">{item.term}</dt>
                  <dd
                    data-testid={item.testId}
                    className={`mt-0.5 font-mono text-support ${item.ok ? 'text-pass' : 'text-warn'}`}
                  >
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="max-w-3xl text-body text-secondary" data-testid="verdict-because">
            {shipping.because}
          </p>

          {/* DECLARED is a claim, not a check. Said where the verdict is read,
              rather than in a log nobody opens. */}
          {run.isolation === 'DECLARED' && (
            <p
              className="max-w-3xl border-t border-line pt-4 text-meta text-secondary"
              data-testid="isolation-declared"
            >
              Isolation is <span className="font-mono">DECLARED</span>: your system nominated a
              reset and RigorRun has not run it twice and compared the results, so the cases are
              believed to have started clean rather than observed to have.
            </p>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
          {[
            {
              label: 'Task success',
              value: `${((score?.taskSuccessRate ?? 0) * 100).toFixed(1)}%`,
            },
            {
              label: 'Policy compliance',
              value: `${((score?.policyComplianceRate ?? 0) * 100).toFixed(1)}%`,
            },
            { label: 'Unsafe actions', value: String(score?.unsafeActions ?? 0) },
            { label: 'Cases', value: String(run.caseResults.length) },
          ].map((metric) => (
            <div key={metric.label} className="bg-surface px-5 py-4">
              <dt className="text-micro font-semibold uppercase text-muted">{metric.label}</dt>
              <dd className="mt-1 text-metric font-medium" data-numeric>
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

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
            <li key={entry.caseId}>
              <CaseRow entry={entry} />
            </li>
          ))}
        </ul>
      </section>

      {run.notTestable.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>Not covered, and why</SectionLabel>
          <ul className="flex flex-col gap-1.5">
            {run.notTestable.map((entry, index) => (
              <li key={index} className="max-w-4xl text-meta text-muted">
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

/**
 * One case, and — when somebody asks — what actually happened in it.
 *
 * A red mark with a category beside it is not enough to act on. Every one of
 * these was already recorded and none of it reached the screen, so the answer
 * to "why did this fail?" was to read a JSON file, which is the point at which
 * a person stops believing a tool and starts arguing with it.
 *
 * The order below is the order the questions get asked: what did the agent do,
 * what did your system say afterwards, which check failed and how was it
 * checked. The agent's own account comes last and is labelled, because an agent
 * that says it did the work and did not is the exact failure this product
 * exists to catch — its claim is evidence about the agent, never about the
 * system.
 */
function CaseRow({ entry }: { entry: CaseResultView }) {
  const [open, setOpen] = useState(false);
  const passed = entry.taskSuccess && entry.policyCompliant;
  const failedChecks = entry.checks.filter((check) => check.status === 'FAIL');

  return (
    <div className="rounded-control bg-inset">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left"
        data-testid={`case-${entry.caseId}`}
        aria-expanded={open}
      >
        <StatusMark status={passed ? 'pass' : 'fail'} />
        <span className="min-w-0 flex-1 truncate text-body text-fg">{entry.caseName}</span>
        <Tag tone="neutral">{entry.category}</Tag>
        {entry.unsafeActions > 0 ? <Tag tone="fail">{entry.unsafeActions} unsafe</Tag> : null}
        <span className="text-meta text-muted">{open ? 'Hide' : 'What happened'}</span>
      </button>

      {open ? (
        <div
          className="flex flex-col gap-4 border-t border-line-soft px-3 py-3"
          data-testid={`evidence-${entry.caseId}`}
        >
          {failedChecks.length > 0 ? (
            <Evidence label="Which check failed, and how it was checked">
              <ul className="flex flex-col gap-2">
                {failedChecks.map((check, index) => (
                  <li key={index} className="flex flex-col gap-1">
                    <span className="text-body text-fg">{check.description}</span>
                    {/* The path form underneath, because it names the exact
                        thing that was looked at and somebody debugging their
                        agent will want it — but it is not the sentence, and it
                        is not what a person reads first. */}
                    <span className="font-mono text-meta text-muted">{check.message}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      {/* The tier that produced this verdict. Carried since the
                          beginning and shown nowhere until now. */}
                      <Tag tone={VERIFICATION_TONE[check.verificationSource]}>
                        {VERIFICATION_TIER[check.verificationSource]}
                      </Tag>
                      {check.unsafe ? <Tag tone="fail">unsafe</Tag> : null}
                      {check.blocking ? null : <Tag tone="neutral">not blocking</Tag>}
                    </span>
                    {check.expected !== undefined ? (
                      <span className="text-meta text-muted">
                        expected {display(check.expected)} · saw {display(check.observed)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Evidence>
          ) : null}

          <Evidence label="What the agent did">
            {entry.steps.length === 0 ? (
              <p className="text-meta text-muted">It called nothing.</p>
            ) : (
              <ol className="flex flex-col gap-1">
                {entry.steps.map((step, index) => (
                  <li key={index} className="flex flex-wrap items-baseline gap-2 text-meta">
                    <span className={step.ok ? 'text-fg' : 'text-fail'}>{step.tool}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{display(step.args)}</span>
                    {step.error ? <span className="text-fail">{step.error}</span> : null}
                  </li>
                ))}
              </ol>
            )}
            {entry.stepsOmitted > 0 ? (
              <p className="mt-1 text-meta text-muted">and {entry.stepsOmitted} more, not shown.</p>
            ) : null}
          </Evidence>

          <Evidence label="What your system said afterwards">
            {Object.keys(entry.finalState).length === 0 ? (
              <p className="text-meta text-muted">
                Nothing was read back. This verdict rests on what was seen to happen, not on your
                system.
              </p>
            ) : (
              // Bounded on purpose. This is a whole slice of somebody's system,
              // and an unbounded dump pushes the part they came here to read —
              // which check failed, and what the agent did — off the screen.
              <details>
                <summary className="cursor-pointer text-meta text-secondary">
                  {Object.keys(entry.finalState).join(', ')}
                </summary>
                <pre
                  tabIndex={0}
                  role="region"
                  aria-label="What the system said after this case"
                  className="mt-2 max-h-80 overflow-auto rounded-control bg-canvas p-2 text-meta text-secondary"
                >
                  {JSON.stringify(entry.finalState, null, 2)}
                </pre>
              </details>
            )}
          </Evidence>

          {entry.agentReport ? (
            <Evidence label="What the agent said it did — not scored">
              <p className="text-meta text-secondary">{entry.agentReport}</p>
            </Evidence>
          ) : null}

          {entry.error ? (
            <Evidence label="It ended early">
              <p className="text-meta text-fail">{entry.error}</p>
            </Evidence>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** What each tier of evidence means, in words rather than an enum. */
const VERIFICATION_TIER: Record<CaseResultView['checks'][number]['verificationSource'], string> = {
  STATE: 'read from your system',
  EVENT: 'from your system’s own log',
  OUTPUT: 'from what the tool returned',
  HUMAN: 'decided by a person',
  MODEL: 'judged by a model',
  DECLARED: 'claimed by the system itself, unverified',
};

/**
 * `DECLARED` is deliberately not a warning.
 *
 * A warning reads as "probably fine, look when you can". A claim the system
 * under test made about itself, which nothing has checked, is not probably
 * fine — it is the thing the rest of the product exists to go and test. Giving
 * it the same amber as a weaker-but-real tier would be the exact confusion
 * this label was added to prevent.
 */
const VERIFICATION_TONE: Record<
  CaseResultView['checks'][number]['verificationSource'],
  'pass' | 'warn' | 'fail'
> = {
  STATE: 'pass',
  EVENT: 'warn',
  OUTPUT: 'warn',
  HUMAN: 'warn',
  MODEL: 'warn',
  DECLARED: 'fail',
};

function Evidence({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  );
}

function display(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? '—';
}

/**
 * A failure that already happened, on its way to becoming a permanent case.
 *
 * Lives on the run screen rather than in a menu, because the moment somebody
 * wants this is the moment they are looking at results and thinking about what
 * their agent does in the wild.
 *
 * Reading and adding are two steps on screen for the same reason they are two
 * requests: a trace is the agent's own record of what it sent, and nothing that
 * has not been read by a person belongs in the thing that checks agents.
 */
export function AddAFailure({ project, onAdded }: { project: ProjectView; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [trace, setTrace] = useState<ImportedTraceView | null>(null);
  const [added, setAdded] = useState<{
    caseId: string;
    shouldPerform: boolean;
    cases: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function review(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await api.reviewTrace(project.id, text);
      setTrace(result.trace);
      if (!name) setName(result.trace.name);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function add(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      // The situation, and only the situation: what the agent was working on
      // when it went wrong. What should have happened comes from your rules.
      const request = trace?.calls.at(-1)?.args ?? {};
      const result = await api.addFailure(project.id, name.trim(), reason.trim(), request);
      setAdded(result.added);
      onAdded();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} testId="add-a-failure">
          Something went wrong in production
        </Button>
      </div>
    );
  }

  return (
    <Panel>
      <div className="flex max-w-3xl flex-col gap-4" data-testid="add-failure">
        <div className="flex flex-col gap-1">
          <SectionLabel>Add a failure to this suite</SectionLabel>
          <p className="text-body text-secondary">
            Paste an OpenTelemetry trace of what your agent did. RigorRun takes the situation from
            it — what the agent was working on — and works out what should have happened from the
            rules you confirmed. It does not take the trace&rsquo;s word for anything else.
          </p>
        </div>

        {added === null ? (
          <>
            <Field
              label="The trace"
              hint="OTLP JSON. What a collector writes, or what your SDK sends."
            >
              {({ id, describedBy }) => (
                <TextArea
                  id={id}
                  describedBy={describedBy}
                  value={text}
                  onChange={setText}
                  testId="trace-json"
                />
              )}
            </Field>

            {trace ? (
              <div className="flex flex-col gap-2" data-testid="trace-review">
                <SectionLabel>What it says happened</SectionLabel>
                <ol className="flex flex-col gap-1">
                  {trace.calls.map((call, index) => (
                    <li key={index} className="flex flex-wrap items-baseline gap-2 text-meta">
                      <span className={call.ok ? 'text-fg' : 'text-fail'}>{call.tool}</span>
                      <span className="min-w-0 flex-1 truncate text-muted">
                        {JSON.stringify(call.args)}
                      </span>
                      <Tag tone="neutral">{call.recognisedBy}</Tag>
                    </li>
                  ))}
                </ol>
                {trace.failures.map((failure, index) => (
                  <p key={index} className="text-meta text-fail">
                    {failure.name}: {failure.message}
                  </p>
                ))}
                {trace.unrecognised > 0 ? (
                  <p className="text-meta text-muted">
                    {trace.unrecognised} span(s) RigorRun did not recognise as tool calls. Said
                    rather than hidden — if one of them is the call that matters, this is not the
                    trace to build a case from.
                  </p>
                ) : null}
              </div>
            ) : null}

            {trace ? (
              <>
                <Field label="What should this case be called?">
                  {({ id }) => (
                    <TextInput id={id} value={name} onChange={setName} testId="failure-name" />
                  )}
                </Field>
                <Field
                  label="Why is it here?"
                  hint="For whoever reads this suite in a year. Shown beside the case; never used to decide anything."
                >
                  {({ id }) => (
                    <TextInput
                      id={id}
                      value={reason}
                      onChange={setReason}
                      placeholder="Reported by the duty manager on 14 March."
                      testId="failure-reason"
                    />
                  )}
                </Field>
              </>
            ) : null}

            {problem ? <Problem>{problem}</Problem> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={review}
                disabled={busy || text.trim().length === 0}
                testId="review-trace"
              >
                {busy ? 'Reading…' : 'Read it'}
              </Button>
              {trace ? (
                <Button onClick={add} disabled={busy} testId="add-failure-case">
                  Add it to the suite
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2" data-testid="failure-added">
            <p className="text-body text-fg">Added. The suite now has {added.cases} cases.</p>
            <p className="text-meta text-secondary">
              Your rules say this work should have been{' '}
              <strong className="text-fg">{added.shouldPerform ? 'done' : 'refused'}</strong> — and
              that came from the rules, not from the trace. It runs on every run from now on.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
