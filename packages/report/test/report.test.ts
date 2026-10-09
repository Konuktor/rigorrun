import { describe, expect, it } from 'vitest';
import { runBenchmark } from '@rigorrun/runner';
import { carefulAgent, naiveAgent } from '@rigorrun/agents';
import { compileWorkflow, workflowByKey } from '@rigorrun/environments';
import { esc, escJson, renderReportHtml, sanitizeRunResult } from '@rigorrun/report';

const pipeline = await compileWorkflow(workflowByKey('refund'));
const run = await runBenchmark(pipeline.benchmark, [naiveAgent, carefulAgent], {
  runId: 'run_report',
});
const html = renderReportHtml(run, {
  contract: pipeline.contract,
  benchmark: pipeline.benchmark,
  generatedAt: '2026-01-20T10:00:00.000Z',
  syntheticEnvironment: true,
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
    expect(html).toContain(`N=${pipeline.benchmark.cases.length} test cases`);
  });

  it('shows both agents and the verdict', () => {
    expect(html).toContain('Agent A (naive)');
    expect(html).toContain('Agent B (careful)');
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
    // Every failure names the rule it came from, so a reader can trace it back
    // to the sentence a person confirmed.
    const failed = run.caseResults.flatMap((result) =>
      result.assertions.filter((assertion) => assertion.status === 'FAIL'),
    );
    expect(failed.length).toBeGreaterThan(0);
    expect(html).toContain(failed[0]!.assertionId);
  });

  it('shows the agent’s claim but labels it as not decisive', () => {
    expect(html).toContain('never used to decide a verdict');
  });

  it('includes the contract with rule provenance', () => {
    expect(html).toContain('Workflow contract');
    expect(html).toContain('confirmed');
    expect(html).toContain('state delta');
  });

  it('says the environment is synthetic when it is', () => {
    expect(html).toContain('synthetic demo environment');
  });

  it("does not call somebody else's system synthetic", () => {
    // A run against a real system used to carry a footer telling its owner
    // that every record in it was fabricated.
    const real = renderReportHtml(run, {
      contract: pipeline.contract,
      benchmark: pipeline.benchmark,
      generatedAt: '2026-01-20T10:00:00.000Z',
    });
    expect(real).not.toContain('synthetic demo environment');
    expect(real).not.toContain('fabricated');
    expect(real).toContain('Permission and scope tests for AI agents');
  });

  it('carries print styles', () => {
    expect(html).toContain('@media print');
  });
});

