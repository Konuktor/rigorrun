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
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { Benchmark, EnvironmentContract, RunResult } from '@rigorrun/core';
import type { DiscoveredTool } from '@rigorrun/mcp';
import { Pairing, SESSION_COOKIE, cookieValue } from './pairing.ts';
import { ConnectorSchema, nextSteps, timeToFirstVerdictMs, type Project } from './project.ts';
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
  /** What to tell the interface it is. Shown in the footer and in bug reports. */
  version?: string;
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

    /**
     * The one endpoint that answers before pairing.
     *
     * The same bundle is served from the runner and from the public site, and
     * it has to know which it is: on the runner it shows a person's projects,
     * on the site it shows the landing page and the example. Asking is more
     * honest than baking a flag in at build time, and it means one bundle
     * rather than two that can drift apart.
     *
     * It says only that a runner is here and whether the caller is paired,
     * which an unpaired caller can already tell by being refused.
     */
    app.get('/api/runner', (context) => {
      const bearer = context.req.header('authorization')?.replace(/^Bearer\s+/i, '');
      const cookie = cookieValue(context.req.header('cookie'), SESSION_COOKIE);
      return context.json({
        runner: true,
        paired: this.pairing.authorises(bearer ?? cookie),
        // So the footer reports the version somebody is actually running,
        // rather than a number typed into a component months ago.
        version: this.options.version ?? 'unknown',
      });
    });

    /**
     * The two endpoints an agent RigorRun cannot start uses.
     *
     * Registered before the pairing middleware, deliberately and visibly:
     * these are the one part of the API that is not driven by the browser the
     * person paired, so they carry their own credential — a key belonging to
     * one agent on one project. It does not drive the runner. Everything else
     * under `/api` still needs the session.
     *
     * A wrong key, a key for another agent, and an agent that does not exist
     * all get the same 401 with the same body, because telling them apart is
     * telling somebody which of their guesses was closer.
     */
    const driving = async (
      context: Context,
    ): Promise<{ projectId: string; agentId: string } | null> => {
      const key = context.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      const agentId = context.req.param('agentId') ?? '';
      const found = await service.driverFor(agentId, key);
      return found ? { projectId: found.project.id, agentId } : null;
    };
    const notDriving = (context: Context): Response =>
      context.json(
        {
          error: 'not your agent',
          detail:
            'Pass this agent’s key as a bearer header. It is shown once, when the agent is ' +
            'added, and never again.',
        },
        401,
      );

    /**
     * A ceiling on everything a key-holder can post.
     *
     * The rest of the API is behind the session, and the largest thing it
     * takes is an OpenAPI document. These two are the only endpoints reachable
     * with a credential that is not the runner's own, so they get a bound that
     * has nothing to do with what a document might weigh.
     */
    app.use('/api/drive/*', bodyLimit({ maxSize: 64 * 1024 }));

    app.get('/api/drive/:agentId', async (context) => {
      const who = await driving(context);
      if (!who) return notDriving(context);
      // Asking for work is what proves a driver exists, so it is also the
      // probe. Nothing else can observe an agent RigorRun cannot call.
      await service.noteDriverCheckIn(who.projectId, who.agentId);
      return context.json({ waiting: service.driver.current(who.agentId) });
    });

    app.post('/api/drive/:agentId/finished', async (context) => {
      const who = await driving(context);
      if (!who) return notDriving(context);
      const body = await context.req.json<{ caseId?: string; status?: string; output?: string }>();
      const accepted = service.driver.finish(who.agentId, body.caseId ?? '', {
        status: body.status === 'failed' ? 'failed' : 'completed',
        // Bounded, because it goes into a run artefact and comes back out on a
        // screen. An agent's account of itself is not a place to put a file.
        output: String(body.output ?? '').slice(0, 8000),
      });
      return accepted
        ? context.json({ accepted: true })
        : context.json(
            {
              accepted: false,
              detail:
                'That is not the case RigorRun is waiting for. Ask for work again — it may ' +
                'have timed out, or another copy of your agent may have answered it.',
            },
            409,
          );
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

    app.get('/api/projects', async (context) => {
      const { projects, broken } = await service.listAllProjects();
      // `broken` travels rather than being filtered out here: the interface has
      // to be able to show somebody that their project is still on this machine
      // and why it will not open, which it cannot do with a shorter list.
      return context.json({ projects: projects.map(summarise), broken });
    });

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
      const [contract, benchmark, discovery, induced, recorded, activation, quality] =
        await Promise.all([
        service.artefact<EnvironmentContract>(project.id, 'contract'),
        service.artefact<Benchmark>(project.id, 'benchmark'),
        service.discovery(project.id),
        service.artefact<{ questions: unknown[] }>(project.id, 'induced'),
        service.recordingState(project.id),
        service.activation.summary(project.id),
        service.quality(project.id),
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
        // Everything below is what makes a reload survivable: the page rebuilds
        // itself from disk instead of from whatever the last tab happened to
        // be holding.
        environment: {
          connected: service.isConnected(project.id),
          discovery: discovery ?? null,
        },
        questions: induced?.questions ?? [],
        recording: recorded,
        activation,
        quality: quality ?? null,
      });
    });

    app.post('/api/projects/:id/environment/reconnect', async (context) => {
      const result = await service.reconnect(context.req.param('id'));
      return context.json({
        project: summarise(result.project),
        serverName: result.serverName,
        latencyMs: result.latencyMs,
        tools: result.tools.map(publicTool),
        drift: result.drift,
      });
    });

    app.post('/api/projects/:id/teach/resume', async (context) => {
      const resumed = await service.resumeTeaching(context.req.param('id'));
      return context.json({
        resumed,
        steps: await service.recordedSoFar(context.req.param('id')),
      });
    });

    // ---------------------------------------------------------- environment

    app.post('/api/projects/:id/environment', async (context) => {
      const body = await context.req.json<{ connector: unknown; safety?: Project['safety'] }>();
      // Parsed rather than trusted. This is the one request that decides what
      // RigorRun will run or open on this machine, and it arrives from a page —
      // a page RigorRun serves, but the narrowing is what makes an `openapi`
      // connector unable to carry a command at all.
      const parsed = ConnectorSchema.safeParse(body.connector);
      if (!parsed.success) {
        return context.json(
          { error: `That is not a connector RigorRun understands: ${parsed.error.issues[0]?.message ?? 'unknown shape'}` },
          400,
        );
      }
      const connected = await service.connectEnvironment(
        context.req.param('id'),
        parsed.data,
        body.safety ?? 'staging',
      );
      return context.json({
        project: summarise(connected.project),
        serverName: connected.serverName,
        latencyMs: connected.latencyMs,
        tools: connected.tools.map(publicTool),
      });
    });

    app.post('/api/projects/:id/environment/config', async (context) => {
      const body = await context.req.json<Parameters<Service['configureEnvironment']>[1]>();
      const { project, readsProblem } = await service.configureEnvironment(
        context.req.param('id'),
        body,
      );
      // Travels beside the saved project rather than as an error: the
      // configuration is valid and was saved, and what RigorRun has to say is
      // about what it will be able to prove later.
      return context.json({ project: summarise(project), readsProblem });
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
        // Claims this system made that its own behaviour contradicted. Shown
        // beside what RigorRun learned, because it is the same kind of thing:
        // something observed about the system rather than assumed about it.
        mismatches: service.mismatches(context.req.param('id')),
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
      const body = await context.req.json<{
        name?: string;
        endpoint?: string;
        command?: string;
        args?: unknown;
        driven?: boolean;
      }>();
      const name = String(body.name ?? '');
      if (body.driven === true) {
        const added = await service.addAgent(context.req.param('id'), { name, driven: true });
        // The key travels in this one response and is never readable again.
        // Whoever is looking at the screen has to copy it now.
        return context.json({
          project: summarise(added.project),
          agent: added.agent,
          key: added.key,
        });
      }
      // A command reaches `exec.ts` only from here and from the CLI, and both
      // are a person at this machine. There is no third route, and no schema
      // anywhere declares the provenance literal that lets one run.
      const added = await service.addAgent(
        context.req.param('id'),
        typeof body.command === 'string' && body.command.length > 0
          ? {
              name,
              command: body.command,
              args: Array.isArray(body.args)
                ? body.args.filter((entry): entry is string => typeof entry === 'string')
                : [],
            }
          : { name, endpoint: String(body.endpoint ?? '') },
      );
      return context.json({ project: summarise(added.project), agent: added.agent });
    });

    /**
     * What an agent RigorRun cannot start is being asked to do right now.
     *
     * The interface's view of the same thing the driver sees, so somebody
     * watching a run knows whether it is stuck on their agent or on RigorRun.
     * Behind the session like everything else here: it is the person's own
     * project, not the agent's key.
     */
    app.get('/api/projects/:id/agents/:agentId/waiting', (context) => {
      return context.json({
        waiting: service.driver.current(context.req.param('agentId')),
        checkedIn: service.driver.hasCheckedIn(context.req.param('agentId')),
      });
    });

    /**
     * Reads a trace. Adds nothing.
     *
     * Deliberately two requests. A trace is the agent's own record of what it
     * sent, and turning that into a permanent case without anybody reading it
     * would be adding the agent's account of itself to the thing that exists
     * to check the agent's account of itself.
     */
    app.post('/api/projects/:id/trace/review', async (context) => {
      const body = await context.req.json<{ trace?: unknown }>();
      return context.json({ trace: service.reviewTrace(String(body.trace ?? '')) });
    });

    app.post('/api/projects/:id/trace/add', async (context) => {
      const body = await context.req.json<{
        name?: unknown;
        reason?: unknown;
        request?: unknown;
      }>();
      const request =
        typeof body.request === 'object' && body.request !== null && !Array.isArray(body.request)
          ? (body.request as Record<string, unknown>)
          : {};
      return context.json({
        added: await service.addFailureToSuite(context.req.param('id'), {
          name: String(body.name ?? 'a failure from production'),
          reason: String(body.reason ?? ''),
          request,
        }),
      });
    });

    app.post('/api/projects/:id/quality', async (context) =>
      context.json({ quality: await service.assessSuite(context.req.param('id')) }),
    );

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
    app.onError((error, context) => {
      // A refusal that already knows its own status keeps it. Flattening
      // everything to 400 turned "that is too large" into "that is malformed",
      // which sends somebody looking in the wrong place.
      if (error instanceof HTTPException) {
        return context.json({ error: error.message || 'refused' }, error.status);
      }
      return context.json({ error: error.message }, 400);
    });

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

