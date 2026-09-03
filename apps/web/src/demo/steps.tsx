/**
 * The five steps of the demo. Each one renders real artefacts produced by the
 * packages — there is no placeholder content anywhere in this file.
 */
import { Fragment, useMemo, useState } from 'react';
import type {
  Benchmark,
  CaseResult,
  ContractRule,
  WorkflowContract,
  WorkflowTrace,
} from '@rigorrun/core';
import { Button, Mono, Panel, Tag, fmtMs } from '../components/primitives.tsx';

/**
 * Where the recorded application lives. Local by default; the deployed build
 * points at the hosted copy of Northstar Support so a reviewer with no local
 * setup can still open it.
 */
const CRM_URL = import.meta.env['VITE_CRM_URL'] ?? 'http://127.0.0.1:5174';

/* ------------------------------------------------------------------ record */

export function RecordStep({ trace, onCompile }: { trace: WorkflowTrace; onCompile: () => void }) {
  const interactions = trace.events.filter((e) => e.type !== 'app_observation');
  const observations = trace.events.filter((e) => e.type === 'app_observation');

  return (
    <div className="space-y-4">
      <StepIntro
        title="A person did the job once"
        body="This is what the recorder captured while a support agent processed a refund in Northstar
              Support. It stores the meaning of each interaction — role, accessible name, stable
              selector — not the page. No credentials, no cookies, no page HTML."
        action={
          <a
            href={CRM_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted hover:border-dim hover:text-fg"
          >
            Open Northstar Support ↗
          </a>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Events" value={String(trace.events.length)} />
        <Stat label="Interactions" value={String(interactions.length)} />
        <Stat label="App observations" value={String(observations.length)} />
        <Stat label="Duration" value={`${(trace.durationMs / 1000).toFixed(1)}s`} />
      </div>

      <Panel
        title="Recorded trace"
        subtitle={`${trace.app.origin} · schema v${trace.schemaVersion}`}
      >
        <ol className="max-h-[420px] overflow-y-auto">
          {trace.events.map((event) => (
            <li
              key={event.id}
              className="flex items-start gap-3 border-b border-line-soft px-4 py-2 last:border-0"
            >
              <Mono className="w-12 shrink-0 text-dim">{(event.at / 1000).toFixed(1)}s</Mono>
              <Tag tone={event.type === 'app_observation' ? 'accent' : 'neutral'}>{event.type}</Tag>
              <div className="min-w-0 flex-1">
                {event.observation ? (
                  <div>
                    <Mono className="text-fg">{event.observation.name}</Mono>
                    <Mono className="ml-2 text-dim">{JSON.stringify(event.observation.data)}</Mono>
                  </div>
                ) : (
                  <div>
                    <span className="text-[13px] text-fg">
                      {event.target?.accessibleName ?? new URL(event.url).pathname}
                    </span>
                    {event.value !== undefined ? (
                      <Mono className="ml-2 text-accent">&ldquo;{event.value}&rdquo;</Mono>
                    ) : null}
                    {event.target ? (
                      <div className="mt-0.5 flex items-center gap-2">
                        <Mono className="text-dim">{event.target.selector}</Mono>
                        <Tag>{event.target.selectorStrategy}</Tag>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <NextBar
        note="Next, RigorRun turns this recording into an executable contract."
        button={
          <Button onClick={onCompile} testId="step-compile">
            Compile benchmark →
          </Button>
        }
      />
    </div>
  );
}

/* ----------------------------------------------------------------- compile */

export function CompileStep({
  contract,
  rejected,
  onToggle,
  onApprove,
}: {
  contract: WorkflowContract;
  rejected: Set<string>;
  onToggle: (ruleId: string) => void;
  onApprove: () => void;
}) {
  const all = [
    ...contract.preconditions.map((r) => ({ kind: 'precondition', rule: r })),
    ...contract.requiredActions.map((r) => ({ kind: 'required action', rule: r })),
    ...contract.forbiddenActions.map((r) => ({ kind: 'forbidden action', rule: r })),
  ];
  const observed = all.filter((r) => r.rule.source === 'observed');
  const inferred = all.filter((r) => r.rule.source === 'inferred');
  const accepted = inferred.filter((r) => !rejected.has(r.rule.id)).length;

  return (
    <div className="space-y-4">
      <StepIntro
        title="One recording does not reveal a policy"
        body="RigorRun separates what it saw from what it guessed. Observed rules come straight from
              the recording. Inferred rules are generalisations, and every one of them comes with
              the question RigorRun cannot answer on its own. Reject one and it stops being
              enforced — including the check behind it."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Observed" value={String(observed.length)} tone="pass" />
        <Stat label="Inferred" value={String(inferred.length)} tone="warn" />
        <Stat label="Open questions" value={String(contract.uncertainty.length)} />
      </div>

      <Panel title="Goal">
        <p className="px-4 py-3 text-[14px]">{contract.goal}</p>
      </Panel>

      <Panel title="Observed" subtitle="Taken directly from what the person did. Confidence 1.0.">
        <ul>
          {observed.map(({ kind, rule }) => (
            <li
              key={rule.id}
              className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-0"
            >
              <Tag tone="pass">observed</Tag>
              <span className="flex-1 text-[13px]">{rule.rule}</span>
              <Mono className="text-dim">{kind}</Mono>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Inferred — needs confirmation"
        subtitle={`${accepted} of ${inferred.length} accepted. These are generalisations, not observations.`}
      >
        <ul>
          {inferred.map(({ kind, rule }) => {
            const isRejected = rejected.has(rule.id);
            const question = contract.uncertainty.find((u) => u.relatedRuleIds.includes(rule.id));
            return (
              <li
                key={rule.id}
                className={`border-b border-line-soft px-4 py-3 last:border-0 ${isRejected ? 'opacity-45' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <Tag tone="warn">inferred {rule.confidence.toFixed(2)}</Tag>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px]">{rule.rule}</div>
                    <Mono className="text-dim">{kind}</Mono>
                    {question ? (
                      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                        <span className="text-warn">?</span> {question.question}
                        <span className="block text-dim">{question.reason}</span>
                      </p>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant={isRejected ? 'secondary' : 'ghost'}
                    onClick={() => onToggle(rule.id)}
                    testId={`rule-toggle-${rule.id}`}
                  >
                    {isRejected ? 'Restore' : 'Reject'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <NextBar
        note={`Approving turns ${accepted + observed.length} rules into a contract a human stands behind.`}
        button={
          <Button onClick={onApprove} testId="step-generate">
            Approve &amp; generate benchmark →
          </Button>
        }
      />
    </div>
  );
}

/* ---------------------------------------------------------------- generate */

export function GenerateStep({ benchmark, onRun }: { benchmark: Benchmark; onRun: () => void }) {
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const categories = useMemo(
    () => [...new Set(benchmark.cases.map((c) => c.category))],
    [benchmark],
  );

  return (
    <div className="space-y-4">
      <StepIntro
        title="Normal, edge and adversarial cases"
        body="Each case seeds its own isolated world, so no case can inherit state from another. The
              agent receives the task and the policy. It never receives the checks — those stay
              private, which is what stops a benchmark from grading itself."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Cases" value={String(benchmark.cases.length)} />
        <Stat label="Categories" value={String(categories.length)} />
        <Stat
          label="Generator"
          value={benchmark.generator === 'deterministic' ? 'deterministic' : 'llm-assisted'}
        />
      </div>

      <Panel title="Benchmark cases" subtitle={`contract ${benchmark.contractHash.slice(0, 23)}…`}>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-[0.07em] text-muted">
              <th className="px-4 py-2 font-medium">Case</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">Scenario</th>
              <th className="px-4 py-2 text-right font-medium">Checks</th>
            </tr>
          </thead>
          <tbody>
            {benchmark.cases.map((testCase) => (
              <Fragment key={testCase.id}>
                <tr
                  onClick={() => setOpenCaseId(openCaseId === testCase.id ? null : testCase.id)}
                  data-testid={`case-row-${testCase.id}`}
                  className="cursor-pointer border-b border-line-soft last:border-0 hover:bg-panel-2"
                >
                  <td className="px-4 py-2 text-[13px]">{testCase.name}</td>
                  <td className="px-4 py-2">
                    <Tag tone={testCase.category === 'prompt_injection' ? 'fail' : 'neutral'}>
                      {testCase.category}
                    </Tag>
                  </td>
                  <td className="px-4 py-2">
                    <Mono className="text-dim">{testCase.seed.scenarioId}</Mono>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">
                    {testCase.checks.length}
                  </td>
                </tr>
                {openCaseId === testCase.id ? (
                  <tr className="border-b border-line-soft bg-panel-2">
                    <td colSpan={4} className="px-4 py-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.07em] text-pass">
                            What the agent sees
                          </div>
                          <pre className="mt-1.5 overflow-x-auto rounded-lg border border-line bg-canvas p-2.5 font-mono text-[11px] leading-relaxed text-muted">
                            {JSON.stringify(
                              {
                                instruction: testCase.task.instruction,
                                inputs: testCase.task.inputs,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.07em] text-fail">
                            Private — never sent to the agent
                          </div>
                          <ul className="mt-1.5 space-y-1 rounded-lg border border-line bg-canvas p-2.5">
                            {testCase.checks.map((check) => (
                              <li key={check.id} className="flex items-start gap-2 text-[11.5px]">
                                <Tag tone={check.severity === 'policy' ? 'fail' : 'neutral'}>
                                  {check.severity}
                                </Tag>
                                <span className="text-muted">{check.description}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Panel>

      <NextBar
        note="Both agents run against exactly these cases, from exactly the same seeded state."
        button={
          <Button onClick={onRun} testId="step-run">
            Run Agent A vs Agent B →
          </Button>
        }
      />
    </div>
  );
}

/* --------------------------------------------------------------------- run */

export function RunStep({
  results,
  total,
  active,
  running,
}: {
  results: CaseResult[];
  total: number;
  active: { agentId: string; caseName: string } | null;
  running: boolean;
}) {
  const progress = total === 0 ? 0 : results.length / total;

  return (
    <div className="space-y-4">
      <StepIntro
        title="Executing against a live environment"
        body="Every case resets the world, seeds it, runs the agent through the tool API, then reads
              back what actually changed. These are real executions happening in this browser."
      />

      <Panel
        title={running ? 'Running' : 'Run complete'}
        subtitle={`${results.length} of ${total} case executions`}
        action={
          active ? (
            <Mono className="text-dim">
              {active.agentId} · {active.caseName}
            </Mono>
          ) : null
        }
      >
        <div className="h-0.5 w-full bg-line">
          <div
            className="h-0.5 bg-accent transition-[width] duration-200"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <ol className="max-h-[460px] overflow-y-auto" data-testid="run-log">
          {results.map((result) => {
            const ok = result.taskSuccess && result.policyCompliant;
            return (
              <li
                key={`${result.agentId}-${result.caseId}-${result.correlationId}`}
                className="rr-enter flex items-center gap-3 border-b border-line-soft px-4 py-2 last:border-0"
              >
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] font-bold ${
                    result.unsafeActions > 0
                      ? 'bg-fail/25 text-fail ring-1 ring-fail'
                      : ok
                        ? 'bg-pass/15 text-pass'
                        : 'bg-fail/15 text-fail'
                  }`}
                >
                  {result.unsafeActions > 0 ? '!' : ok ? '✓' : '✕'}
                </span>
                <Mono className="w-28 shrink-0 text-dim">{result.agentId}</Mono>
                <span className="min-w-0 flex-1 truncate text-[13px]">{result.caseName}</span>
                <Tag>{result.category}</Tag>
                <Mono className="w-16 shrink-0 text-right text-dim">
                  {fmtMs(result.durationMs)}
                </Mono>
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ shared */

function StepIntro({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'pass' | 'warn' | 'fail';
}) {
  const color =
    tone === 'pass'
      ? 'text-pass'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'fail'
          ? 'text-fail'
          : 'text-fg';
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.07em] text-muted">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums tracking-tight ${color}`}>
        {value}
      </div>
    </div>
  );
}

function NextBar({ note, button }: { note: string; button: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel-2 px-4 py-3">
      <p className="text-[12.5px] text-muted">{note}</p>
      {button}
    </div>
  );
}

export function ruleLabel(rule: ContractRule): string {
  return `${rule.rule} (${rule.source}, ${rule.confidence.toFixed(2)})`;
}
