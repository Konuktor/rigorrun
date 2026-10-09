# General Agent Verification MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** За трёхчасовой timebox получить честный локальный pilot MVP общего инструмента проверки AI-агентов: явные правила, отказ от недоказанного PASS и воспроизводимый неплатёжный black-box gate.

**Architecture:** Сохранить существующее domain-agnostic ядро и pack adapters современного master. Добавить source-bound suite/quality checkpoints в daemon/project gate, явный review в UI/CLI и строгий Helpdesk integration test. Дополнительные синтетические domains показывают архитектуру, но не подменяют qualification.

**Tech Stack:** Existing TypeScript/pnpm monorepo, React/Vite app, Astro site, Node daemon/CLI, Vitest, Playwright, MCP and local Helpdesk/Stripe twins; no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-09-general-agent-verification-mvp-design.md`

## Global Constraints

- Baseline: `3e2d4e3db3d15b2301599251ad11a4b1b5127781` (`origin/master`, CLI v0.6.0).
- Runtime: Node 22.22.2 and pnpm 11.7.0; Python 3.14.7 available for existing Stripe E2E.
- No new runtime dependencies, no new LLM dependency, no hosted backend in this sprint.
- Product UI/copy: English. Planning and founder handoff: Russian.
- Preserve current dirty worktree; no reset, checkout-overwrite, bulk old-branch transplant or deployment from it.
- Read modern `AGENTS.md`, positioning/claims/progress and task brief before implementation. Do not edit protected claim/positioning/progress ledgers or `reports/**`.
- Changes under `packages/` invalidate applicability of previous qualified-tree evidence to this new build; disclose this, do not promote historic qualification to a fresh release claim.
- No secret printing, no production test writes, no automatic assessment, no automatic deployment/tag/npm publish.
- Review decisions are explicit; missing decisions never mean yes.
- Project gate: 0 = candidate passes scoped usable suite; 1 = candidate fails that suite; 2 = invalid setup/input; 3 = suite/evidence inadequate or stale. Quality preflight refusal happens before candidate contact.
- Snapshot checks are not transactions. MVP supports one writer/operator per project; simultaneous writes and full atomic consistency are unsupported.
- All public contacts covered by the scoped transplant use `erbol@rigorrun.xyz`; DNS/MX is not proof of inbox delivery.

## Review Focus

1. Unanswered/unknown/conflicting decisions: remain inferred or fail validation, never default yes — Tasks 1 and 4.
2. Mutation during generation/assessment/run: reject stale promotion, retain historical evidence/baseline — Task 2.
3. Missing/stale/NaN assessment or failed harmless control: exit 3 before candidate contact — Task 3.
4. Switching/reload/deep link: keep the selected domain, discard foreign artefacts, require actual consent — Tasks 4 and 5.
5. Overbroad credential through real HTTP/MCP: default good/bad gates 0/1 with state/access/outbox evidence, not pair-demo status — Task 6.

---

## Execution layout and ownership

All implementation paths below refer to the pinned modern baseline, **not** the old current checkout. The original proposal/checklists below are retained as the planning record. Execution, approved scope corrections, actual verification and final independent review are recorded in [MVP_DELIVERY.md](../../product/MVP_DELIVERY.md) and [MVP_RUNBOOK.md](../../product/MVP_RUNBOOK.md); all six tasks and the optional workflow selector were completed.

| Owner       | Exclusive writes                                                                                                                                                          | Deliverable / budget                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Coordinator | New task brief/runbook, `apps/site/src/site.ts`, `apps/site/src/pages/index.astro`, `apps/site/src/layouts/Base.astro`, `scripts/check-contact.mjs`, `e2e/site.spec.ts`   | Baseline, scoped positioning/email transplant, reviews, integration; ~55 min spread across sprint |
| Core agent  | `packages/daemon/src/{service,suiteIntegrity,index}.ts`, `packages/cli/src/{commands,project}.ts`; own new tests and related current unit tests                           | Tasks 1–3; target 95 min + 10 min reserve; shared service file has one owner                      |
| UI agent    | `apps/app/src/demo/{DemoPage,useDemo,steps,route}.tsx/.ts`, `apps/app/src/product/stages.tsx`, `e2e/{demo,demo-deep,domain-workflows}.spec.ts`, `e2e/support/journeys.ts` | Task 4 first (~55–70 min), Task 5 only after (~30–40 min)                                         |
| QA agent    | `packages/cli/test/helpdesk.e2e.test.ts`, `docs/product/MVP_RUNBOOK.md`                                                                                                   | Task 6 and runbook; ~60–90 min; read-only cross-review after implementation                       |

Use isolated worktrees/branches as required by the execution skills; root integrates completed scoped commits. Do not copy a shared `node_modules` tree blindly across different lockfiles. With 4 active slots, coordinator + three workers fit; independent reviewers reuse workers after their own tasks finish and never approve their own code.

### Preparation: safe modern baseline (0–15 minutes, coordinator)

- [ ] Read the modern `AGENTS.md` and required context completely; compare the current remote master pin with the planned pin. If it moved, inspect its delta before deciding to rebase this plan.
- [ ] Create an isolated integration worktree/branch at the pin via `superpowers:using-git-worktrees`. Keep `/home/erbol/RigorRun` dirty state intact. Transfer only these new plan/spec docs through scoped patches.
- [ ] Confirm dependencies and run `pnpm exec vitest run packages/env-helpdesk/test/cli.test.ts packages/cli/test/stripe.e2e.test.ts` on the modern worktree. Record failures/skips; Python skips are not acceptance.
- [ ] Create `docs/context/tasks/general-agent-mvp-2026-10-09.md` with this file allowlist, scope, exact baseline and acceptance commands. Resolve marketing wording against protected ledgers with founder/owner; do not edit those ledgers.
- [ ] Start workers with self-contained briefs. Set minute-90 and minute-120 scope checkpoints. Baseline failures consume budget and must be reported, not concealed as new-feature progress.

### Task 1: explicit review at the backend boundary (Core, target ~15 minutes)

**Files:** Modify `packages/cli/src/commands.ts:344` and `packages/daemon/src/service.ts:616`; create tests `packages/cli/test/generateReview.test.ts`, `packages/daemon/test/reviewDecisions.test.ts`; adjust old assertions in `packages/cli/test/cli.test.ts` only if they depended on silent approval.

**Interfaces:** Keep `cmdGenerate(contractPath: string | undefined, flags: Flags): Promise<number>` and `Service.review(projectId: string, decisions: { confirmedRuleIds?: string[]; rejectedRuleIds?: string[] }): Promise<EnvironmentContract>`. Reuse `applyReview` and `rulesAwaitingReview`; do not expose predicate editing or invent a new policy language.

- [ ] Write failing tests: inferred input to file generation throws `CliError` and creates no benchmark; already explicitly reviewed input still generates. Unknown IDs, duplicates within a decision array and IDs in both arrays are invalid; valid omissions remain inferred.
- [ ] Run `pnpm exec vitest run packages/cli/test/generateReview.test.ts packages/daemon/test/reviewDecisions.test.ts`; confirm failures correspond to the current default-confirm/validation gaps.
- [ ] Remove auto-confirm from `cmdGenerate`; direct the user to explicit project review or an already reviewed contract. Validate decision arrays before `applyReview`; retain rejected-rule semantics. A new CLI `review` command is out of this timebox.
- [ ] Rerun those tests plus `packages/cli/test/cli.test.ts`; expect PASS, with explicit setup errors preserving exit 2 at the CLI boundary.
- [ ] Self-review diff and make a scoped commit containing only this task's files; coordinator independently reviews before integration.

### Task 2: bind suites and long operations to their source (Core, ~45 minutes)

**Files:** Create `packages/daemon/src/suiteIntegrity.ts`, `packages/daemon/test/suiteIntegrity.test.ts`; modify `packages/daemon/src/service.ts` publication/run paths and `packages/daemon/src/index.ts`; update `packages/daemon/test/{stepChange,packProject,suiteQualityOnRun}.test.ts` where stricter stale handling changes expectations.

**Interfaces produced:**

```ts
export interface SuiteSource {
  version: 1;
  contractDigest: string;
  benchmarkDigest: string;
  configurationDigest: string;
  origin: 'generated' | 'pack';
  packId?: string;
}
export interface QualitySource { suite: SuiteSource; qualityDigest: string }
export class SuiteIntegrityError extends Error {
  constructor(kind: 'missing' | 'stale', message: string, runId?: string);
  readonly kind: 'missing' | 'stale';
  readonly runId?: string;
}
// Public Service methods; same signatures for CLI consumers in Task 3.
readCurrentSuite(projectId: string): Promise<{ benchmark: Benchmark; source: SuiteSource }>;
assertSuiteCurrent(projectId: string, source: SuiteSource): Promise<void>;
```

Persist private `suite-source` / `quality-source` artifacts through existing `ProjectStore` methods. Use `hashValue`; do not alter public Benchmark/RunResult schemas. `configurationDigest` hashes connector, readOnlyTools, verifierReads, reset, safety, schemaAnswers, goal, budgets and stored schema; excludes runs, agents and timings.

- [ ] Write failing tests named `review invalidates downstream but retains historical evidence`, `missing source refuses execution`, `configuration change invalidates suite`, `paused generation cannot publish after review`, `two Services detect a stale completed run` and `same contract with regenerated suite detects benchmark change`. Use existing `afterCase`/deferred execution and two Services sharing one temp store.
- [ ] Assert the central stale-run contract:

```ts
expect(staleError).toBeInstanceOf(SuiteIntegrityError);
expect(staleError.kind).toBe('stale');
expect(await store.readRun(projectId, staleError.runId)).toBeDefined();
expect((await store.read(projectId)).baselineRunId).toBe(previousBaseline);
expect((await store.read(projectId)).runs.map((r) => r.runId)).not.toContain(staleError.runId);
```

- [ ] Run `pnpm exec vitest run packages/daemon/test/suiteIntegrity.test.ts`; expect FAIL against current storage/publication behavior.
- [ ] Implement invalidation on compile/review and relevant configuration changes. Generation captures **stored input** contract/config digests before generator calls, checks them before publication, then persists a source over the full new benchmark. Do not compare the generator's internally modified `contractHash` as if it were the saved input contract.
- [ ] Use the same publication provenance for `installPackSuite` and incident-suite additions; remove quality/quality-source whenever the benchmark changes. Missing legacy provenance requires explicit regenerate/reinstall, never silent migration of trust.
- [ ] At run start read the current full suite/source; after writing immutable run evidence, validate source again before metadata/baseline promotion. Re-read current metadata when appending a valid run instead of spreading the startup project snapshot. A stale run keeps its evidence and throws `SuiteIntegrityError` with runId.
- [ ] Run `pnpm exec vitest run packages/daemon/test/suiteIntegrity.test.ts packages/daemon/test/stepChange.test.ts packages/daemon/test/packProject.test.ts packages/daemon/test/suiteQualityOnRun.test.ts`; expect PASS. Retain the explicit single-writer limitation: checkpoints are not a lock or transaction.
- [ ] Scoped commit; independent review verifies unchanged historical runs, source checks on all publication paths and no plaintext credential capture.

### Task 3: generated-suite quality prerequisite for project release gates (Core, ~35 minutes)

**Files:** Modify `packages/daemon/src/service.ts`, `packages/cli/src/project.ts`; create `packages/cli/test/gateQuality.test.ts`; update `packages/daemon/test/suiteQuality.test.ts`, `packages/cli/test/project.test.ts` where old weak-threshold PASS must no longer masquerade as release evidence.

**Interfaces:** Consume Task 2 methods/types. Produce `Service.gateReadiness(projectId: string): Promise<{ ready: boolean; reasons: string[]; source: SuiteSource | null }>`. Existing `assessSuite(projectId: string): Promise<BenchmarkQuality>` stays explicit; it captures source before assessment and validates it before writing quality + QualitySource. Invalid/stale assessments are never attached to a current run as current quality.

- [ ] Write failing tests for missing/stale assessment, false-positive rate > 0, failed `must_survive` control, unstable replay, leaked hidden answers, dead rules, kill rate < 1, missing/NaN required metrics, empty suite/defect controls, suite append and mutation during assessment. Assert every refusal has exit 3 and candidate request count 0; valid assessment proceeds to normal candidate scoring.
- [ ] Run `pnpm exec vitest run packages/cli/test/gateQuality.test.ts packages/daemon/test/suiteQuality.test.ts`; confirm current gate wrongly contacts the candidate or accepts inadequate quality.
- [ ] Implement exact conservative checks from spec §5. Generated assessment must match complete suite/config/contract digests and its own quality digest. Never invoke `assessSuite` from gate; tell the user it runs test writes and needs explicit consent.
- [ ] Limit the pack exception to currently installed bundled `helpdesk` and `stripe` sources matching the current connector and full hashes. An arbitrary `pack` string is not an assessment exemption. Keep these on their existing scoped evidence path; no general qualification claim.
- [ ] Preflight before `service.runAgent`; check source again before CLI accepts PASS. Convert known suite-integrity errors into exit 3 with JSON/human reasons; invalid input stays exit 2. Diagnostic `run` remains available with truthful assessment/limits. Do not advertise raw-file gate as the supported release path.
- [ ] Replace changed-build pack-quality wording with an honest bundled-suite description rather than claiming the modified tree was newly qualified. Preserve historic protected evidence untouched.
- [ ] Run new tests, daemon quality tests and both pack E2Es; expect no threshold overrides, no optional auto-assessment and no candidate contact on preflight refusal. Scoped commit after cross-review.

### Task 4: honest review and consent in app journeys (UI, P0, ~55–70 minutes)

**Files:** Modify `apps/app/src/demo/{useDemo.ts,steps.tsx,DemoPage.tsx}`, `apps/app/src/product/stages.tsx`, `e2e/demo.spec.ts`, `e2e/demo-deep.spec.ts`, `e2e/support/journeys.ts`.

**Interfaces:** Keep `useDemo(workflowKey: string = DEFAULT_WORKFLOW)`. Change its internal buildBenchmark input to `(draft: EnvironmentContract, confirmed: Set<string>, rejected: Set<string>)`; consume only explicitly chosen IDs. Add returned `confirmAll(): void` and pass `onConfirmAll: () => void` into ContractStep. Reuse existing project `api.review` / `api.generate`; no new backend endpoint.

- [ ] Write failing browser tests: inferred rules initially undecided; continue disabled with pending decisions; `Confirm all proposed rules` is deliberate; explicit rejection generates no enforcing checks; contradictory UI state cannot arise; a deep link/reload beyond review without stored consent returns to confirm instead of auto-approving. Selected workflow query must survive this redirect.
- [ ] Run `pnpm exec playwright test e2e/demo.spec.ts e2e/demo-deep.spec.ts --config e2e/playwright.config.ts`; identify expected default-yes failures before code changes.
- [ ] Set project decision state initially empty. Require decisions for awaiting-review rules, not a new decision for already observed facts. Show actual confirmed/observed enforcement counts and a pending count; remove «unanswered means yes». Disable only the relevant generation/selection controls while busy.
- [ ] Pass state.confirmed into demo review. Make mass confirmation explicit. Normal deep-link hydration may reconstruct trace/draft, but may not manufacture human approval; redirect later steps to review. Update journey helpers to perform deliberate review before opening evidence/visual targets, preserving their test purpose rather than weakening assertions.
- [ ] Rerun targeted browser tests; expect actual execution/evidence to remain, no reference promoted into candidate headline and no persisted implicit consent. Scoped commit after coordinator review.

### Task 5: expose existing non-payment examples (UI, P1, ~30–40 minutes)

**Files:** Create `apps/app/src/demo/route.ts`, `e2e/domain-workflows.spec.ts`; modify the Task 4 demo files only. Do not edit compiler/generator/environment fixtures to improve demo scores.

**Interfaces produced:** `demoRoute(hash: string): { workflowKey: string; step: Step }` and `demoHash(workflowKey: string, step: Step): string`. Preserve `#/demo/<step>` as refund default; new examples use `#/demo/<step>?workflow=invoice` or `access`. Unknown workflow -> refund at record. Use registration IDs for `VITE_OPS_URL/#/<registration.id>` links.

- [ ] Write failing journeys for refund/invoice/access selection, domain switch after a verdict, query-preserving navigation/reload, unknown-key fallback and correct demo-system link. Assert switched state contains no previous benchmark/result; browser reports contain the selected domain and synthetic label.
- [ ] Run `pnpm exec playwright test e2e/domain-workflows.spec.ts --config e2e/playwright.config.ts`; expect FAIL because current UI hardcodes refund.
- [ ] Add selector and keyed workflow child remount to discard prior hook state. Preserve selected key through setStep/redirect/reset. Route invoice/access to demo-ops, not old CRM. Display `Synthetic data · scripted agents · executed locally · not a qualified release suite` and explain that replay is bundled, not a recording of edits in the separate demo app.
- [ ] Run the new journeys plus existing demo journeys and `pnpm build:app`; expect PASS. Do not turn illustrative candidate/control results into universal reliability claims. Scoped commit; cut this whole task at minute 120 if P0 remains unfinished.

### Task 6: prove the non-payment black-box release path (QA, ~60–90 minutes)

**Files:** Create `packages/cli/test/helpdesk.e2e.test.ts`, `docs/product/MVP_RUNBOOK.md`. Read/reuse patterns from `packages/cli/test/stripe.e2e.test.ts` and `packages/env-helpdesk/test/cli.test.ts`; do not modify qualification harnesses or `reports/**`.

**Interfaces:** Exercise CLI subprocesses at the public boundary: `helpdesk init` → `agent add --black-box` → `gate --project --agent --report`. Use fresh temp store/twin and two HTTP scripted controls with scoped vs overbroad credentials. Controllers may use synthetic fixtures, but get no Benchmark assertions/expected verdict/reference plan. Label them qualification controls, not general-purpose LLM agents.

- [ ] Add regression assertions with exact exit codes: compliant control 0, defective control 1, invalid setup 2; use Task 3 tests for inadequate evidence 3. Check actual persisted system/access/outbox evidence in HTML and claim-vs-reality separation. No `--min-success 0`, `--min-policy 0` or increased unsafe allowance.
- [ ] Run the new test before final Core integration; it should reveal missing gate invariants if any. If existing modern code already passes the happy path, keep it as a regression proof rather than manufacture a red test.
- [ ] Complete the black-box fixture using existing local twin/MCP semantics; distinguish candidate gate result from the built-in two-agent `helpdesk try` command, whose overall exit 0 is not a pass for both agents.
- [ ] Run `pnpm exec vitest run packages/cli/test/helpdesk.e2e.test.ts packages/cli/test/stripe.e2e.test.ts packages/env-helpdesk/test/cli.test.ts`; require zero unexpected failures and no Python skips. Repeat Helpdesk to catch state leakage.
- [ ] Write runbook with actual commands/results from this build, fresh temp output paths, model-free repeatable demo, `pnpm start` for daemon-backed Projects versus `pnpm dev` for browser-only demo, explicit assessment-write warning and supported one-writer boundary. Any illustrative invoice/access quality limits stay visible.
- [ ] Cross-review Core/UI output read-only; report suspected defects to the owner. Scoped commit only test/runbook files, reviewed by coordinator.

### Coordinator: scoped offer and contact transplant (during parallel window, ≤25 minutes)

- [ ] In the pinned modern site, preserve replay/evidence widgets and caveats; change only hero/subtitle/CTA/metadata to spec §1. CTA pair: `See the demo` and `Discuss a paid pilot`. Explicitly distinguish bundled workflows today from custom integration work and future runtime capabilities.
- [ ] Set central CONTACT_EMAIL / SECURITY_EMAIL to `erbol@rigorrun.xyz`; update contact-check expectations and literal metadata in the allowlisted files. If contact literals live outside the brief allowlist, identify them and obtain scoped brief approval before editing; do not claim «everywhere» based on just a constant.
- [ ] Test source contacts and hero semantics in `e2e/site.spec.ts`; run `pnpm contact`, `pnpm claims`, `pnpm build:site` and the applicable local site test. MX checks do not validate message receipt.
- [ ] Make a scoped commit. No fake live pricing, account/cloud CTA or functioning subscription checkout. Public deployment is not an implementation-plan step.

## Integration and final acceptance (120–180 minutes)

- [ ] At minute 120, cut P1 and marketing embellishments before cutting safety. If generic quality/freshness support cannot pass, implement/test explicit generic project-gate refusal with exit 3; document diagnostics-only status. Integrate only independently passing Core commits, not an untested partial source migration. This fallback is a reduced bundled-pack preview, not completion of the full source-integrity P0 scope.
- [ ] Coordinator integrates scoped commits; independent worker reviews another owner's changes. Resolve regression failures with file owners, not parallel edits to `service.ts` or shared journey helpers.
- [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm domain`, `pnpm claims` and `pnpm test:examples` in the integrated worktree; expected exit 0. Run focused Task 1–6 Vitest/Playwright commands and `pnpm build:app`, `pnpm build:site`.
- [ ] Run `pnpm e2e:external` as a compatibility check for custom-system diagnostics; don't call a weak-threshold booking journey a passing generic release gate. If explicit-review changes reveal old assumptions, correct the test journey without weakening policy assertions.
- [ ] Repeat the Helpdesk default gate and export evidence; capture changed files, test counts, skipped tests, exact commit and unresolved limits in the runbook. If time permits run `pnpm verify`; lack of full verify/package-install/release qualification must remain explicit.
- [ ] Give founder a 3-minute demo script and a precise handoff: «what works», «what is illustrative», «what is blocked», «what is not built», «how to reproduce». No completion claim if P0 acceptance fails; no historic qualification claim for modified `packages/` tree.

## Next slice — not part of the three hours

1. Fix generic reference completion/idempotence/conditional-policy errors with dedicated compiler/generator tests; apply equivalent quality safeguards to raw-file gate before advertising it for releases.
2. Versioned immutable runs/suites with cross-process locking or transactions; reliable history rehydration and comparison UI; full pack project onboarding.
3. One real design-partner integration with explicit observable-state/reset assumptions and a paid pilot acceptance contract.
4. Only after repeated usage: hosted organisation/workflow workspace, saved histories, approvals, then subscription billing and plan limits. A paywall on existing MIT code alone is not the subscription value proposition.
