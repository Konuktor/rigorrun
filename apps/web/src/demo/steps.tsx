/**
 * The first four steps of the demo. Each renders real artefacts produced by the
 * packages — there is no placeholder content anywhere in this file.
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type {
  Benchmark,
  BenchmarkCase,
  ContractRule,
  WorkflowContract,
  WorkflowTrace,
} from '@rigorrun/core';
import {
  Button,
  Mono,
  Panel,
  SectionLabel,
  StatusMark,
  Tag,
  Truncated,
  fmtMs,
} from '../components/primitives.tsx';
import type { DemoState, RunPhase } from './useDemo.ts';

/**
 * Where the recorded application lives. Local by default; the deployed build
 * points at the hosted copy of Northstar Support so a reviewer with no local
 * setup can still open it.
 */
const CRM_URL = import.meta.env['VITE_CRM_URL'] ?? 'http://127.0.0.1:5174';

/* ------------------------------------------------------------------ shared */

export function StepHeader({
  title,
  lede,
  action,
}: {
  title: string;
  lede: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-[16rem] flex-1">
        <h1 className="text-title font-semibold">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-secondary text-secondary">{lede}</p>
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
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
    <div className="rounded-panel border border-line bg-surface px-4 py-3">
      <div className="text-micro font-medium uppercase text-muted">{label}</div>
      <div data-numeric className={`mt-1 text-metric-sm font-semibold ${color}`}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-meta text-muted">{hint}</div> : null}
    </div>
  );
}

function NextBar({ note, button }: { note: string; button: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-raised px-4 py-3">
      <p className="min-w-[14rem] flex-1 text-meta text-muted">{note}</p>
      {button}
    </div>
  );
}

/* ------------------------------------------------------------------ record */

