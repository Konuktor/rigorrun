# RigorRun — build status

Live implementation checklist, updated against executed commands rather than
intent.

**One command:** `pnpm release:verify` (add `--prod` after deploying).

| Layer                         | Command           | Result                                         |
| ----------------------------- | ----------------- | ---------------------------------------------- |
| Design tokens                 | `pnpm contrast`   | 45/45 pairs meet WCAG contrast                 |
| Lint                          | `pnpm lint`       | clean                                          |
| Types                         | `pnpm typecheck`  | clean                                          |
| Unit + integration            | `pnpm test`       | 380 passing                                    |
| Build                         | `pnpm build`      | all apps, CLI and extension                    |
| Local E2E                     | `pnpm e2e`        | 16 passing (incl. the real recorder extension) |
| Accessibility                 | `pnpm a11y`       | 16 passing, zero WCAG A/AA violations          |
| Visual regression             | `pnpm visual`     | 14 baselines, desktop and mobile               |
| Cross-browser                 | `pnpm cross`      | 6 passing on Chromium and Firefox              |
| Production smoke              | `pnpm smoke:prod` | 5 passing                                      |
| Production API + system state | `pnpm api:prod`   | 10 tests                                       |
| Production journeys           | `pnpm e2e:prod`   | 87 passing at 1440 / 820 / 390                 |

## Phase 0 — foundation ✅

- [x] pnpm workspace, TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [x] ESLint flat config, Prettier, Vitest, Playwright
- [x] `pnpm install` exits 0, runs no package scripts, needs no prompts
- [x] `.env.example` — every variable optional and empty

## Phase 1 — core + Northstar ✅

- [x] Versioned Zod schemas: trace, contract, benchmark, run, assertions
- [x] Canonical-JSON SHA-256 over WebCrypto (browser, Node and Worker)
- [x] Redaction: credential fields, secret shapes, Luhn card numbers, URLs, headers
- [x] Selector ranking as a pure function, testable without a DOM
- [x] Structured logger that redacts its own payloads
- [x] Northstar engine: 17 scenarios, 12 tools, deterministic logical clock
- [x] Engine enforces integrity, **never** policy — asserted by test

## Phase 2 — verifier, generator, scoring ✅

- [x] 14 assertion kinds, `orElse` for "A OR B", PASS/FAIL/ERROR with evidence
- [x] Path language with filters (`[amount>50 & approvalStatus!=approved]`)
- [x] 17 cases across all 10 categories; $49 / $50 / $51 boundary
- [x] Expected outcomes computed from the policy, never hand-written
- [x] Wilson intervals checked against published reference values
- [x] pass@k, latency percentiles, thresholds, verdict

## Phase 3 — agents + runner ✅

- [x] Agent A (baseline) with four realistic flaws, no case-id special-casing
- [x] Agent B (hardened)
- [x] HTTP adapter (documented protocol, SSRF guard, no redirects, size cap)
- [x] Groq / Gemini / Workers AI / OpenAI-compatible providers
- [x] Runner: reset → seed → execute → observe → verify → score
- [x] Agent never receives its own assertions — asserted at runtime by a spy agent
- [x] Golden demo: A 76.5% / 5 unsafe, B 100% / 0 unsafe, verdict B

## Phase 4 — dashboard + demo CRM ✅

- [x] Landing page, five-step demo, live run, comparison, case matrix
- [x] Per-case evidence: timeline, agent claim, what changed, observed vs expected
- [x] `DETERMINISTIC` / `MODEL-JUDGED` / `HUMAN-REVIEW` rendered distinctly
- [x] Northstar CRM with stable test ids, policy banner, semantic observations
- [x] Verified in a real browser: no console errors, zero external requests

## Phase 5 — contract compiler ✅

- [x] Observed / inferred / needs-confirmation with an open question per inference
- [x] Reads the stated $50 limit from captured page text and still files it as inferred
- [x] Rejecting a rule drops its assertion and changes the generated benchmark

