/**
 * The first four steps of the demo. Each renders real artefacts produced by the
 * packages — there is no placeholder content anywhere in this file.
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type {
  Benchmark,
  BenchmarkCase,
  ContractRule,
  EnvironmentContract,
  CanonicalHumanTrace,
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

export function RecordStep({
  trace,
  environmentName,
  onCompile,
}: {
  trace: CanonicalHumanTrace | null;
  environmentName: string;
  onCompile: () => void;
}) {
  if (!trace) {
    return (
      <div className="space-y-4">
        <StepHeader
          title="Show us the job"
          lede="Recording the demonstration and reading the system either side of it."
        />
        <Panel title="Recording">
          <p className="px-4 py-6 text-secondary">Replaying the demonstration…</p>
        </Panel>
      </div>
    );
  }

  const actions = trace.steps.filter((step) => step.action !== undefined);
  const changed = countChanges(trace);

  return (
    <div className="space-y-4">
      <StepHeader
        title="A person did the job once"
        lede={`This is what RigorRun captured while somebody worked in ${environmentName}: what they did, and what the system looked like before and after. It records the meaning of each step, not the page.`}
        action={
          <a
            href={CRM_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center rounded-control border border-line px-3 text-secondary hover:border-line-strong hover:text-fg"
          >
            Open the demo app ↗
          </a>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Steps" value={String(trace.steps.length)} />
        <Stat label="Actions" value={String(actions.length)} />
        <Stat label="Records changed" value={String(changed)} />
        <Stat label="Duration" value={`${(trace.durationMs / 1000).toFixed(1)}s`} />
      </div>

      <Panel
        title="Recorded demonstration"
        subtitle={<>{trace.environmentId} · no page HTML, no cookies, no credential values</>}
      >
        <div
          className="max-h-[26rem] overflow-y-auto"
          tabIndex={0}
          role="region"
          aria-label="Recorded steps, scrollable"
        >
          <ol>
            {trace.steps.map((step) => (
              <li
                key={step.id}
                className="flex items-start gap-3 border-b border-line-soft px-4 py-2 last:border-0"
              >
                <Mono className="w-11 shrink-0 pt-0.5 text-muted">
                  {(step.at / 1000).toFixed(1)}s
                </Mono>
                <div className="w-28 shrink-0">
                  <Tag tone={step.action ? 'info' : 'neutral'}>{step.kind}</Tag>
                </div>
                <div className="min-w-0 flex-1">
                  <Mono className="text-fg">{step.action?.name ?? step.kind}</Mono>
                  {step.action ? (
                    <Truncated className="text-muted" value={JSON.stringify(step.action.args)} />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Panel>

      <NextBar
        note="Next: RigorRun works out what it saw, and what it is only guessing."
        button={
          <Button onClick={onCompile} testId="step-compile" size="lg">
            Review what RigorRun learned →
          </Button>
        }
      />
    </div>
  );
}

/** Records that differ between the state before and the state after. */
function countChanges(trace: CanonicalHumanTrace): number {
  const before = trace.before?.entities ?? {};
  const after = trace.after?.entities ?? {};
  let changed = 0;
  for (const entity of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[entity] ?? {};
    const now = after[entity] ?? {};
    for (const id of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (JSON.stringify(was[id]) !== JSON.stringify(now[id])) changed += 1;
    }
  }
  return changed;
}

/* ---------------------------------------------------------------- contract */

/**
 * Step 2 — what RigorRun learned.
 *
 * Read only, on purpose. Reading what a machine inferred from watching you is
 * a different act from deciding whether it is your policy, and putting Yes and
 * No on this screen invites people to click through the second one while they
 * are still doing the first.
 */