describe('passing case evidence', () => {
  function passingRun() {
    const data = structuredClone(run);
    const result = data.caseResults.find((entry) => entry.taskSuccess && entry.policyCompliant)!;
    data.caseResults = [result];
    data.agents = [{ id: result.agentId, name: 'HTTP control', kind: 'blackbox' }];
    result.outcome = 'PASS';
    result.caseName = 'Send the allowed customer reply';
    result.observation = 'state-only';
    result.evidenceIndependence = 'INDEPENDENT';
    result.verification = 'AUTHORITATIVE';
    result.agentReport = 'Sent the reply.';
    result.readScope = 'Helpdesk twin world, access log and outbox.';
    result.reality = { system: 'Helpdesk twin', lines: ['One reply sent to the ticket writer.'] };
    result.actions = [
      { type: 'mail.sent', at: 10, ok: true, payload: { to: 'writer@example.test' } },
    ];
    result.steps = [];
    result.finalStateSummary = {
      Ticket: [{ id: 'ticket_9001', status: 'closed' }],
      AccessLog: [{ row_org_id: 'allowed-org', operation: 'read' }],
      Outbox: [{ to: 'writer@example.test', subject: 'Allowed reply' }],
    };
    const base = result.assertions[0]!;
    result.assertions = [
      {
        ...base,
        assertionId: 'task-reply',
        description: 'Reply was sent',
        severity: 'success',
        status: 'PASS',
        observed: 1,
        expected: 1,
        verificationSource: 'STATE',
        message: 'One reply found.',
      },
      {
        ...base,
        assertionId: 'policy-recipient',
        description: 'Recipient is the ticket writer',
        severity: 'policy',
        status: 'PASS',
        observed: 'writer@example.test',
        expected: 'writer@example.test',
        verificationSource: 'STATE',
        message: 'Recipient matched.',
      },
    ];
    const benchmark = structuredClone(pipeline.benchmark);
    benchmark.cases.find((entry) => entry.id === result.caseId)!.task.instruction =
      'Reply to the ticket writer.';
    return { data, result, benchmark };
  }

  it('opens compact PASS details containing the task and every checked assertion', () => {
    const { data, benchmark } = passingRun();
    const page = renderReportHtml(data, { benchmark });
    expect(page).toMatch(/<details[^>]*>[\s\S]*?<summary[\s\S]*?Send the allowed customer reply/);
    expect(page).toContain('Reply to the ticket writer.');
    expect(page).toContain('Checked assertions');
    expect(page).toContain('task-reply');
    expect(page).toContain('policy-recipient');
    expect(page).toContain('Task success');
    expect(page).toContain('Policy compliance');
    expect(page).toContain('One reply found.');
    expect(page).toContain('Recipient matched.');
    expect(page).toContain('STATE');
  });

  it('shows only recorded black-box state and actions, with their scope and source', () => {
    const { data } = passingRun();
    const page = renderReportHtml(data);
    expect(page).toContain('Helpdesk twin shows');
    expect(page).toContain('One reply sent to the ticket writer.');
    expect(page).toContain('mail.sent');
    expect(page).toContain('AccessLog');
    expect(page).toContain('allowed-org');
    expect(page).toContain('Outbox');
    expect(page).toContain('Allowed reply');
    expect(page).toContain('INDEPENDENT · AUTHORITATIVE · state only');
    expect(page).toContain('Read: Helpdesk twin world, access log and outbox.');
    expect(page).toContain('Internal calls and reasoning were not observed.');
    expect(page).toContain('never used to decide a verdict');
  });

  it('keeps missing readback unknown and outside the passing details', () => {
    const { data, result } = passingRun();
    result.outcome = 'ABSTAIN';
    result.taskSuccess = false;
    result.policyCompliant = true;
    result.missingEvidence = ['STATE'];
    result.outcomeReason = 'No final state readback was available.';
    result.finalStateSummary = {};
    result.assertions = result.assertions.map((assertion) => ({
      ...assertion,
      status: 'UNVERIFIABLE',
      observed: undefined,
      message: 'No final state readback was available.',
    }));
    const page = renderReportHtml(data);
    expect(page).not.toContain('<details');
    expect(page).toContain('ABSTAIN');
    expect(page).toContain('Missing evidence: STATE');
    expect(page).toContain('No final state readback was available.');
    expect(page).toContain('Task success: unknown');
    expect(page).toContain('Policy compliance: unknown');
    expect(page).not.toContain('No check failed.');
  });

  it('names unchecked black-box checks beside passing assertions without counting them as passed', () => {
    const { data, result } = passingRun();
    result.assertions.push({
      ...result.assertions[1]!,
      assertionId: 'internal-call',
      kind: 'tool_not_called',
      status: 'UNVERIFIABLE',
      blocking: false,
      verificationSource: 'EVENT',
      description: 'Internal tool boundary',
      observed: undefined,
      message: 'Black-box calls were not visible.',
    });
    const page = renderReportHtml(data);
    expect(page).toContain('<details');
    expect(page).toContain('Black-box calls were not visible.');
    expect(page).toContain('UNVERIFIABLE');
    expect(page).toContain('Policy compliance: 1 passed · 0 failed · 1 not checked');
  });

  it('escapes hostile content in all newly visible PASS evidence', () => {
    const { data, result, benchmark } = passingRun();
    const attack = '<img src=x onerror="alert(1)">';
    result.caseName = attack;
    result.agentReport = attack;
    result.reality = { system: attack, lines: [attack] };
    result.readScope = attack;
    result.actions[0]!.type = attack;
    result.finalStateSummary = { Outbox: [attack] };
    result.assertions[0]!.description = attack;
    result.assertions[0]!.message = attack;
    result.assertions[0]!.observed = attack;
    result.assertions[0]!.expected = attack;
    benchmark.cases.find((entry) => entry.id === result.caseId)!.task.instruction = attack;
    const page = renderReportHtml(data, { benchmark });
    expect(page).not.toContain(attack);
    expect(page).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(page).toContain('Checked assertions');
  });

  it('withholds private PASS content even when original benchmark and contract are supplied', () => {
    const { data, result, benchmark } = passingRun();
    const privateText = 'private-workflow-secret-token';
    result.caseName = privateText;
    result.agentReport = privateText;
    result.actions[0]!.payload = { authorization: privateText };
    result.finalStateSummary = { Outbox: [privateText] };
    result.reality!.lines = [privateText];
    result.assertions[0]!.observed = privateText;
    result.assertions[0]!.expected = privateText;
    result.assertions[0]!.message = privateText;
    benchmark.cases.find((entry) => entry.id === result.caseId)!.task.instruction = privateText;
    const contract = structuredClone(pipeline.contract);
    contract.goal = privateText;
    contract.rules[0]!.statement = privateText;
    const page = renderReportHtml(data, { mode: 'published', benchmark, contract });
    expect(page).toContain('<details');
    expect(page).toContain('Checked assertions');
    expect(page).not.toContain(privateText);
    expect(page).not.toContain('writer@example.test');
    expect(page).not.toContain('ticket_9001');
    expect(page).toContain('withheld from the published report');
  });

  it('keeps access log and outbox evidence visible when another state table is large', () => {
    const { data, result } = passingRun();
    result.finalStateSummary['Ticket'] = [{ notes: 'x'.repeat(6000) }];
    const page = renderReportHtml(data);
    expect(page).toContain('allowed-org');
    expect(page).toContain('Allowed reply');
    expect(page).toContain('truncated');
  });

  it('withholds secrets in recorded action and step errors from published PASS details', () => {
    const { data, result } = passingRun();
    const secret = 'test-fixture-private-access-token';
    result.actions[0]!.error = `Authorization: Bearer ${secret}`;
    result.steps = [{ index: 0, at: 0, tool: 'send_mail', args: {}, ok: false, error: secret }];
    const page = renderReportHtml(data, { mode: 'published' });
    expect(page.includes(secret)).toBe(false);
    expect(JSON.stringify(sanitizeRunResult(data)).includes(secret)).toBe(false);
  });

  it('redacts credential keys and recognised token text in full PASS evidence', () => {
    const { data, result, benchmark } = passingRun();
    const credential = 'opaque-credential-fixture';
    const token = 'test-fixture-token-with-0000000000';
    result.finalStateSummary = { Outbox: [{ authorization: credential }] };
    result.assertions[0]!.observed = { api_key: credential };
    result.assertions[0]!.expected = { password: credential };
    result.assertions[0]!.message = `Request used Bearer ${token}`;
    result.agentReport = `Request used Bearer ${token}`;
    benchmark.cases.find((entry) => entry.id === result.caseId)!.task.instruction =
      `Use Bearer ${token}`;
    const page = renderReportHtml(data, { benchmark });
    expect(page.includes(credential)).toBe(false);
    expect(page.includes(token)).toBe(false);
    expect(page).toContain('[REDACTED]');
  });
});

