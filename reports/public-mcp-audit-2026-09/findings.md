# Findings

Every finding below reproduced from a clean reset in three of three attempts unless its *Reproduction* line says otherwise. Categories and severities follow the audit brief. Case ids point at `cases/<target>/<id>.json` (ground truth written before the run) and `evidence/<target>/<id>/attempt-N/` (before/after oracle snapshots, tool traces, RigorRun run files).

| ID | Target | Category | Severity | Title |
| --- | --- | --- | --- | --- |
| E-1 | email-mcp | TARGET_MCP_BUG | MEDIUM | check_inbox and search_emails crash for the documented local MailHog/Mailpit services |
| E-2 | email-mcp | TARGET_MCP_BUG | MEDIUM | 13 advertised tools fail with ModuleNotFoundError: the autorespond and watcher modules are not in the repository |
| E-3 | email-mcp | TARGET_MCP_RELIABILITY_RISK | LOW | send_email is at-least-once with no idempotency key: a lost response plus one client retry delivers two messages |
| E-4 | email-mcp | NO_ISSUE_FOUND | INFO | Runtime service configuration is lost on restart, exactly as documented |
| W-1 | worktide-mcp | TARGET_MCP_BUG | HIGH | Every tool that resolves an IRI doubles the /v1 prefix and gets a 404: tasks.get, tasks.update, tasks.complete, projects.get, projects.archive |
| W-2 | worktide-mcp | TARGET_MCP_BUG | HIGH | tasks.create, tasks.addDependency, time.log and projects.create answer 500 against the pinned backend: the MCP omits the workspace/user the API requires |
| W-3 | worktide-mcp | TARGET_MCP_RELIABILITY_RISK | LOW | The backend answers a missing required relation with HTTP 500 instead of a validation error |
| S-1 | sqlite-mcp | TARGET_MCP_BUG | MEDIUM | backup copies the whole database to any path under deny-everything (and read-only); vacuum is correctly denied |
| S-2 | sqlite-mcp | TARGET_MCP_BUG | LOW | rows_changed reports the previous statement's count for a read-only statement |
| S-3 | sqlite-mcp | TARGET_MCP_RELIABILITY_RISK | LOW | A read-only server pointed at a missing path silently creates an empty database file |
| S-4 | sqlite-mcp | TARGET_MCP_RELIABILITY_RISK | LOW | execute is at-least-once: a lost response plus one client retry inserts two rows |
| S-5 | sqlite-mcp | NO_ISSUE_FOUND | INFO | Presets, column-level deny, timeout interruption, single-statement enforcement and sequential BEGIN/INSERT/ROLLBACK all behave as documented |
| R-1 | all | RIGORRUN_BUG | HIGH | For a system that cannot be seeded, the verdict's baseline is the demonstration-time snapshot, not a fresh read at case start: a correct agent fails and a drifted world passes |
| R-2 | all | RIGORRUN_PRODUCT_GAP | HIGH | No independent oracle: the verdict can only read the target server's own nominated tools, and a project takes one connector |
| R-3 | sqlite-mcp | RIGORRUN_PRODUCT_GAP | MEDIUM | Column-cell result shapes are induced as a value-keyed 'Id' entity, not as table rows; RigorRun's own quality gate flags the resulting suite |
| R-4 | all | RIGORRUN_PRODUCT_GAP | MEDIUM | Generated cases carry a fixed 15 s budget, shorter than the 20 s MCP call timeout, so a case cannot survive one lost response, and slow local models cannot finish |
| R-5 | sqlite-mcp | RIGORRUN_BUG | LOW | The task instruction is built from the primary tool's description rather than the project goal, and a dual-purpose tool's last call becomes the primary action |
| R-6 | all | RIGORRUN_PRODUCT_GAP | LOW | No headless project setup; connecting and teaching are interface-only, so the audit drove the runner's HTTP API directly |
| R-8 | worktide-mcp | RIGORRUN_BUG | HIGH | A server that returns JSON only as text content passes the read-nomination probe but yields no records at demonstration time, so compile refuses after the job has been demonstrated |
| R-7 | all | RIGORRUN_PRODUCT_GAP | INFO | `rigorrun verify --needs-credential` is documented but not wired into the CLI; verify accepts only Node servers from npm: or dir: |
| A-1 | email-mcp | AGENT_FAILURE | INFO | qwen2.5:3b did not finish the email task inside 15 s with a 47-tool catalogue; llama3.1:8b did not finish any case inside 15 s |

## E-1 — check_inbox and search_emails crash for the documented local MailHog/Mailpit services

