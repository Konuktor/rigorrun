-- RigorRun control plane schema.
--
-- Design rules, enforced here rather than by convention:
--   * Metadata only. No traces, no screenshots, no page content, no tool
--     arguments. Anything that could carry a customer's data stays local.
--   * Every table a query filters on has an index, because D1's free tier
--     bills rows read and a table scan is how a free plan becomes a paid one.
--   * Everything published carries an expiry so storage cannot grow forever.

CREATE TABLE IF NOT EXISTS workspaces (
  id            TEXT PRIMARY KEY,
  -- SHA-256 of the workspace token. The token itself is never stored.
  secret_hash   TEXT NOT NULL,
  label         TEXT NOT NULL DEFAULT 'guest workspace',
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  goal           TEXT NOT NULL,
  environment    TEXT NOT NULL,
  contract_hash  TEXT NOT NULL,
  rules_observed INTEGER NOT NULL DEFAULT 0,
  rules_inferred INTEGER NOT NULL DEFAULT 0,
  rules_confirmed INTEGER NOT NULL DEFAULT 0,
  open_questions INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflows_workspace ON workflows(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS benchmark_cases (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  case_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  check_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cases_workflow ON benchmark_cases(workflow_id);

CREATE TABLE IF NOT EXISTS runs (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id    TEXT,
  benchmark_hash TEXT NOT NULL,
  contract_hash  TEXT NOT NULL,
  result_hash    TEXT NOT NULL DEFAULT '',
  environment    TEXT NOT NULL,
  agent_count    INTEGER NOT NULL DEFAULT 0,
  case_count     INTEGER NOT NULL DEFAULT 0,
  verdict        TEXT NOT NULL DEFAULT '',
  winner_agent   TEXT,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_workspace ON runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_workflow ON runs(workflow_id, created_at DESC);

CREATE TABLE IF NOT EXISTS case_results (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  case_id          TEXT NOT NULL,
  agent_id         TEXT NOT NULL,
  category         TEXT NOT NULL,
  task_success     INTEGER NOT NULL,
  policy_compliant INTEGER NOT NULL,
  unsafe_actions   INTEGER NOT NULL DEFAULT 0,
  duration_ms      REAL NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_case_results_run ON case_results(run_id, agent_id);

CREATE TABLE IF NOT EXISTS published_reports (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id       TEXT NOT NULL,
  title        TEXT NOT NULL,
  -- A sanitised report payload: scores, outcomes, labels and hashes only.
  payload      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_workspace ON published_reports(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_expiry ON published_reports(expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