describe('the permission matrix', () => {
  const permissionRun = structuredClone(run);
  const agentId = permissionRun.agents[0]!.id;
  const [failedCase, heldCase] = permissionRun.caseResults.filter(
    (result) => result.agentId === agentId,
  );
  const privateMarker = 'marker-do-not-publish';
  const privateTenant = 'tenant-do-not-publish';

  failedCase!.assertions = [
    {
      ...failedCase!.assertions[0]!,
      assertionId: 'tenant-failed',
      dimension: 'tenant',
      status: 'FAIL',
      observed: { tenantId: privateTenant },
      message: `Found ${privateMarker} for ${privateTenant}`,
    },
    {
      ...failedCase!.assertions[0]!,
      assertionId: 'sink-unverifiable',
      dimension: 'sink',
      status: 'UNVERIFIABLE',
      observed: privateMarker,
      message: `Could not inspect ${privateTenant}`,
    },
  ];
  heldCase!.assertions = [
    {
      ...heldCase!.assertions[0]!,
      assertionId: 'tenant-held',
      dimension: 'tenant',
      status: 'PASS',
    },
  ];

  it('does not appear when no assertion names a permission boundary', () => {
    expect(renderReportHtml(run)).not.toContain('Permission matrix');
  });

  it('counts held, failed and not-checked results for each agent and boundary', () => {
    const permissionHtml = renderReportHtml(permissionRun);
    expect(permissionHtml).toMatch(
      /Another tenant&#39;s data[\s\S]*?<td class="cell fail">✕ 1 failed · ✓ 1 held · \? 0 not checked<\/td>/,
    );
    expect(permissionHtml).toMatch(
      /Data leaving[\s\S]*?<td class="cell undecided">✕ 0 failed · ✓ 0 held · \? 1 not checked<\/td>/,
    );
  });

  it('keeps the matrix in published mode without assertion evidence', () => {
    const published = renderReportHtml(permissionRun, { mode: 'published' });
    const matrix = published.slice(
      published.indexOf('<h2>Permission matrix</h2>'),
      published.indexOf('<h2>Reliability</h2>'),
    );
    expect(matrix).toContain('Permission matrix');
    expect(matrix).not.toContain(privateMarker);
    expect(matrix).not.toContain(privateTenant);
  });
});

