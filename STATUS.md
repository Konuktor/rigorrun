# RigorRun — build status

Live implementation checklist. Updated after every phase, against executed
commands rather than intent.

Verification gates (all must pass): `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `pnpm e2e`.

## Phase 0 — foundation ✅
- [x] pnpm workspace, TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [x] ESLint flat config + Prettier + Vitest
- [x] `pnpm install` exits 0 with no build scripts and no prompts
- [x] `.env.example` — every variable optional

## Phase 1 — core + Northstar ✅
- [x] Versioned Zod schemas: trace, contract, benchmark, run, assertions
- [x] Canonical JSON + SHA-256 over WebCrypto (browser, Node and Worker)
- [x] Redaction: credential fields, secret shapes, Luhn card numbers, URL params, headers
- [x] Structured logger that redacts its own payloads
- [x] Northstar engine: 17 scenarios, 12 tools, deterministic logical clock
- [x] Engine enforces integrity, **never** policy — verified by test

## Phase 2 — verifier, generator, scoring ✅
- [x] 14 assertion kinds + `orElse` (A OR B), each returning PASS/FAIL/ERROR with evidence
- [x] Path language with filters (`[amount>50 & approvalStatus!=approved]`)
- [x] Deterministic case generation, 17 cases across all 10 categories
- [x] $49 / $50 / $51 boundary triple
- [x] Wilson intervals verified against published reference values
- [x] pass@k, latency percentiles, threshold evaluation

## Phase 3 — agents + runner ✅
- [x] Agent A (baseline) — four realistic flaws, no case-id special-casing
- [x] Agent B (hardened)
- [x] HTTP adapter (documented protocol, SSRF guard, no redirects, size cap)
- [x] OpenAI-compatible / Groq / Gemini / Workers AI adapters
- [x] Runner: reset → seed → execute → observe → verify → score
- [x] Agent never receives its own assertions — asserted at runtime
- [x] Golden demo executes: A 76.5% / 5 unsafe, B 100% / 0 unsafe, verdict B

## Phase 5 — contract compiler ✅
- [x] Trace → contract with observed / inferred / needs-confirmation
- [x] Reads the stated $50 limit from captured page text and still files it as *inferred*
- [x] Every inference carries an open question
- [x] Approval promotes rules; rejection drops the rule *and* its assertion

## Remaining
- [ ] Phase 4 — dashboard + demo CRM
- [ ] Phase 6 — CLI + HTML report
- [ ] Phase 7 — Chrome recorder extension
- [ ] Phase 8 — Worker + D1 + free-tier deploy
- [ ] Phase 9 — security tests, docs, CI

## Test counts (last run)
```
12 files, 281 tests, all passing
lint clean · typecheck clean
```