export function LearnedStep({
  contract,
  onContinue,
}: {
  contract: EnvironmentContract;
  onContinue: () => void;
}) {
  const facts = contract.observedFacts;
  const rules = contract.rules;
  const weakest = rules.filter((rule) =>
    rule.provenance.some((node) => node.kind === 'ui_text'),
  ).length;

  return (
    <div className="space-y-4">
      <StepHeader
        title="One recording does not reveal a policy"
        lede="What changed is a fact. What it means is a guess. RigorRun keeps them apart, and shows you which is which before it asks you anything."
      />

      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-panel border border-line bg-surface px-4 py-3">
        <SummaryStat label="Facts observed" value={facts.length} tone="pass" />
        <SummaryStat label="Rules guessed" value={rules.length} tone="warn" />
        <SummaryStat label="Read off a screen" value={weakest} />
        <div className="min-w-[14rem] flex-1 self-center text-meta text-muted">
          Goal: <span className="text-fg">{contract.goal}</span>
        </div>
      </div>

      <Panel
        title="What RigorRun saw"
        subtitle="Read straight out of the system, before and after. Not open to interpretation."
        labelledBy="observed-heading"
      >
        <ul>
          {facts.map((fact) => (
            <li
              key={fact.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-4 py-2.5 last:border-0"
            >
              <StatusMark status="pass" size="sm" />
              <span className="min-w-[12rem] flex-1 text-secondary">{fact.statement}</span>
              <Mono className="text-muted">observed</Mono>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="What RigorRun is guessing"
        subtitle="Each one carries the evidence behind it. None of them can fail an agent yet."
      >
        <ul>
          {rules.map((rule) => (
            <li
              key={rule.id}
              data-testid={`learned-${rule.id}`}
              className="border-b border-line-soft px-4 py-3 last:border-0"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="min-w-[15rem] flex-1 text-body text-fg">{rule.statement}</p>
                <Confidence value={rule.confidence} />
              </div>
              <p className="mt-1.5 flex flex-wrap items-center gap-2">
                {[...new Set(rule.provenance.map((node) => node.kind))].map((kind) => (
                  <Tag key={kind} tone={kind === 'ui_text' ? 'warn' : 'neutral'}>
                    {kind.replace(/_/g, ' ')}
                  </Tag>
                ))}
                <span className="text-meta text-muted">
                  {rule.provenance.find((node) => node.detail)?.detail}
                </span>
              </p>
            </li>
          ))}
        </ul>
      </Panel>

      <NextBar
        note="Nothing above is enforced. Next, you decide which of these are actually your policy."
        button={
          <Button onClick={onContinue} testId="step-confirm" size="lg">
            Confirm the rules →
          </Button>
        }
      />
    </div>
  );
}

/** Step 3 — the decision. Yes, No, and nothing else to learn first. */
export function ContractStep({
  contract,
  rejected,
  confirmed,
  onDecide,
  onApprove,
}: {
  contract: EnvironmentContract;
  rejected: Set<string>;
  confirmed: Set<string>;
  onDecide: (ruleId: string, decision: 'confirm' | 'reject') => void;
  onApprove: () => void;
}) {
  const rules = contract.rules;
  const enforced = rules.filter((rule) => !rejected.has(rule.id)).length;
  const answered = rules.filter(
    (rule) => rejected.has(rule.id) || confirmed.has(rule.id),
  ).length;

  return (
    <div className="space-y-4">
      <StepHeader
        title="Which of these are actually your policy?"
        lede="Answer in your own terms. Say no to anything that is not a rule where you work — a rule you reject can never fail an agent, and RigorRun keeps it as a check on itself."
      />

      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-panel border border-line bg-surface px-4 py-3">
        <SummaryStat label="Answered" value={answered} tone="pass" />
        <SummaryStat label="Said no to" value={rejected.size} />
        <SummaryStat label="Will be enforced" value={enforced} tone="warn" />
        <div className="min-w-[14rem] flex-1 self-center text-meta text-muted">
          You can continue at any point. Anything you have not answered is treated as a yes.
        </div>
      </div>

      <Panel title="Your rules" subtitle="Plain questions. No eval vocabulary, and no wrong answer.">
        <ul>
          {rules.map((rule) => (
            <InferredRule
              key={rule.id}
              rule={rule}
              rejected={rejected.has(rule.id)}
              confirmed={confirmed.has(rule.id)}
              onDecide={onDecide}
            />
          ))}
        </ul>
      </Panel>

      <NextBar
        note={`${enforced} rules will be enforced. ${rejected.size > 0 ? `${rejected.size} rule${rejected.size === 1 ? '' : 's'} you said no to will generate no checks.` : 'Say no to anything you disagree with before continuing.'}`}
        button={
          <Button onClick={onApprove} testId="step-generate" size="lg">
            Stress-test the job →
          </Button>
        }
      />
    </div>
  );
}

function Confidence({ value }: { value: number }) {
  const percent = Math.round(value * 100);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-meta text-muted">Confidence</span>
      <span aria-hidden="true" className="h-1 w-12 overflow-hidden rounded-pill bg-line">
        <span className="block h-full rounded-pill bg-warn" style={{ width: `${percent}%` }} />
      </span>
      <span data-numeric className="text-meta font-medium text-warn">
        {percent}%
      </span>
    </span>
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

/** One rule, phrased as a question with three answers and no eval vocabulary. */
function InferredRule({
  rule,
  rejected,
  confirmed,
  onDecide,
}: {
  rule: ContractRule;
  rejected: boolean;
  confirmed: boolean;
  onDecide: (ruleId: string, decision: 'confirm' | 'reject') => void;
}) {
  const confidence = Math.round(rule.confidence * 100);
  const evidence = [...new Set(rule.provenance.map((node) => node.kind.replace(/_/g, ' ')))];

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
            {rule.question?.text ?? rule.statement}
          </p>
          <p className="mt-1 text-meta text-secondary">{rule.statement}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Mono className="text-muted">{evidence.join(', ')}</Mono>
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
            <Tag tone="neutral">No</Tag>
          ) : confirmed ? (
            <Tag tone="pass">Yes</Tag>
          ) : (
            <Tag tone="warn">Needs an answer</Tag>
          )}
        </div>
      </div>

      {rule.question ? (
        <p className="mt-2 max-w-3xl text-meta text-secondary">
          <span className="text-warn">RigorRun cannot answer this:</span> {rule.question.reason}
          {rule.question.counterexample ? (
            <span className="mt-0.5 block text-muted">{rule.question.counterexample}</span>
          ) : null}
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={confirmed ? 'secondary' : 'primary'}
          onClick={() => onDecide(rule.id, 'confirm')}
          testId={`rule-confirm-${rule.id}`}
        >
          {confirmed ? 'Yes' : 'Yes'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onDecide(rule.id, 'reject')}
          testId={`rule-toggle-${rule.id}`}
        >
          {rejected ? 'Undo' : 'No'}
        </Button>
        <span className="text-meta text-muted">
          {rejected
            ? 'Not your policy — no agent will be failed for it.'
            : 'Part of your policy — an agent that breaks it will fail.'}
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