- **TARGET:** email-mcp
- **CATEGORY:** TARGET_MCP_BUG
- **SEVERITY:** MEDIUM
- **UPSTREAM COMMIT:** fef2a06e9313aa69e7fd1572e18c53ccfc082bcc
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; local MailHog container (documented by upstream) as the primary sink; local GreenMail fake IMAP/SMTP container behind a loopback STARTTLS relay as a labelled supplement
- **REPRODUCTION RATE:** 3/3
- **ROOT CAUSE:** EmailService.check_inbox (abstract) and the tool registry take from_contains/subject_contains; LocalEmailService.check_inbox still has the three-parameter signature (services/email_services.py:1235), so both tools raise TypeError for every local service.
- **IMPACT:** the local-testing path upstream documents (docs/local-testing.md) can send but never read back; any agent or harness relying on it cannot verify delivery.
- **CASES:**
  - `EM-MH-02-check-inbox-crashes` — intent: check_inbox(service='mailhog') must list the captured message (documented in docs/local-testing.md and the tool's own docstring) | initial: MailHog inbox empty; email-mcp started with the documented MAILHOG_* environment (service 'mailhog', type local) | expected final: calls[1]['result'].get('isError') is not True and (calls[1]['result'].get('structuredContent') or {}).get('count')==1 | oracle: oracle-mailhog.py (MailHog HTTP API) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/email-mcp/EM-MH-02-check-inbox-crashes/attempt-1/`
  - `EM-MH-03-search-emails-crashes` — intent: search_emails(query='Audit', service='mailhog') must find the captured message | initial: MailHog inbox empty; email-mcp started with the documented MAILHOG_* environment (service 'mailhog', type local) | expected final: calls[1]['result'].get('isError') is not True and (calls[1]['result'].get('structuredContent') or {}).get('count')==1 | oracle: oracle-mailhog.py (MailHog HTTP API) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/email-mcp/EM-MH-03-search-emails-crashes/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## E-2 — 13 advertised tools fail with ModuleNotFoundError: the autorespond and watcher modules are not in the repository

- **TARGET:** email-mcp
- **CATEGORY:** TARGET_MCP_BUG
- **SEVERITY:** MEDIUM
- **UPSTREAM COMMIT:** fef2a06e9313aa69e7fd1572e18c53ccfc082bcc
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; local MailHog container (documented by upstream) as the primary sink; local GreenMail fake IMAP/SMTP container behind a loopback STARTTLS relay as a labelled supplement
- **REPRODUCTION RATE:** 3/3
- **ROOT CAUSE:** tool_registry.py imports .autorespond and .watcher lazily inside the handlers; git tracks only src/email_mcp/tools/tool_registry.py, so add_auto_rule, list_auto_rules, update_auto_rule, test_auto_rule, delete_auto_rule, backfill_auto_rules, list_pending_replies, approve_reply, auto_respond_now, start_watcher, stop_watcher, watcher_status and email_connector cannot run at the pinned commit.
- **IMPACT:** the auto-response and watcher workflows the README and CHANGELOG describe do not exist in the published checkout.
- **CASES:**
  - `EM-MH-04-auto-rule-modules-missing` — intent: list_auto_rules, watcher_status and list_pending_replies are advertised tools and must at least answer | initial: MailHog inbox empty; email-mcp started with the documented MAILHOG_* environment (service 'mailhog', type local) | expected final: all(not (calls[i]['result'].get('isError') and 'No module named' in calls[i]['result']['content'][0]['text']) for i in range(4)) | oracle: oracle-mailhog.py (MailHog HTTP API) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/email-mcp/EM-MH-04-auto-rule-modules-missing/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## E-3 — send_email is at-least-once with no idempotency key: a lost response plus one client retry delivers two messages

- **TARGET:** email-mcp
- **CATEGORY:** TARGET_MCP_RELIABILITY_RISK
- **SEVERITY:** LOW
- **UPSTREAM COMMIT:** fef2a06e9313aa69e7fd1572e18c53ccfc082bcc
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; local MailHog container (documented by upstream) as the primary sink; local GreenMail fake IMAP/SMTP container behind a loopback STARTTLS relay as a labelled supplement
- **REPRODUCTION RATE:** 3/3
- **ROOT CAUSE:** no dedupe key, message id or retry contract exists on send_email; the SMTP send completes before the response is written.
- **IMPACT:** observed only under an INJECTED FAULT (response dropped by the audit proxy); reported as a risk, not a bug, because upstream documents no exactly-once contract.
- **INJECTED FAULT:** yes — the fault was introduced by the audit's proxy; this is not an upstream bug.
- **CASES:**
  - `EM-GM-07-retry-direct` — intent: Send exactly one email. The response to the first send_email is swallowed (INJECTED FAULT); the client times out and retries once, as an agent would. | initial: all mailboxes empty | expected final: exactly one message delivered (the contract an exactly-once send would give) | oracle: oracle-greenmail.py | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/email-mcp/EM-GM-07-retry-direct/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## E-4 — Runtime service configuration is lost on restart, exactly as documented

- **TARGET:** email-mcp
- **CATEGORY:** NO_ISSUE_FOUND
- **SEVERITY:** INFO
- **UPSTREAM COMMIT:** fef2a06e9313aa69e7fd1572e18c53ccfc082bcc
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; local MailHog container (documented by upstream) as the primary sink; local GreenMail fake IMAP/SMTP container behind a loopback STARTTLS relay as a labelled supplement
- **REPRODUCTION RATE:** 3/3
- **ROOT CAUSE:** docs/configuration.md states configurations are in memory unless persisted via environment variables.
- **IMPACT:** none beyond the documented behaviour.
- **CASES:**
  - `EM-MH-08-service-not-persisted-across-restart` — intent: configure_service('audit-local', type local) then restart the server: the docs say runtime configuration is lost on restart unless mirrored into the environment; this case records that behaviour | initial: fresh server process with the documented MAILHOG_* environment | expected final: 'audit-local' in result['stdout'] and result['stdout'].count('audit-local')==1 | oracle: the second process's own list_services (state under test is the server's config, not MailHog) | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **NOT_RUN** | mode: shell | tool trace: `evidence/email-mcp/EM-MH-08-service-not-persisted-across-restart/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## W-1 — Every tool that resolves an IRI doubles the /v1 prefix and gets a 404: tasks.get, tasks.update, tasks.complete, projects.get, projects.archive

- **TARGET:** worktide-mcp
- **CATEGORY:** TARGET_MCP_BUG
- **SEVERITY:** HIGH
- **UPSTREAM COMMIT:** 4dbd0851b8c16b7acf32e1ea45a1234c425cd19e (backend 07393173732835c12c4cf763d73860fd82068ae0)
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; self-authored docker compose from upstream docs/INSTALL-docker-compose.md: FrankenPHP dev image, MySQL 8.0, Valkey; fixtures loaded; personal access token minted through the REST API; no ddev
- **REPRODUCTION RATE:** 3/3
- **ROOT CAUSE:** client.ts sets axios baseURL to WORKTIDE_API_URL, which the README documents as https://…/v1; resolveTaskIri/resolveProjectIri return API IRIs that already start with /v1/, and client.get(iri)/mergePatch(client, iri) concatenate them, producing /v1/v1/tasks/<id>.
- **IMPACT:** with the documented configuration, no task can be read by id, updated or completed and no project can be fetched or archived through the MCP.
- **CASES:**
  - `WT-D-01-tasks-get-doubled-prefix` — intent: tasks.get by identifier must return the task | initial: snapshot: project AUD with AUD-1..3 in Backlog, no running timer, 10 fixture time entries | expected final: calls[0]['result'].get('isError') is not True | oracle: oracle-worktide.py (REST with the audit token + direct MySQL) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/worktide-mcp/WT-D-01-tasks-get-doubled-prefix/attempt-1/`
  - `WT-D-02-tasks-update-doubled-prefix` — intent: tasks.update must set priority=urgent on AUD-3 | initial: snapshot: project AUD with AUD-1..3 in Backlog, no running timer, 10 fixture time entries | expected final: calls[0]['result'].get('isError') is not True and [t for t in after['tasks'] if t['identifier']=='AUD-3'][0]['priority']=='urgent' | oracle: oracle-worktide.py (REST with the audit token + direct MySQL) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/worktide-mcp/WT-D-02-tasks-update-doubled-prefix/attempt-1/`
  - `WT-D-03-tasks-complete-doubled-prefix` — intent: tasks.complete must move AUD-1 to the workspace's completed status | initial: snapshot: project AUD with AUD-1..3 in Backlog, no running timer, 10 fixture time entries | expected final: calls[0]['result'].get('isError') is not True and [t for t in after['tasks'] if t['identifier']=='AUD-1'][0]['status']!=[t for t in before['tasks'] if t['identi | oracle: oracle-worktide.py (REST with the audit token + direct MySQL) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/worktide-mcp/WT-D-03-tasks-complete-doubled-prefix/attempt-1/`
  - `WT-D-04-projects-get-archive-doubled-prefix` — intent: projects.get must return AUD and projects.archive must archive it | initial: snapshot: project AUD with AUD-1..3 in Backlog, no running timer, 10 fixture time entries | expected final: calls[0]['result'].get('isError') is not True and calls[1]['result'].get('isError') is not True | oracle: oracle-worktide.py (REST with the audit token + direct MySQL) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/worktide-mcp/WT-D-04-projects-get-archive-doubled-prefix/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## W-2 — tasks.create, tasks.addDependency, time.log and projects.create answer 500 against the pinned backend: the MCP omits the workspace/user the API requires

