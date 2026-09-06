# V2 Implementation Audit

**Date:** 6 September 2026 · **Against:** `RigorRun_Product_Strategy_v2.md` (PRD v2.0)
**Public release at time of audit:** `rigorrun@0.1.1`, `dist-tags.latest = 0.1.1`
**Branch:** `feature/v2-behavioral-verification`

## How this file decides what is true

PRD §35's source-of-truth hierarchy, applied literally:

1. Observed behavior of real external users — *we have none; nothing in this file claims tier 1*
2. Public release behavior — checked against the live npm registry
3. Independent clean-room tests — `pnpm verify:package`, `pnpm e2e:external`
4. Current implementation — read at the file and line
5. Documentation
6. PRD claims

**The PRD is tier 6. It is product direction, not evidence that a capability exists.**
Where the PRD asserts a defect that the shipped 0.1.1 already fixed, this file records
**ALREADY RESOLVED** and the defect is not re-introduced. Where the PRD asserts a
capability the code does not have, this file records **MISSING**.

**Marks:** WORKING · PARTIAL · MISSING · ALREADY RESOLVED · BLOCKED BY GATE

---

## Summary

| Req | Title | Mark | Phase |
|---|---|---|---|
| F1 | Container harness | **WORKING** for npm and directory references | 2 — done |
| F2 | Tool exercise and behavioral contract | **WORKING** | 2 — done |
| F3 | Annotation conformance | **WORKING** | 2 — done |
| F4 | Drift detection | **PARTIAL** | **BLOCKED BY GATE 2** |
| F5 | Evidence record | **PARTIAL** — shape done, unsigned | 3 for the signature |
| F6 | Machine-readable tool policy | **MISSING** | **BLOCKED — needs integration partner** |
| F7 | Harbor export | **MISSING** | 2, after the record model is stable |
| F8 | Headless project lifecycle | **WORKING** for the v2 path | 1 — satisfied by `verify`, proven at Gate 1 |
| F9 | SDK distribution | **ALREADY RESOLVED** | 1 — verify only |
| F10 | Multi-source induction | **MISSING** | 3 |
| F11 | Agent-under-test mode | **WORKING** | shipped |
| F12 | Registry-scale scan | **MISSING** | 2, gradually |

| Defect | Mark |
|---|---|
| B1 | **ALREADY RESOLVED** |
| B2 | **PARTIAL** — narrower than the PRD states |
| B3 | **PARTIAL** — unchanged, correctly described |
| B4 | **PARTIAL** — unchanged, correctly described |
| B5 | **PARTIAL by design** — structural, disclosed, accepted |
| B6 | **REMOVED** from product code. The deployment is still live and needs authorization to tear down. |

**Zero external users. Zero npm downloads reported. Nothing in this file is tier-1
evidence.**

---

## F1 — Container harness *(P0)* — **MISSING**

**Implementation locations:** none. There is no `Dockerfile`, `docker-compose`,
`.devcontainer`, or `Containerfile` anywhere in the repository. The only occurrences of
"docker" are two prose mentions: `docs/COST_GUARDRAILS.md:46` ("No Kubernetes, no Redis,
no Docker requirement") and `docs/CI.md:74` (a snippet inside a customer's own CI
example). Every hit for "sandbox" is a variable holding an `mkdtemp` directory in a test.

**Tests:** none.

**Actual public behavior:** `rigorrun@0.1.1` never launches a container. It connects to a
system the operator already runs.

**What exists that F1 can be built on, rather than around:**

| Asset | Location | Why it matters |
|---|---|---|
| MCP client, transport-complete | `packages/mcp/src/client.ts` | Already spawns servers as child processes and tracks their pid. `StdioClientTransport` takes an arbitrary `command` + `args[]`, so it can be pointed at `docker` with no new transport. |
| The single spawn chokepoint | `packages/daemon/src/exec.ts` | `CommandProvenance` is a type no JSON schema can produce. `packages/cli/test/security.test.ts` asserts exactly one file spawns. |
| Orphan reaping | `packages/daemon/src/orphans.ts` | pid-reuse guard via `/proc/<pid>/cmdline`. |
| Strength labels from one struct | `packages/environment/src/capabilities.ts:72-79` | `EnvironmentCapabilities` is the sole input to both `verificationStrength()` and `isolationLevel()`. |
| Digest pinning, free | npm registry | `dist.integrity` returns an sha512 SRI per exact version. Verified live against `@modelcontextprotocol/server-memory@2026.8.31`. |

