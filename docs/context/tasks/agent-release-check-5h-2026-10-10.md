# Agent Release Check · five-hour delivery

- Agent: root coordinator and three isolated workers; user explicitly requested parallel implementation through the supplied prompt.
- Base: `d307735004e47aa1064779b6b8c2c262071025ab`, branch `feat/hackathon-general-agent-mvp`.
- Integration worktree: `/home/erbol/.codex/worktrees/104e/RigorRun`, branch `feat/agent-release-check-5h`.
- Time box: five hours including plan, implementation, integration, independent review and fresh acceptance.

Read `AGENTS.md`, `docs/context/AGENT_WORKFLOW.md`, `POSITIONING.md`, `CLAIMS.md`, `PROGRESS.md`, the approved supplied spec in `docs/superpowers/specs/2026-10-10-agent-release-check-design.md`, and your extracted task brief.

## Goal

Complete the existing Helpdesk twin → own HTTP agent → explicit rules review → readiness → run → observable evidence → repeat → CLI gate flow. Product and quickstart copy are English. Coordinator communication is Russian. Scripted controls are never labelled live LLM validation.

## Ownership and allowed files

- Backend: `packages/cli/src/setup.ts`, narrow new setup helper under `packages/cli/src/`, `packages/cli/src/help.ts`, `packages/cli/test/setup.test.ts`, `packages/cli/test/generateReview.test.ts`, `packages/cli/test/gateQuality.test.ts`, `packages/daemon/src/server.ts`, new focused tests under `packages/daemon/test/`. Service logic may be read but not rewritten.
- UI: `apps/app/src/product/**`; new `e2e/helpdesk-onboarding.spec.ts` and `e2e/playwright.helpdesk.config.ts`. No backend/report edits.
- Evidence: `packages/report/src/**`, `packages/report/test/**`. No app/server edits.
- Root: this brief, supplied design spec, `docs/superpowers/plans/2026-10-10-agent-release-check.md`, new `docs/product/AGENT_RELEASE_CHECK_QUICKSTART.md`, `docs/product/AGENT_RELEASE_CHECK_DELIVERY.md`, `scripts/agent-release-check-acceptance.mjs`, focused CLI acceptance test/fixtures if necessary under `packages/cli/test/`, `fixtures/external/helpdesk-release-control/**`. Worker areas require explicit ownership transfer before root edits.

## Forbidden

Do not modify `reports/**`, qualification harnesses, preregistrations, `docs/context/CLAIMS.md`, `POSITIONING.md` or `PROGRESS.md`. Do not copy dirty source edits. No release pins, publish, deploy, push, remote merge, live CRM writes, provider calls using private keys, new SaaS/billing or gate weakening. Do not read/print secret values. Preserve other worktrees and processes. Use apply_patch for edits. Do not delete tracked files without reporting exact paths.

## Acceptance

Run focused RED then GREEN tests. Run `pnpm lint`, `pnpm typecheck`, `pnpm claims` before worker handoff. Root runs integrated Helpdesk/Stripe acceptance, real daemon/browser onboarding, `pnpm verify`, `pnpm verify:package`, and a clean-room packaged CLI quickstart. Isolated temporary state per test, one writer per project. Preserve logs/evidence outside protected reports, with exact commands and exit codes.

## Handoff

Return baseline SHA and all implementation commits; created/modified/deleted/renamed paths; RED/GREEN command evidence, risks and incomplete items. Full report goes to the assigned scratch report path; short chat response only status, commits and concerns. Changes under packages invalidate coverage by historical qualification; new regression checks are not qualification.