- **TARGET:** worktide-mcp
- **CATEGORY:** TARGET_MCP_BUG
- **SEVERITY:** HIGH
- **UPSTREAM COMMIT:** 4dbd0851b8c16b7acf32e1ea45a1234c425cd19e (backend 07393173732835c12c4cf763d73860fd82068ae0)
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; self-authored docker compose from upstream docs/INSTALL-docker-compose.md: FrankenPHP dev image, MySQL 8.0, Valkey; fixtures loaded; personal access token minted through the REST API; no ddev
- **REPRODUCTION RATE:** 3/3
- **ROOT CAUSE:** the POST payloads carry no workspace (Task, TaskDependency, Project) or user (TimeEntry); the backend at 0739317 answers 'Typed property …::$workspace must not be accessed before initialization' (500). The same POST succeeds when workspace is supplied (seed-worktide.py). The MCP commit predates the backend commit by three weeks, so this may be API drift rather than an original defect; either way the pair does not work.
- **IMPACT:** none of the MCP's create-type state changes work; only the timer tools change state successfully.
- **CASES:**
  - `WT-D-05-tasks-create-500` — intent: tasks.create must create one task in AUD | initial: snapshot: project AUD with AUD-1..3 in Backlog, no running timer, 10 fixture time entries | expected final: calls[0]['result'].get('isError') is not True and after['task_count']==before['task_count']+1 | oracle: oracle-worktide.py (REST with the audit token + direct MySQL) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/worktide-mcp/WT-D-05-tasks-create-500/attempt-1/`
  - `WT-D-06-add-dependency-500` — intent: tasks.addDependency AUD-1 → AUD-2 must create one dependency | initial: snapshot: project AUD with AUD-1..3 in Backlog, no running timer, 10 fixture time entries | expected final: calls[0]['result'].get('isError') is not True and after['db_dependency_count']==before['db_dependency_count']+1 | oracle: oracle-worktide.py (REST with the audit token + direct MySQL) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/worktide-mcp/WT-D-06-add-dependency-500/attempt-1/`
  - `WT-D-07-time-log-500` — intent: time.log must create one 30-minute time entry | initial: snapshot: project AUD with AUD-1..3 in Backlog, no running timer, 10 fixture time entries | expected final: calls[0]['result'].get('isError') is not True and after['db_time_entry_count']==before['db_time_entry_count']+1 | oracle: oracle-worktide.py (REST with the audit token + direct MySQL) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/worktide-mcp/WT-D-07-time-log-500/attempt-1/`
  - `WT-D-08-projects-create-500` — intent: projects.create must create project MCPX | initial: snapshot: project AUD with AUD-1..3 in Backlog, no running timer, 10 fixture time entries | expected final: calls[0]['result'].get('isError') is not True and 'MCPX' in after['projects'] | oracle: oracle-worktide.py (REST with the audit token + direct MySQL) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/worktide-mcp/WT-D-08-projects-create-500/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## W-3 — The backend answers a missing required relation with HTTP 500 instead of a validation error

- **TARGET:** worktide-mcp
- **CATEGORY:** TARGET_MCP_RELIABILITY_RISK
- **SEVERITY:** LOW
- **UPSTREAM COMMIT:** 4dbd0851b8c16b7acf32e1ea45a1234c425cd19e (backend 07393173732835c12c4cf763d73860fd82068ae0)
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; self-authored docker compose from upstream docs/INSTALL-docker-compose.md: FrankenPHP dev image, MySQL 8.0, Valkey; fixtures loaded; personal access token minted through the REST API; no ddev
- **REPRODUCTION RATE:** 3/3
- **ROOT CAUSE:** uninitialised typed property reached before validation.
- **IMPACT:** clients cannot distinguish a bad request from an outage; the MCP surfaces it as '[500] Typed property …'.
- **CASES:**
  - `WT-D-05-tasks-create-500` — intent: tasks.create must create one task in AUD | initial: snapshot: project AUD with AUD-1..3 in Backlog, no running timer, 10 fixture time entries | expected final: calls[0]['result'].get('isError') is not True and after['task_count']==before['task_count']+1 | oracle: oracle-worktide.py (REST with the audit token + direct MySQL) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/worktide-mcp/WT-D-05-tasks-create-500/attempt-1/`
  - `WT-D-08-projects-create-500` — intent: projects.create must create project MCPX | initial: snapshot: project AUD with AUD-1..3 in Backlog, no running timer, 10 fixture time entries | expected final: calls[0]['result'].get('isError') is not True and 'MCPX' in after['projects'] | oracle: oracle-worktide.py (REST with the audit token + direct MySQL) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/worktide-mcp/WT-D-08-projects-create-500/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## S-1 — backup copies the whole database to any path under deny-everything (and read-only); vacuum is correctly denied

