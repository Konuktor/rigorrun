# RigorRun — build status

Live implementation checklist, updated against executed commands rather than
intent.

**Gates (all green):** `pnpm lint` · `pnpm typecheck` · `pnpm test` ·
`pnpm build` · `pnpm e2e`

```
380 unit and integration tests   (17 files)
 13 end-to-end tests             (Playwright, incl. the real recorder extension)
lint clean · typecheck clean · all builds succeed
```

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

## Phase 8 — Worker + D1 ✅ (deployment blocked)
- [x] Hono API, guest workspaces, hashed tokens, per-workspace isolation
- [x] Migrations with indexes, bounded queries, retention and delete
- [x] Body caps and fixed-window rate limits
- [x] 23 tests against real SQL via Node's built-in SQLite
- [x] Verified locally on workerd with a real D1 (`wrangler dev`)
- [ ] **Not deployed.** The on-disk Cloudflare OAuth session has expired and
      cannot refresh non-interactively. One command unblocks it:
      `pnpm exec wrangler login` — see docs/FREE_DEPLOYMENT.md.

## Phase 9 — security, docs, CI ✅
- [x] Threat model with the test that holds each line
- [x] Security tests: no process-spawning API in the execution path, no `eval`,
      no schema field that could carry a command, no secret in source or bundles
- [x] README plus 11 documents
- [x] GitHub Actions: full verify job, plus a benchmark gate asserting the
      hardened agent exits 0 and the baseline agent exits 1

## Known gaps
Listed in full in `docs/ROADMAP.md`. The load-bearing ones: the environment is
synthetic, policy templates cover one workflow family, there is no
browser-driven execution lane, and no model-judged evaluator is implemented.