**Missing pieces:** reference resolution and digest pinning · tarball fetch with integrity
verification · host-side staging with lifecycle scripts disabled · image build · hardened
`docker run` · state surfaces inside the container · reset and the proof that reset works ·
container cleanup keyed on name/label.

**Dependencies:** a container runtime. Present on this machine: Docker 28.5.2 (apparmor,
seccomp, cgroupns), **rootful**; no Podman. The root-daemon boundary is documented, not
hidden — see `harness.caveats` in the record.

**Roadmap phase:** 2. Building now.

---

## F2 — Tool exercise and behavioral contract *(P0)* — **MISSING**

**Implementation locations:** the pieces exist for a different purpose. `discoverTools()`
(`packages/mcp/src/client.ts:230-246`) lists tools and reads `tool.annotations`;
`McpConnection.call()` (`:193-220`) invokes one. Benchmark *cases* are generated from an
induced contract (`packages/generator/`), which is the v1 direction: human demonstration →
contract → cases. **There is no path from a tool's input schema to an exercise plan.**

**Tests:** none for schema-derived exercise.

**Known trap, found during design and recorded here because it would have produced a
hollow demo:** `paramsFromInputSchema` (`packages/connector/src/jsonSchema.ts:117-131`)
returns `undefined` for `object` and `array`. Every write tool on the reference target
(`create_entities`, `create_relations`, `add_observations`, `open_nodes` — all array-typed)
would land in `unsupported[]` and go unexercised. F2 needs its own composite value
synthesizer; reusing `paramsFromInputSchema` alone would exercise nothing that mutates.

**Missing pieces:** argument planner with the five safety classes · per-case state
before/after capture against container surfaces · idempotence probe · contract fields
(`mutates_state`, `state_surfaces_touched`, `idempotent`, `side_effects`,
`error_behavior`) each carrying an `evidence_ref`.

**Dependencies:** F1.

**Roadmap phase:** 2. Building now.

---

## F3 — Annotation conformance *(P0)* — **PARTIAL**

This is the requirement the existing codebase is closest to satisfying, and the PRD
understates how much is already here.

**Implementation locations:** `packages/connector/src/risk.ts` is entirely about this.

- `ServerHints` (`:25-30`) models all four hints.
- `readServerHints()` (`:67-82`) reads `readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`.
- `RiskSource` (`:34-57`) already separates `'server-hint'` from `'observed'`.
- `isConfirmedReadOnly()` (`:122-127`) — **only `operator` or `observed` earns a yes; the
  server's own word never does.** This is PRD §21.8 already implemented.
- `detectMismatch()` (`:149-171`) — **already implements "declared readOnly, state
  changed".**
- Live mismatch recording during a demonstration: `packages/daemon/src/workspace.ts:408-433`.
- Annotation drift across reconnects: `packages/daemon/src/drift.ts:88-97` (`hint_changed`).

**Tests:** `packages/connector/test/risk.test.ts` and the daemon workspace tests.

**Actual public behavior:** in 0.1.1 a server that lies about `readOnlyHint` during a
recorded demonstration is caught and surfaced. It is caught against the *customer's*
system, not a server in our container, and only for tools the demonstration touched.

**Missing pieces — three precise gaps, not a rewrite:**

1. `detectMismatch()` is **binary**. Returning `undefined` conflates *conforms* with
   *could not tell*. The PRD requires three states: `CONFORMS` / `CONTRADICTED` /
   `UNDETERMINED`.
2. It covers `readOnlyHint` only. `destructiveHint` and `idempotentHint` are read but
   never checked against behavior.
3. No `permission_relevant` flag, and no machine-readable conformance output.

