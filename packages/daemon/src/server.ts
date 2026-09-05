/**
 * The local runner: one origin serving the product and the API.
 *
 * The product UI is served from here rather than from the cloud, and that is an
 * architectural decision rather than a convenience. A page on `https://` cannot
 * fetch `http://127.0.0.1` in Firefox or Safari — it is mixed content — and
 * Chrome adds a preflight of its own. So a hosted UI simply cannot reach a
 * customer's local MCP server, internal API, or staging box, which is most of
 * what anybody has. Serving both halves from one loopback origin removes the
 * problem rather than working around it, and it means no relay, no account and
 * no route by which a customer's credentials could reach us.
 *
 * Three defences, because each covers a different mistake. The socket listens
 * on loopback, so nothing off-box connects. The `Host` header is checked, so a
 * page that resolved an attacker's domain to 127.0.0.1 is still refused. And
 * every API call needs the session token, so a page that got past both still
 * has to have been invited.
 */
import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { Benchmark, EnvironmentContract, RunResult } from '@rigorrun/core';
import { Pairing, SESSION_COOKIE, cookieValue } from './pairing.ts';
import { nextSteps, timeToFirstVerdictMs, type Connector, type Project } from './project.ts';
import type { Service } from './service.ts';

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export interface RunnerOptions {
  service: Service;
  /** Built UI bundle. Omitted in tests, where only the API is under test. */
  uiDir?: string;
  port?: number;
}

export class Runner {
  readonly pairing = new Pairing();
  private http: ServerType | undefined;
  private boundPort = 0;

  constructor(private readonly options: RunnerOptions) {}

  get port(): number {
    return this.boundPort;
  }

  /** The URL to hand a person: it carries the code, so opening it pairs. */
  get pairedUrl(): string {
    return `http://127.0.0.1:${this.boundPort}/?code=${this.pairing.pairingCode}`;
  }

