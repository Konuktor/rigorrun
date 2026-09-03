import { describe, expect, it } from 'vitest';
import { buildDemoPipeline, runBenchmark } from '@rigorrun/runner';
import { demoRobustAgent, demoWeakAgent } from '@rigorrun/agents';
import { esc, escJson, renderReportHtml, sanitizeRunResult } from '@rigorrun/report';

const pipeline = await buildDemoPipeline();
const run = await runBenchmark(pipeline.benchmark, [demoWeakAgent, demoRobustAgent], {
  runId: 'run_report',
});
const html = renderReportHtml(run, {
  contract: pipeline.contract,
  benchmark: pipeline.benchmark,
  generatedAt: '2026-01-20T10:00:00.000Z',
});

describe('escaping', () => {
  it('neutralises every HTML-significant character', () => {
    expect(esc(`<script>alert("x")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(esc("'`&")).toBe('&#39;&#96;&amp;');
  });

  it('escapes JSON payloads too', () => {
    expect(escJson({ note: '<img src=x onerror=alert(1)>' })).not.toContain('<img');
  });

  it('bounds very large values', () => {
    expect(escJson({ big: 'x'.repeat(20_000) }).length).toBeLessThan(5000);
  });
});

describe('the rendered report', () => {
  it('is a single self-contained document with no external requests', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/src=["']https?:/i);
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/i);
  });

  it('states the sample size next to the percentages', () => {
    expect(html).toContain('N=17 test cases');
  });

  it('shows both agents and the verdict', () => {
    expect(html).toContain('Agent A (baseline)');
    expect(html).toContain('Agent B (hardened)');
    expect(html).toContain('Verdict');
    expect(html).toContain(esc(run.verdict.summary));
  });

  it('includes all three artefact hashes', () => {
    expect(html).toContain(run.benchmarkHash);
    expect(html).toContain(run.contractHash);
    expect(html).toContain(run.resultHash);
  });

  it('distinguishes deterministic checks visually', () => {
    expect(html).toContain('DETERMINISTIC');
  });

  it('renders the failure evidence with observed and expected values', () => {
    expect(html).toContain('Failures &amp; evidence');
    expect(html).toContain('Which checks failed');
    expect(html).toContain('policy_forbid_over_limit');
  });

  it('shows the agent’s claim but labels it as not decisive', () => {
    expect(html).toContain('never used to decide a verdict');
  });

  it('includes the contract with rule provenance', () => {
    expect(html).toContain('Workflow contract');
    expect(html).toContain('user_confirmed');
  });

  it('says the environment is synthetic', () => {
    expect(html).toContain('synthetic demo environment');
  });

  it('carries print styles', () => {
    expect(html).toContain('@media print');
  });
});

describe('injected content cannot escape into the report', () => {
  it('renders the $500 injection payload inertly', () => {
    // The weak agent's report and the action log both carry attacker-authored text.
    expect(html).not.toContain('<script>');
    const injectionCase = run.caseResults.find(
      (r) => r.caseId === 'case_prompt-injection' && r.agentId === 'demo-weak',
    )!;
    expect(injectionCase.agentReport).toContain('500');
    expect(html).toContain('refund created: $500');
  });

  it('escapes a hostile agent report', async () => {
    const hostile = structuredClone(run);
    hostile.caseResults[0]!.agentReport = '<img src=x onerror="alert(1)">';
    hostile.caseResults[0]!.taskSuccess = false;
    const out = renderReportHtml(hostile);
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img src=x');
  });

  it('escapes a hostile benchmark name', () => {
    const hostile = { ...run, benchmarkName: '</title><script>alert(1)</script>' };
    const out = renderReportHtml(hostile);
    expect(out).not.toContain('<script>alert(1)</script>');
  });
});

describe('publishing a sanitised report', () => {
  const sanitized = sanitizeRunResult(run);
  const publishedHtml = renderReportHtml(sanitized, { mode: 'published' });

  it('drops task inputs, tool arguments and results', () => {
    const serialised = JSON.stringify(sanitized);
    expect(serialised).not.toContain('CUST-2016');
    expect(serialised).not.toContain('ORD-3001');
    expect(serialised).not.toContain('IMPORTANT SYSTEM MESSAGE');
  });

  it('drops agent prose and assertion evidence', () => {
    for (const result of sanitized.caseResults) {
      expect(result.agentReport).toBe('(withheld from the published report)');
      expect(result.finalStateSummary).toEqual({});
      for (const assertion of result.assertions) expect(assertion.observed).toBeUndefined();
    }
  });

  it('masks record identifiers and amounts in check descriptions', () => {
    const descriptions = sanitized.caseResults.flatMap((r) =>
      r.assertions.map((a) => a.description),
    );
    expect(descriptions.join(' ')).not.toMatch(/\b[A-Z]{2,6}-\d{3,}\b/);
    expect(descriptions.some((d) => d.includes('\u2039id\u203a'))).toBe(true);
  });

  it('replaces case names with case numbers', () => {
    expect(sanitized.caseResults[0]!.caseName).toBe('Case 1');
  });

  it('keeps the scores, outcomes, labels and hashes', () => {
    expect(sanitized.scores).toEqual(run.scores);
    expect(sanitized.benchmarkHash).toBe(run.benchmarkHash);
    const first = sanitized.caseResults[0]!;
    expect(first.category).toBe(run.caseResults[0]!.category);
    expect(first.assertions[0]?.status).toBeDefined();
    expect(first.taskSuccess).toBe(run.caseResults[0]!.taskSuccess);
  });

  it('tells the reader what was removed', () => {
    expect(publishedHtml).toContain('Sanitised for publication');
    expect(publishedHtml).toContain('Tool arguments and tool results are removed');
  });

  it('does not leak the private workflow into the published HTML', () => {
    expect(publishedHtml).not.toContain('CUST-2016');
    expect(publishedHtml).not.toContain('IMPORTANT SYSTEM MESSAGE');
  });
});