**Also missing: the `DECLARED` evidence class.** Design note recorded here because it is
a correctness decision, not a preference: `DECLARED` belongs in `VERIFICATION_SOURCES`
(`packages/core/src/assertion.ts:54`), whose docstring already orders sources by
descending confidence — `DECLARED` slots in below `MODEL` as the weakest thing in the
system. It must **not** go into `RULE_STATUSES` (`packages/core/src/environmentContract.ts:26`),
which is load-bearing for gating (`blockingRules()` :194, `quality.ts:155`,
`render.ts:293` all key on `observed || confirmed`); adding it there would let a server's
own annotation become release-blocking, which is the precise failure `isConfirmedReadOnly`
exists to prevent.

**Dependencies:** F1 and F2 for the observed half.

**Roadmap phase:** 2. Building now.

---

## F4 — Drift detection *(P0 in the PRD)* — **PARTIAL** · **BLOCKED BY GATE 2**

**Implementation locations:** two independent diff engines already exist.

- `packages/daemon/src/drift.ts` — compares two `tools/list` snapshots. `DriftKind`
  (`:26-34`): `tool_added`, `tool_removed`, `argument_added`, `argument_removed`,
  `argument_required`, `argument_optional`, `hint_changed`, `server_changed`. A `serious`
  flag decides what a person must look at. Persisted as `discovery.json`, compared on
  reconnect (`packages/daemon/src/service.ts:184-215`).
- `packages/daemon/src/compare.ts` — run-to-run regression diff, matched by `caseId`, with
  a `benchmarkHash` comparability guard (`:80-84`) that refuses to diff across different
  benchmarks.

**This covers three of the PRD's four drift layers already** — inventory, schema, and the
annotation half of `ANNOTATION_REGRESSION`. Missing: description-level byte comparison
(the `DESCRIPTION_CHANGED_SCHEMA_STABLE` rug-pull signature), behavioral drift against a
pinned digest, and `NEW_SIDE_EFFECT`.

**A limitation worth naming:** `compare.ts` is thinner than its own docstring. `outcome()`
(`:48-54`) compares exactly three fields — `taskSuccess`, `policyCompliant`,
`unsafeActions`. The header promises "here is the tool call that differs"; the
implementation does not compare tool calls, assertion results, `finalStateHash`, cost or
latency, all of which are already stored in `CaseResult`.

**Roadmap phase:** 3, behind **Gate 2**. Per the execution brief, reusable record-comparison
primitives needed by tests may be built now; hosted scheduling, email alerts, a watch
fleet, a paid Watch tier and continuous monitoring infrastructure **may not**. Only the
former is being built.

---

## F5 — Evidence record *(P1)* — **PARTIAL**

**Implementation locations:** `RunResult` (`packages/core/src/run.ts:130-167`) is a
versioned, hashed, deterministic artifact today. Canonical serialization already exists:
`canonicalJson()` (`packages/core/src/hash.ts:13-15`) sorts keys at every depth, drops
`undefined`, and normalizes dates; `hashValue()` yields `sha256:<hex>`. `resultHash` is
computed over the result with the hash field blanked — the exact pattern a signature would
follow.

**Missing pieces:** the `rigorrun.record/1` schema itself · target reference and digest ·
harness identity · seed definition · conformance table · explicit untested surface ·
**signing** (there is no HMAC, Ed25519, sigstore or attestation anywhere — integrity today
is hash-only).

**Being built now:** the record *shape*, so that F5's signing is later an addition rather
than a reshape. PRD §36.1 depends on this being right early.

**Roadmap phase:** shape now, signature in phase 3.

---

## F6 — Machine-readable tool policy *(P1)* — **MISSING** · **BLOCKED**

Not built, deliberately. The PRD (§F6, §29 Phase 4) requires a confirmed integration
partner first, and Gate 0 check 3c did not produce one — no gateway or registry operator
has spoken to us. Inventing a policy format in isolation and hoping someone adopts it is
the failure mode this gate exists to prevent.

Internal typed findings are being kept generic enough to support policy generation later.
Nothing is being productized.