  async start(): Promise<number> {
    if (this.http) return this.boundPort;
    const app = new Hono();
    const service = this.options.service;

    app.use('*', async (context, next) => {
      if (!hostIsLocal(context.req.header('host'))) return context.text('forbidden host', 403);
      await next();
      return undefined;
    });

    // Opening the paired URL trades the code for a cookie, then drops the code
    // out of the address bar so it does not linger in history or a screenshot.
    app.get('/', async (context) => {
      const code = context.req.query('code');
      if (code) {
        const token = this.pairing.redeem(code);
        if (!token) return htmlResponse(EXPIRED_PAGE, 403);
        context.header(
          'set-cookie',
          `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
        );
        return context.redirect('/', 302);
      }
      return this.serveUi(context.req.path);
    });

    app.use('/api/*', async (context, next) => {
      const bearer = context.req.header('authorization')?.replace(/^Bearer\s+/i, '');
      const cookie = cookieValue(context.req.header('cookie'), SESSION_COOKIE);
      if (!this.pairing.authorises(bearer ?? cookie)) {
        return context.json(
          {
            error: 'not paired',
            detail:
              'Open the URL the runner printed, or pass its token as a bearer header. ' +
              'A page that was not invited cannot drive this runner.',
          },
          401,
        );
      }
      await next();
      return undefined;
    });

    // ------------------------------------------------------------- projects

    app.get('/api/projects', async (context) =>
      context.json({ projects: (await service.listProjects()).map(summarise) }),
    );

    app.post('/api/projects', async (context) => {
      const body = await context.req.json<{ name?: string; goal?: string }>();
      const project = await service.createProject({
        name: String(body.name ?? ''),
        ...(body.goal ? { goal: String(body.goal) } : {}),
      });
      return context.json({ project: summarise(project) }, 201);
    });

    app.get('/api/projects/:id', async (context) => {
      const project = await service.readProject(context.req.param('id'));
      const [contract, benchmark] = await Promise.all([
        service.artefact<EnvironmentContract>(project.id, 'contract'),
        service.artefact<Benchmark>(project.id, 'benchmark'),
      ]);
      return context.json({
        project: summarise(project),
        contract: contract ?? null,
        benchmark: benchmark
          ? {
              cases: benchmark.cases.map((entry) => ({
                id: entry.id,
                name: entry.name,
                category: entry.category,
              })),
              notTestable: benchmark.notTestable,
            }
          : null,
      });
    });

    // ---------------------------------------------------------- environment

    app.post('/api/projects/:id/environment', async (context) => {
      const body = await context.req.json<{ connector: Connector; safety?: Project['safety'] }>();
      const connected = await service.connectEnvironment(
        context.req.param('id'),
        body.connector,
        body.safety ?? 'staging',
      );
      return context.json({
        project: summarise(connected.project),
        serverName: connected.serverName,
        latencyMs: connected.latencyMs,
        tools: connected.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          params: tool.params,
          unsupported: tool.unsupported,
          hints: tool.hints,
          risk: tool.risk,
          hasOutputSchema: tool.outputSchema !== undefined,
        })),
      });
    });

    app.post('/api/projects/:id/environment/config', async (context) => {
      const body = await context.req.json<Parameters<Service['configureEnvironment']>[1]>();
      return context.json({
        project: summarise(await service.configureEnvironment(context.req.param('id'), body)),
      });
    });

    // ---------------------------------------------------------- teach a job

    app.post('/api/projects/:id/teach/start', async (context) => {
      await service.startTeaching(context.req.param('id'));
      return context.json({ recording: true });
    });

    app.post('/api/projects/:id/teach/call', async (context) => {
      const body = await context.req.json<{ tool: string; args?: Record<string, unknown> }>();
      const result = await service.teachStep(
        context.req.param('id'),
        body.tool,
        body.args ?? {},
      );
      return context.json(result);
    });

    app.post('/api/projects/:id/teach/finish', async (context) => {
      const finished = await service.finishTeaching(context.req.param('id'));
      return context.json({
        project: summarise(finished.project),
        questions: finished.questions,
        schema: finished.schema,
      });
    });

    app.post('/api/projects/:id/schema/answers', async (context) => {
      const body = await context.req.json<{ answers: { questionId: string; value: string }[] }>();
      return context.json({
        project: summarise(await service.answerSchema(context.req.param('id'), body.answers ?? [])),
      });
    });

    // ------------------------------------------------------ contract + suite

    app.post('/api/projects/:id/compile', async (context) =>
      context.json({ contract: await service.compile(context.req.param('id')) }),
    );

    app.post('/api/projects/:id/review', async (context) => {
      const body = await context.req.json<{
        confirmedRuleIds?: string[];
        rejectedRuleIds?: string[];
      }>();
      return context.json({ contract: await service.review(context.req.param('id'), body) });
    });

    app.post('/api/projects/:id/benchmark', async (context) => {
      const benchmark = await service.generate(context.req.param('id'));
      return context.json({
        cases: benchmark.cases.map((entry) => ({
          id: entry.id,
          name: entry.name,
          category: entry.category,
        })),
        notTestable: benchmark.notTestable,
      });
    });

    // ------------------------------------------------------------- agents

    app.post('/api/projects/:id/agents', async (context) => {
      const body = await context.req.json<{ name?: string; endpoint: string }>();
      const added = await service.addAgent(context.req.param('id'), {
        name: String(body.name ?? ''),
        endpoint: String(body.endpoint ?? ''),
      });
      return context.json({ project: summarise(added.project), agent: added.agent });
    });

    // --------------------------------------------------------------- runs

    app.post('/api/projects/:id/runs', async (context) => {
      const body = await context.req.json<{ agentId: string }>();
      const result = await service.runAgent(context.req.param('id'), body.agentId);
      return context.json({ run: publicRun(result) });
    });

    app.get('/api/projects/:id/runs/:runId', async (context) => {
      const run = await service.run(context.req.param('id'), context.req.param('runId'));
      if (!run) return context.json({ error: 'no such run' }, 404);
      return context.json({ run });
    });

    app.get('/api/projects/:id/compare/:runId', async (context) => {
      const baseline = context.req.query('baseline');
      return context.json({
        comparison: await service.compare(
          context.req.param('id'),
          context.req.param('runId'),
          baseline,
        ),
      });
    });

    app.post('/api/projects/:id/baseline', async (context) => {
      const body = await context.req.json<{ runId: string }>();
      return context.json({
        project: summarise(await service.setBaseline(context.req.param('id'), body.runId)),
      });
    });

    // Anything that threw becomes a message a person can act on rather than a
    // stack trace, and never a 200 with an error inside it.
    app.onError((error, context) => context.json({ error: error.message }, 400));

    app.get('*', (context) => this.serveUi(context.req.path));

    this.http = serve({
      fetch: app.fetch,
      hostname: '127.0.0.1',
      port: this.options.port ?? 0,
    });
    await new Promise<void>((resolve_) => this.http!.once('listening', () => resolve_()));
    const address = this.http.address();
    this.boundPort = typeof address === 'object' && address ? address.port : 0;
    return this.boundPort;
  }

  async stop(): Promise<void> {
    const http = this.http;
    this.http = undefined;
    if (http) await new Promise<void>((resolve_) => http.close(() => resolve_()));
  }

  /**
   * Serves the built UI, refusing anything that tries to leave its directory.
   *
   * Unknown paths fall back to the entry document because the UI routes on the
   * client; a deep link has to survive a reload.
   */
  private async serveUi(path: string): Promise<Response> {
    const uiDir = this.options.uiDir;
    if (!uiDir) return htmlResponse(NO_UI_PAGE, 404);

    const root = resolve(uiDir);
    const requested = resolve(join(root, normalize(path)));
    const candidate = requested.startsWith(root) ? requested : root;

    for (const file of [candidate, join(root, 'index.html')]) {
      try {
        if (!(await stat(file)).isFile()) continue;
        const body = await readFile(file);
        return new Response(new Uint8Array(body), {
          status: 200,
          headers: {
            'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
            // The UI is rebuilt with the runner; never let a stale one linger.
            'cache-control': 'no-store',
          },
        });
      } catch {
        continue;
      }
    }
    return htmlResponse(NO_UI_PAGE, 404);
  }
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function hostIsLocal(host: string | undefined): boolean {
  if (!host) return false;
  return ALLOWED_HOSTS.has(host.replace(/:\d+$/, '').toLowerCase());
}

/** A project as the UI sees it: no secrets, plus what to do next. */
function summarise(project: Project) {
  return {
    ...project,
    nextSteps: nextSteps(project),
    timeToFirstVerdictMs: timeToFirstVerdictMs(project),
  };
}

/** A run without the per-step detail, which the evidence view fetches separately. */
function publicRun(run: RunResult) {
  return {
    runId: run.runId,
    finishedAt: run.finishedAt,
    verification: run.verification,
    isolation: run.isolation,
    limits: run.limits,
    notTestable: run.notTestable,
    verdict: run.verdict,
    scores: run.scores,
    caseResults: run.caseResults.map((entry) => ({
      caseId: entry.caseId,
      caseName: entry.caseName,
      category: entry.category,
      taskSuccess: entry.taskSuccess,
      policyCompliant: entry.policyCompliant,
      unsafeActions: entry.unsafeActions,
      durationMs: entry.durationMs,
    })),
  };
}

const NO_UI_PAGE = `<!doctype html><meta charset="utf-8"><title>RigorRun runner</title>
<body style="font:14px system-ui;margin:3rem;max-width:40rem">
<h1>The runner is up; the interface is not built.</h1>
<p>Run <code>pnpm build:web</code> and start the runner again. The API is
answering either way, so <code>rigorrun run --project</code> works now.</p>`;

const EXPIRED_PAGE = `<!doctype html><meta charset="utf-8"><title>RigorRun</title>
<body style="font:14px system-ui;margin:3rem;max-width:40rem">
<h1>That pairing code has been used or has expired.</h1>
<p>Codes are good once, for ten minutes. Run <code>rigorrun pair</code> in the
terminal where the runner is running to get another.</p>`;
