/**
 * The comparison view and per-case evidence.
 *
 * Everything here is read from the executed `RunResult`. There are no hardcoded
 * scores in this file — reject a contract rule upstream and these numbers
 * change accordingly.
 */
import { Fragment, useMemo, useState } from 'react';
import type {
  AgentScore,
  AssertionResult,
  Benchmark,
  CaseResult,
  RunResult,
  EnvironmentContract,
} from '@rigorrun/core';
import { renderReportHtml, sanitizeRunResult } from '@rigorrun/report';
import { Dialog } from '../components/Dialog.tsx';
import {
  Button,
  EvaluatorTag,
  Mono,
  Panel,
  SectionLabel,
  STATUS_LABEL,
  StatusMark,
  Tag,
  Truncated,
  fmtMs,
  pct,
  pctCompact,
} from '../components/primitives.tsx';
import { StepHeader } from './steps.tsx';

type Outcome = 'pass' | 'fail' | 'unsafe';

function outcomeOf(result: CaseResult): Outcome {
  if (result.unsafeActions > 0) return 'unsafe';
  return result.taskSuccess && result.policyCompliant ? 'pass' : 'fail';
}

export function VerdictStep({
  result,
  contract,
  benchmark,
}: {
  result: RunResult;
  contract: EnvironmentContract | null;
  benchmark: Benchmark | null;
}) {
  const [selected, setSelected] = useState<CaseResult | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const caseIds = useMemo(() => [...new Set(result.caseResults.map((r) => r.caseId))], [result]);

  const winner = result.scores.find((s) => s.agentId === result.verdict.winnerAgentId);
  const others = result.scores.filter((s) => s.agentId !== result.verdict.winnerAgentId);

  const download = (published: boolean) => {
    const payload = published ? sanitizeRunResult(result) : result;
    const html = renderReportHtml(payload, {
      ...(contract && !published ? { contract } : {}),
      ...(benchmark ? { benchmark } : {}),
      mode: published ? 'published' : 'full',
      // The in-page example is always one of the bundled synthetic workflows.
      syntheticEnvironment: true,
    });
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `rigorrun-${result.runId}${published ? '-published' : ''}.html`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <StepHeader
        title="Head to head"
        lede={`${result.scores.length} implementations ran the same ${caseIds.length} cases from the same seeded state. Every verdict below comes from inspecting the system after the agent finished — never from what it said about itself.`}
      />

      {/* The result, before any table. */}
      <section
        data-testid="verdict"
        aria-labelledby="verdict-heading"
        className={`overflow-hidden rounded-panel border ${
          winner ? 'border-pass-line' : 'border-fail-line'
        } bg-surface`}
      >
        <div className={`px-4 py-4 sm:px-5 ${winner ? 'bg-pass-bg' : 'bg-fail-bg'}`}>
          <div className="text-micro font-medium uppercase text-muted">Verdict</div>
          <h2 id="verdict-heading" className="mt-1 text-title font-semibold">
            {winner ? `${winner.agentName} wins` : 'No agent met the release thresholds'}
          </h2>
          <p className="mt-1 max-w-3xl text-secondary text-secondary">
            {result.verdict.rationale[0] ?? result.verdict.summary}
          </p>
        </div>

        <div className="grid gap-px bg-line sm:grid-cols-2">
          {(winner ? [winner, ...others] : result.scores).map((score, index) => (
            <AgentCard
              key={score.agentId}
              score={score}
              isWinner={Boolean(winner) && index === 0}
            />
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-[16rem] flex-1 text-meta text-muted">
          Ranges are 95% Wilson score intervals. With {result.scores[0]?.n ?? 0} cases, even a
          perfect run only supports a lower bound of{' '}
          {pct(Math.max(...result.scores.map((s) => s.taskSuccessInterval.lower)))} — the honest
          reading is &ldquo;no failures observed yet&rdquo;, not &ldquo;never fails&rdquo;.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPublishOpen(true)}
            testId="publish-preview"
          >
            Publish…
          </Button>
          <Button size="sm" onClick={() => download(false)} testId="export-report">
            Export report
          </Button>
        </div>
      </div>

      <ComparisonTable result={result} />

      <CaseMatrix result={result} caseIds={caseIds} onSelect={setSelected} />

      <Panel title="Benchmark integrity">
        <dl className="grid gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
          <HashRow label="Benchmark" value={result.benchmarkHash} />
          <HashRow label="Contract" value={result.contractHash} />
          <HashRow label="Result" value={result.resultHash} />
          <HashRow label="Run" value={result.runId} />
        </dl>
        <p className="border-t border-line px-4 py-2.5 text-meta text-muted">
          SHA-256 over the canonical JSON of each artefact. The benchmark hash is computed before
          execution, so a result can always be tied to the exact cases that produced it.
        </p>
      </Panel>

      <EvidenceDialog result={selected} onClose={() => setSelected(null)} />
      <PublishDialog
        open={publishOpen}
        result={result}
        onClose={() => setPublishOpen(false)}
        onConfirm={() => {
          download(true);
          setPublishOpen(false);
        }}
      />
    </div>
  );
}

function AgentCard({ score, isWinner }: { score: AgentScore; isWinner: boolean }) {
  const safe = score.unsafeActions === 0;
  return (
    <div className="bg-surface px-4 py-4 sm:px-5" data-testid={`score-${score.agentId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-section font-semibold">{score.agentName}</h3>
        {isWinner ? <Tag tone="pass">Winner</Tag> : null}
        {score.thresholdsPassed ? (
          <Tag tone="pass">Gate passed</Tag>
        ) : (
          <Tag tone="fail">Gate failed</Tag>
        )}
      </div>
      <Mono className="mt-0.5 block text-muted">{score.agentId}</Mono>

      <dl className="mt-3 grid grid-cols-3 gap-3">
        <BigStat
          label="Task success"
          value={pctCompact(score.taskSuccessRate)}
          sub={`${pct(score.taskSuccessInterval.lower)}–${pct(score.taskSuccessInterval.upper)}`}
        />
        <BigStat
          label="Policy"
          value={pctCompact(score.policyComplianceRate)}
          sub={`${score.policyViolations} violation${score.policyViolations === 1 ? '' : 's'}`}
        />
        <BigStat
          label="Unsafe"
          value={String(score.unsafeActions)}
          sub={safe ? 'none taken' : 'must be zero'}
          tone={safe ? 'pass' : 'fail'}
        />
      </dl>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-meta text-muted">
        <span>
          median{' '}
          <span data-numeric className="text-secondary">
            {fmtMs(score.medianLatencyMs)}
          </span>
        </span>
        <span>
          p95{' '}
          <span data-numeric className="text-secondary">
            {fmtMs(score.p95LatencyMs)}
          </span>
        </span>
        <span>
          steps{' '}
          <span data-numeric className="text-secondary">
            {score.avgSteps.toFixed(1)}
          </span>
        </span>
        <span title={score.costNote}>
          cost{' '}
          <span data-numeric className="text-secondary">
            {score.totalCostUsd === null ? 'unavailable' : `$${score.totalCostUsd.toFixed(2)}`}
          </span>
        </span>
      </div>

      {score.failedThresholds.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-line pt-3">
          {score.failedThresholds.map((failure) => (
            <li key={failure} className="text-meta text-fail">
              {failure}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function BigStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: 'pass' | 'fail';
}) {
  const color = tone === 'pass' ? 'text-pass' : tone === 'fail' ? 'text-fail' : 'text-fg';
  return (
    <div>
      <dt className="text-micro font-medium uppercase text-muted">{label}</dt>
      <dd data-numeric className={`mt-0.5 text-metric font-semibold ${color}`}>
        {value}
      </dd>
      <dd className="text-meta text-muted">{sub}</dd>
    </div>
  );
}

function ComparisonTable({ result }: { result: RunResult }) {
  // Same order as the cards above, so the eye does not have to re-map.
  const winnerFirst = result.scores.filter((s) => s.agentId === result.verdict.winnerAgentId);
  const ordered = [...winnerFirst, ...result.scores.filter((s) => !winnerFirst.includes(s))];

  return (
    <Panel title="Comparison" subtitle={`N=${result.scores[0]?.n ?? 0} test cases per agent`}>
      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Agent comparison table, scrollable horizontally"
      >
        <table className="w-full min-w-[44rem] text-left" data-testid="comparison-table">
          <thead>
            <tr className="border-b border-line text-micro uppercase text-muted">
              <th scope="col" className="px-4 py-2 font-medium">
                Agent
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Task success
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Policy
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Unsafe
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Median
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                p95
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Steps
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Cost
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Gate
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((score) => (
              <tr key={score.agentId} className="border-b border-line-soft last:border-0">
                <th scope="row" className="px-4 py-3 text-left font-medium text-fg">
                  {score.agentName}
                </th>
                <td className="px-4 py-3 text-right">
                  <div data-numeric className="text-section font-semibold">
                    {pctCompact(score.taskSuccessRate)}
                  </div>
                  <Mono className="text-muted">
                    {pct(score.taskSuccessInterval.lower)}–{pct(score.taskSuccessInterval.upper)}
                  </Mono>
                </td>
                <td data-numeric className="px-4 py-3 text-right text-section font-semibold">
                  {pctCompact(score.policyComplianceRate)}
                </td>
                <td className="px-4 py-3 text-right">
                  {score.unsafeActions === 0 ? (
                    <Tag tone="pass">0</Tag>
                  ) : (
                    <Tag tone="fail">{score.unsafeActions}</Tag>
                  )}
                </td>
                <td data-numeric className="px-4 py-3 text-right text-secondary">
                  {fmtMs(score.medianLatencyMs)}
                </td>
                <td data-numeric className="px-4 py-3 text-right text-secondary">
                  {fmtMs(score.p95LatencyMs)}
                </td>
                <td data-numeric className="px-4 py-3 text-right text-secondary">
                  {score.avgSteps.toFixed(1)}
                </td>
                <td
                  data-numeric
                  className="px-4 py-3 text-right text-secondary"
                  title={score.costNote}
                >
                  {score.totalCostUsd === null
                    ? 'unavailable'
                    : `$${score.totalCostUsd.toFixed(2)}`}
                </td>
                <td className="px-4 py-3">
                  {score.thresholdsPassed ? (
                    <Tag tone="pass">Pass</Tag>
                  ) : (
                    <Tag tone="fail">Fail</Tag>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CaseMatrix({
  result,
  caseIds,
  onSelect,
}: {
  result: RunResult;
  caseIds: string[];
  onSelect: (result: CaseResult) => void;
}) {
  return (
    <Panel
      title="Case matrix"
      subtitle="Open any execution to see the evidence behind its verdict."
    >
      <ul className="divide-y divide-line-soft">
        {caseIds.map((caseId) => {
          const sample = result.caseResults.find((r) => r.caseId === caseId)!;
          return (
            <li key={caseId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
              <div className="min-w-[12rem] flex-1">
                <div className="text-secondary text-fg">{sample.caseName}</div>
                <Tag tone={sample.category === 'prompt_injection' ? 'fail' : 'neutral'}>
                  {sample.category.replace(/_/g, ' ')}
                </Tag>
              </div>
              <div className="flex shrink-0 gap-2">
                {result.agents.map((agent) => {
                  const cell = result.caseResults.find(
                    (r) => r.caseId === caseId && r.agentId === agent.id,
                  );
                  if (!cell) return null;
                  const status = outcomeOf(cell);
                  const shortName = agent.name.replace(/\s*\(.*\)$/, '');
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      data-testid={`cell-${agent.id}-${caseId}`}
                      onClick={() => onSelect(cell)}
                      aria-label={`${shortName}: ${sample.caseName} — ${STATUS_LABEL[status]}. Open evidence.`}
                      className="inline-flex h-10 items-center gap-2 rounded-control border border-line px-2.5 transition-colors hover:border-line-strong hover:bg-raised"
                    >
                      <StatusMark status={status} size="sm" />
                      <span className="text-meta text-muted">{shortName}</span>
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function HashRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-meta text-muted">{label}</dt>
      <dd className="mb-0.5 min-w-0">
        <Truncated value={value} className="text-fg" />
      </dd>
    </>
  );
}

/* ---------------------------------------------------------------- evidence */

export function EvidenceDialog({
  result,
  onClose,
}: {
  result: CaseResult | null;
  onClose: () => void;
}) {
  if (!result) return null;

  // INAPPLICABLE is not a failure. A mutation that removed a rule's
  // antecedent leaves a check that is neither satisfied nor violated, and
  // showing it under a red "policy failure" banner tells a reader the agent
  // broke a rule it was never tested against.
  const failures = result.assertions.filter(
    (a) => a.status === 'FAIL' || a.status === 'ERROR',
  );
  const inapplicable = result.assertions.filter((a) => a.status === 'INAPPLICABLE').length;
  const primary = failures.find((a) => a.severity === 'policy') ?? failures[0];
  const status = outcomeOf(result);

  return (
    <Dialog
      open
      onClose={onClose}
      title={result.caseName}
      subtitle={<Truncated value={`${result.agentId} · ${result.correlationId}`} />}
      badge={
        status === 'unsafe' ? (
          <Tag tone="fail">{result.unsafeActions} unsafe</Tag>
        ) : status === 'fail' ? (
          <Tag tone="fail">Failed</Tag>
        ) : (
          <Tag tone="pass">Passed</Tag>
        )
      }
      testId="evidence-drawer"
    >
      <div className="space-y-4">
        {primary ? (
          <FailureHeadline assertion={primary} status={status} />
        ) : (
          <PassHeadline inapplicable={inapplicable} />
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <Panel title="What the agent claimed">
            <p className="px-4 py-3 text-secondary text-secondary">
              {result.agentReport || '(no report)'}
            </p>
            <p className="border-t border-line px-4 py-2 text-meta text-warn">
              Not used to decide a verdict.
            </p>
          </Panel>

          <Panel title="What actually changed">
            <pre
              className="max-h-56 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-secondary"
              tabIndex={0}
              role="region"
              aria-label="Final system state, scrollable"
            >
              {JSON.stringify(result.finalStateSummary, null, 2)}
            </pre>
          </Panel>
        </div>

        <Panel title="Timeline">
          <ol className="px-4 py-2">
            {result.actions.map((action, index) => (
              <li
                key={`${action.type}-${index}`}
                className={`flex gap-3 border-b border-line-soft py-1 font-mono text-[11px] last:border-0 ${
                  action.ok ? 'text-secondary' : 'text-fail'
                }`}
              >
                <span className="w-11 shrink-0 text-muted">{formatOffset(action.at)}</span>
                <span className="min-w-0 flex-1 break-words">
                  {describeAction(action.type, action.payload)}
                  {action.error ? ` — ${action.error}` : ''}
                </span>
              </li>
            ))}
            {failures.map((assertion) => (
              <li
                key={assertion.assertionId}
                className="flex gap-3 border-b border-line-soft py-1 font-mono text-[11px] text-fail last:border-0"
              >
                <span className="w-11 shrink-0 text-muted">verify</span>
                <span className="break-words">
                  {assertion.assertionId} {assertion.status}
                </span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title={`All checks (${result.assertions.length})`}>
          <ul className="divide-y divide-line-soft">
            {result.assertions.map((assertion) => (
              <li key={assertion.assertionId} className="px-4 py-2.5">
                <div className="flex flex-wrap items-start gap-2">
                  <Tag
                    tone={
                      assertion.status === 'PASS'
                        ? 'pass'
                        : assertion.status === 'FAIL'
                          ? 'fail'
                          : 'warn'
                    }
                  >
                    {assertion.status}
                  </Tag>
                  <EvaluatorTag evaluator={assertion.evaluator} />
                  <span className="min-w-[12rem] flex-1 text-meta text-secondary">
                    {assertion.description}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </Dialog>
  );
}

function FailureHeadline({ assertion, status }: { assertion: AssertionResult; status: Outcome }) {
  return (
    <section className="overflow-hidden rounded-panel border border-fail-line bg-fail-bg">
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusMark status={status} />
          <span className="text-micro font-semibold uppercase text-fail">
            {assertion.severity === 'policy' ? 'Policy failure' : 'Task failure'}
          </span>
        </div>
        <h3 className="mt-1.5 text-section font-semibold">{assertion.description}</h3>
      </div>

      <div className="grid gap-px border-t border-fail-line bg-fail-line sm:grid-cols-2">
        <div className="min-w-0 bg-surface px-4 py-3">
          <SectionLabel>Observed</SectionLabel>
          <ObservedFacts observed={assertion.observed} />
        </div>
        <div className="min-w-0 bg-surface px-4 py-3">
          <SectionLabel>Expected</SectionLabel>
          <p className="mt-1.5 text-secondary text-secondary">{expectedSentence(assertion)}</p>
          <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-muted">
            {assertion.kind}{' '}
            {assertion.expected === undefined ? '' : JSON.stringify(assertion.expected)}
          </p>
        </div>
      </div>
    </section>
  );
}

/** Fields that decide a refund verdict, in the order a person would read them. */
const SALIENT_FIELDS = [
  'amount',
  'approvalStatus',
  'approvalId',
  'ticketId',
  'orderId',
  'customerId',
  'orderStatus',
  'overSelfServeLimit',
  'ownedByRefundCustomer',
  'ticketValidForOrder',
  'ticketOpenAtSeed',
] as const;

const FIELD_LABEL: Record<string, string> = {
  amount: 'refund.amount',
  approvalStatus: 'manager_approval',
  approvalId: 'approval.id',
  ticketId: 'ticket',
  orderId: 'order',
  customerId: 'customer',
  orderStatus: 'order.status',
  overSelfServeLimit: 'over $50 limit',
  ownedByRefundCustomer: 'customer owns order',
  ticketValidForOrder: 'ticket matches order',
  ticketOpenAtSeed: 'ticket was open',
};

/**
 * Renders the evidence as the handful of values that decided the verdict, not
 * as a JSON dump. The full object is still in the exported report.
 */
function ObservedFacts({ observed }: { observed: unknown }) {
  const record = firstRecord(observed);

  if (!record) {
    return (
      <pre className="mt-1.5 overflow-x-auto font-mono text-[11px] leading-relaxed text-fail">
        {JSON.stringify(observed, null, 2)}
      </pre>
    );
  }

  const keys = SALIENT_FIELDS.filter((key) => key in record);
  const rows = (keys.length > 0 ? keys : Object.keys(record).slice(0, 8)) as string[];

  return (
    <dl
      data-testid="observed-facts"
      className="mt-1.5 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1"
    >
      {rows.map((key) => (
        <Fragment key={key}>
          <dt className="font-mono text-[11px] text-muted">{FIELD_LABEL[key] ?? key}</dt>
          <dd data-numeric className="break-all font-mono text-[11px] font-medium text-fail">
            {formatFactValue(key, record[key])}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : null;
}

function formatFactValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (key === 'amount' && typeof value === 'number') return `$${value.toFixed(2)}`;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/** A readable restatement of what the check required. */
function expectedSentence(assertion: AssertionResult): string {
  if (assertion.expected !== undefined) {
    return `${assertion.description} — expected ${JSON.stringify(assertion.expected)}.`;
  }
  if (assertion.kind === 'state_not_exists') {
    return `${capitalise(assertion.description)}. Nothing matching that condition may exist after the run.`;
  }
  if (assertion.kind === 'state_exists') {
    return `${capitalise(assertion.description)}. It was not found.`;
  }
  return capitalise(assertion.message);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function PassHeadline({ inapplicable }: { inapplicable: number }) {
  return (
    <section className="rounded-panel border border-pass-line bg-pass-bg px-4 py-3">
      <div className="flex items-center gap-2">
        <StatusMark status="pass" />
        <span className="text-micro font-semibold uppercase text-pass">All checks passed</span>
      </div>
      <p className="mt-1.5 text-secondary">
        Every check this case exercises was satisfied by the state the agent left behind.
        {inapplicable > 0 ? (
          <>
            {' '}
            {inapplicable} other check{inapplicable === 1 ? '' : 's'} did not apply here — this
            case does not put {inapplicable === 1 ? 'it' : 'them'} to the test, which is not the
            same as passing.
          </>
        ) : null}
      </p>
    </section>
  );
}

/* ----------------------------------------------------------------- publish */

function PublishDialog({
  open,
  result,
  onClose,
  onConfirm,
}: {
  open: boolean;
  result: RunResult;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const sanitized = useMemo(() => (open ? sanitizeRunResult(result) : null), [open, result]);
  if (!open || !sanitized) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      variant="modal"
      title="Preview before publishing"
      subtitle="Nothing is published automatically. This is exactly what a shared report would contain."
      testId="publish-preview"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm} testId="confirm-publish">
            Download sanitised report
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-panel border border-fail-line bg-fail-bg p-3">
          <SectionLabel>
            <span className="text-fail">Removed</span>
          </SectionLabel>
          <ul className="mt-1 space-y-0.5 text-meta text-secondary">
            <li>Task inputs: customer, order and ticket identifiers</li>
            <li>Tool arguments and tool results</li>
            <li>Assertion evidence: observed and expected values</li>
            <li>Agent prose reports and final state summaries</li>
            <li>Case names, and identifiers or amounts inside check descriptions</li>
          </ul>
        </div>

        <div className="rounded-panel border border-pass-line bg-pass-bg p-3">
          <SectionLabel>
            <span className="text-pass">Kept</span>
          </SectionLabel>
          <ul className="mt-1 space-y-0.5 text-meta text-secondary">
            <li>Scores, intervals and the verdict</li>
            <li>Category labels and per-check PASS/FAIL/ERROR outcomes</li>
            <li>Agent labels, benchmark and contract hashes, timestamps</li>
          </ul>
        </div>

        <div>
          <SectionLabel>First case, as it would be published</SectionLabel>
          <pre
            className="mt-1 max-h-48 overflow-auto rounded-control border border-line bg-inset p-3 font-mono text-[11px] text-secondary"
            tabIndex={0}
            role="region"
            aria-label="Published case payload, scrollable"
          >
            {JSON.stringify(sanitized.caseResults[0], null, 2)}
          </pre>
        </div>
      </div>
    </Dialog>
  );
}

function describeAction(type: string, payload: Record<string, unknown>): string {
  if (type.startsWith('tool.')) {
    const args = Object.entries(payload)
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
      .map(([key, value]) => `${key}=${String(value)}`)
      .slice(0, 3)
      .join(' ');
    return `${type.slice(5)}(${args})`;
  }
  if (type === 'refund.created') {
    return `refund created: $${String(payload['amount'])} on ${String(payload['orderId'])} ticket=${String(
      payload['ticketId'],
    )} approval=${String(payload['approvalId'])}`;
  }
  return type;
}

function formatOffset(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
