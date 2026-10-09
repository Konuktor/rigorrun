# Agent Release Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax. The supplied user spec explicitly chooses parallel isolated workers, overriding the skill's serial implementation default.

**Goal:** Finish the existing observable Helpdesk release check from user-owned HTTP agent to explicit review, run evidence and CI gate.

**Architecture:** Reuse Service, pack registry, ProjectStore and gateReadiness. The app keeps its existing Projects navigation and adds a narrow Helpdesk path. Reports reuse existing explanation, escaping and sanitization. No new policy engine or generated-suite exemption.

**Tech Stack:** TypeScript, React 19, Vite, Hono, Vitest, Playwright, pnpm 11.7.0, Node 22.

**Spec:** `docs/superpowers/specs/2026-10-10-agent-release-check-design.md` (user-supplied and requested for execution).

## Global Constraints

- Maximum four active agents including root. Each writing worker has its own worktree from the shared planning baseline.
- Product/landing/quickstart English; user conversation Russian. No hosted-service, unique-technology, traction or guaranteed-safety claims.
- Do not modify reports, qualifications, CLAIMS, POSITIONING or PROGRESS. No publish/deploy/push/release/tag/remote merge, secrets disclosure or production actions.
- New package code is not covered by historical qualification. PASS only means checked scenarios with observed evidence; missing required readback remains unknown/inconclusive.
- Preserve gate exits: success 0, candidate failure 1, invalid environment/configuration 2, inadequate project suite 3 before candidate execution. Setup uses existing error contract.
- One writer per project/state directory. Cancel stale UI requests and do not show foreign run evidence.
- Worker allowlists and report contract are in `docs/context/tasks/agent-release-check-5h-2026-10-10.md`. No subagents from implementers; root dispatches reviews.

## Review Focus

- Setup regex invalid/overlapping decisions must fail before downstream generation, assessment and agent registration; unmatched rules remain inferred and accessible for later review.
- Pack-suite malformed decision arrays must fail rather than silently filter, and explicit rejection must survive reload without enforcement: existing diagnostic assertions may remain nonblocking.
- Readiness GET must use pairing/security middleware and must not mutate files or contact the candidate.
- Project/URL changes or reload must not display prior async response/evidence; failed probe remains disconnected.
- PASS details must retain task/policy separation, escaping, redaction, evidence source and unavailable-readback limits.

## Shared API contract

- POST `/api/projects/:id/pack-suite`: JSON `{ params?: unknown, confirmedRuleIds?: string[], rejectedRuleIds?: string[] }`; strict array/string validation; missing arrays default empty; service rejects unknown IDs, duplicates and overlaps. Response remains `{ contract, cases: { id, name, category }[] }`.
- Helpdesk params: `{ confirmedRuleIds: string[] }` must match confirmed outer decisions so pack produces corresponding checks. Draft `{ params: { confirmedRuleIds: [] }, confirmedRuleIds: [], rejectedRuleIds: [] }` remains unreviewed; install again after explicit decisions, never use ordinary review to make the old suite appear current.
- GET `/api/projects/:id/gate-readiness`: `{ ready: boolean, reasons: string[], source: SuiteSource | null }` directly from `service.gateReadiness(id)`. Existing paired session required.
- App `api.packSuite(id, params, confirmedRuleIds, rejectedRuleIds)` and `api.gateReadiness(id)` wrap these routes. Existing connect accepts pack connector `{ kind: 'pack', pack: 'helpdesk', mode: 'twin', baseUrl: localMcpUrl }` with explicit local/ephemeral safety. Preserve the actual pack ID from source if it differs.
- Agent registration uses existing `blackBox` input and probe result. Run/report/history APIs stay unchanged.
- Extend `ProjectView.connector` with the actual daemon pack summary shape (`kind: 'pack'`, pack/mode/baseUrl/options), and restore the selected Helpdesk connection from it after reload.

### Task 1: Backend explicit review and readiness

**Files:** Backend allowlist in task brief. New `packages/daemon/test/packSuiteRoutes.test.ts` and/or `gateReadinessRoutes.test.ts`.
**Interfaces:** consumes existing `Service.installPackSuite(id, params, decisions)` and `Service.gateReadiness(id)`; produces shared routes above. No service gate changes.

