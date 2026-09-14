# Final qualification — progress log

Append-only. Each entry records what was run, at which product commit, and what it showed. Nothing above an entry is edited after it is written; a correction is a new entry.

The plan, with the gate definitions decided with the user before any run, is summarised in `README.md`.

## 2026-09-14 — Phase 0: current state

- **Tree at start:** branch `redesign/brand-site-product`, HEAD `a9edbec98ea9056bf1b6a3773cc3fa9ba2692d01`, clean; 46 commits ahead of origin, never pushed. Package version 0.2.0. Raw captures: `evidence/env/phase0/`.
- **Pre-registered before any run (decided with the user):**
  1. GATE 4 is strict. A known-good frozen case must be TRUE_NEGATIVE under both rules on every attempt; a TIMED_OUT, ABSTAIN or HARNESS_FAILURE there fails the gate.
  2. IO-5 counts as observable, because the unrelated change is visible in the verifier's reads. The expected verdict is FAIL; a PASS fails GATE 7.
  3. IO-7 in the mixed-nomination configuration is gated. Both read orders must be FAIL; a PASS fails GATE 7.
  4. Evidence is committed locally at milestones. Nothing is pushed or published.
- **Full suite, first run (`evidence/phase0/test.log`):** 91 of 92 files passed; 1007 tests passed and 10 were skipped, of 1017.
  - **Failed file:** `packages/sandbox/test/adversarial.test.ts`. Its `beforeAll` stages a fixture with a host `npm install --ignore-scripts --prefix <temp tree>`, and that install did not finish inside the 600 s limit. Its 10 tests were skipped.
  - **Cause, from the install's npm debug log:** registry requests from this host timed out or were reset (`jose`, `hono`, `cross-spawn`, `pkce-challenge`, `eventsource`, `content-type`: ETIMEDOUT / ECONNRESET). Retries succeeded after 20–136 s each. While it hung, four TLS connections to the registry held unacknowledged data in the send queue.
  - **No damage:** the install wrote only to its temporary prefix. The repository has no new files and `node_modules` is unchanged.
  - **Previous durations of this file:** 23.4 s in `remediation/n1/evidence/full-test.log` and 20.8 s in `remediation/evidence/final-test.log`.
  - This is a host network condition, not a code change. The file is re-run once the registry answers normally; both runs are kept.
- **Typecheck (`evidence/phase0/typecheck.log`):** exit 0.
- **ESLint (`evidence/phase0/lint.log`):** exit 0 on the 74 TypeScript files under `packages/` and `apps/` changed since `07dda8c`.

## 2026-09-14 — Phase 1: product under test frozen

- **Record:** `product-under-test.json`, written by `scripts/product-under-test.mjs`, which also verifies it (`--check`).
- **Product commit:** `a9edbec98ea9056bf1b6a3773cc3fa9ba2692d01`.
  - The last commit that touched product sources is `69e6c33`.
  - Product sources are identical to `54f6e79`, where EH-WT-03 and Worktide v2 were measured.
  - They are not identical to AFTER-2's `0abf8ef`, so the frozen 58 must be re-run.
- **Product pathspec:** `packages apps fixtures package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json vitest.config.ts`. Evidence commits under `reports/` do not change it.
- **N-1 commits:** `0099670 f1ad841 69e6c33`, and the tests `bbb5f9e 8336fd3`, are all ancestors of the product commit.
- **Benchmark integrity:**
  - `freeze-baseline.mjs --check` reports "baseline manifest verified: 58 cases, 108 frozen files".
  - The manifest plans 152 attempts.
  - All 21 files hashed in `heldout-worktide-v2/freeze.json` verify.
- **Pinned targets:** all four clones are at their manifest commits (email-mcp, worktide-mcp, worktide backend, sqlite-mcp).
  - The email-mcp clone has a modified `src/drafts.json`. That is the server's own runtime draft store, and it was already modified in AFTER-2's recreate log.
  - The file is recorded and left untouched.
- **Scoring rules:**
  - `scripts/run-cases.py`, `remediation/scripts/run-cases-after.py`, `setup-after.py` and `recreate-stacks.sh` are committed, unmodified, and unchanged since AFTER-2.
  - `aggregate-after.mjs` changed after AFTER-2, through N-1's appended fields. It is not used to score this run: `scripts/aggregate-final.mjs` reads the classifications `run-cases-after.py` writes.

## 2026-09-14 — Phase 0: the failed file re-run

- **Registry check:** once the npm registry answered normally again, the six packages that had stalled (`jose`, `hono`, `eventsource`, `content-type`, `cross-spawn`, `pkce-challenge`) each returned HTTP 200 in under 0.7 s.
- **Re-run:** `packages/sandbox/test/adversarial.test.ts` was re-run alone (`evidence/phase0/test-rerun-adversarial.log`). 1 file passed, 10 of 10 tests, in 20.9 s, in line with its earlier durations.
- **Suite at the product commit:** 1017 of 1017 tests passed across the two runs. The first run's failure is kept in `evidence/phase0/test.log` and is not counted as a pass. The full suite is run again, in one piece, in Phase 8.

## 2026-09-14 — Phase 6 preparation: independent-oracle cases frozen before any ran

- **Fixture:** `scripts/io/`, Python standard library only; nothing is added to the product.
  - `taskdesk_server.py` is the connector the agent acts through: a read-write SQLite task store with fault switches.
  - `taskdesk_oracle_server.py` is the verifier: a separate process that opens the same file `mode=ro`.
  - `reset-taskdesk.sh` resets the store, and six scripted-agent playbooks drive the agent.
  - Four spec templates cover the independent, mixed-a, mixed-b and self-reported projects.
- **Smoke test before the freeze (servers only, no RigorRun, no case):**
  - both servers negotiate `2025-11-25` and list their tools;
  - `write_wrong_title` makes the connector report `Quarterly report` while the oracle reads `Quarterly repotr`;
  - `ack_without_write` reports success and adds no row;
  - the empty flag gives `{"tasks": []}`;
  - the down flag makes the oracle exit at startup, or on its next call without answering;
  - an unknown id gives `isError`.
- **Frozen:** `scripts/io/freeze.json` hashes the 15 files that define the cases (cases, expectations, playbooks, spec templates, servers, reset, runner), at HEAD `a9edbec`, before any case ran. `run-io.py` refuses to run when one differs.