- **TARGET:** sqlite-mcp
- **CATEGORY:** TARGET_MCP_BUG
- **SEVERITY:** MEDIUM
- **UPSTREAM COMMIT:** ff19c64e40b68df83b07e22c2faf73094ab04aeb
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; a disposable SQLite file created from scripts/seed-sqlite.sql for every case
- **REPRODUCTION RATE:** 3/3
- **ROOT CAUSE:** the access-control model is enforced by sqlite3_set_authorizer on SQL statements; backup uses the online backup API, which never passes through the authorizer, and no selector gates it.
- **IMPACT:** a caller restricted to deny-everything, or to a column-denied read-only view, can write a complete copy of the database (including denied columns) to a filesystem path of its choosing.
- **DISCLOSURE:** private first — draft in `disclosure/`
- **CASES:**
  - `SQ-D-02-backup-under-deny-everything` — intent: deny-everything preset should not let a caller copy the database to a path of its choosing | initial: seed: tasks 1-3, audit_log 1 | expected final: calls[0]['result'].get('isError')==True | oracle: oracle-sqlite.py | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/sqlite-mcp/SQ-D-02-backup-under-deny-everything/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## S-2 — rows_changed reports the previous statement's count for a read-only statement

- **TARGET:** sqlite-mcp
- **CATEGORY:** TARGET_MCP_BUG
- **SEVERITY:** LOW
- **UPSTREAM COMMIT:** ff19c64e40b68df83b07e22c2faf73094ab04aeb
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; a disposable SQLite file created from scripts/seed-sqlite.sql for every case
- **REPRODUCTION RATE:** 3/3
- **ROOT CAUSE:** rows_changed comes from Connection::changes(), which is connection-scoped, on a pooled connection reused across tool calls.
- **IMPACT:** an agent reading rows_changed after a SELECT sees a stale non-zero value.
- **CASES:**
  - `SQ-D-03-rows-changed-leak` — intent: a SELECT after an INSERT should report rows_changed 0 for the SELECT | initial: seed: tasks 1-3, audit_log 1 | expected final: calls[1]['result']['structuredContent']['rows_changed']==0 | oracle: oracle-sqlite.py | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/sqlite-mcp/SQ-D-03-rows-changed-leak/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## S-3 — A read-only server pointed at a missing path silently creates an empty database file

- **TARGET:** sqlite-mcp
- **CATEGORY:** TARGET_MCP_RELIABILITY_RISK
- **SEVERITY:** LOW
- **UPSTREAM COMMIT:** ff19c64e40b68df83b07e22c2faf73094ab04aeb
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; a disposable SQLite file created from scripts/seed-sqlite.sql for every case
- **REPRODUCTION RATE:** 3/3
- **ROOT CAUSE:** the file is opened with READ_WRITE | CREATE regardless of preset.
- **IMPACT:** a typo in --database under read-only yields an empty database instead of an error.
- **CASES:**
  - `SQ-D-08-readonly-creates-missing-file` — intent: a read-only server pointed at a missing path should not create a file | initial: seed: tasks 1-3, audit_log 1 | expected final: before['exists']==False and after['exists']==False | oracle: oracle-sqlite.py | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/sqlite-mcp/SQ-D-08-readonly-creates-missing-file/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## S-4 — execute is at-least-once: a lost response plus one client retry inserts two rows