/** One tool, without the raw JSON Schema the interface has no use for. */
function publicTool(tool: DiscoveredTool) {
  return {
    name: tool.name,
    description: tool.description,
    params: tool.params,
    unsupported: tool.unsupported,
    hints: tool.hints,
    risk: tool.risk,
    hasOutputSchema: tool.outputSchema !== undefined,
  };
}

/** A project as the UI sees it: no secrets, plus what to do next. */
function summarise(project: Project) {
  return {
    ...project,
    // An OpenAPI document can be megabytes, and the page has no use for it —
    // it is read by the runner when a connection opens. Sending it on every
    // project load would put the whole thing across the wire to redraw a form.
    ...(project.connector?.kind === 'openapi'
      ? { connector: { ...project.connector, spec: '', specBytes: project.connector.spec.length } }
      : {}),
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

      // Everything below is the evidence for the line above. It was all
      // recorded already and none of it reached the screen, so a failure was a
      // red mark with a category beside it and no way to find out what
      // happened — which is the difference between a tool somebody acts on and
      // a tool somebody argues with.
      // What the agent did, in order, with what it passed. Truncated per step
      // rather than as a whole, so a long run stays readable and the shape of
      // what happened survives.
      steps: entry.steps.slice(0, 60).map((step) => ({
        tool: step.tool,
        args: clip(step.args),
        ok: step.ok,
        error: step.error ?? '',
      })),
      stepsOmitted: Math.max(0, entry.steps.length - 60),
      /** What the system said afterwards, which is what the verdict rests on. */
      finalState: clip(entry.finalStateSummary),
      checks: entry.assertions.map((assertion) => ({
        description: assertion.description,
        status: assertion.status,
        message: assertion.message,
        // The tier that produced this verdict. Carried since the beginning and
        // rendered nowhere until now.
        verificationSource: assertion.verificationSource,
        evaluator: assertion.evaluator,
        unsafe: assertion.unsafe,
        blocking: assertion.blocking,
        expected: clipValue(assertion.expected),
        observed: clipValue(assertion.observed),
      })),
      /**
       * The agent's own account of itself, kept apart from everything above and
       * never scored. An agent that says it issued a refund and did not is the
       * failure this product exists to catch, so its claim is evidence about
       * the agent rather than evidence about the system.
       */
      agentReport: entry.agentReport.slice(0, 2_000),
      error: entry.error ?? '',
    })),
  };
}

