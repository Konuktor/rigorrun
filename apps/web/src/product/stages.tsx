/**
 * The six steps, as screens.
 *
 * Connect your system · Teach it a job · Review what it learned · Rule on it ·
 * Build the suite · Run your agent.
 *
 * Two rules run through all of them. Nothing says "connected" until something
 * has answered, and nothing that RigorRun merely guessed is presented as a
 * fact — a guess arrives as a question with the observation that prompted it,
 * so a person can disagree with the evidence rather than with an assertion.
 */
import { useState } from 'react';
import { Button, Panel, SectionLabel, Tag } from '../components/primitives.tsx';
import { Checkbox, Field, Problem, Select, TextArea, TextInput } from './inputs.tsx';
import {
  api,
  type CaseView,
  type ProjectView,
  type RuleView,
  type SchemaQuestionView,
  type ToolView,
} from './api.ts';

// ------------------------------------------------------------------ step one

export function ConnectEnvironment({
  project,
  onConnected,
}: {
  project: ProjectView;
  onConnected: (project: ProjectView, tools: ToolView[], serverName: string, latencyMs: number) => void;
}) {
  const [transport, setTransport] = useState<'stdio' | 'http'>(
    project.connector?.transport ?? 'stdio',
  );
  const [command, setCommand] = useState(project.connector?.command ?? '');
  const [args, setArgs] = useState((project.connector?.args ?? []).join('\n'));
  const [url, setUrl] = useState(project.connector?.url ?? '');
  const [secretNames, setSecretNames] = useState((project.connector?.secretNames ?? []).join('\n'));
  const [safety, setSafety] = useState(project.safety);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function connect(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await api.connect(
        project.id,
        {
          kind: 'mcp',
          transport,
          command: command.trim(),
          args: args.split('\n').map((line) => line.trim()).filter(Boolean),
          url: url.trim(),
          secretNames: secretNames.split('\n').map((line) => line.trim()).filter(Boolean),
        },
        safety,
      );
      onConnected(result.project, result.tools, result.serverName, result.latencyMs);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="flex max-w-2xl flex-col gap-5">
        <p className="text-body text-secondary">
          Point RigorRun at the system your agent will work in. It reads that system before and
          after your agent runs, which is the only reason a verdict can mean anything.
        </p>

        <Field label="Where is it?">
          {({ id }) => (
            <Select
              id={id}
              value={transport}
              onChange={(value) => setTransport(value as 'stdio' | 'http')}
              testId="transport"
              options={[
                { value: 'stdio', label: 'On this machine — a command RigorRun runs' },
                { value: 'http', label: 'Somewhere else — an MCP server over HTTP' },
              ]}
            />
          )}
        </Field>

        {transport === 'stdio' ? (
          <>
            <Field
              label="Command"
              hint="The program itself, with no arguments. RigorRun runs it directly and never through a shell, so nothing here is interpreted."
            >
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  describedBy={describedBy}
                  value={command}
                  onChange={setCommand}
                  placeholder="npx"
                  testId="command"
                />
              )}
            </Field>
            <Field label="Arguments" hint="One per line.">
              {({ id, describedBy }) => (
                <TextArea
                  id={id}
                  describedBy={describedBy}
                  value={args}
                  onChange={setArgs}
                  testId="args"
                />
              )}
            </Field>
          </>
        ) : (
          <Field label="Server URL">
            {({ id }) => (
              <TextInput
                id={id}
                value={url}
                onChange={setUrl}
                placeholder="https://staging.example.com/mcp"
                testId="url"
              />
            )}
          </Field>
        )}

        <Field
          label="Credentials it needs"
          hint={
            <>
              Names only, one per line. Set the values with{' '}
              <code className="font-mono">rigorrun secret set NAME</code>; they stay in this
              machine&rsquo;s store and never travel with the project.
            </>
          }
        >
          {({ id, describedBy }) => (
            <TextArea
              id={id}
              describedBy={describedBy}
              value={secretNames}
              onChange={setSecretNames}
              rows={2}
              testId="secrets"
            />
          )}
        </Field>

        <Field
          label="What kind of system is this?"
          hint="RigorRun will not run anything that writes against production."
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              describedBy={describedBy}
              value={safety}
              onChange={(value) => setSafety(value as ProjectView['safety'])}
              testId="safety"
              options={[
                { value: 'ephemeral', label: 'Throwaway — made for testing, reset freely' },
                { value: 'local', label: 'Local — my machine, nobody else affected' },
                { value: 'staging', label: 'Staging — shared, but not the live system' },
                { value: 'production', label: 'Production — real, read-only please' },
              ]}
            />
          )}
        </Field>

        {problem ? <Problem>{problem}</Problem> : null}

        <div>
          <Button onClick={connect} disabled={busy} testId="connect">
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------- step one, continued