- **TARGET:** sqlite-mcp
- **CATEGORY:** TARGET_MCP_RELIABILITY_RISK
- **SEVERITY:** LOW
- **UPSTREAM COMMIT:** ff19c64e40b68df83b07e22c2faf73094ab04aeb
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; a disposable SQLite file created from scripts/seed-sqlite.sql for every case
- **REPRODUCTION RATE:** 3/3
- **ROOT CAUSE:** no idempotency key; the statement commits before the response is written.
- **IMPACT:** observed only under an INJECTED FAULT; a risk, not a bug, absent any exactly-once contract.
- **INJECTED FAULT:** yes — the fault was introduced by the audit's proxy; this is not an upstream bug.
- **CASES:**
  - `SQ-D-09-retry-direct` — intent: Insert exactly one row. The response to the first INSERT is swallowed (INJECTED FAULT); the client times out and retries once. | initial: seed: tasks 1-3 | expected final: exactly one new row | oracle: oracle-sqlite.py | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/sqlite-mcp/SQ-D-09-retry-direct/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## S-5 — Presets, column-level deny, timeout interruption, single-statement enforcement and sequential BEGIN/INSERT/ROLLBACK all behave as documented

- **TARGET:** sqlite-mcp
- **CATEGORY:** NO_ISSUE_FOUND
- **SEVERITY:** INFO
- **UPSTREAM COMMIT:** ff19c64e40b68df83b07e22c2faf73094ab04aeb
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; a disposable SQLite file created from scripts/seed-sqlite.sql for every case
- **REPRODUCTION RATE:** 3/3
- **ROOT CAUSE:** n/a
- **IMPACT:** the cross-call transaction hypothesis from source reading did not reproduce in sequential use.
- **CASES:**
  - `SQ-D-01-readonly-denies-insert` — intent: read-only preset must refuse INSERT and leave state unchanged | initial: seed: tasks 1-3, audit_log 1 | expected final: calls[0]['result']['isError']==True and 'denied' in calls[0]['result']['content'][0]['text'] and after==before | oracle: oracle-sqlite.py | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/sqlite-mcp/SQ-D-01-readonly-denies-insert/attempt-1/`
  - `SQ-D-04-transaction-across-calls` — intent: BEGIN, INSERT, ROLLBACK across three tool calls must leave no row | initial: seed: tasks 1-3, audit_log 1 | expected final: after==before | oracle: oracle-sqlite.py | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/sqlite-mcp/SQ-D-04-transaction-across-calls/attempt-1/`
  - `SQ-D-05-column-deny-blocks-aggregate` — intent: --deny Read(tasks.amount) must block SELECT * and sum(amount) but allow id,title | initial: seed: tasks 1-3, audit_log 1 | expected final: calls[0]['result']['isError']==True and calls[1]['result']['isError']==False and calls[2]['result']['isError']==True | oracle: oracle-sqlite.py | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/sqlite-mcp/SQ-D-05-column-deny-blocks-aggregate/attempt-1/`
  - `SQ-D-06-timeout-interrupts` — intent: --timeout-ms 200 must interrupt a long query and the server must keep serving | initial: seed: tasks 1-3, audit_log 1 | expected final: calls[0]['result']['isError']==True and calls[1]['result']['isError']==False | oracle: oracle-sqlite.py | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/sqlite-mcp/SQ-D-06-timeout-interrupts/attempt-1/`
  - `SQ-D-07-multi-statement-rejected` — intent: two statements in one execute must be rejected atomically (neither applied) | initial: seed: tasks 1-3, audit_log 1 | expected final: calls[0]['result']['isError']==True and after==before | oracle: oracle-sqlite.py | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **NOT_RUN** | mode: direct | tool trace: `evidence/sqlite-mcp/SQ-D-07-multi-statement-rejected/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## R-1 — For a system that cannot be seeded, the verdict's baseline is the demonstration-time snapshot, not a fresh read at case start: a correct agent fails and a drifted world passes

- **TARGET:** all
- **CATEGORY:** RIGORRUN_BUG
- **SEVERITY:** HIGH
- **UPSTREAM COMMIT:** n/a
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; all three targets, as set up in evidence/environment.md
- **REPRODUCTION RATE:** 3/3 on sqlite (W1 and W1b), 3/3 on email (reset and accumulate modes), 3/3 with a real LLM agent
- **ROOT CAUSE:** packages/runner/src/run.ts executeCase: seedState = testCase.seed.state (recorded at generation time); adapter.seed() is skipped for seed:'none' connectors; buildProjection(..., {seed: seedState, ...}) computes derived.created against that stale snapshot. The recorded seed already contains the demonstrated record, so re-doing the job produces 'derived.created.<Entity> is absent' (FALSE_POSITIVE), while any record not in the snapshot — a duplicate, a wrong value, mail that accumulated since — counts as created (FALSE_NEGATIVE).
- **IMPACT:** against the connectors real MCP servers get (seed: none), the success check 'the requested work was actually performed' does not measure the case's own delta.
- **CASES:**
  - `SQ-W1-01-correct` — intent: Insert exactly one new task titled 'Quarterly report' (open, 45.5, owner cy); change nothing else. | initial: tasks has rows 1-3 (seed), audit_log has 1 row | expected final: exactly one new tasks row with the requested values; rows 1-3 and audit_log unchanged | oracle: oracle-sqlite.py (read-only sqlite3 open outside the MCP process) | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **FAIL** | mode: rigorrun | tool trace: `evidence/sqlite-mcp/SQ-W1-01-correct/attempt-1/`
  - `SQ-W1B-01-correct` — intent: Insert exactly one new task titled 'Quarterly report' (open, 45.5, owner cy); change nothing else. | initial: tasks has rows 1-3 (seed), audit_log has 1 row | expected final: exactly one new tasks row with the requested values; rows 1-3 and audit_log unchanged | oracle: oracle-sqlite.py (read-only sqlite3 open outside the MCP process) | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **FAIL** | mode: rigorrun | tool trace: `evidence/sqlite-mcp/SQ-W1B-01-correct/attempt-1/`
  - `SQ-LLM-02-qwen2.5-3b` — intent: Insert exactly one new task titled 'Quarterly report' (open, 45.5, owner cy); change nothing else. | initial: tasks has rows 1-3 (seed), audit_log has 1 row | expected final: exactly one new tasks row with the requested values; rows 1-3 and audit_log unchanged | oracle: oracle-sqlite.py (read-only sqlite3 open outside the MCP process) | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **FAIL** | mode: rigorrun | tool trace: `evidence/sqlite-mcp/SQ-LLM-02-qwen2.5-3b/attempt-1/`
  - `EM-GM-01-correct` — intent: Send exactly one email to qa@example.test with subject 'Audit 17'; nothing else. | initial: all mailboxes empty | expected final: exactly one message in qa@example.test's INBOX with subject Audit 17; nothing elsewhere | oracle: oracle-greenmail.py (IMAPS from a separate process) | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **FAIL** | mode: rigorrun | tool trace: `evidence/email-mcp/EM-GM-01-correct/attempt-1/`
  - `EM-GMA-01-correct` — intent: Send exactly one email to qa@example.test with subject 'Audit 17'; nothing else. | initial: all mailboxes empty | expected final: exactly one message in qa@example.test's INBOX with subject Audit 17; nothing elsewhere | oracle: oracle-greenmail.py (IMAPS from a separate process) | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **FAIL** | mode: rigorrun | tool trace: `evidence/email-mcp/EM-GMA-01-correct/attempt-1/`
  - `SQ-W1-03-duplicate` — intent: Insert exactly one new task titled 'Quarterly report' (open, 45.5, owner cy); change nothing else. | initial: tasks has rows 1-3 (seed), audit_log has 1 row | expected final: exactly one new tasks row with the requested values; rows 1-3 and audit_log unchanged | oracle: oracle-sqlite.py (read-only sqlite3 open outside the MCP process) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **PASS** | mode: rigorrun | tool trace: `evidence/sqlite-mcp/SQ-W1-03-duplicate/attempt-1/`
  - `SQ-W1-04-wrong-value` — intent: Insert exactly one new task titled 'Quarterly report' (open, 45.5, owner cy); change nothing else. | initial: tasks has rows 1-3 (seed), audit_log has 1 row | expected final: exactly one new tasks row with the requested values; rows 1-3 and audit_log unchanged | oracle: oracle-sqlite.py (read-only sqlite3 open outside the MCP process) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **PASS** | mode: rigorrun | tool trace: `evidence/sqlite-mcp/SQ-W1-04-wrong-value/attempt-1/`
  - `SQ-W1-05-wrong-entity` — intent: Insert exactly one new task titled 'Quarterly report' (open, 45.5, owner cy); change nothing else. | initial: tasks has rows 1-3 (seed), audit_log has 1 row | expected final: exactly one new tasks row with the requested values; rows 1-3 and audit_log unchanged | oracle: oracle-sqlite.py (read-only sqlite3 open outside the MCP process) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **PASS** | mode: rigorrun | tool trace: `evidence/sqlite-mcp/SQ-W1-05-wrong-entity/attempt-1/`
  - `EM-GM-03-duplicate` — intent: Send exactly one email to qa@example.test with subject 'Audit 17'; nothing else. | initial: all mailboxes empty | expected final: exactly one message in qa@example.test's INBOX with subject Audit 17; nothing elsewhere | oracle: oracle-greenmail.py (IMAPS from a separate process) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **PASS** | mode: rigorrun | tool trace: `evidence/email-mcp/EM-GM-03-duplicate/attempt-1/`
  - `EM-GMA-04-wrong-recipient` — intent: Send exactly one email to qa@example.test with subject 'Audit 17'; nothing else. | initial: all mailboxes empty | expected final: exactly one message in qa@example.test's INBOX with subject Audit 17; nothing elsewhere | oracle: oracle-greenmail.py (IMAPS from a separate process) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **PASS** | mode: rigorrun | tool trace: `evidence/email-mcp/EM-GMA-04-wrong-recipient/attempt-1/`
  - `EM-GMA-05-wrong-subject` — intent: Send exactly one email to qa@example.test with subject 'Audit 17'; nothing else. | initial: all mailboxes empty | expected final: exactly one message in qa@example.test's INBOX with subject Audit 17; nothing elsewhere | oracle: oracle-greenmail.py (IMAPS from a separate process) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **PASS** | mode: rigorrun | tool trace: `evidence/email-mcp/EM-GMA-05-wrong-subject/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## R-2 — No independent oracle: the verdict can only read the target server's own nominated tools, and a project takes one connector