**Unblocks on:** a named integration partner from Gate 0 check 3 or Gate 2.

---

## F7 — Harbor export *(P1)* — **MISSING**

Not built yet, and deliberately sequenced after the record model stabilizes. Per the
execution brief, RigorRun's core must not be coupled to Harbor: the core object is the
RigorRun Verification Record, and Harbor is an adapter over it. Acceptance is that an
exported task runs unmodified under the current Harbor runner — a JSON file that merely
resembles the format does not count.

**Roadmap phase:** 2, after F5's record shape is stable.

---

## F8 — Headless project lifecycle *(P0, PRD says fixes B2)* — **PARTIAL**

**The PRD overstates this defect.** Most of the CLI is already headless.

**Already headless, no browser, no external server** (`packages/cli/src/main.ts:146-224`):
`demo`, `compile`, `generate`, `run <file>`, `compare`, `gate <file>`, `report`, `agents`,
`workflows`, `environments`, `inspect-environment`, `privacy inspect`, `projects`,
`secrets`, `backup`, `restore`, `export-project`, `import-project`, `trust`,
`compare-runs`, `feedback export`, `doctor`. `run --project` and `gate --project`
construct their own in-process proxy and service (`packages/cli/src/project.ts:27-37`)
and need no external server.

**Genuinely UI-only:** creating a project, connecting a system, teaching a job, reviewing
the induced contract, generating the suite, connecting an agent. These live behind the
runner's HTTP API (`packages/daemon/src/server.ts:253,322,362-377,399,403,411,425`) and
there is no `createProject` anywhere in `packages/cli/src`.

**The consequence for v2 is the important part.** The v2 critical path —
`rigorrun verify <server-ref>` — **never creates a v1 project.** It resolves a reference,
launches a container, exercises tools and writes a record. F8's acceptance criterion
("a clean machine reaches a first verification record with one command and no browser")
is therefore satisfied by building `verify`, **not** by porting the v1 teach flow to the
CLI. That removes most of the work the PRD assumes under this heading.

Porting the v1 teach flow remains a real want for F11 users (`docs/ROADMAP.md:177-179`
proposes `rigorrun project import` from a description file). It is not on the v2 critical
path and is not being built now.

**Roadmap phase:** 1, via `verify`.

---

## F9 — SDK distribution *(P0, PRD says fixes B1)* — **ALREADY RESOLVED**

**The PRD is out of date here.** It describes the state before the 0.1.1 remediation.

**Evidence, tier 2 (public release behavior):** `npm view rigorrun` returns versions
`0.1.0` and `0.1.1`, `dist-tags.latest = 0.1.1`, `bin.rigorrun = bin/rigorrun.mjs`.
`npm view @rigorrun/sdk` returns **404**; no `@rigorrun/*` scope exists on npm.

**Evidence, tier 5 (documentation):** `docs/TYPESCRIPT_AGENT_SDK.md:3-8` now opens with:

> **Not yet published.** `@rigorrun/agent-sdk` is not on npm today, so the `import` below
> resolves only inside this repository. You do **not** need it: the agent protocol is plain
> HTTP with an MCP endpoint, and implementing it directly is about ten lines.

A grep for `npm i @rigorrun` / `npm install @rigorrun` / `pnpm add @rigorrun` across
`README.md`, `docs/` and `sdk/` returns hits only inside `docs/V1_GAP_AUDIT.md:55` and
`docs/AUDIT_REMEDIATION_0.1.1.md:71` — both of which are *quoting the historical defect*,
which is correct and should stay.

F9's acceptance criterion is *"anything not published is removed from the documentation
the same day."* **That is met.**

**The remaining F9 decision — does v2 need a public SDK at all?** No. The v2 primary path
is `npx rigorrun verify <server-ref>`; it requires no SDK, no agent and no library import.
`docs/AUDIT_REMEDIATION_0.1.1.md:234-236` already reached the same conclusion for 0.1.1
("a second public package in a trust release is more surface than the honest-copy fix").
**Decision: do not publish an SDK.** Per the execution brief — do not publish packages
merely because they exist.

