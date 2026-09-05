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
  type AnnotationMismatchView,
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
  onConnected: (
    project: ProjectView,
    tools: ToolView[],
    serverName: string,
    latencyMs: number,
  ) => void;
}) {
  const saved = project.connector;
  const mcp = saved?.kind === 'mcp' ? saved : undefined;
  const openapi = saved?.kind === 'openapi' ? saved : undefined;

  const browser = saved?.kind === 'browser' ? saved : undefined;
  const [kind, setKind] = useState<'mcp' | 'openapi' | 'browser'>(saved?.kind ?? 'mcp');
  const [transport, setTransport] = useState<'stdio' | 'http'>(mcp?.transport ?? 'stdio');
  const [command, setCommand] = useState(mcp?.command ?? '');
  const [args, setArgs] = useState((mcp?.args ?? []).join('\n'));
  const [url, setUrl] = useState(mcp?.url ?? '');
  const [spec, setSpec] = useState(openapi?.spec ?? '');
  const [baseUrl, setBaseUrl] = useState(openapi?.baseUrl ?? '');
  const [headerName, setHeaderName] = useState(Object.keys(openapi?.headers ?? {})[0] ?? '');
  const [startUrl, setStartUrl] = useState(browser?.startUrl ?? '');
  const [secretNames, setSecretNames] = useState((saved?.secretNames ?? []).join('\n'));
  const [safety, setSafety] = useState(project.safety);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function connect(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const names = secretNames
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const result = await api.connect(
        project.id,
        kind === 'browser'
          ? {
              kind: 'browser' as const,
              startUrl: startUrl.trim(),
              browser: 'chromium' as const,
              headless: true,
              // Attaching one is a second step, deliberately: somebody should
              // see OBSERVATIONAL on their first verdict and understand why
              // before being offered the way out of it.
              verifier: null,
              secretNames: names,
            }
          : kind === 'openapi'
            ? {
                kind: 'openapi',
                spec,
                specUrl: '',
                baseUrl: baseUrl.trim(),
                // A header name against a *secret* name. The value is fetched
                // by the runner when it opens the connection and never here.
                headers: headerName.trim() && names[0] ? { [headerName.trim()]: names[0] } : {},
                secretNames: names,
              }
            : {
                kind: 'mcp',
                transport,
                command: command.trim(),
                args: args
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
                url: url.trim(),
                secretNames: names,
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
          Point RigorRun at the system your agent works in. It looks at that system before and after
          your agent runs, which is the only reason a result can be trusted.
        </p>
        <div className="rounded-panel border border-line bg-inset px-3 py-2.5">
          <p className="text-meta font-medium text-secondary">What you need</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-meta text-muted">
            <li>
              {kind === 'mcp' ? (
                <>
                  An <strong className="text-secondary">MCP server</strong> for that system — either
                  a command on this machine or a URL. If you already run one for Claude, Cursor or
                  anything else, that is the one.
                </>
              ) : (
                <>
                  An <strong className="text-secondary">OpenAPI document</strong> for that system,
                  and the address the API is actually served from.
                </>
              )}
            </li>
            <li>
              Somewhere it is <strong className="text-secondary">safe to change things</strong>.
              Staging or a scratch instance. RigorRun refuses to write to anything you mark
              production.
            </li>
          </ul>
          <p className="mt-2 text-meta text-muted">
            Next: RigorRun connects, shows you everything that system can do, and asks you two
            questions about it.{' '}
            {kind === 'openapi'
              ? 'It will not call anything that changes your system while you are setting this up, whatever the document offers.'
              : 'Nothing is changed until you say so.'}
          </p>
        </div>

        <Field label="How does RigorRun talk to it?">
          {({ id }) => (
            <Select
              id={id}
              value={kind}
              onChange={(value) => setKind(value as 'mcp' | 'openapi' | 'browser')}
              testId="connector-kind"
              options={[
                { value: 'mcp', label: 'MCP — a server that publishes tools' },
                { value: 'openapi', label: 'OpenAPI — an HTTP API with a document' },
                { value: 'browser', label: 'A browser — a web application, by clicking' },
              ]}
            />
          )}
        </Field>

        {kind === 'browser' ? (
          <>
            <Field
              label="Where does the job start?"
              hint="The page a person would open first. RigorRun stays on this site — a page can link anywhere, and following one off-site would mean driving a browser to an address you never named."
            >
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  describedBy={describedBy}
                  value={startUrl}
                  onChange={setStartUrl}
                  placeholder="https://staging.example.com/"
                  testId="start-url"
                />
              )}
            </Field>
            <div className="rounded-panel border border-warn-line bg-warn-bg p-4">
              <p className="text-body text-fg">A browser cannot check its own work.</p>
              <p className="mt-2 text-meta text-secondary">
                A page saying &ldquo;done&rdquo; is a claim by the same system that would have to be
                wrong for it not to be done. RigorRun will watch your agent click, and every verdict
                will say <span className="font-mono">OBSERVATIONAL</span> — it saw what happened and
                did not check what changed.
              </p>
              <p className="mt-2 text-meta text-muted">
                Once this is working you can attach an MCP server or an OpenAPI document for the
                same system, and then the clicking is watched in the page while the verdict comes
                from records. Most systems that look API-less have something that can be read.
              </p>
            </div>
          </>
        ) : null}

        {kind === 'openapi' ? (
          <>
            <Field
              label="The OpenAPI document"
              hint="Paste it, JSON or YAML. It is kept on this machine, so a run does not depend on the document still being where it was."
            >
              {({ id, describedBy }) => (
                <TextArea
                  id={id}
                  describedBy={describedBy}
                  value={spec}
                  onChange={setSpec}
                  testId="openapi-spec"
                />
              )}
            </Field>
            <Field
              label="Where is the API?"
              hint="The address requests actually go to. Whatever the document's `servers` says is a suggestion; this is what RigorRun uses."
            >
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  describedBy={describedBy}
                  value={baseUrl}
                  onChange={setBaseUrl}
                  placeholder="https://staging.example.com/api"
                  testId="openapi-base-url"
                />
              )}
            </Field>
            <Field
              label="Which header carries your credential?"
              hint="The header name only — for example Authorization. Its value comes from the first secret below, and stays on this machine."
            >
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  describedBy={describedBy}
                  value={headerName}
                  onChange={setHeaderName}
                  placeholder="Authorization"
                  testId="openapi-header"
                />
              )}
            </Field>
          </>
        ) : null}

        {kind === 'mcp' ? (
          <>
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
                  hint="Just the program, with no arguments — for example npx. RigorRun runs it directly rather than through a shell, so nothing here is interpreted as shell syntax."
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
                <Field
                  label="Arguments"
                  hint="One per line. Everything you would type after the command."
                >
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
              <Field
                label="Server URL"
                hint="A private address is fine — RigorRun runs on your machine, so anything this machine can reach, it can reach."
              >
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    describedBy={describedBy}
                    value={url}
                    onChange={setUrl}
                    placeholder="https://staging.example.com/mcp"
                    testId="url"
                  />
                )}
              </Field>
            )}
          </>
        ) : null}

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
          hint="If you say production, RigorRun refuses every action that would change something — your agent still gets to try, and you see what it would have done."
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
  onStartOver,
}: {
  project: ProjectView;
  tools: ToolView[];
  serverName: string;
  latencyMs: number;
  onConfigured: (project: ProjectView) => void;
  onStartOver?: () => void;
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
  /** What the reads could not tell RigorRun. Not an error — a decision. */
  const [readsProblem, setReadsProblem] = useState('');

  function toggle(set: Set<string>, name: string, apply: (next: Set<string>) => void): void {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    apply(next);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setProblem('');
    setReadsProblem('');
    try {
      const result = await api.configure(project.id, {
        readOnlyTools: [...readOnly],
        verifierReads: [...reads].map((tool) => ({ tool })),
        reset: reset ? { kind: 'tool', tool: reset } : { kind: 'none' },
      });
      // RigorRun tried the reads. If they cannot tell it what changed, the
      // person hears it now rather than after doing the whole job — which is
      // what happened against a real third-party server, and cost the run.
      if (result.readsProblem) {
        setReadsProblem(result.readsProblem);
        return;
      }
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
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-section font-semibold" data-testid="server-name">
              {serverName}
            </span>
            <span className="text-meta text-muted">
              {tools.length} things it can do · answered in {latencyMs}ms
            </span>
          </div>
          {onStartOver ? (
            <button
              type="button"
              onClick={onStartOver}
              data-testid="change-system"
              className="text-meta text-muted hover:text-fg"
            >
              Connect a different system
            </button>
          ) : null}
        </div>
      </Panel>

      <section className="flex flex-col gap-3">
        <SectionLabel>What this system can do</SectionLabel>
        <p className="max-w-2xl text-body text-secondary">
          Two things need you, because neither can be worked out from the outside.
        </p>
        <ul className="flex max-w-2xl list-disc flex-col gap-1 pl-5 text-body text-secondary">
          <li>
            <strong className="font-medium text-fg">
              Which of these only look, never change anything.
            </strong>{' '}
            Your system can say so itself, and RigorRun shows you when it does — but it will not
            take a system&rsquo;s word about its own safety.
          </li>
          <li>
            <strong className="font-medium text-fg">
              Which ones RigorRun should use to check what actually happened.
            </strong>{' '}
            After your agent finishes, RigorRun calls these to look at your system and find out what
            really changed. That is the whole reason a result can be trusted.
          </li>
        </ul>
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
            label="Which one puts your system back the way it was?"
            hint="RigorRun calls it before every test, so each one starts from the same place. Without it RigorRun still works — it just says on every result that the tests could affect each other."
          >
            {({ id, describedBy }) => (
              <Select
                id={id}
                describedBy={describedBy}
                value={reset}
                onChange={setReset}
                testId="reset-tool"
                options={[
                  { value: '', label: 'There is no way to put this system back' },
                  ...tools.map((tool) => ({ value: tool.name, label: tool.name })),
                ]}
              />
            )}
          </Field>
          {problem ? <Problem>{problem}</Problem> : null}
          {readsProblem ? (
            <div
              className="rounded-panel border border-warn-line bg-warn-bg p-4"
              data-testid="reads-problem"
            >
              <p className="text-body text-fg">{readsProblem}</p>
              <p className="mt-3 text-meta text-secondary">
                You can carry on. RigorRun will watch what your agent does and say OBSERVATIONAL on
                every result, because it will not have looked at your system.
              </p>
              <div className="mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setReadsProblem('');
                    onConfigured(project);
                  }}
                  testId="continue-anyway"
                >
                  Continue anyway
                </Button>
              </div>
            </div>
          ) : null}
          <div>
            <Button onClick={save} disabled={busy || reads.size === 0} testId="save-environment">
              {busy ? 'Saving…' : 'Save and continue'}
            </Button>
            {reads.size === 0 ? (
              <p className="mt-2 text-meta text-muted">
                Tick at least one &ldquo;check with this&rdquo;. Without one, RigorRun can watch
                what your agent does but cannot look at your system afterwards to see whether it
                worked — and a result nobody checked is not worth having.
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
            label="Only looks"
            testId={`readonly-${tool.name}`}
          />
          <Checkbox
            checked={isRead}
            onChange={onRead}
            label="Check with this"
            hint="Called afterwards, to see what changed"
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
  alreadyRecorded,
  recordingOpen,
  onFinished,
}: {
  project: ProjectView;
  tools: ToolView[];
  /** Steps from a recording that was in progress when the page was reloaded. */
  alreadyRecorded: { tool: string; ok: boolean }[];
  /** A demonstration is open on disk, whatever is or is not in it yet. */
  recordingOpen: boolean;
  onFinished: (
    project: ProjectView,
    questions: SchemaQuestionView[],
    mismatches: AnnotationMismatchView[],
  ) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [selected, setSelected] = useState(tools[0]?.name ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [log, setLog] = useState<{ tool: string; ok: boolean; detail: string }[]>(
    alreadyRecorded.map((entry) => ({ ...entry, detail: 'recorded earlier' })),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const tool = tools.find((entry) => entry.name === selected);
  const canResume = recordingOpen && !recording;

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

  /**
   * Picks a half-finished recording back up.
   *
   * The alternative — losing it and starting again — means doing real work in a
   * real system twice, which is the most expensive thing this product can ask
   * of anybody.
   */
  async function resume(): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await api.resumeTeaching(project.id);
      if (!result.resumed) {
        setProblem('There was nothing left to pick up. Starting again is safe.');
        return;
      }
      setRecording(true);
      setLog(result.steps.map((entry) => ({ ...entry, detail: 'recorded earlier' })));
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
          detail: result.ok
            ? JSON.stringify(result.data).slice(0, 240)
            : (result.error ?? 'failed'),
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
      onFinished(result.project, result.questions, result.mismatches);
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
            <div className="flex flex-col gap-3">
              {canResume ? (
                <div className="rounded-panel border border-info-line bg-info-bg px-3 py-2.5">
                  <p className="text-body text-fg">
                    You were partway through recording this
                    {alreadyRecorded.length > 0
                      ? ` — ${alreadyRecorded.length} step${alreadyRecorded.length === 1 ? '' : 's'} so far.`
                      : '. Nothing has changed your system yet, and the starting point RigorRun took is still here.'}
                  </p>
                  <p className="mt-1 text-meta text-muted">
                    Carrying on keeps what you already did. Starting again resets your system and
                    throws it away.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button onClick={resume} disabled={busy} testId="resume-recording">
                      {busy ? 'Picking it up…' : 'Carry on where I left off'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={start}
                      disabled={busy}
                      testId="restart-recording"
                    >
                      Start again
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button onClick={start} disabled={busy} testId="start-recording">
                    {busy ? 'Starting…' : 'Start recording'}
                  </Button>
                  <p className="mt-2 text-meta text-muted">
                    This puts your system back first, so the job starts where your tests will start.
                    You can stop and pick this up again later.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Tag tone="warn">recording</Tag>
              <Button
                variant="secondary"
                onClick={finish}
                disabled={busy}
                testId="finish-recording"
              >
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
                        setValues((current) => ({
                          ...current,
                          [`${tool.name}.${param.name}`]: value,
                        }))
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
                        setValues((current) => ({
                          ...current,
                          [`${tool.name}.${param.name}`]: value,
                        }))
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
  mismatches,
  onAnswered,
}: {
  project: ProjectView;
  questions: SchemaQuestionView[];
  mismatches: AnnotationMismatchView[];
  onAnswered: (project: ProjectView) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(questions.map((question) => [question.id, question.proposed])),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  /**
   * Least certain first.
   *
   * There are often twenty of these, and handing somebody twenty
   * undifferentiated questions is the same as handing them none: they scroll to
   * the bottom and press the button. The ones RigorRun is unsure about are the
   * ones where a wrong answer quietly corrupts a threshold or a boundary, so
   * they go where somebody will actually read them.
   */
  const rank = { weak: 0, moderate: 1, strong: 2 } as const;
  const ordered = [...questions].sort((a, b) => rank[a.confidence] - rank[b.confidence]);
  const byConfidence = {
    weak: questions.filter((question) => question.confidence === 'weak'),
    moderate: questions.filter((question) => question.confidence === 'moderate'),
    strong: questions.filter((question) => question.confidence === 'strong'),
  };

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
      <div className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-secondary">
          RigorRun worked these out by looking at what your system handed back. It read the shape of
          the data and never the names of things, which is what stops it only working on businesses
          it has seen before — and means a few things it genuinely cannot know.
        </p>
        <p className="text-body text-secondary">
          Each question shows what it saw, so you can disagree with the evidence rather than with a
          verdict. The ones it is least sure about are first, because those are the ones where a
          wrong answer matters. Getting one wrong is not permanent: come back to this step any time.
        </p>
      </div>

      {mismatches.length > 0 ? (
        <section className="flex flex-col gap-2" data-testid="annotation-mismatches">
          <SectionLabel>What your system said about itself, and did not do</SectionLabel>
          {mismatches.map((mismatch) => (
            <Panel key={mismatch.tool}>
              <p className="text-body text-fg">
                <span className="font-mono">{mismatch.tool}</span> — {mismatch.claimed}
              </p>
              <p className="mt-1 text-meta text-secondary">{mismatch.observed}</p>
              <p className="mt-2 text-meta text-muted">
                Nothing about your run changes: RigorRun already treats every tool you have not
                vouched for as one that writes. This is worth knowing anyway — a system that
                misdescribes one tool may misdescribe others, and you are about to trust what it
                tells RigorRun about your agent.
              </p>
            </Panel>
          ))}
        </section>
      ) : null}

      <div className="flex flex-wrap gap-4 text-meta text-muted">
        <span>
          <strong className="text-fg">{byConfidence.weak.length}</strong> it is unsure about
        </span>
        <span>
          <strong className="text-secondary">{byConfidence.moderate.length}</strong> it is fairly
          sure about
        </span>
        <span>
          <strong className="text-secondary">{byConfidence.strong.length}</strong> it is confident
          about
        </span>
      </div>

      {ordered.map((question) => (
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
        Object.entries(decisions)
          .filter(([, v]) => v === 'yes')
          .map(([id]) => id),
        Object.entries(decisions)
          .filter(([, v]) => v === 'no')
          .map(([id]) => id),
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
            RigorRun will now turn what it watched into rules about how the job should be done. None
            of them can fail your agent until you have said yes to it.
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
          Guesses, every one. A rule you say no to cannot fail your agent, so saying no costs you
          nothing — RigorRun deliberately proposes more than it expects you to keep, because missing
          a real rule is far worse than proposing one you do not want.
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
