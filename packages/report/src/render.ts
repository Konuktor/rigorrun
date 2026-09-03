/**
 * Self-contained HTML report.
 *
 * Produces a single file with no external requests, so it opens from disk,
 * survives being emailed, and prints. All interpolated content is escaped —
 * the report routinely contains a prompt-injection payload and agent-written
 * prose, and neither is trusted.
 */
import type {
  AgentScore,
  Benchmark,
  CaseResult,
  RunResult,
  WorkflowContract,
} from '@rigorrun/core';
import { pct } from '@rigorrun/scoring';
import { esc, escJson } from './escape.ts';
import { REPORT_CSS } from './styles.ts';
import { sanitizeRunResult, SANITIZATION_NOTES } from './sanitize.ts';

export interface RenderOptions {
  contract?: WorkflowContract;
  benchmark?: Benchmark;
  /** `published` strips private workflow content. */
  mode?: 'full' | 'published';
  generatedAt?: string;
}

export function renderReportHtml(run: RunResult, options: RenderOptions = {}): string {
  const mode = options.mode ?? 'full';
  const data = mode === 'published' ? sanitizeRunResult(run) : run;
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>RigorRun — ${esc(data.benchmarkName)}</title>
<style>${REPORT_CSS}</style>
</head><body><div class="wrap">
${masthead(data, generatedAt, mode)}
${comparison(data)}
${verdictBlock(data)}
${caseMatrix(data)}
${reliability(data)}
${failures(data, mode)}
${contractSection(options.contract)}
${metadata(data, options, generatedAt, mode)}
<footer>
  RigorRun ${esc(data.rigorrunVersion)} · Do the job once. Test every agent forever.<br>
  Northstar Support is a synthetic demo environment. All customers, orders and refunds in it are fabricated.
</footer>
</div></body></html>`;
}

function masthead(run: RunResult, generatedAt: string, mode: string): string {
  return `<header class="masthead">
  <div>
    <div class="brand"><span class="mark">RR</span><h1>RigorRun</h1></div>
    <div class="tagline">Private agent benchmark${mode === 'published' ? ' · published (sanitised)' : ''}</div>
  </div>
  <div class="mono dim" style="text-align:right">
    <div>Workflow: <span style="color:var(--fg)">${esc(run.benchmarkName)}</span></div>
    <div>Run: ${esc(run.runId)}</div>
    <div>${esc(generatedAt)}</div>
  </div>
</header>`;
}

function comparison(run: RunResult): string {
  const n = run.scores[0]?.n ?? 0;
  const rows = run.scores
    .map(
      (s) => `<tr>
      <td><strong>${esc(s.agentName)}</strong><div class="dim mono">${esc(s.agentId)}</div></td>
      <td class="num">${pct(s.taskSuccessRate)}<div class="dim mono">${pct(s.taskSuccessInterval.lower)}–${pct(s.taskSuccessInterval.upper)}</div></td>
      <td class="num">${pct(s.policyComplianceRate)}<div class="dim mono">${pct(s.policyComplianceInterval.lower)}–${pct(s.policyComplianceInterval.upper)}</div></td>
      <td class="num">${s.unsafeActions === 0 ? `<span class="tag pass">0</span>` : `<span class="tag fail">${s.unsafeActions}</span>`}</td>
      <td class="num">${fmtMs(s.medianLatencyMs)}</td>
      <td class="num">${fmtMs(s.p95LatencyMs)}</td>
      <td class="num">${s.avgSteps.toFixed(1)}</td>
      <td class="num">${esc(costLabel(s))}</td>
      <td>${s.thresholdsPassed ? '<span class="tag pass">PASS</span>' : '<span class="tag fail">FAIL</span>'}</td>
    </tr>`,
    )
    .join('');

  return `<h2>Overall comparison</h2>
<div class="panel">
  <table>
    <thead><tr>
      <th>Agent</th><th class="num">Task success</th><th class="num">Policy compliance</th>
      <th class="num">Unsafe</th><th class="num">Median</th><th class="num">p95</th>
      <th class="num">Avg steps</th><th class="num">Cost</th><th>Gate</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="dim mono" style="margin-top:10px">
    N=${n} test cases per agent. Percentage ranges are 95% Wilson score intervals —
    with a sample this size, a 100% result still only supports a lower bound well below 100%.
  </p>
</div>`;
}

function verdictBlock(run: RunResult): string {
  const cls = run.verdict.winnerAgentId ? 'verdict' : 'verdict none';
  return `<div class="${cls}">
  <h3>Verdict</h3>
  <p>${esc(run.verdict.summary)}</p>
  <ul class="muted" style="margin:8px 0 0;padding-left:18px">
    ${run.verdict.rationale.map((r) => `<li>${esc(r)}</li>`).join('')}
  </ul>
</div>`;
}

function caseMatrix(run: RunResult): string {
  const caseIds = [...new Set(run.caseResults.map((r) => r.caseId))];
  const header = run.agents.map((a) => `<th>${esc(shortName(a.name))}</th>`).join('');

  const rows = caseIds
    .map((caseId) => {
      const sample = run.caseResults.find((r) => r.caseId === caseId)!;
      const cells = run.agents
        .map((agent) => {
          const result = run.caseResults.find((r) => r.caseId === caseId && r.agentId === agent.id);
          if (!result) return '<td></td>';
          const ok = result.taskSuccess && result.policyCompliant;
          const cls = result.unsafeActions > 0 ? 'cell unsafe' : ok ? 'cell pass' : 'cell fail';
          const glyph = result.unsafeActions > 0 ? '!' : ok ? '✓' : '✕';
          return `<td><span class="${cls}" title="${esc(result.caseName)}">${glyph}</span></td>`;
        })
        .join('');
      return `<tr>
        <td class="mono dim">${esc(caseId.replace(/^case_/, ''))}</td>
        <td><span class="tag">${esc(sample.category)}</span></td>
        ${cells}
      </tr>`;
    })
    .join('');

  return `<h2>Case matrix</h2>
<div class="panel">
  <table class="matrix">
    <thead><tr><th>Case</th><th>Category</th>${header}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="dim mono" style="margin-top:10px">
    ✓ passed · ✕ failed · <span class="cell unsafe" style="width:16px;height:16px;font-size:10px">!</span> unsafe action taken
  </p>
</div>`;
}

function reliability(run: RunResult): string {
  const cards = run.scores
    .map(
      (s) => `<div class="panel">
      <h3>${esc(s.agentName)}</h3>
      <div class="grid cols-2" style="margin-top:10px">
        ${metric('Task success', pct(s.taskSuccessRate), `95% CI ${pct(s.taskSuccessInterval.lower)}–${pct(s.taskSuccessInterval.upper)}, n=${s.n}`)}
        ${metric('Policy compliance', pct(s.policyComplianceRate), `${s.policyViolations} violation(s)`)}
        ${metric('Unsafe actions', String(s.unsafeActions), 'failed checks flagged unsafe')}
        ${metric('Error rate', pct(s.errorRate), 'agent or adapter failures')}
        ${metric('Median latency', fmtMs(s.medianLatencyMs), `avg ${fmtMs(s.avgLatencyMs)} · p95 ${fmtMs(s.p95LatencyMs)}`)}
        ${metric('Cost', costLabel(s), esc(s.costNote))}
      </div>
      ${
        Object.keys(s.passAtK).length > 0
          ? `<p class="dim mono" style="margin-top:10px">${Object.entries(s.passAtK)
              .map(([k, v]) => `${esc(k)}=${pct(v)}`)
              .join(' · ')}</p>`
          : ''
      }
      ${
        s.failedThresholds.length > 0
          ? `<p class="mono" style="color:var(--fail);margin-top:10px">Gate failures: ${s.failedThresholds.map(esc).join(' · ')}</p>`
          : `<p class="mono" style="color:var(--pass);margin-top:10px">All configured thresholds met.</p>`
      }
    </div>`,
    )
    .join('');

  return `<h2>Reliability</h2><div class="grid cols-2">${cards}</div>`;
}

function metric(label: string, value: string, sub: string): string {
  return `<div class="metric"><div class="label">${esc(label)}</div>
    <div class="value">${esc(value)}</div><div class="sub">${sub}</div></div>`;
}

function failures(run: RunResult, mode: string): string {
  const failed = run.caseResults.filter((r) => !r.taskSuccess || !r.policyCompliant);
  if (failed.length === 0) {
    return `<h2>Failures</h2><div class="panel"><p class="muted">No agent failed any case in this run.</p></div>`;
  }

  return `<h2>Failures &amp; evidence</h2>
${failed.map((result) => failureCard(result, run, mode)).join('')}`;
}

function failureCard(result: CaseResult, run: RunResult, mode: string): string {
  const agentName = run.agents.find((a) => a.id === result.agentId)?.name ?? result.agentId;
  const failedChecks = result.assertions.filter((a) => a.status !== 'PASS');

  return `<div class="failure">
  <div class="head">
    <div>
      <strong>${esc(result.caseName)}</strong>
      <span class="tag" style="margin-left:8px">${esc(result.category)}</span>
      <div class="dim mono">${esc(result.caseId)} · ${esc(agentName)} · ${esc(result.correlationId)}</div>
    </div>
    <div>${result.unsafeActions > 0 ? `<span class="tag fail">${result.unsafeActions} unsafe</span>` : '<span class="tag fail">FAIL</span>'}</div>
  </div>
  <div class="body">
    <div class="grid cols-2">
      <div>
        <h3>What the agent did</h3>
        <ol class="timeline">
          ${timeline(result)}
        </ol>
      </div>
      <div>
        <h3>What the agent said</h3>
        <pre>${esc(result.agentReport || '(no report)')}</pre>
        <p class="dim mono">The claim above is displayed for comparison only. It is never used to decide a verdict.</p>
        ${
          mode === 'full'
            ? `<h3 style="margin-top:12px">What actually changed</h3><pre>${escJson(result.finalStateSummary)}</pre>`
            : ''
        }
      </div>
    </div>
    <h3 style="margin-top:16px">Which checks failed</h3>
    <table>
      <thead><tr><th>Check</th><th>Kind</th><th>Evaluator</th><th>Observed</th><th>Expected</th><th>Status</th></tr></thead>
      <tbody>
      ${failedChecks
        .map(
          (a) => `<tr>
          <td>${esc(a.description)}<div class="dim mono">${esc(a.assertionId)}</div></td>
          <td class="mono dim">${esc(a.kind)}</td>
          <td>${evaluatorTag(a.evaluator)}</td>
          <td class="mono">${escJson(a.observed)}</td>
          <td class="mono">${a.expected === undefined ? '<span class="dim">—</span>' : escJson(a.expected)}</td>
          <td><span class="tag ${a.status === 'FAIL' ? 'fail' : 'error'}">${esc(a.status)}</span>${a.unsafe ? ' <span class="tag fail">unsafe</span>' : ''}</td>
        </tr>`,
        )
        .join('')}
      </tbody>
    </table>
  </div>
</div>`;
}

function timeline(result: CaseResult): string {
  const entries = result.actions.slice(0, 40).map((action) => {
    const bad = !action.ok;
    return `<li class="${bad ? 'bad' : ''}"><span class="t">${formatOffset(action.at)}</span><span class="ev">${esc(
      describeAction(action.type, action.payload),
    )}${action.error ? ` — ${esc(action.error)}` : ''}</span></li>`;
  });

  const failing = result.assertions.filter((a) => a.status !== 'PASS');
  for (const assertion of failing) {
    entries.push(
      `<li class="bad"><span class="t">verify</span><span class="ev">${esc(assertion.assertionId)} ${esc(assertion.status)}</span></li>`,
    );
  }
  return entries.join('');
}

function describeAction(type: string, payload: Record<string, unknown>): string {
  if (type.startsWith('tool.')) {
    const name = type.slice(5);
    const keys = Object.entries(payload)
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
      .map(([k, v]) => `${k}=${String(v)}`)
      .slice(0, 3)
      .join(' ');
    return `${name}(${keys})`;
  }
  if (type === 'refund.created') {
    return `refund created: $${String(payload['amount'])} on ${String(payload['orderId'])} ticket=${String(payload['ticketId'])} approval=${String(payload['approvalId'])}`;
  }
  return type;
}

function contractSection(contract?: WorkflowContract): string {
  if (!contract) return '';
  const ruleRows = [
    ...contract.preconditions.map((r) => ['Precondition', r] as const),
    ...contract.requiredActions.map((r) => ['Required', r] as const),
    ...contract.forbiddenActions.map((r) => ['Forbidden', r] as const),
  ]
    .map(
      ([kind, rule]) => `<tr>
      <td>${esc(kind)}</td>
      <td>${esc(rule.rule)}</td>
      <td><span class="tag ${rule.source === 'user_confirmed' ? 'pass' : rule.source === 'observed' ? 'det' : ''}">${esc(rule.source)}</span></td>
      <td class="num mono">${rule.confidence.toFixed(2)}</td>
    </tr>`,
    )
    .join('');

  return `<h2>Workflow contract</h2>
<div class="panel">
  <p class="muted">${esc(contract.goal)}</p>
  <table style="margin-top:10px">
    <thead><tr><th>Kind</th><th>Rule</th><th>Source</th><th class="num">Confidence</th></tr></thead>
    <tbody>${ruleRows}</tbody>
  </table>
  ${
    contract.uncertainty.length > 0
      ? `<p class="dim mono" style="margin-top:10px">${contract.uncertainty.length} open question(s) were raised at compile time; rules marked <em>user_confirmed</em> were reviewed and accepted by a person.</p>`
      : ''
  }
</div>`;
}

function metadata(
  run: RunResult,
  options: RenderOptions,
  generatedAt: string,
  mode: string,
): string {
  return `<h2>Benchmark metadata</h2>
<div class="panel">
  <dl class="kv">
    <dt>Benchmark</dt><dd>${esc(run.benchmarkId)}</dd>
    <dt>Benchmark hash</dt><dd>${esc(run.benchmarkHash)}</dd>
    <dt>Contract hash</dt><dd>${esc(run.contractHash)}</dd>
    <dt>Result hash</dt><dd>${esc(run.resultHash)}</dd>
    <dt>Environment</dt><dd>${esc(run.environment)}</dd>
    <dt>Cases</dt><dd>${esc(String(options.benchmark?.cases.length ?? new Set(run.caseResults.map((r) => r.caseId)).size))}</dd>
    <dt>Started</dt><dd>${esc(run.startedAt)}</dd>
    <dt>Finished</dt><dd>${esc(run.finishedAt)}</dd>
    <dt>Generated</dt><dd>${esc(generatedAt)}</dd>
    <dt>RigorRun</dt><dd>${esc(run.rigorrunVersion)}</dd>
  </dl>
  <p class="dim mono" style="margin-top:10px">
    Hashes are SHA-256 over the canonical JSON of each artefact. The benchmark hash is computed
    before execution, so a result can always be tied back to the exact cases that produced it.
  </p>
  ${
    mode === 'published'
      ? `<div class="notice" style="margin-top:12px"><strong>Sanitised for publication.</strong><ul style="margin:6px 0 0;padding-left:18px">${SANITIZATION_NOTES.map(
          (n) => `<li>${esc(n)}</li>`,
        ).join('')}</ul></div>`
      : ''
  }
</div>`;
}

function evaluatorTag(evaluator: string): string {
  const cls = evaluator === 'deterministic' ? 'det' : evaluator === 'model_judged' ? 'judge' : 'human';
  const label =
    evaluator === 'deterministic'
      ? 'DETERMINISTIC'
      : evaluator === 'model_judged'
        ? 'MODEL-JUDGED'
        : 'HUMAN-REVIEW';
  return `<span class="tag ${cls}">${label}</span>`;
}

function costLabel(score: AgentScore): string {
  if (score.totalCostUsd === null) return 'unavailable';
  return score.totalCostUsd === 0 ? '$0.00' : `$${score.totalCostUsd.toFixed(4)}`;
}

function shortName(name: string): string {
  return name.replace(/\s*\(.*\)$/, '');
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 1) return `${ms.toFixed(1)}ms`;
  return `${(ms * 1000).toFixed(0)}µs`;
}

function formatOffset(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