export function RecordStep({ trace, onCompile }: { trace: WorkflowTrace; onCompile: () => void }) {
  const observations = trace.events.filter((e) => e.type === 'app_observation');
  const interactions = trace.events.length - observations.length;

  return (
    <div className="space-y-4">
      <StepHeader
        title="A person did the job once"
        lede="This is what the recorder captured while a support agent processed a refund. It stores the meaning of each step — role, accessible name, stable selector — not the page."
        action={
          <a
            href={CRM_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center rounded-control border border-line px-3 text-secondary text-secondary hover:border-line-strong hover:text-fg"
          >
            Open Northstar Support ↗
          </a>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Events" value={String(trace.events.length)} />
        <Stat label="Interactions" value={String(interactions)} />
        <Stat label="App signals" value={String(observations.length)} />
        <Stat label="Duration" value={`${(trace.durationMs / 1000).toFixed(1)}s`} />
      </div>

      <Panel
        title="Recorded trace"
        subtitle={<>{trace.app.origin} · no page HTML, no cookies, no credential values</>}
      >
        <div
          className="max-h-[26rem] overflow-y-auto"
          tabIndex={0}
          role="region"
          aria-label="Recorded trace events, scrollable"
        >
          <ol>
            {trace.events.map((event) => (
              <li
                key={event.id}
                className="flex items-start gap-3 border-b border-line-soft px-4 py-2 last:border-0"
              >
                <Mono className="w-11 shrink-0 pt-0.5 text-muted">
                  {(event.at / 1000).toFixed(1)}s
                </Mono>
                <div className="w-28 shrink-0">
                  <Tag tone={event.type === 'app_observation' ? 'info' : 'neutral'}>
                    {event.type}
                  </Tag>
                </div>
                <div className="min-w-0 flex-1">
                  {event.observation ? (
                    <div className="min-w-0">
                      <Mono className="text-fg">{event.observation.name}</Mono>
                      <Truncated
                        className="text-muted"
                        value={JSON.stringify(event.observation.data)}
                      />
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <span className="text-secondary">
                        {event.target?.accessibleName ?? new URL(event.url).pathname}
                      </span>
                      {event.value !== undefined ? (
                        <Mono className="ml-2 text-info">&ldquo;{event.value}&rdquo;</Mono>
                      ) : null}
                      {event.target ? (
                        <div className="mt-0.5 flex min-w-0 items-center gap-2">
                          <Truncated className="text-muted" value={event.target.selector} />
                          <Tag>{event.target.selectorStrategy}</Tag>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Panel>

      <NextBar
        note="Next: RigorRun turns this recording into an executable contract."
        button={
          <Button onClick={onCompile} testId="step-compile" size="lg">
            Compile contract →
          </Button>
        }
      />
    </div>
  );
}

/* ---------------------------------------------------------------- contract */

interface RuleRow {
  kind: string;
  rule: ContractRule;
}

export function ContractStep({
  contract,
  rejected,
  confirmed,
  onDecide,
  onApprove,
}: {
  contract: WorkflowContract;
  rejected: Set<string>;
  confirmed: Set<string>;
  onDecide: (ruleId: string, decision: 'confirm' | 'reject') => void;
  onApprove: () => void;
}) {
  const all: RuleRow[] = [
    ...contract.preconditions.map((rule) => ({ kind: 'Precondition', rule })),
    ...contract.requiredActions.map((rule) => ({ kind: 'Required action', rule })),
    ...contract.forbiddenActions.map((rule) => ({ kind: 'Forbidden action', rule })),
  ];
  const observed = all.filter((r) => r.rule.source === 'observed');
  const inferred = all.filter((r) => r.rule.source === 'inferred');
  const activeInferred = inferred.filter((r) => !rejected.has(r.rule.id));
  const enforcedTotal = observed.length + activeInferred.length;

  return (
    <div className="space-y-4">
      <StepHeader
        title="One recording does not reveal a policy"
        lede="RigorRun separates what it saw from what it inferred. Inferred rules are not enforced until a person confirms them — and rejecting one removes the check behind it."
      />

      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-panel border border-line bg-surface px-4 py-3">
        <SummaryStat label="Observed" value={observed.length} tone="pass" />
        <SummaryStat label="Inferred" value={inferred.length} tone="warn" />
        <SummaryStat label="Rejected" value={rejected.size} />
        <SummaryStat label="Will be enforced" value={enforcedTotal} />
        <div className="min-w-[14rem] flex-1 self-center text-meta text-muted">
          Goal: <span className="text-fg">{contract.goal}</span>
        </div>
      </div>

      <Panel
        title="Observed"
        subtitle="Taken directly from what the person did. Confidence 100%."
        labelledBy="observed-heading"
      >
        <ul>
          {observed.map(({ kind, rule }) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-4 py-2.5 last:border-0"
            >
              <StatusMark status="pass" size="sm" />
              <span className="min-w-[12rem] flex-1 text-secondary">{rule.rule}</span>
              <Mono className="text-muted">{kind}</Mono>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Inferred — needs confirmation"
        subtitle={`Generalisations from a single recording, not observations. ${activeInferred.length} of ${inferred.length} will be enforced when you approve — reject any you disagree with.`}
      >
        <ul>
          {inferred.map(({ kind, rule }) => (
            <InferredRule
              key={rule.id}
              kind={kind}
              rule={rule}
              contract={contract}
              rejected={rejected.has(rule.id)}
              confirmed={confirmed.has(rule.id)}
              onDecide={onDecide}
            />
          ))}
        </ul>
      </Panel>

      <NextBar
        note={`${enforcedTotal} rules will be enforced. ${rejected.size > 0 ? `${rejected.size} rejected rule${rejected.size === 1 ? '' : 's'} will not generate checks.` : 'Reject any rule you disagree with before generating.'}`}
        button={
          <Button onClick={onApprove} testId="step-generate" size="lg">
            Approve &amp; generate benchmark →
          </Button>
        }
      />
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'pass' | 'warn';
}) {
  const color = tone === 'pass' ? 'text-pass' : tone === 'warn' ? 'text-warn' : 'text-fg';
  return (
    <div>
      <div className="text-micro font-medium uppercase text-muted">{label}</div>
      <div data-numeric className={`text-metric-sm font-semibold ${color}`}>
        {value}
      </div>
    </div>
  );
}

function InferredRule({
  kind,
  rule,
  contract,
  rejected,
  confirmed,
  onDecide,
}: {
  kind: string;
  rule: ContractRule;
  contract: WorkflowContract;
  rejected: boolean;
  confirmed: boolean;
  onDecide: (ruleId: string, decision: 'confirm' | 'reject') => void;
}) {
  const question = contract.uncertainty.find((u) => u.relatedRuleIds.includes(rule.id));
  const confidence = Math.round(rule.confidence * 100);

  return (
    <li
      className={`border-b border-line-soft px-4 py-3.5 last:border-0 ${rejected ? 'bg-canvas' : ''}`}
      data-testid={`rule-${rule.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[15rem] flex-1">
          <p
            className={`text-body font-medium ${rejected ? 'text-muted line-through' : 'text-fg'}`}
          >
            {rule.rule}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Mono className="text-muted">{kind}</Mono>
            <span className="text-muted">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-meta text-muted">Confidence</span>
              <span aria-hidden="true" className="h-1 w-12 overflow-hidden rounded-pill bg-line">
                <span
                  className="block h-full rounded-pill bg-warn"
                  style={{ width: `${confidence}%` }}
                />
              </span>
              <span data-numeric className="text-meta font-medium text-warn">
                {confidence}%
              </span>
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {rejected ? (
            <Tag tone="neutral">Rejected</Tag>
          ) : confirmed ? (
            <Tag tone="pass">Confirmed</Tag>
          ) : (
            <Tag tone="warn">Needs review</Tag>
          )}
        </div>
      </div>

      {question ? (
        <p className="mt-2 max-w-3xl text-meta text-secondary">
          <span className="text-warn">RigorRun cannot answer this:</span> {question.question}
          <span className="mt-0.5 block text-muted">{question.reason}</span>
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={confirmed ? 'secondary' : 'primary'}
          onClick={() => onDecide(rule.id, 'confirm')}
          testId={`rule-confirm-${rule.id}`}
        >
          {confirmed ? 'Confirmed' : 'Confirm'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onDecide(rule.id, 'reject')}
          testId={`rule-toggle-${rule.id}`}
        >
          {rejected ? 'Restore' : 'Reject'}
        </Button>
        <span className="text-meta text-muted">
          {rejected
            ? 'Not enforced — no check will be generated.'
            : 'Enforced — a check will be generated for this rule.'}
        </span>
      </div>
    </li>
  );
}

/* --------------------------------------------------------------- benchmark */

const CATEGORY_GROUPS: { id: string; label: string; categories: string[] }[] = [
  { id: 'happy', label: 'Happy path', categories: ['happy_path'] },
  { id: 'boundary', label: 'Boundaries', categories: ['boundary'] },
  { id: 'precondition', label: 'Missing prerequisites', categories: ['missing_precondition'] },
  { id: 'policy', label: 'Policy', categories: ['policy_violation', 'duplicate_action'] },
  { id: 'security', label: 'Security', categories: ['prompt_injection'] },
  {
    id: 'resilience',
    label: 'Tool failures & edge states',
    categories: ['tool_failure', 'timeout', 'malformed_input', 'unexpected_state'],
  },
];

export function BenchmarkStep({
  benchmark,
  onRun,
  running,
}: {
  benchmark: Benchmark;
  onRun: () => void;
  running: boolean;
}) {
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  const groups = useMemo(
    () =>
      CATEGORY_GROUPS.map((group) => ({
        ...group,
        count: benchmark.cases.filter((c) => group.categories.includes(c.category)).length,
      })).filter((g) => g.count > 0),
    [benchmark],
  );

  const visible = useMemo(() => {
    if (filter === 'all') return benchmark.cases;
    const group = CATEGORY_GROUPS.find((g) => g.id === filter);
    return benchmark.cases.filter((c) => group?.categories.includes(c.category));
  }, [benchmark, filter]);

  const categories = new Set(benchmark.cases.map((c) => c.category)).size;

  return (
    <div className="space-y-4">
      <StepHeader
        title="Normal, edge and adversarial cases"
        lede="Each case seeds its own isolated world. The agent receives the task and the policy; it never receives the checks."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Cases" value={String(benchmark.cases.length)} />
        <Stat label="Categories" value={String(categories)} />
        <Stat
          label="Checks per case"
          value={String(benchmark.cases[0]?.checks.length ?? 0)}
          hint="private"
        />
        <Stat label="Generator" value="deterministic" />
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter cases by category"
      >
        <FilterChip
          label="All cases"
          count={benchmark.cases.length}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          testId="filter-all"
        />
        {groups.map((group) => (
          <FilterChip
            key={group.id}
            label={group.label}
            count={group.count}
            active={filter === group.id}
            onClick={() => setFilter(group.id)}
            testId={`filter-${group.id}`}
          />
        ))}
      </div>

      <Panel
        title="Benchmark cases"
        subtitle={<Truncated value={`contract ${benchmark.contractHash}`} />}
      >
        <ul className="divide-y divide-line-soft">
          {visible.map((testCase) => (
            <CaseRow
              key={testCase.id}
              testCase={testCase}
              open={openCaseId === testCase.id}
              onToggle={() => setOpenCaseId(openCaseId === testCase.id ? null : testCase.id)}
            />
          ))}
        </ul>
      </Panel>

      <NextBar
        note="Both agents run these cases from exactly the same seeded state."
        button={
          <Button onClick={onRun} testId="step-run" size="lg" busy={running}>
            {running ? 'Running…' : 'Run Agent A vs Agent B →'}
          </Button>
        }
      />
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  testId,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={`inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-meta font-medium transition-colors ${
        active
          ? 'border-line-strong bg-raised text-fg'
          : 'border-line text-muted hover:border-line-strong hover:text-fg'
      }`}
    >
      {label}
      <span data-numeric className="text-muted">
        {count}
      </span>
    </button>
  );
}

function CaseRow({
  testCase,
  open,
  onToggle,
}: {
  testCase: BenchmarkCase;
  open: boolean;
  onToggle: () => void;
}) {
  const isSecurity = testCase.category === 'prompt_injection';
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid={`case-row-${testCase.id}`}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised"
      >
        <span
          aria-hidden="true"
          className={`text-muted transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-secondary text-fg">{testCase.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-2">
            <Tag tone={isSecurity ? 'fail' : 'neutral'}>{testCase.category.replace(/_/g, ' ')}</Tag>
            <span className="text-meta text-muted">{testCase.checks.length} private checks</span>
          </span>
        </span>
      </button>

      {open ? (
        <div className="grid gap-3 border-t border-line-soft bg-canvas px-4 py-3 md:grid-cols-2">
          <div className="min-w-0">
            <SectionLabel>Visible to the agent</SectionLabel>
            <pre
              className="mt-1.5 overflow-x-auto rounded-control border border-line bg-inset p-2.5 font-mono text-[11px] leading-relaxed text-secondary"
              tabIndex={0}
              role="region"
              aria-label="Task as the agent receives it, scrollable"
            >
              {JSON.stringify(
                { instruction: testCase.task.instruction, inputs: testCase.task.inputs },
                null,
                2,
              )}
            </pre>
          </div>
          <div className="min-w-0">
            <SectionLabel>
              <span className="text-fail">Private verifier — never sent to the agent</span>
            </SectionLabel>
            <ul className="mt-1.5 space-y-1 rounded-control border border-line bg-inset p-2.5">
              {testCase.checks.map((check) => (
                <li key={check.id} className="flex items-start gap-2">
                  <Tag tone={check.severity === 'policy' ? 'fail' : 'neutral'}>
                    {check.severity}
                  </Tag>
                  <span className="text-meta text-secondary">{check.description}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/* --------------------------------------------------------------------- run */

const PHASE_LABEL: Record<RunPhase, string> = {
  idle: 'Preparing',
  seeding: 'Seeding environments',
  executing: 'Executing cases',
  verifying: 'Verifying system state',
  scoring: 'Scoring results',
  done: 'Complete',
};

export function RunStep({ state, total }: { state: DemoState; total: number }) {
  const { liveResults: results, activeCase, running, phase, elapsedMs } = state;
  const progress = total === 0 ? 0 : results.length / total;

  return (
    <div className="space-y-4">
      <StepHeader
        title="Executing against a live environment"
        lede="Every case resets the world, seeds it, runs the agent through the tool API, then reads back what actually changed."
      />

      <Panel
        title={running ? PHASE_LABEL[phase] : 'Run complete'}
        subtitle={
          running
            ? `${results.length} of ${total} case executions`
            : elapsedMs !== null
              ? `${total} case executions in ${elapsedMs} ms`
              : `${results.length} case executions`
        }
        action={
          activeCase ? (
            <Mono className="text-muted">
              {activeCase.agentId} · {activeCase.caseName}
            </Mono>
          ) : null
        }
      >
        <div
          className="h-0.5 w-full bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={results.length}
          aria-label="Benchmark progress"
        >
          <div
            className="h-0.5 bg-info transition-[width] duration-150"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>

        <div
          className="max-h-[28rem] overflow-y-auto"
          data-testid="run-log"
          tabIndex={0}
          role="region"
          aria-label="Case executions, scrollable"
        >
          <ol>
            {results.map((result) => {
              const status =
                result.unsafeActions > 0
                  ? 'unsafe'
                  : result.taskSuccess && result.policyCompliant
                    ? 'pass'
                    : 'fail';
              return (
                <li
                  key={`${result.agentId}-${result.caseId}-${result.correlationId}`}
                  className="rr-enter flex items-center gap-3 border-b border-line-soft px-4 py-2 last:border-0"
                >
                  <StatusMark status={status} size="sm" />
                  <Mono className="w-24 shrink-0 text-muted">{result.agentId}</Mono>
                  <span className="min-w-0 flex-1 truncate text-secondary">{result.caseName}</span>
                  <Mono className="w-14 shrink-0 text-right text-muted">
                    {fmtMs(result.durationMs)}
                  </Mono>
                </li>
              );
            })}
          </ol>
        </div>
      </Panel>

      <p className="text-meta text-muted">
        Execution is near-instant; results are revealed one animation frame apart so the run is
        legible. Every duration shown is the real measured value.
      </p>
    </div>
  );
}

export { Fragment };