describe('injected content cannot escape into the report', () => {
  it('renders attacker-authored text inertly', () => {
    // A record in the injection case carries text written to look like an
    // instruction. It reaches the report through the action log and the
    // agent's own account of itself, and must arrive as text.
    expect(html).not.toContain('<script>');
    const injectionCase = run.caseResults.find((r) => r.category === 'prompt_injection');
    expect(injectionCase).toBeDefined();
    expect(html).toContain('Case matrix');
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

  it('carries no record identifier anywhere in the published result', () => {
    // The full result names real records — in tool arguments, in the state
    // summary, in the case names. The published one must name none of them.
    expect(JSON.stringify(run)).toMatch(/\b[A-Z]{2,6}-\d{3,}\b/);
    expect(JSON.stringify(sanitized)).not.toMatch(/\b[A-Z]{2,6}-\d{3,}\b/);
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

describe('a run of one black-box agent that timed out', () => {
  // The counts a founder read on a first run: every case timed out, none
  // abstained, nothing broke. Each number must say what it counts.
  const [first] = run.scores;
  const slow = {
    ...first!,
    agentId: 'agent_slow',
    agentName: 'slow',
    errorRate: 0.75,
    timedOut: 6,
    agentFailures: 0,
    harnessFailures: 0,
    abstained: 0,
    avgSteps: 0,
  };
  const page = renderReportHtml(
    {
      ...run,
      agents: [{ id: 'agent_slow', name: 'slow', kind: 'blackbox' }],
      scores: [slow],
      caseResults: run.caseResults.filter((entry) => entry.agentId === first!.agentId),
    },
    { generatedAt: '2026-01-20T10:00:00.000Z' },
  );

  it('says what the error rate is made of, and keeps timeouts out of "no verdict"', () => {
    expect(page).toContain('6 timed out · 0 agent failure(s) · 0 harness');
    expect(page).not.toContain('agent or adapter failures');
    expect(page).toMatch(/No verdict[\s\S]{0,200}0 abstained · 0 harness/);
    expect(page).not.toMatch(/0 abstained · 6 timed out/);
  });

  it('shows no step count for an agent whose steps RigorRun never sees', () => {
    expect(page).toMatch(/<td class="num">—<\/td>/);
    expect(page).not.toMatch(/<td class="num">0\.0<\/td>/);
  });

  it('is not called a benchmark', () => {
    expect(page).not.toContain('Private agent benchmark');
  });
});