export function ToolCatalogue({
  project,
  tools,
  serverName,
  latencyMs,
  onConfigured,
}: {
  project: ProjectView;
  tools: ToolView[];
  serverName: string;
  latencyMs: number;
  onConfigured: (project: ProjectView) => void;
}) {
  const [readOnly, setReadOnly] = useState<Set<string>>(
    new Set(
      project.readOnlyTools.length > 0
        ? project.readOnlyTools
        : // Pre-ticked from the server's hint, because it is usually right and
          // always visible. It is a starting point a person confirms, never a
          // decision RigorRun takes from an untrusted claim.
          tools.filter((tool) => tool.hints.readOnly === true).map((tool) => tool.name),
    ),
  );
  const [reads, setReads] = useState<Set<string>>(
    new Set(project.verifierReads.map((read) => read.tool)),
  );
  const [reset, setReset] = useState(project.reset.tool);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  function toggle(set: Set<string>, name: string, apply: (next: Set<string>) => void): void {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    apply(next);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await api.configure(project.id, {
        readOnlyTools: [...readOnly],
        verifierReads: [...reads].map((tool) => ({ tool })),
        reset: reset ? { kind: 'tool', tool: reset } : { kind: 'none' },
      });
      onConfigured(result.project);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="text-section font-semibold" data-testid="server-name">
            {serverName}
          </span>
          <span className="text-meta text-muted">
            {tools.length} tools · answered in {latencyMs}ms
          </span>
        </div>
      </Panel>

      <section className="flex flex-col gap-3">
        <SectionLabel>What this system can do</SectionLabel>
        <p className="max-w-2xl text-body text-secondary">
          Two things need your judgement, because neither can be discovered. Which of these only
          read — a server&rsquo;s own claim about that is a hint, not a guarantee — and which one
          puts the system back afterwards.
        </p>
        <ul className="flex flex-col gap-2">
          {tools.map((tool) => (
            <li key={tool.name}>
              <ToolRow
                tool={tool}
                readOnly={readOnly.has(tool.name)}
                isRead={reads.has(tool.name)}
                onReadOnly={() => toggle(readOnly, tool.name, setReadOnly)}
                onRead={() => toggle(reads, tool.name, setReads)}
              />
            </li>
          ))}
        </ul>
      </section>

      <Panel>
        <div className="flex max-w-2xl flex-col gap-4">
          <Field
            label="Which tool puts the system back?"
            hint="Without one, cases cannot be isolated from each other and repeated mutation tests are switched off. RigorRun will still run; it will say so on every result."
          >
            {({ id, describedBy }) => (
              <Select
                id={id}
                describedBy={describedBy}
                value={reset}
                onChange={setReset}
                testId="reset-tool"
                options={[
                  { value: '', label: 'There is no way to reset this system' },
                  ...tools.map((tool) => ({ value: tool.name, label: tool.name })),
                ]}
              />
            )}
          </Field>
          {problem ? <Problem>{problem}</Problem> : null}
          <div>
            <Button onClick={save} disabled={busy || reads.size === 0} testId="save-environment">
              {busy ? 'Saving…' : 'Save and continue'}
            </Button>
            {reads.size === 0 ? (
              <p className="mt-2 text-meta text-muted">
                Choose at least one read. Without one RigorRun can watch your agent but cannot check
                whether it worked.
              </p>
            ) : null}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function ToolRow({
  tool,
  readOnly,
  isRead,
  onReadOnly,
  onRead,
}: {
  tool: ToolView;
  readOnly: boolean;
  isRead: boolean;
  onReadOnly: () => void;
  onRead: () => void;
}) {
  const tone =
    tool.risk.level === 'destructive'
      ? 'fail'
      : tool.risk.level === 'read'
        ? 'pass'
        : tool.risk.level === 'unknown'
          ? 'warn'
          : 'info';

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-body text-fg">{tool.name}</span>
            <Tag tone={tone}>{tool.risk.level}</Tag>
            {tool.risk.source === 'server-hint' ? (
              <Tag tone="neutral">server&rsquo;s claim</Tag>
            ) : null}
          </div>
          {tool.description ? (
            <p className="max-w-xl text-meta text-secondary">{tool.description}</p>
          ) : null}
          <p className="text-meta text-muted">{tool.risk.rationale}</p>
          {tool.params.length > 0 ? (
            <p className="font-mono text-meta text-muted">
              ({tool.params.map((param) => `${param.name}${param.required ? '' : '?'}`).join(', ')})
            </p>
          ) : null}
          {tool.unsupported.length > 0 ? (
            <p className="text-meta text-warn">
              {tool.unsupported.map((entry) => `${entry.name}: ${entry.reason}`).join(' · ')}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <Checkbox
            checked={readOnly}
            onChange={onReadOnly}
            label="Only reads"
            testId={`readonly-${tool.name}`}
          />
          <Checkbox
            checked={isRead}
            onChange={onRead}
            label="Check with this"
            hint="Called after your agent finishes"
            testId={`verifier-${tool.name}`}
          />
        </div>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ step two

export function TeachJob({
  project,
  tools,
  onFinished,
}: {
  project: ProjectView;
  tools: ToolView[];
  onFinished: (project: ProjectView, questions: SchemaQuestionView[]) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [selected, setSelected] = useState(tools[0]?.name ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [log, setLog] = useState<{ tool: string; ok: boolean; detail: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const tool = tools.find((entry) => entry.name === selected);

  async function start(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      await api.startTeaching(project.id);
      setRecording(true);
      setLog([]);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function call(): Promise<void> {
    if (!tool) return;
    setBusy(true);
    setProblem('');
    const args: Record<string, unknown> = {};
    for (const param of tool.params) {
      const raw = values[`${tool.name}.${param.name}`];
      if (raw === undefined || raw === '') continue;
      args[param.name] =
        param.type === 'number' ? Number(raw) : param.type === 'boolean' ? raw === 'true' : raw;
    }
    try {
      const result = await api.teachCall(project.id, tool.name, args);
      setLog((entries) => [
        ...entries,
        {
          tool: tool.name,
          ok: result.ok,
          detail: result.ok ? JSON.stringify(result.data).slice(0, 240) : (result.error ?? 'failed'),
        },
      ]);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await api.finishTeaching(project.id);
      setRecording(false);
      onFinished(result.project, result.questions);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <div className="flex flex-col gap-3">
          <p className="max-w-2xl text-body text-secondary">
            Do the job once, using this system&rsquo;s own tools. RigorRun reads the system before
            you start and again when you finish, and works out the rules from what changed — so a
            job that leaves no trace cannot be learned.
          </p>
          {!recording ? (
            <div>
              <Button onClick={start} disabled={busy} testId="start-recording">
                {busy ? 'Starting…' : 'Start recording'}
              </Button>
              <p className="mt-2 text-meta text-muted">
                This resets the system first, so the job starts where your tests will start.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Tag tone="warn">recording</Tag>
              <Button variant="secondary" onClick={finish} disabled={busy} testId="finish-recording">
                {busy ? 'Working it out…' : 'I have finished the job'}
              </Button>
            </div>
          )}
        </div>
      </Panel>

      {recording ? (
        <Panel>
          <div className="flex max-w-2xl flex-col gap-4">
            <Field label="Do something">
              {({ id }) => (
                <Select
                  id={id}
                  value={selected}
                  onChange={setSelected}
                  testId="tool-picker"
                  options={tools.map((entry) => ({ value: entry.name, label: entry.name }))}
                />
              )}
            </Field>
            {tool?.params.map((param) => (
              <Field
                key={param.name}
                label={param.name}
                hint={param.description || (param.required ? 'Required.' : 'Optional.')}
              >
                {({ id, describedBy }) =>
                  param.enumValues ? (
                    <Select
                      id={id}
                      describedBy={describedBy}
                      value={values[`${tool.name}.${param.name}`] ?? ''}
                      onChange={(value) =>
                        setValues((current) => ({ ...current, [`${tool.name}.${param.name}`]: value }))
                      }
                      testId={`param-${param.name}`}
                      options={[
                        { value: '', label: '—' },
                        ...param.enumValues.map((value) => ({ value, label: value })),
                      ]}
                    />
                  ) : (
                    <TextInput
                      id={id}
                      describedBy={describedBy}
                      value={values[`${tool.name}.${param.name}`] ?? ''}
                      onChange={(value) =>
                        setValues((current) => ({ ...current, [`${tool.name}.${param.name}`]: value }))
                      }
                      type={param.type === 'number' ? 'number' : 'text'}
                      testId={`param-${param.name}`}
                    />
                  )
                }
              </Field>
            ))}
            {problem ? <Problem>{problem}</Problem> : null}
            <div>
              <Button onClick={call} disabled={busy || !tool} testId="run-tool">
                Run it
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {log.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>What you did</SectionLabel>
          <ol className="flex flex-col gap-1">
            {log.map((entry, index) => (
              <li
                key={index}
                className="flex gap-3 rounded-control bg-inset px-3 py-2 font-mono text-meta"
              >
                <span className={entry.ok ? 'text-pass' : 'text-fail'}>{entry.ok ? '✓' : '✕'}</span>
                <span className="text-fg">{entry.tool}</span>
                <span className="min-w-0 truncate text-muted">{entry.detail}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- step three

export function ReviewLearned({
  project,
  questions,
  onAnswered,
}: {
  project: ProjectView;
  questions: SchemaQuestionView[];
  onAnswered: (project: ProjectView) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(questions.map((question) => [question.id, question.proposed])),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function save(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await api.answerSchema(
        project.id,
        Object.entries(answers).map(([questionId, value]) => ({ questionId, value })),
      );
      onAnswered(result.project);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-2xl text-body text-secondary">
        RigorRun worked these out from what your system handed back. It read the shape of the data
        and nothing else — never the names — so some of it needs you. Each answer says what the
        evidence was, so you can disagree with the evidence rather than with a verdict.
      </p>

      {questions.map((question) => (
        <Panel key={question.id}>
          <div className="flex max-w-2xl flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body font-medium text-fg">{question.text}</span>
              <Tag
                tone={
                  question.confidence === 'strong'
                    ? 'pass'
                    : question.confidence === 'moderate'
                      ? 'info'
                      : 'warn'
                }
              >
                {question.confidence}
              </Tag>
            </div>
            <p className="text-meta text-muted">{question.evidence}</p>
            {question.options.length > 0 ? (
              <Field label="Your answer">
                {({ id }) => (
                  <Select
                    id={id}
                    value={answers[question.id] ?? question.proposed}
                    onChange={(value) =>
                      setAnswers((current) => ({ ...current, [question.id]: value }))
                    }
                    testId={`answer-${question.id}`}
                    options={question.options.map((option) => ({ value: option, label: option }))}
                  />
                )}
              </Field>
            ) : (
              <Field label="Your answer">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={answers[question.id] ?? question.proposed}
                    onChange={(value) =>
                      setAnswers((current) => ({ ...current, [question.id]: value }))
                    }
                    testId={`answer-${question.id}`}
                  />
                )}
              </Field>
            )}
          </div>
        </Panel>
      ))}

      {problem ? <Problem>{problem}</Problem> : null}
      <div>
        <Button onClick={save} disabled={busy} testId="save-answers">
          {busy ? 'Saving…' : 'These are right'}
        </Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- step four

export function RuleOnRules({
  project,
  onGenerated,
}: {
  project: ProjectView;
  onGenerated: (cases: CaseView[], notTestable: { rule: string; reason: string }[]) => void;
}) {
  const [rules, setRules] = useState<RuleView[] | null>(null);
  const [facts, setFacts] = useState<{ statement: string }[]>([]);
  const [decisions, setDecisions] = useState<Record<string, 'yes' | 'no'>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function compile(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await api.compile(project.id);
      setRules(result.contract.rules);
      setFacts(result.contract.observedFacts);
      setDecisions(Object.fromEntries(result.contract.rules.map((rule) => [rule.id, 'yes'])));
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function generate(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      await api.review(
        project.id,
        Object.entries(decisions).filter(([, v]) => v === 'yes').map(([id]) => id),
        Object.entries(decisions).filter(([, v]) => v === 'no').map(([id]) => id),
      );
      const suite = await api.generate(project.id);
      onGenerated(suite.cases, suite.notTestable);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (rules === null) {
    return (
      <Panel>
        <div className="flex flex-col gap-3">
          <p className="max-w-2xl text-body text-secondary">
            RigorRun will now turn what it watched into rules. None of them will be enforced until
            you say so.
          </p>
          {problem ? <Problem>{problem}</Problem> : null}
          <div>
            <Button onClick={compile} disabled={busy} testId="compile">
              {busy ? 'Working…' : 'Compile what you showed it'}
            </Button>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {facts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>What it saw happen</SectionLabel>
          <ul className="flex flex-col gap-1">
            {facts.map((fact) => (
              <li key={fact.statement} className="text-body text-secondary">
                {fact.statement}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionLabel>What it thinks the rules are</SectionLabel>
        <p className="max-w-2xl text-body text-secondary">
          Guesses, every one. A rule you do not confirm cannot fail your agent — so saying no is
          cheap, and RigorRun proposes more than it expects you to keep.
        </p>
        {rules.map((rule) => (
          <Panel key={rule.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-body text-fg">{rule.statement}</span>
                {rule.question ? (
                  <span className="text-meta text-muted">{rule.question.text}</span>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant={decisions[rule.id] === 'yes' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setDecisions((current) => ({ ...current, [rule.id]: 'yes' }))}
                  testId={`yes-${rule.id}`}
                >
                  Yes
                </Button>
                <Button
                  variant={decisions[rule.id] === 'no' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setDecisions((current) => ({ ...current, [rule.id]: 'no' }))}
                  testId={`no-${rule.id}`}
                >
                  No
                </Button>
              </div>
            </div>
          </Panel>
        ))}
      </section>

      {problem ? <Problem>{problem}</Problem> : null}
      <div>
        <Button onClick={generate} disabled={busy} testId="generate">
          {busy ? 'Building the suite…' : 'Build the suite'}
        </Button>
      </div>
    </div>
  );
}