## Phase 6 — CLI + report ✅

- [x] demo · record · compile · generate · run · compare · gate · report · agents · doctor
- [x] Exit codes 0 / 1 / 2, with config errors distinguishable from failures
- [x] Path traversal refused; artefacts written under `.rigorrun/`
- [x] Self-contained HTML report, escaped, printable, with all three hashes
- [x] Publish sanitiser with a preview of exactly what would leave

## Phase 7 — recorder extension ✅

- [x] MV3 popup: start / pause / stop / counter / export / send to local runner
- [x] Sanitised semantic capture with ranked selector fallbacks
- [x] Loopback-only host permissions; cannot reach a remote host
- [x] Builds to `dist/rigorrun-extension/` and `dist/rigorrun-extension.zip`
- [x] Smoke-tested in a real browser; the recorded trace compiles into a contract

## Phase 8 — Worker + D1 ✅ (deployed)

- [x] Hono API, guest workspaces, hashed tokens, per-workspace isolation
- [x] Migrations with indexes, bounded queries, retention and delete
- [x] Body caps and fixed-window rate limits
- [x] 23 tests against real SQL via Node's built-in SQLite
- [x] Verified locally on workerd with a real D1 (`wrangler dev`)
- [x] **Deployed** to <https://rigorrun.takhiroverbol.workers.dev>, remote D1
      migrated, health / workspace creation / workflow round-trip / 401 all
      verified against the public URL

## Phase 9 — security, docs, CI ✅

- [x] Threat model with the test that holds each line
- [x] Security tests: no process-spawning API in the execution path, no `eval`,
      no schema field that could carry a command, no secret in source or bundles
- [x] README plus 11 documents
- [x] GitHub Actions: full verify job, plus a benchmark gate asserting the
      hardened agent exits 0 and the baseline agent exits 1

## Phase 10 — public launch ✅

- [x] Dashboard on Cloudflare Pages: <https://rigorrun.pages.dev>
- [x] Northstar Support on Cloudflare Pages: <https://rigorrun-crm.pages.dev>
- [x] Worker + D1 on Workers Free: <https://rigorrun.takhiroverbol.workers.dev>
- [x] 27 public QA tests against the live URL at 1440 / 820 / 390 px — landing,
      full demo pipeline, injection case both ways, evidence drawer, report
      export, no console errors, no failed requests
- [x] Landing copy pass; `docs/ALTALAB_SUBMISSION.md`;
      `docs/ALTALAB_DEMO_60S.md`; screenshots in `docs/submission-assets/`
      captured from the live site

## Phase 11 — product quality pass ✅

- [x] Audit of the deployed product across nine viewports → `docs/UX_AUDIT.md`
      (31 findings with severity, and how each was resolved)
- [x] Semantic design tokens derived from measured contrast, enforced by
      `scripts/check-contrast.mjs` in the release gate → `docs/DESIGN_SYSTEM.md`
- [x] Seven-step type scale replacing 15–18 ad-hoc combinations per screen
- [x] Accessible `Dialog`: role, accessible name, focus trap, focus return,
      scroll lock, Escape
- [x] Contract, verdict and evidence screens rebuilt around what they are for
- [x] Zero horizontal overflow at 360 / 390 / 430 / 768 / 820 / 1024 / 1280 /
      1440 / 1920
- [x] Four explicit test layers plus `pnpm release:verify` as the gate
- [x] Manual exploratory QA across five personas against production
- [x] Final gate green end to end: `pnpm release:verify --prod` — 12/12 stages,
      including 87 production journeys at three viewports and 10 live control
      plane / system state checks against the deployed Worker and D1

## Known gaps

Listed in full in `docs/ROADMAP.md`. The load-bearing ones: the environment is
synthetic, policy templates cover one workflow family, there is no
browser-driven execution lane, and no model-judged evaluator is implemented.
