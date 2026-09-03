/**
 * The comparison view and per-case evidence.
 *
 * Everything rendered here is read from the executed `RunResult`. There are no
 * hardcoded scores anywhere in this file — reject a contract rule upstream and
 * these numbers change accordingly.
 */
import { useState } from 'react';
import type {
  AgentScore,
  Benchmark,
  CaseResult,
  RunResult,
  WorkflowContract,
} from '@rigorrun/core';
import { renderReportHtml, sanitizeRunResult } from '@rigorrun/report';
import { Button, EvaluatorTag, Mono, Panel, Tag, fmtMs, pct } from '../components/primitives.tsx';

export function VerdictStep({
  result,
  contract,
  benchmark,
}: {
  result: RunResult;
  contract: WorkflowContract | null;
  benchmark: Benchmark | null;
}) {
  const [selected, setSelected] = useState<CaseResult | null>(null);
  const [publishPreview, setPublishPreview] = useState(false);
  const caseIds = [...new Set(result.caseResults.map((r) => r.caseId))];

  const download = (published: boolean) => {
    const payload = published ? sanitizeRunResult(result) : result;
    const html = renderReportHtml(payload, {
      ...(contract && !published ? { contract } : {}),
      ...(benchmark ? { benchmark } : {}),
      mode: published ? 'published' : 'full',
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[240px] flex-1">
          <h1 className="text-[17px] font-semibold tracking-tight">Head to head</h1>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-muted">
            Both agents ran the same {caseIds.length} cases from the same seeded state. Every
            verdict below comes from inspecting the system after the agent finished.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPublishPreview(true)}
            testId="publish-preview"
          >
            Publish…
          </Button>
          <Button size="sm" onClick={() => download(false)} testId="export-report">
            Export report
          </Button>
        </div>
      </div>

      <div
        className={`rounded-xl border p-4 ${
          result.verdict.winnerAgentId
            ? 'border-pass/30 bg-pass/[0.05]'
            : 'border-fail/30 bg-fail/[0.05]'
        }`}
        data-testid="verdict"
      >
        <div className="text-[11px] uppercase tracking-[0.07em] text-muted">Verdict</div>
        <p className="mt-1 text-[15px] font-medium">{result.verdict.summary}</p>
        <ul className="mt-2 space-y-0.5">
          {result.verdict.rationale.map((reason) => (
            <li key={reason} className="text-[12.5px] text-muted">
              — {reason}
            </li>
          ))}
        </ul>
      </div>

      <Panel title="Comparison" subtitle={`N=${result.scores[0]?.n ?? 0} test cases per agent`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left" data-testid="comparison-table">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-[0.07em] text-muted">
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-4 py-2 text-right font-medium">Task success</th>
                <th className="px-4 py-2 text-right font-medium">Policy compliance</th>
                <th className="px-4 py-2 text-right font-medium">Unsafe</th>
                <th className="px-4 py-2 text-right font-medium">Median</th>
                <th className="px-4 py-2 text-right font-medium">p95</th>
                <th className="px-4 py-2 text-right font-medium">Steps</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
                <th className="px-4 py-2 font-medium">Gate</th>
              </tr>
            </thead>
            <tbody>
              {result.scores.map((score) => (
                <ScoreRow key={score.agentId} score={score} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-[11.5px] leading-relaxed text-dim">
          Ranges are 95% Wilson score intervals. With {result.scores[0]?.n ?? 0} cases, even a
          perfect run only supports a lower bound of{' '}
          {pct(Math.max(...result.scores.map((s) => s.taskSuccessInterval.lower)))} — the honest
          reading is &ldquo;no failures observed yet&rdquo;, not &ldquo;never fails&rdquo;.
        </p>
      </Panel>

      <Panel title="Case matrix" subtitle="Click any cell to open the evidence for that execution.">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-[0.07em] text-muted">
                <th className="px-4 py-2 font-medium">Case</th>
                <th className="px-4 py-2 font-medium">Category</th>
                {result.agents.map((agent) => (
                  <th key={agent.id} className="px-4 py-2 text-center font-medium">
                    {agent.name.replace(/\s*\(.*\)$/, '')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {caseIds.map((caseId) => {
                const sample = result.caseResults.find((r) => r.caseId === caseId)!;
                return (
                  <tr key={caseId} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-1.5 text-[13px]">{sample.caseName}</td>
                    <td className="px-4 py-1.5">
                      <Tag tone={sample.category === 'prompt_injection' ? 'fail' : 'neutral'}>
                        {sample.category}
                      </Tag>
                    </td>
                    {result.agents.map((agent) => {
                      const cell = result.caseResults.find(
                        (r) => r.caseId === caseId && r.agentId === agent.id,
                      );
                      if (!cell) return <td key={agent.id} />;
                      const ok = cell.taskSuccess && cell.policyCompliant;
                      return (
                        <td key={agent.id} className="px-4 py-1.5 text-center">
                          <button
                            type="button"
                            data-testid={`cell-${agent.id}-${caseId}`}
                            onClick={() => setSelected(cell)}
                            title={`${agent.name} · ${cell.caseName}`}
                            className={`grid h-6 w-6 place-items-center rounded text-[11px] font-bold transition-transform hover:scale-110 ${
                              cell.unsafeActions > 0
                                ? 'bg-fail/25 text-fail ring-1 ring-fail'
                                : ok
                                  ? 'bg-pass/15 text-pass'
                                  : 'bg-fail/15 text-fail'
                            }`}
                          >
                            {cell.unsafeActions > 0 ? '!' : ok ? '✓' : '✕'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Benchmark integrity">
        <dl className="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[auto_1fr]">
          <HashRow label="Benchmark" value={result.benchmarkHash} />
          <HashRow label="Contract" value={result.contractHash} />
          <HashRow label="Result" value={result.resultHash} />
          <HashRow label="Run" value={result.runId} />
        </dl>
        <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-dim">
          SHA-256 over the canonical JSON of each artefact. The benchmark hash is computed before
          execution, so a result can always be tied to the exact cases that produced it.
        </p>
      </Panel>

      {selected ? <EvidenceDrawer result={selected} onClose={() => setSelected(null)} /> : null}
      {publishPreview ? (
        <PublishPreview
          result={result}
          onClose={() => setPublishPreview(false)}
          onConfirm={() => {
            download(true);
            setPublishPreview(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ScoreRow({ score }: { score: AgentScore }) {
  return (
    <tr className="border-b border-line-soft last:border-0" data-testid={`score-${score.agentId}`}>
      <td className="px-4 py-3">
        <div className="text-[13px] font-medium">{score.agentName}</div>
        <Mono className="text-dim">{score.agentId}</Mono>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="text-[15px] font-semibold tabular-nums">{pct(score.taskSuccessRate)}</div>
        <Mono className="text-dim">
          {pct(score.taskSuccessInterval.lower)}–{pct(score.taskSuccessInterval.upper)}
        </Mono>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="text-[15px] font-semibold tabular-nums">
          {pct(score.policyComplianceRate)}
        </div>
        <Mono className="text-dim">{score.policyViolations} violation(s)</Mono>
      </td>
      <td className="px-4 py-3 text-right">
        {score.unsafeActions === 0 ? (
          <Tag tone="pass">0</Tag>
        ) : (
          <Tag tone="fail">{score.unsafeActions}</Tag>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted">
        {fmtMs(score.medianLatencyMs)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted">{fmtMs(score.p95LatencyMs)}</td>
      <td className="px-4 py-3 text-right tabular-nums text-muted">{score.avgSteps.toFixed(1)}</td>
      <td className="px-4 py-3 text-right">
        {score.totalCostUsd === null ? (
          <Mono className="text-dim">unavailable</Mono>
        ) : (
          <span className="tabular-nums text-muted" title={score.costNote}>
            ${score.totalCostUsd.toFixed(2)}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        {score.thresholdsPassed ? <Tag tone="pass">PASS</Tag> : <Tag tone="fail">FAIL</Tag>}
      </td>
    </tr>
  );
}

function HashRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mb-0.5 break-all font-mono text-[11.5px] text-fg">{value}</dd>
    </>
  );
}

/* ---------------------------------------------------------------- evidence */

export function EvidenceDrawer({ result, onClose }: { result: CaseResult; onClose: () => void }) {
  const failures = result.assertions.filter((a) => a.status !== 'PASS');

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <aside
        className="rr-enter h-full w-full max-w-2xl overflow-y-auto border-l border-line bg-canvas"
        onClick={(event) => event.stopPropagation()}
        data-testid="evidence-drawer"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-canvas/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">{result.caseName}</h2>
            <Mono className="text-dim">
              {result.agentId} · {result.correlationId}
            </Mono>
          </div>
          <div className="flex items-center gap-2">
            {result.unsafeActions > 0 ? <Tag tone="fail">{result.unsafeActions} unsafe</Tag> : null}
            <Button variant="ghost" size="sm" onClick={onClose} testId="close-evidence">
              Close
            </Button>
          </div>
        </header>

        <div className="space-y-4 p-5">
          <Panel title="What the agent did">
            <ol className="px-4 py-2">
              {result.actions.map((action, index) => (
                <li
                  key={`${action.type}-${index}`}
                  className={`flex gap-3 border-b border-line-soft py-1 font-mono text-[11.5px] last:border-0 ${
                    action.ok ? '' : 'text-fail'
                  }`}
                >
                  <span className="w-12 shrink-0 text-dim">{formatOffset(action.at)}</span>
                  <span className="min-w-0 flex-1 break-all">
                    {describeAction(action.type, action.payload)}
                    {action.error ? ` — ${action.error}` : ''}
                  </span>
                </li>
              ))}
              {failures.map((assertion) => (
                <li
                  key={assertion.assertionId}
                  className="flex gap-3 border-b border-line-soft py-1 font-mono text-[11.5px] text-fail last:border-0"
                >
                  <span className="w-12 shrink-0 text-dim">verify</span>
                  <span>
                    {assertion.assertionId} {assertion.status}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel
            title="What the agent said"
            subtitle="Displayed for comparison. Never used to decide a verdict."
          >
            <p className="px-4 py-3 text-[13px] leading-relaxed text-muted">
              {result.agentReport || '(no report)'}
            </p>
          </Panel>

          <Panel title="What actually changed">
            <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-muted">
              {JSON.stringify(result.finalStateSummary, null, 2)}
            </pre>
          </Panel>

          <Panel title={`Checks (${result.assertions.length})`}>
            <ul>
              {result.assertions.map((assertion) => (
                <li
                  key={assertion.assertionId}
                  className="border-b border-line-soft px-4 py-2.5 last:border-0"
                >
                  <div className="flex items-start gap-2">
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
                    <span className="flex-1 text-[12.5px]">{assertion.description}</span>
                  </div>
                  {assertion.status !== 'PASS' ? (
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                      <div>
                        <div className="text-[10.5px] uppercase tracking-[0.07em] text-dim">
                          Observed
                        </div>
                        <pre className="mt-0.5 overflow-x-auto rounded border border-line bg-panel-2 p-2 font-mono text-[11px] text-fail">
                          {JSON.stringify(assertion.observed, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-[10.5px] uppercase tracking-[0.07em] text-dim">
                          Expected
                        </div>
                        <pre className="mt-0.5 overflow-x-auto rounded border border-line bg-panel-2 p-2 font-mono text-[11px] text-muted">
                          {assertion.expected === undefined
                            ? assertion.message
                            : JSON.stringify(assertion.expected, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </aside>
    </div>
  );
}

/* ----------------------------------------------------------------- publish */

function PublishPreview({
  result,
  onClose,
  onConfirm,
}: {
  result: RunResult;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const sanitized = sanitizeRunResult(result);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="rr-enter max-h-full w-full max-w-2xl overflow-y-auto rounded-xl border border-line bg-canvas"
        onClick={(event) => event.stopPropagation()}
        data-testid="publish-preview"
      >
        <header className="border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-tight">Preview before publishing</h2>
          <p className="mt-1 text-[12.5px] text-muted">
            Nothing is published automatically. This is exactly what a shared report would contain.
          </p>
        </header>

        <div className="space-y-3 p-5">
          <div className="rounded-lg border border-fail/30 bg-fail/[0.05] p-3">
            <div className="text-[11px] uppercase tracking-[0.07em] text-fail">Removed</div>
            <ul className="mt-1 space-y-0.5 text-[12.5px] text-muted">
              <li>— Task inputs: customer, order and ticket identifiers</li>
              <li>— Tool arguments and tool results</li>
              <li>— Assertion evidence: observed and expected values</li>
              <li>— Agent prose reports and final state summaries</li>
              <li>— Case names, and identifiers or amounts inside check descriptions</li>
            </ul>
          </div>

          <div className="rounded-lg border border-pass/30 bg-pass/[0.05] p-3">
            <div className="text-[11px] uppercase tracking-[0.07em] text-pass">Kept</div>
            <ul className="mt-1 space-y-0.5 text-[12.5px] text-muted">
              <li>— Scores, intervals and the verdict</li>
              <li>— Category labels and per-check PASS/FAIL/ERROR outcomes</li>
              <li>— Agent labels, benchmark and contract hashes, timestamps</li>
            </ul>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-[0.07em] text-muted">
              First case, as it would be published
            </div>
            <pre className="mt-1 max-h-52 overflow-auto rounded-lg border border-line bg-panel-2 p-3 font-mono text-[11px] text-muted">
              {JSON.stringify(sanitized.caseResults[0], null, 2)}
            </pre>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm} testId="confirm-publish">
            Download sanitised report
          </Button>
        </footer>
      </div>
    </div>
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