- [x] Write setup regressions for unmatched rule retention and nonzero stop, explicit reject/confirm (including pattern `.`), overlap and invalid regex. Assert no generated suite, assessment or registered agent on refusal. Validate regex patterns before proxy/connect where possible; actual overlap only after compiling rules.
- [x] Run `pnpm exec vitest run packages/cli/test/setup.test.ts` and record expected RED assertions.
- [x] Compile regex once, resolve only explicit matches, reject conflicting matches, persist explicit decisions, report project/pending rule IDs and return the existing appropriate nonzero contract before downstream operations. Update misleading setup help/comment if required.
- [x] Write real Runner HTTP tests for both decisions, malformed root/arrays/elements, unknown IDs/duplicates/overlap, missing/stale/pending/refused-generated/valid bundled readiness, pairing/CSRF, unchanged disk bytes and no candidate calls.
- [x] Run focused server tests for RED; implement strict route parsing and read-only forwarding.
- [x] Run focused CLI/server tests plus pairing/CSRF, lint, typecheck and claims; commit only allowlisted files; report RED/GREEN and files.

### Task 2: Guided Helpdesk browser path

**Files:** UI allowlist in task brief, with narrow pack-specific `apps/app/src/packs/HelpdeskFlow.tsx`; new onboarding spec/config. Keep pack identity/defaults/copy in this component; generic product pages consume its component and support predicate without pack literals. Leave the domain checker unchanged.
**Interfaces:** consumes shared API, existing connect/addAgent/run/project/report. Produces wrapper signatures above and user route within Projects/Project.

- [x] Write a user-visible Playwright regression using the real CLI daemon/twin and external deterministic HTTP control with fresh state. Path: create project → Helpdesk twin URL and safety → draft rules → explicit confirm/reject → own endpoint/probe → readiness → run → evidence/report → reload/repeat.
- [x] Run to observe RED for missing Helpdesk path (record reason; backend may not yet be integrated).
- [x] Implement wrappers and a focused existing-style flow. Ensure selected pack params reflect explicit decisions; pending review cannot proceed. Confirm real daemon bootstrap registers pack, rather than unit-only registration.
- [x] Add the existing server's pack connector shape to `ProjectView.connector` and verify persisted Helpdesk selection/URL/safety after reload; do not cast packs as MCP connectors.
- [x] Add bounded coverage for failed probe, readiness refusal, project/URL switching, late response cancellation, reload and evidence isolation. Use existing UI patterns rather than full redesign.
- [x] Run browser flow against a local combined checkout with accepted backend commit once available. Inspect desktop/mobile screenshot and console. Run lint/typecheck/claims; report complete file list and commit.

### Task 3: Safe PASS evidence

**Files:** Evidence allowlist in task brief.
**Interfaces:** consumes existing `RunResult`, optional benchmark/contract, explainCase/sanitize/escape; produces self-contained HTML with compact expandable passing cases.

- [x] Write report tests for PASS task/assertion details, actual black-box world/access/outbox, task versus policy labels, missing readback unknown, adversarial HTML escaping and secret/private-data redaction in published mode.
- [x] Run `pnpm exec vitest run packages/report/test/report.test.ts packages/report/test/explain.test.ts packages/report/test/materialized.test.ts` to observe relevant RED.
- [x] Add compact details using existing render/explain functions. Do not infer internal calls/reasoning; keep unknown cases visibly undecided. Do not expose more private data than current mode permits.
- [x] Rerun all report tests plus lint/typecheck/claims; commit allowlisted changes and report RED/GREEN.

### Task 4: Root integration, artifact quickstart and acceptance

**Files:** Root allowlist in task brief.
**Interfaces:** consumes reviewed worker commits and built CLI artifact; produces English quickstart and honest acceptance ledger.

- [x] Establish baseline using public CLI Helpdesk/Stripe acceptance with independent scripted HTTP controls and a fresh store; do not count this as new-code acceptance.
- [x] Arrange read-only plan review; resolve findings before writing workers start. Extract task briefs with the skill script and create three native worktrees from the committed plan baseline.
- [x] Review each worker name-status/stat/check/full diff and test report before cherry-picking only accepted commits. Dispatch independent task review as slots become available, then read-only whole-branch review.
- [x] Obtain commands from actual local packaged CLI help. Build app/CLI, pack and install into a new temporary directory. Execute twin/daemon, own endpoint, explicit review, readiness, gate, HTML and repeat against installed artifact. Save artifact paths and exit codes outside protected reports.
- [x] Cover every acceptance item 1–11 in the spec with literal expected outcomes using independent controls (scoped, overbroad, refusal, wrong recipient/read/write/leak). Add only missing root-owned tests/fixtures with RED/GREEN.
- [x] Run integrated targeted tests, real daemon/browser onboarding, fresh restart/reset repeat, `pnpm verify`, `pnpm verify:package` and history/compare checks. Correct regressions through owner or explicit ownership transfer and rereview.
- [x] Write `docs/product/AGENT_RELEASE_CHECK_QUICKSTART.md` and `AGENT_RELEASE_CHECK_DELIVERY.md` with exact checkout, branch, SHA, commands, reports, PASS/FAIL/NOT RUN per acceptance, unsupported scope and local/npm/production status. Preserve worktrees; report deletions truthfully.
