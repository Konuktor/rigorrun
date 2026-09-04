import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { compileWorkflow, workflowByKey } from '@rigorrun/environments';
import { runBenchmark } from '@rigorrun/runner';
import { assertSafeAgentUrl, createHttpAgent } from '@rigorrun/agents';

/**
 * The bring-your-own-agent path, exercised rather than described.
 *
 * The server below is the whole integration a team has to write: read the
 * task, reply with the next tool call or a final report. It is deliberately
 * naive — it does what the work order says and checks nothing — because the
 * point is that it connects, not that it is any good.
 */
let server: Server;
let endpoint: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const { task, history } = JSON.parse(body) as {
        task: {
          inputs: Record<string, unknown>;
          tools: { name: string; readOnly: boolean; params: { name: string; required: boolean }[] }[];
        };
        history: { tool: string }[];
      };
      const writers = task.tools.filter((tool) => !tool.readOnly);
      const next = writers.find((tool) => !history.some((step) => step.tool === tool.name));

      res.setHeader('content-type', 'application/json');
      if (!next) {
        res.end(JSON.stringify({ done: true, report: 'Finished.', costUsd: 0 }));
        return;
      }
      const args: Record<string, unknown> = {};
      let complete = true;
      for (const param of next.params) {
        const value = task.inputs[param.name];
        if (value !== undefined) args[param.name] = value;
        else if (param.required) complete = false;
      }
      res.end(
        complete
          ? JSON.stringify({ action: { tool: next.name, args } })
          : JSON.stringify({ done: true, report: 'Missing a required detail.', costUsd: 0 }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  endpoint = `http://127.0.0.1:${port}/act`;
});

afterAll(() => {
  server.close();
});

describe('an agent behind an HTTP endpoint', () => {
  it('runs against a generated benchmark with no change to RigorRun', async () => {
    const compiled = await compileWorkflow(workflowByKey('refund'));
    const agent = createHttpAgent({ id: 'byo', name: 'Bring-your-own agent', endpoint });

    const result = await runBenchmark(compiled.benchmark, [agent], { runId: 'byo_http' });
    expect(result.caseResults).toHaveLength(compiled.benchmark.cases.length);
    // It genuinely acted: every case has tool calls recorded against it.
    expect(result.caseResults.some((r) => r.steps.length > 0)).toBe(true);
    // And it is judged the same way as anything else — on state.
    expect(result.caseResults.every((r) => r.assertions.length > 0)).toBe(true);
  }, 30_000);

  it('is caught when it ignores the policy, like any other agent', async () => {
    const compiled = await compileWorkflow(workflowByKey('refund'));
    const agent = createHttpAgent({ id: 'byo', name: 'Bring-your-own agent', endpoint });
    const result = await runBenchmark(compiled.benchmark, [agent], { runId: 'byo_http_gate' });
    const score = result.scores[0]!;
    expect(score.thresholdsPassed).toBe(false);
    expect(score.unsafeActions).toBeGreaterThan(0);
  }, 30_000);

  it('refuses an endpoint a downloaded benchmark could have chosen', () => {
    // The endpoint comes from the operator's configuration, never from a file.
    expect(() => assertSafeAgentUrl('http://169.254.169.254/latest/meta-data/')).toThrow();
    expect(() => assertSafeAgentUrl('file:///etc/passwd')).toThrow();
    expect(() => assertSafeAgentUrl('https://evil.example/act')).toThrow();
    expect(assertSafeAgentUrl('https://evil.example/act', true).host).toBe('evil.example');
  });
});