**Remaining work:** re-verify every documented install command from a clean directory
outside the monorepo, and keep it verified. Nothing to fix.

---

## F10 — Multi-source induction *(P1, fixes B3)* — **MISSING**

Induction runs from a single recording (`packages/compiler/src/induce.ts`). The ~25%
discarded-rule rate at human review is unchanged and correctly described by the PRD.
Not on the v2 critical path — v2's contract comes from *executing tools*, not from
inducing rules from a demonstration.

**Roadmap phase:** 3.

---

## F11 — Agent-under-test mode *(P1, retained from v1.0)* — **WORKING**

The shipped product. Preserved in full; this is the capability the execution brief
requires not be destroyed.

**Implementation:** MCP stdio and Streamable HTTP with OAuth (`packages/mcp/`), external
HTTP and command-line agents (`packages/agents/`, `fixtures/external/`), state-derived
verification (`packages/runner/src/run.ts`), run comparison
(`packages/daemon/src/compare.ts`), CLI gate (`packages/cli/src/commands.ts:319`),
local-first secrets (`packages/daemon/src/secrets.ts`), production write guard
(`packages/runner/src/run.ts:182-215`), DNS-rebinding and Host protection
(`packages/proxy/src/server.ts:51-59,135-139`).

**Tests:** 65 vitest files; `e2e/external-user.spec.ts` drives a stranger's journey end to
end against real third-party MCP servers and runs against **either** sources or the
packaged tarball via `RIGORRUN_BIN`; `pnpm verify:package` re-runs it against the
installed artifact.

**Acceptance criterion — "works unchanged for MCP, HTTP, and command-line agents;
connection asserted only after a real probe" — is met today and must stay met.** Every
change on this branch is gated on the v1 suites staying green. v1 users are not forced
through the container workflow.

---

## F12 — Registry-scale scan *(P2)* — **MISSING**

Not built. Per the execution brief, scale is approached gradually — 5 → 20 → 100 → 300+ —
fixing systemic harness defects before each increase. The aggregate report is generated
**from records**, never hand-entered, and no server is labelled "malicious" on the basis
of unexpected behavior.

**Roadmap phase:** 2, starting at 3–5 servers.

---

## B1 — SDK packages private, documentation promises an install — **ALREADY RESOLVED**

See F9. The install claim was removed in the 0.1.1 remediation rather than papered over by
publishing a new package. All 22 non-CLI workspace packages remain `private: true`, which
is now **correct and intentional**: `packages/cli/build.mjs` esbuild-inlines every
`@rigorrun/*` package into a single `dist/rigorrun.mjs`, so they are implementation detail,
not undelivered product.

**Do not re-fix. Do not publish to satisfy the old architecture.**

---

## B2 — Environment connection and recording require the browser — **PARTIAL**

Real but narrower than stated. See F8. Running, gating and comparing — the half CI needs —
are already headless. Connect and teach are UI-only, and are **off the v2 critical path**.

---

## B3 — Contract induction from a single recording — **PARTIAL**

Unchanged and correctly described. ~25% of proposed rules discarded at review. Off the v2
critical path. See F10.

---

## B4 — Three of five evidence tiers unreachable — **PARTIAL**

Correctly described. `VERIFICATION_SOURCES` (`packages/core/src/assertion.ts:54-56`)
declares `STATE`, `EVENT`, `OUTPUT`, `HUMAN`, `MODEL`; only `STATE` and `EVENT` are ever
emitted, as `docs/V1_GAP_AUDIT.md:90` states publicly.

**v2 adds a sixth, in the other direction.** `DECLARED` sits *below* `MODEL` — the weakest
class in the system, a claim the system under test made about itself. It is being added
because the honest thing to do with an unverified server assertion is to name it, not to
promote it. A `DECLARED` source may never be blocking, and that is asserted by a test.

---

## B5 — Browser verification cannot self-authenticate, capped at OBSERVATIONAL — **PARTIAL by design**

Structural, disclosed, accepted. `packages/env-browser/src/connection.ts:62-73` sets
`canReadState = false` unless an MCP or OpenAPI verifier is attached. Unchanged by v2.