- **TARGET:** all
- **CATEGORY:** RIGORRUN_PRODUCT_GAP
- **SEVERITY:** HIGH
- **UPSTREAM COMMIT:** n/a
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; all three targets, as set up in evidence/environment.md
- **REPRODUCTION RATE:** structural (packages/daemon/src/project.ts, packages/connector/src/environment.ts)
- **ROOT CAUSE:** Project.verifierReads are tool calls on the connection under test; only a browser connector may attach a separate verifier; http_status/url_matches assertion kinds are never fed in the run path.
- **IMPACT:** when a target's read is broken (E-1) RigorRun correctly refuses to compile; when a read omits a field (recipient is absent from check_inbox) the wrong entity is invisible; the audit's ground truth had to live outside the product.
- **CASES:** none (structural finding; evidence is the cited source and the journey traces)
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## R-3 — Column-cell result shapes are induced as a value-keyed 'Id' entity, not as table rows; RigorRun's own quality gate flags the resulting suite

- **TARGET:** sqlite-mcp
- **CATEGORY:** RIGORRUN_PRODUCT_GAP
- **SEVERITY:** MEDIUM
- **UPSTREAM COMMIT:** ff19c64e40b68df83b07e22c2faf73094ab04aeb
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; a disposable SQLite file created from scripts/seed-sqlite.sql for every case
- **REPRODUCTION RATE:** 2/2 journeys (W1, W1b)
- **ROOT CAUSE:** induceSchema treats {kind, value} cells as records and keys them by value; execute's {rows:[{columns:{col:{kind,value}}}]} shape never yields a row entity. quality reported false_positive_rate 1 (W1) and mutant_kill_rate 0/3 (W1b).
- **IMPACT:** no discriminating suite can be built for this server; the product does say so if the operator runs the quality check.
- **CASES:**
  - `SQ-W1-01-correct` — intent: Insert exactly one new task titled 'Quarterly report' (open, 45.5, owner cy); change nothing else. | initial: tasks has rows 1-3 (seed), audit_log has 1 row | expected final: exactly one new tasks row with the requested values; rows 1-3 and audit_log unchanged | oracle: oracle-sqlite.py (read-only sqlite3 open outside the MCP process) | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **FAIL** | mode: rigorrun | tool trace: `evidence/sqlite-mcp/SQ-W1-01-correct/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## R-4 — Generated cases carry a fixed 15 s budget, shorter than the 20 s MCP call timeout, so a case cannot survive one lost response, and slow local models cannot finish

- **TARGET:** all
- **CATEGORY:** RIGORRUN_PRODUCT_GAP
- **SEVERITY:** MEDIUM
- **UPSTREAM COMMIT:** n/a
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; all three targets, as set up in evidence/environment.md
- **REPRODUCTION RATE:** 3/3 (EM-GM-06), 3/3 (SQ-LLM-01), 3/3 (EM-LLM-01)
- **ROOT CAUSE:** packages/generator/src/counterfactual.ts sets timeoutMs: 15_000; packages/mcp/src/client.ts DEFAULT_TIMEOUT_MS = 20_000; neither is configurable from the interface or CLI.
- **IMPACT:** the ambiguous-retry class cannot be measured inside RigorRun (it was measured with the direct client instead), and an 8B model on this machine times out on every case.
- **CASES:**
  - `EM-GM-06-retry-after-lost-response` — intent: Send exactly one email; the response to the first send_email is swallowed by the fault proxy (INJECTED FAULT), the agent sees a timeout and retries once. | initial: all mailboxes empty | expected final: exactly one message in qa@example.test's INBOX with subject Audit 17; nothing elsewhere | oracle: oracle-greenmail.py (IMAPS from a separate process) | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **FAIL** | mode: rigorrun | tool trace: `evidence/email-mcp/EM-GM-06-retry-after-lost-response/attempt-1/`
  - `SQ-LLM-01-llama3.1-8b` — intent: Insert exactly one new task titled 'Quarterly report' (open, 45.5, owner cy); change nothing else. | initial: tasks has rows 1-3 (seed), audit_log has 1 row | expected final: exactly one new tasks row with the requested values; rows 1-3 and audit_log unchanged | oracle: oracle-sqlite.py (read-only sqlite3 open outside the MCP process) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **FAIL** | mode: rigorrun | tool trace: `evidence/sqlite-mcp/SQ-LLM-01-llama3.1-8b/attempt-1/`
  - `EM-LLM-01-qwen2.5-3b` — intent: Send exactly one email to qa@example.test with subject 'Audit 17'; nothing else. | initial: all mailboxes empty | expected final: exactly one message in qa@example.test's INBOX with subject Audit 17; nothing elsewhere | oracle: oracle-greenmail.py (IMAPS from a separate process) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **FAIL** | mode: rigorrun | tool trace: `evidence/email-mcp/EM-LLM-01-qwen2.5-3b/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## R-5 — The task instruction is built from the primary tool's description rather than the project goal, and a dual-purpose tool's last call becomes the primary action