/** Keeps an evidence payload readable, and keeps a run response bounded. */
function clip(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 24)) out[key] = clipValue(entry);
  return out;
}

function clipValue(value: unknown): unknown {
  if (typeof value === 'string') return value.length > 400 ? `${value.slice(0, 400)}…` : value;
  if (value === null || typeof value !== 'object') return value;
  const text = JSON.stringify(value) ?? '';
  return text.length > 800 ? `${text.slice(0, 800)}…` : value;
}

const NO_UI_PAGE = `<!doctype html><meta charset="utf-8"><title>RigorRun runner</title>
<body style="font:14px system-ui;margin:3rem;max-width:40rem">
<h1>The runner is up; the interface is not built.</h1>
<p>Run <code>pnpm build:web</code> and start the runner again. The API is
answering either way, so <code>rigorrun run --project</code> works now.</p>`;

// Deliberately not "run `rigorrun pair`" — for months this page named a command
// that was never written, which is the worst thing a dead end can do: send
// somebody to a second dead end. Issuing a new code needs the authority of
// being at the terminal the runner is running in, which is exactly the
// authority that read the first code off the screen, so that is what it asks
// for.
const EXPIRED_PAGE = `<!doctype html><meta charset="utf-8"><title>RigorRun</title>
<body style="font:14px system-ui;margin:3rem;max-width:40rem">
<h1>That pairing code has been used or has expired.</h1>
<p>Codes are good once, for ten minutes, so that the copy left in your shell
history is worthless.</p>
<p>Press <b>Enter</b> in the terminal where the runner is running: it prints a
new link. If that terminal is not interactive, stop the runner and start it
again. Nothing you have set up is affected either way — your projects are on
disk.</p>`;
