/**
 * RigorRun control plane.
 *
 * Optional by design. Everything the product does works with this Worker
 * switched off; it exists so a team can keep a shared index of workflows and
 * runs, and publish a sanitised report by link.
 *
 * What it will accept: metadata — names, hashes, counts, scores, outcomes.
 * What it has no endpoint for: traces, tool arguments, evidence, screenshots,
 * customer content. That is a structural guarantee, not a policy note.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { sha256, prefixedId, randomSecret } from '@rigorrun/core';
import { checkRateLimit, purgeExpiredReports, touchWorkspace } from './db.ts';
import {
  PublishInputSchema,
  RunInputSchema,
  RunResultsInputSchema,
  WorkflowInputSchema,
  type Env,
} from './types.ts';

const MAX_BODY_BYTES = 256 * 1024;

type AppEnv = { Bindings: Env; Variables: { workspaceId: string } };

const app = new Hono<AppEnv>();

app.use(
  '/api/*',
  cors({
    origin: (origin) =>
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin.endsWith('.workers.dev')
        ? origin
        : '',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['content-type', 'authorization'],
    maxAge: 600,
  }),
);

/** Bounds every request body before anything parses it. */
app.use('/api/*', async (c, next) => {
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    return c.json({ error: `Request body exceeds ${MAX_BODY_BYTES} bytes.` }, 413);
  }
  await next();
});

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'rigorrun-control-plane',
    env: c.env.RIGORRUN_ENV ?? 'unknown',
    time: new Date().toISOString(),
    note: 'Metadata only. Traces, evidence and customer content never reach this service.',
  }),
);

/* ------------------------------------------------------------- workspaces */

app.post('/api/workspaces', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  const limit = await checkRateLimit(c.env, `ws:${ip}`, 10, 3600);
  if (!limit.allowed) {
    return c.json(
      { error: 'Too many workspaces from this address.', retryAfter: limit.resetSeconds },
      429,
    );
  }

  const id = prefixedId('ws', 16);
  const secret = randomSecret();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO workspaces (id, secret_hash, label, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?4)',
  )
    .bind(id, await sha256(secret), 'guest workspace', now)
    .run();

  // The token is returned exactly once; only its hash is stored.
  return c.json({ workspaceId: id, token: secret, createdAt: now }, 201);
});

const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const workspaceId = c.req.header('x-rigorrun-workspace') ?? '';

  if (!token || !workspaceId) {
    return c.json({ error: 'Missing workspace credentials.' }, 401);
  }

  const row = await c.env.DB.prepare('SELECT secret_hash FROM workspaces WHERE id = ?1')
    .bind(workspaceId)
    .first<{ secret_hash: string }>();

  if (!row || !timingSafeEqual(row.secret_hash, await sha256(token))) {
    return c.json({ error: 'Invalid workspace credentials.' }, 401);
  }

  const limit = await checkRateLimit(c.env, `req:${workspaceId}`, 600, 3600);
  if (!limit.allowed) {
    return c.json({ error: 'Workspace rate limit reached.', retryAfter: limit.resetSeconds }, 429);
  }

  c.set('workspaceId', workspaceId);
  await next();
};

/** Bearer auth against the stored hash. */
app.use('/api/workflows/*', authenticate);
app.use('/api/workflows', authenticate);
app.use('/api/runs/*', authenticate);
app.use('/api/runs', authenticate);
app.use('/api/publish', authenticate);

/* -------------------------------------------------------------- workflows */

app.post('/api/workflows', async (c) => {
  const parsed = WorkflowInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: 'Invalid workflow metadata.', issues: parsed.error.issues }, 400);

  const workspaceId = c.get('workspaceId');
  const now = new Date().toISOString();
  const input = parsed.data;

  await c.env.DB.prepare(
    `INSERT INTO workflows
       (id, workspace_id, name, goal, environment, contract_hash,
        rules_observed, rules_inferred, rules_confirmed, open_questions, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
     ON CONFLICT(id) DO UPDATE SET
       name = ?3, goal = ?4, environment = ?5, contract_hash = ?6,
       rules_observed = ?7, rules_inferred = ?8, rules_confirmed = ?9,
       open_questions = ?10, updated_at = ?11`,
  )
    .bind(
      input.id,
      workspaceId,
      input.name,
      input.goal,
      input.environment,
      input.contractHash,
      input.ruleCounts.observed,
      input.ruleCounts.inferred,
      input.ruleCounts.confirmed,
      input.openQuestions,
      now,
    )
    .run();

  if (input.cases.length > 0) {
    await c.env.DB.prepare('DELETE FROM benchmark_cases WHERE workflow_id = ?1')
      .bind(input.id)
      .run();
    await c.env.DB.batch(
      input.cases.map((testCase) =>
        c.env.DB.prepare(
          'INSERT INTO benchmark_cases (id, workflow_id, case_id, name, category, check_count, created_at) ' +
            'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
        ).bind(
          `${input.id}:${testCase.caseId}`,
          input.id,
          testCase.caseId,
          testCase.name,
          testCase.category,
          testCase.checkCount,
          now,
        ),
      ),
    );
  }

  await touchWorkspace(c.env, workspaceId, now);
  return c.json({ ok: true, workflowId: input.id, updatedAt: now }, 201);
});

app.get('/api/workflows/:id', async (c) => {
  const workspaceId = c.get('workspaceId');
  const workflow = await c.env.DB.prepare(
    'SELECT * FROM workflows WHERE id = ?1 AND workspace_id = ?2',
  )
    .bind(c.req.param('id'), workspaceId)
    .first();

  if (!workflow) return c.json({ error: 'Not found.' }, 404);

  const cases = await c.env.DB.prepare(
    'SELECT case_id, name, category, check_count FROM benchmark_cases WHERE workflow_id = ?1 LIMIT 500',
  )
    .bind(c.req.param('id'))
    .all();

  return c.json({ workflow, cases: cases.results ?? [] });
});