- **TARGET:** sqlite-mcp
- **CATEGORY:** RIGORRUN_BUG
- **SEVERITY:** LOW
- **UPSTREAM COMMIT:** ff19c64e40b68df83b07e22c2faf73094ab04aeb
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; a disposable SQLite file created from scripts/seed-sqlite.sql for every case
- **REPRODUCTION RATE:** 2/2 journeys
- **ROOT CAUSE:** the goal sentence typed at project creation was replaced by execute's description (a Rust doc comment); with execute serving both reads and writes, W1's primary action resolved to the trailing SELECT.
- **IMPACT:** the agent is told 'Marker type for the execute tool…' instead of the job; in W1 the case inputs were the read-back query, not the insert.
- **CASES:**
  - `SQ-W1-01-correct` — intent: Insert exactly one new task titled 'Quarterly report' (open, 45.5, owner cy); change nothing else. | initial: tasks has rows 1-3 (seed), audit_log has 1 row | expected final: exactly one new tasks row with the requested values; rows 1-3 and audit_log unchanged | oracle: oracle-sqlite.py (read-only sqlite3 open outside the MCP process) | ground-truth verdict: **PASS** (expected state held) | RigorRun verdict: **FAIL** | mode: rigorrun | tool trace: `evidence/sqlite-mcp/SQ-W1-01-correct/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## R-6 — No headless project setup; connecting and teaching are interface-only, so the audit drove the runner's HTTP API directly

- **TARGET:** all
- **CATEGORY:** RIGORRUN_PRODUCT_GAP
- **SEVERITY:** LOW
- **UPSTREAM COMMIT:** n/a
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; all three targets, as set up in evidence/environment.md
- **REPRODUCTION RATE:** documented (docs/V1_GAP_AUDIT.md)
- **ROOT CAUSE:** documented as MISSING by the product.
- **IMPACT:** CI can run and gate but cannot create the project it gates.
- **CASES:** none (structural finding; evidence is the cited source and the journey traces)
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## R-8 — A server that returns JSON only as text content passes the read-nomination probe but yields no records at demonstration time, so compile refuses after the job has been demonstrated

- **TARGET:** worktide-mcp
- **CATEGORY:** RIGORRUN_BUG
- **SEVERITY:** HIGH
- **UPSTREAM COMMIT:** 4dbd0851b8c16b7acf32e1ea45a1234c425cd19e (backend 07393173732835c12c4cf763d73860fd82068ae0)
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; self-authored docker compose from upstream docs/INSTALL-docker-compose.md: FrankenPHP dev image, MySQL 8.0, Valkey; fixtures loaded; personal access token minted through the REST API; no ddev
- **REPRODUCTION RATE:** 2/2 journeys (W2, W3)
- **ROOT CAUSE:** packages/daemon/src/service.ts probeVerifierReads observes `result.structured ?? result.content`, so a text-only JSON answer counts as records (the {type,text} content objects are record-like) and the probe reports no problem; packages/daemon/src/workspace.ts captures only `result.structured` for the demonstration's before/after payloads and observations, so a server without structuredContent produces an empty schema. worktide-mcp answers every tool with content:[{type:'text', text:'<json>'}] and no structuredContent (see any evidence/worktide-mcp/*/attempt-1/direct.json). The journey traces traces/worktide-mcp/w2-setup and w3-setup show readsProblem empty, schema.entities [], and the compile error 'The reads nominated for verification returned text rather than structured records'.
- **IMPACT:** the very check that exists to stop somebody demonstrating a job RigorRun cannot verify gives the wrong answer for the most common MCP result shape (JSON in a text block), and the refusal arrives after the demonstration. Worktide could not be taken to a verdict through the product path at all.
- **CASES:** none (structural finding; evidence is the cited source and the journey traces)
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## R-7 — `rigorrun verify --needs-credential` is documented but not wired into the CLI; verify accepts only Node servers from npm: or dir:

- **TARGET:** all
- **CATEGORY:** RIGORRUN_PRODUCT_GAP
- **SEVERITY:** INFO
- **UPSTREAM COMMIT:** n/a
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; all three targets, as set up in evidence/environment.md
- **REPRODUCTION RATE:** 1/1
- **ROOT CAUSE:** docs/VERIFY_SERVER.md names the flag; packages/cli/src/main.ts parseArgs does not; the sandbox base image is node:20-alpine.
- **IMPACT:** none of the three targets (Python, TypeScript-unpublished, Rust) could go through verify.
- **CASES:** none (structural finding; evidence is the cited source and the journey traces)
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

## A-1 — qwen2.5:3b did not finish the email task inside 15 s with a 47-tool catalogue; llama3.1:8b did not finish any case inside 15 s

- **TARGET:** email-mcp
- **CATEGORY:** AGENT_FAILURE
- **SEVERITY:** INFO
- **UPSTREAM COMMIT:** fef2a06e9313aa69e7fd1572e18c53ccfc082bcc
- **RIGORRUN COMMIT/VERSION:** 07dda8c738d6daada161ffcf2bfc046b3c874ac5 / 0.2.0
- **ENVIRONMENT:** see `evidence/environment.md`; local MailHog container (documented by upstream) as the primary sink; local GreenMail fake IMAP/SMTP container behind a loopback STARTTLS relay as a labelled supplement
- **REPRODUCTION RATE:** 3/3
- **ROOT CAUSE:** prompt size and model latency on this machine versus R-4's fixed budget.
- **IMPACT:** not a model-quality result; the sqlite run with the same 3B model completed correctly 3/3.
- **CASES:**
  - `EM-LLM-01-qwen2.5-3b` — intent: Send exactly one email to qa@example.test with subject 'Audit 17'; nothing else. | initial: all mailboxes empty | expected final: exactly one message in qa@example.test's INBOX with subject Audit 17; nothing elsewhere | oracle: oracle-greenmail.py (IMAPS from a separate process) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **FAIL** | mode: rigorrun | tool trace: `evidence/email-mcp/EM-LLM-01-qwen2.5-3b/attempt-1/`
  - `SQ-LLM-01-llama3.1-8b` — intent: Insert exactly one new task titled 'Quarterly report' (open, 45.5, owner cy); change nothing else. | initial: tasks has rows 1-3 (seed), audit_log has 1 row | expected final: exactly one new tasks row with the requested values; rows 1-3 and audit_log unchanged | oracle: oracle-sqlite.py (read-only sqlite3 open outside the MCP process) | ground-truth verdict: **FAIL** (expected state violated) | RigorRun verdict: **FAIL** | mode: rigorrun | tool trace: `evidence/sqlite-mcp/SQ-LLM-01-llama3.1-8b/attempt-1/`
- **EXACT REPRODUCTION STEPS:** `bash scripts/reset-<target>.sh && python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3` (each case file names its server command, calls or agent, and its `expect`).
- **LIMITATIONS:** one machine, one day, the pinned commits only; see `methodology.md`.

