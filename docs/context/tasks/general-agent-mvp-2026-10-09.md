# General agent verification MVP — approved execution brief

User approved implementation on 2026-10-09 and explicitly requested parallel subagents, plus investor/hackathon-ready English landing offers. Baseline: `3e2d4e3db3d15b2301599251ad11a4b1b5127781` (CLI 0.6.0). Preserve the old dirty checkout at `/home/erbol/RigorRun` and other founder worktrees.

Read the design spec and the applicable extracted task brief. No production deployment, push, npm release, external outreach, production test writes, secret disclosure or changes to protected claims/positioning/progress ledgers, reports or qualification harnesses. Package changes are not covered by old qualified-tree evidence. Runtime enforcement and SaaS subscription infrastructure are not this MVP.

## Ownership

- Core worker: Tasks 1–3. Only `packages/daemon/src/service.ts`, `suiteIntegrity.ts`, `index.ts`, `packages/cli/src/commands.ts`, `project.ts`; new tests `packages/cli/test/generateReview.test.ts`, `gateQuality.test.ts`, `packages/daemon/test/reviewDecisions.test.ts`, `suiteIntegrity.test.ts`; existing related tests `packages/cli/test/cli.test.ts`, `project.test.ts`, `packages/daemon/test/stepChange.test.ts`, `packProject.test.ts`, `suiteQualityOnRun.test.ts`, `suiteQuality.test.ts`. Request expansion for any other existing file before editing it.
- UI worker: Tasks 4–5. Only `apps/app/src/demo/DemoPage.tsx`, `useDemo.ts`, `steps.tsx`, new `route.ts`, `apps/app/src/product/stages.tsx`, `e2e/demo.spec.ts`, `demo-deep.spec.ts`, new `domain-workflows.spec.ts`, `e2e/support/journeys.ts`. Related external/restart/visual acceptance files may need follow-up expansion; report it first.
- QA worker: Task 6. Only new `packages/cli/test/helpdesk.e2e.test.ts`, `docs/product/MVP_RUNBOOK.md`. No edits to other workers' files. Reports in its plan workspace may be updated freely.
- Coordinator: plan/spec/this brief/plan ledger; site offers and consistency in `apps/site/src/site.ts`, `pages/index.astro`, `pages/company.astro`, `pages/access.astro`, `pages/how-it-works.astro`, `pages/start.astro`, `layouts/Base.astro`, `components/Nav.astro`, `components/Footer.astro`, `public/llms.txt`, `astro.config.mjs`, `scripts/check-contact.mjs`, `e2e/site.spec.ts`, `e2e/smoke.spec.ts`; email literals in `apps/docs/src/content/docs/start/what-it-is.md` and `trust/security.md`; new `docs/product/HACKATHON_PITCH.md`.

## Additional landing requirements

Retain the current typography, reusable components, evidence/replay widgets and responsive layout. This is an offer/content update inside the existing design system, not a visual redesign. Lead with `Verify what your AI agents actually do.` and a concrete pre-deployment permission/scope problem. Show current Helpdesk/Stripe scope, distinguish broader workflow examples from qualified integrations, explain free OSS vs paid scoped pilot vs planned team cloud. Do not invent revenue, users, partners, market size, performance, pricing validation or blanket safety. Existing recorded numbers are historical and linked to their evidence. Investor readiness means an intelligible thesis and honest stage, not claimed funding readiness. All contact addresses in the approved copy scope become `erbol@rigorrun.xyz`.

## Verification

Workers follow TDD for behavior changes, report actual RED/GREEN evidence, run targeted acceptance commands plus lint/typecheck/claims, and do not reduce gate thresholds. Coordinator runs full `pnpm test` and integrated acceptance. Each worker uses its own worktree and commits only its own scoped files. No child subagents; review is coordinator-owned.

Tasks use checkpoints, not transactional concurrency guarantees. One writer/operator per project is the supported MVP mode. Quality assessment is explicit and writes to test environments; never invoke it automatically from gate. Missing/stale/poor generated suite yields project-gate exit 3 before contacting a candidate. Unknown/conflicting review decisions are invalid input; omitted decisions do not confirm anything.

## Scope checkpoints

At minute 90 stop expanding scope. At minute 120 remove optional workflow-selector work if required. If source/quality protection cannot be verified, ship only a clearly labelled pack preview and refuse generated release gates. Do not report full MVP completion on failed P0 acceptance.