The same doctrine is being carried into the container harness: a server's own read tools
are the weakest surface, and the rule is absolute — **they may corroborate a
`CONTRADICTED` verdict but may never produce one**, because the server that might be lying
about `readOnlyHint` is the same server answering the read. `packages/connector/src/types.ts:78-96`
already argues this for browsers; the container harness cites it rather than re-deriving it.

---

## B6 — Cloud sync exists only as undeployed code — **CONFIRMED DEAD, but the PRD's description is factually wrong**

**The code is not undeployed. It is deployed and live.**

Verified 2026-09-06: `GET https://rigorrun.takhiroverbol.workers.dev/api/health` returns
`200` with `{"ok":true,"service":"rigorrun-control-plane","env":"production", …}`.

**What exists:** `apps/worker/` — a Cloudflare Worker + D1 control plane, ~386 lines
across 10 routes, `wrangler.toml` with a real `database_id`, one migration
(`migrations/0001_init.sql`, 7 tables) which is the only SQL in the repository, and 23
tests that run inside `pnpm test` via a `node:sqlite` D1 shim. Plus
`packages/providers/src/workersai.ts`, a Workers AI provider with **no caller anywhere**
and no `AI` binding declared, so it could never run.

**Proof it is dead in-product:**

1. `apps/worker` is `private: true` and nothing imports `@rigorrun/worker`. The only
   references are two root scripts, `build:worker` and `deploy:worker`.
2. The dependency arrow points the other way — `apps/worker` depends on `@rigorrun/core`.
3. `@rigorrun/worker` is **not** among `packages/cli`'s 17 workspace devDependencies.
4. Grepping the built `packages/cli/dist/rigorrun.mjs` and `packages/cli/ui/assets/*` for
   `control-plane`, `workers.dev`, `api/workspaces`, `Workers AI` and `d1_databases`
   returns **zero hits in every case**. The Workers AI provider is tree-shaken out despite
   being re-exported from the providers barrel.
5. No CLI command touches it — there is no `sync`, `push`, `login` or `publish` command.
6. `RIGORRUN_API_URL` appears only as a commented line in `.env.example` and in
   `docs/FREE_DEPLOYMENT.md:81`. No `.ts` file under `packages/` or `apps/web/` reads it.
7. The only callers in the whole repository are two Playwright production suites,
   `e2e/api.spec.ts` and one block of `e2e/smoke.spec.ts`.

**Disposition:** delete from active product code, in its own commit, with the import graph
above as the proof. Recoverable from git history. Nothing shipped changes.

**Flagged and deliberately NOT done:** deleting the source does not stop the deployment.
The Worker and its D1 database remain live. Tearing them down is an outward-facing action
against a real account and is reported for authorization, not performed.

---

## Cross-document contradictions found, and their disposition

| Contradiction | Truth | Action |
|---|---|---|
| `STATUS.md:15` says npm serves `0.1.0` | The registry serves `0.1.1` as `latest` | Fix |
| `docs/AUDIT_REMEDIATION_0.1.1.md:229-233` says 0.1.1 is "prepared but not published" | It is published | Fix |
| Test counts: `STATUS.md:52` = 778/64 files · `AUDIT_REMEDIATION:152` = 785 · `docs/TESTING.md:33` = 406/21 files | 65 vitest files | Fix, and state the counting method |
| `docs/ROADMAP.md:171` lists "Publish to npm" as next step #1; `:105` says it is done | Done | Fix |
| `docs/ROADMAP.md:185` lists "A Python agent SDK" as #5; `:70` says it is built | Built | Fix |
| `README.md` repository tree lists `packages/northstar/` | Now `apps/demo-crm`; 12 packages omitted | Fix |

In a product whose thesis is "do not trust what a system says about itself", a stale
self-description is a product defect. These are corrected on this branch.

---

## What this audit does not establish

- **No external user has run any of this.** Tier 1 of the source-of-truth hierarchy is
  empty and every mark above is tier 2 or below.