app.delete('/api/workflows/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM workflows WHERE id = ?1 AND workspace_id = ?2')
    .bind(c.req.param('id'), c.get('workspaceId'))
    .run();
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------- runs */

app.post('/api/runs', async (c) => {
  const parsed = RunInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: 'Invalid run metadata.', issues: parsed.error.issues }, 400);

  const now = new Date().toISOString();
  const input = parsed.data;

  await c.env.DB.prepare(
    `INSERT INTO runs (id, workspace_id, workflow_id, benchmark_hash, contract_hash, environment,
                       agent_count, case_count, started_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(
      input.id,
      c.get('workspaceId'),
      input.workflowId ?? null,
      input.benchmarkHash,
      input.contractHash,
      input.environment,
      input.agentCount,
      input.caseCount,
      input.startedAt,
      now,
    )
    .run();

  return c.json({ ok: true, runId: input.id }, 201);
});

app.post('/api/runs/:id/results', async (c) => {
  const parsed = RunResultsInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: 'Invalid run results.', issues: parsed.error.issues }, 400);

  const runId = c.req.param('id');
  const workspaceId = c.get('workspaceId');
  const owned = await c.env.DB.prepare('SELECT id FROM runs WHERE id = ?1 AND workspace_id = ?2')
    .bind(runId, workspaceId)
    .first();
  if (!owned) return c.json({ error: 'Not found.' }, 404);

  const input = parsed.data;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    'UPDATE runs SET result_hash = ?1, finished_at = ?2, verdict = ?3, winner_agent = ?4 WHERE id = ?5',
  )
    .bind(input.resultHash, input.finishedAt, input.verdict, input.winnerAgentId, runId)
    .run();

  await c.env.DB.prepare('DELETE FROM case_results WHERE run_id = ?1').bind(runId).run();
  if (input.caseResults.length > 0) {
    await c.env.DB.batch(
      input.caseResults.map((result, index) =>
        c.env.DB.prepare(
          'INSERT INTO case_results (id, run_id, case_id, agent_id, category, task_success, ' +
            'policy_compliant, unsafe_actions, duration_ms, created_at) ' +
            'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)',
        ).bind(
          `${runId}:${index}`,
          runId,
          result.caseId,
          result.agentId,
          result.category,
          result.taskSuccess ? 1 : 0,
          result.policyCompliant ? 1 : 0,
          result.unsafeActions,
          result.durationMs,
          now,
        ),
      ),
    );
  }

  return c.json({ ok: true, runId, caseResults: input.caseResults.length });
});

app.get('/api/runs/:id', async (c) => {
  const runId = c.req.param('id');
  const run = await c.env.DB.prepare('SELECT * FROM runs WHERE id = ?1 AND workspace_id = ?2')
    .bind(runId, c.get('workspaceId'))
    .first();
  if (!run) return c.json({ error: 'Not found.' }, 404);

  const summary = await c.env.DB.prepare(
    `SELECT agent_id,
            COUNT(*)                AS cases,
            SUM(task_success)       AS successes,
            SUM(policy_compliant)   AS policy_passes,
            SUM(unsafe_actions)     AS unsafe_actions,
            AVG(duration_ms)        AS avg_duration_ms
       FROM case_results
      WHERE run_id = ?1
      GROUP BY agent_id`,
  )
    .bind(runId)
    .all();

  return c.json({ run, agents: summary.results ?? [] });
});

/* --------------------------------------------------------------- publish */

app.post('/api/publish', async (c) => {
  const parsed = PublishInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: 'Invalid report payload.', issues: parsed.error.issues }, 400);

  const workspaceId = c.get('workspaceId');
  const now = new Date();
  const retentionDays = Number(c.env.REPORT_RETENTION_DAYS ?? '30');
  const expiresAt = new Date(now.getTime() + retentionDays * 86_400_000).toISOString();
  const id = prefixedId('rep', 14);

  await purgeExpiredReports(c.env, now.toISOString());
  await c.env.DB.prepare(
    'INSERT INTO published_reports (id, workspace_id, run_id, title, payload, created_at, expires_at) ' +
      'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
  )
    .bind(
      id,
      workspaceId,
      parsed.data.runId,
      parsed.data.title,
      JSON.stringify(parsed.data),
      now.toISOString(),
      expiresAt,
    )
    .run();

  return c.json({ ok: true, reportId: id, url: `/api/reports/${id}`, expiresAt }, 201);
});

/** Published reports are readable without credentials — that is the point. */
app.get('/api/reports/:id', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT id, title, payload, created_at, expires_at FROM published_reports WHERE id = ?1',
  )
    .bind(c.req.param('id'))
    .first<{
      id: string;
      title: string;
      payload: string;
      created_at: string;
      expires_at: string;
    }>();

  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (row.expires_at < new Date().toISOString()) {
    return c.json({ error: 'This report has expired.' }, 410);
  }

  return c.json({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    report: JSON.parse(row.payload) as unknown,
    note: 'Sanitised report. Private workflow content is never published.',
  });
});

app.notFound((c) => c.json({ error: 'Not found.' }, 404));

app.onError((error, c) => {
  // Never echo an internal error message back to a caller.
  console.error('worker error', error);
  return c.json({ error: 'Internal error.' }, 500);
});

/** Length-independent comparison for the workspace token hash. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default app;
