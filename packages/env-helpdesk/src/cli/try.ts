/**
 * `rigorrun helpdesk try`: one command, no keys, a verdict in seconds.
 *
 * Starts the Larch Helpdesk twin in this process, opens the pack's session on
 * it, and runs the pack's suite — every rule confirmed — against two built-in
 * demo agents that differ only in their token, or against your own agent with
 * `--agent <url>`. Writes one HTML report with both side by side and prints
 * what each did, from the twin's own records.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createBlackBoxAgent } from '@rigorrun/daemon';
import { PackEnvironment, clearEnvironments, registerEnvironment } from '@rigorrun/environment';
import type { AgentAdapter } from '@rigorrun/agents';
import { renderReportHtml } from '@rigorrun/report';
import { runBenchmark } from '@rigorrun/runner';
import { HELPDESK_PACK_ID, TWIN_PORT, TWIN_URL } from '../conventions.ts';
import { DEMO_SCOPED_TOKEN, DEMO_SERVICE_TOKEN, demoAgent } from '../demo/agents.ts';
import { helpdeskPack } from '../pack.ts';
import { HELPDESK_RULE_IDS } from '../rules.ts';
import { HELPDESK_CASE_TIMEOUT_MS } from '../scenarios.ts';
import { helpdeskSuite } from '../suite.ts';
import { HelpdeskClient } from '../client.ts';
import { startTwin, type RunningTwin } from '../twin/http.ts';
import { HelpdeskUsageError } from './twin.ts';

export const TRY_USAGE = `rigorrun helpdesk try - the Larch Helpdesk suite, now, with no keys

  rigorrun helpdesk try                     two built-in agents, one difference: the token
  rigorrun helpdesk try --agent <url>       your own agent (rigorrun/task/1 over HTTP)

Starts the twin on this machine (with --agent, uses the one already running on its port), gives
every case a fresh world, and decides each ticket from what the twin recorded — its tables, its
access log, its outbox — never from what the agent said.

OPTIONS
      --agent <url>        Your agent's endpoint. Point its helpdesk MCP URL at the twin this
                           prints (default port ${TWIN_PORT}) and give it a token from there.
      --claim-path <path>  Where your agent's reply sentence is in its answer. Default message.
      --report <file>      Where the HTML report goes. Default helpdesk-report.html.
      --port <n>           The twin's port. Default ${TWIN_PORT} with --agent, any free port without.
      --json               Print the outcomes as JSON.`;

const say = (text = '') => process.stdout.write(`${text}\n`);

/**
 * The twin to run on. With `--agent`, the agent is usually already connected
 * to a twin on the default port — an MCP client connects when it starts — so a
 * twin already answering there is used rather than refused; its world is
 * replaced before every case all the same. Anything else on the port is an
 * error, never a twin.
 */
async function twinFor(
  port: number,
  reuse: boolean,
): Promise<{ twin: RunningTwin; reused: boolean }> {
  try {
    return { twin: await startTwin({ port }), reused: false };
  } catch (error) {
    if (!reuse || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    const url = `http://127.0.0.1:${port}/mcp`;
    const answers = await new HelpdeskClient(url).dump().then(
      () => true,
      () => false,
    );
    if (!answers) {
      throw new HelpdeskUsageError(
        `Port ${port} is taken by something that is not a Larch Helpdesk twin. Stop it, or pass --port.`,
      );
    }
    return { twin: { url, port, close: async () => {} }, reused: true };
  }
}

export async function cmdTry(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      agent: { type: 'string' },
      'claim-path': { type: 'string' },
      report: { type: 'string' },
      port: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) {
    say(TRY_USAGE);
    return 0;
  }
  const port = values.port === undefined ? (values.agent ? TWIN_PORT : 0) : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new HelpdeskUsageError(`--port is a port number, not "${values.port}".`);
  }

  const { twin, reused } = await twinFor(port, Boolean(values.agent));
  const session = await helpdeskPack.open({
    mode: 'twin',
    baseUrl: twin.url,
    secret: () => undefined,
  });
  registerEnvironment({
    id: HELPDESK_PACK_ID,
    name: helpdeskPack.name,
    description: helpdeskPack.description,
    create: () => new PackEnvironment(helpdeskPack, session),
    fixtures: [],
  });
  try {
    const human = !values.json;
    if (human) {
      say(`Larch Helpdesk twin · ${twin.url}${reused ? ' (already running)' : ''}`);
      say('  Alder Outdoor and Birch Home share it; the agent supports Alder only.');
      say();
    }
    const agents: AgentAdapter[] = values.agent
      ? [
          createBlackBoxAgent({
            id: 'your-agent',
            name: 'your agent',
            endpoint: values.agent,
            allowedHosts: [],
            bodyTemplate: null,
            completion: 'response',
            claimPath: values['claim-path'] ?? 'message',
            settleQuietMs: 0,
            timeoutMs: HELPDESK_CASE_TIMEOUT_MS,
          }),
        ]
      : [
          demoAgent(
            'scoped-token',
            `demo agent · ${DEMO_SCOPED_TOKEN}`,
            twin.url,
            DEMO_SCOPED_TOKEN,
          ),
          demoAgent(
            'service-token',
            `demo agent · ${DEMO_SERVICE_TOKEN}`,
            twin.url,
            DEMO_SERVICE_TOKEN,
          ),
        ];

    const { contract, benchmark } = helpdeskSuite({
      confirmedRuleIds: Object.values(HELPDESK_RULE_IDS),
      createdAt: new Date().toISOString(),
    });
    const result = await runBenchmark(benchmark, agents);
    const reportPath = resolve(values.report ?? 'helpdesk-report.html');
    await writeFile(
      reportPath,
      renderReportHtml(result, { contract, benchmark, generatedAt: result.finishedAt }),
      'utf8',
    );

    if (values.json) {
      say(
        JSON.stringify(
          {
            twin: twin.url,
            report: reportPath,
            outcomes: result.caseResults.map((entry) => ({
              agent: entry.agentId,
              case: entry.caseId,
              outcome: entry.outcome,
            })),
          },
          null,
          2,
        ),
      );
    } else {
      for (const agent of agents) {
        const mine = result.caseResults.filter((entry) => entry.agentId === agent.id);
        const failed = mine.filter((entry) => entry.outcome !== 'PASS');
        say(`${agent.name}: ${mine.length - failed.length} of ${mine.length} tickets held`);
        for (const entry of failed) {
          say(`  ✕ ${entry.caseName} — ${entry.outcome}`);
          if (entry.agentReport) say(`      it said     ${entry.agentReport.slice(0, 140)}`);
          for (const line of entry.reality?.lines ?? []) say(`      the twin    ${line}`);
        }
        say();
      }
      say(`Report: ${reportPath}`);
      if (!values.agent) {
        say();
        say('Same code, one difference — the token. Now yours:');
        say('  rigorrun helpdesk twin                       # leave it running');
        say(
          `  point your agent's helpdesk MCP URL at ${TWIN_URL} with ${DEMO_SCOPED_TOKEN}, start it, then`,
        );
        say('  rigorrun helpdesk try --agent <your agent URL>');
      }
    }
    return result.caseResults.every((entry) => entry.outcome === 'PASS') || !values.agent ? 0 : 1;
  } finally {
    clearEnvironments();
    await session.close();
    await twin.close();
  }
}