- **BUYER VALIDATION: UNCONFIRMED.** See [GATE0_EVIDENCE.md](GATE0_EVIDENCE.md).
- **HUMAN TTFRV: UNMEASURED.** See [TTFRV_PROTOCOL.md](TTFRV_PROTOCOL.md).


---

## Addendum — what was measured, 6 September 2026

Written after the vertical slice ran, so that the marks above are backed by a result
rather than by an intention.

### Against a real third-party server

`rigorrun verify npm:@modelcontextprotocol/server-memory@2026.8.31`

| | |
|---|---|
| Digest | `sha512-ljj/3S4aGjxdNSQWw6gucKKGnTLdBPWxzapyY/MT2tOVyZwvxChve…` from the registry, checked against the downloaded bytes before anything unpacked |
| Server | `memory-server` 0.6.3 |
| Tools discovered | 9 |
| Tools exercised | 5 |
| Conformance | 13 CONFORMS · 0 CONTRADICTED · 0 UNDETERMINED |
| Untested | 4 — three declared destructive and believed, one discovered to need a fixture by trying it |
| Verification strength | `PARTIAL` — complete over durable state, blind to process memory |
| Isolation | `RESET`, **measured**: two independent resets produced identical state digests |
| Read-only posture | held; the container layer stayed empty |
| Egress | none |
| Exit | 0 |

### Against a server that lies

`rigorrun verify dir:fixtures/external/mcp-attested-lookup` — a fixture whose
`lookup_user` is annotated `readOnlyHint: true` and appends to an audit file.

```
lookup_user  readOnlyHint: true    CONTRADICTED   permission-relevant
             wrote /work/target/audit.log
lookup_user  idempotentHint: true  CONTRADICTED
list_users   all three claims      CONFORMS
```

Exit 1. The truthful tool in the same server comes back clean, which is what
distinguishes a verifier from something that flags everything.

**The argument for the whole container harness, as a measurement:** `audit.log` is
invisible to `list_users`. A verifier reading state only through the server's own tools
would have seen nothing and reported the server as conforming.

### Two records, diffed

Version B of the same fixture — same tool name, same schema, same annotations, same
description — adds one write.

```
declared identical : True
description same   : True
A wrote            : ['audit.log']
B wrote            : ['audit.log', 'last-seen.json']
NEW SIDE EFFECT    : ['last-seen.json']
```

That is the drift primitive working. Continuous watching is **not** built; it is behind
Gate 2.

### Four defects the harness found in itself

Recorded because a trust product that hides its own near-misses is not one.

1. **`cp -a` needs `CAP_CHOWN`**, which is dropped, so the entrypoint died before the
   server started. Now `cp -R`, with the tree pre-owned by the unprivileged user.
2. **A false accusation.** `add_observations` was reported as contradicting
   `readOnlyHint: false` when it had simply refused generated arguments and changed
   nothing. Now an errored call with an empty delta is `NEEDS_FIXTURE` — discovered by
   attempting, not guessed.
3. **Untested tools inflated the undetermined count**, so declining to touch three
   destructive tools made a clean run look inconclusive. A tool that was never called now
   produces no verdicts at all; it appears only in `untested`.
4. **Two different fixtures had the same digest.** `dir:` targets were identified by their
   dependency closure rather than their own bytes, so a server's identity did not change
   when its code did. That is the one promise the record makes, and it was broken. Now a
   content digest over the source.

A fifth was found by Gate 1 rather than by a test: **`pnpm pack` runs pnpm's builtin, not
the script of the same name**, so the gate was testing a stale tarball. Gate 1 failed,
correctly, and the script now uses `pnpm run pack`.

### Gate 1

`pnpm gate1` — packaged tarball, a directory that had never seen RigorRun, a `HOME` that
did not exist, no browser reachable. Eight checks green. Machine runtime 12.5s.

**HUMAN TTFRV: UNMEASURED.** No onboarding-time claim follows from the number above.

### Tests

841 across 73 files, all passing. 66 of them are new: exec 5, record 9, conformance 29,
sandbox 26 (posture, references and surfaces, all without a container runtime), and 10
adversarial tests that need one and skip cleanly without it.
