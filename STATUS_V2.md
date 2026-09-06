# STATUS — v2 Behavioral Verification

**Branch:** `feature/v2-behavioral-verification` · **Updated:** 6 September 2026
**Public release, untouched by this branch:** `rigorrun@0.1.1`, `latest`

> This file is written pessimistically on purpose. A status file that flatters the work is
> worth less than no status file, and in a product whose thesis is "do not trust what a
> system says about itself", it is a defect.

---

## CURRENT PHASE

**Phase 1 (unconditional blockers) complete; Phase 2 vertical slice in progress.**

Phase 0 (falsification) is done and written up. Phase 2 is limited to the smallest real
F1 → F2 → F3 slice plus 3–5 real third-party servers. F4 and F6 are not being built.

---

## GATE STATUS

| Gate | Status | Basis |
|---|---|---|
| **Gate 0** — falsification | `GATE_0_NOT_DISPROVEN_BUT_BUYER_UNVALIDATED` | Check 1 positive from primary Microsoft documentation. Check 3a/3b positive. Checks 2 and 3c UNKNOWN, outreach written and unsent. Gate 0 fails only if 1 **and** 3 are both negative; 1 is positive, so it has not failed. See [GATE0_EVIDENCE.md](docs/GATE0_EVIDENCE.md). |
| **Gate 1** — clean machine → record, one command, no browser | **IN PROGRESS** | Requires the `verify` command to exist. Proof must come from a packaged artifact in a fresh `HOME`, not from unit tests. |
| **Gate 2** — inbound from operators within 30 days of the registry report | **NOT STARTED** | Requires F12 and a published report. Blocks F4. |
| **Gate 3** — three independent orgs watching at day 30 | **NOT STARTED** | Blocks the paid tier, multi-user, billing, hosted console, hiring. |
| **Gate 4** — three organizations paying | **NOT STARTED** | — |

**BUYER VALIDATION: UNCONFIRMED.** No gateway operator, registry maintainer, certification
program or underwriter has spoken to us. Per PRD §32, tests, our own fixtures, our own
registry scan, stars, traffic and downloads do not count and are not counted.

**HUMAN TTFRV: UNMEASURED.** See [TTFRV_PROTOCOL.md](docs/TTFRV_PROTOCOL.md).

---

## COMPLETED

- **Phase 0 — falsification.** Four checks answered or honestly marked unknown, with exact
  source URLs and retrieval dates. Microsoft's certification page confirms evaluation
  evidence is invited, optional, and stated to accelerate review — and that submission is
  publisher-gated, which relocates the buyer to the publisher rather than the marketplace.
- **Reality reconciliation.** F1–F12 and B1–B6 mapped against the code, not the PRD. Three
  PRD claims corrected: B1 already resolved, B6 deployed rather than undeployed, B2
  narrower than stated.
- **Outreach written, not sent.** Exact messages for checks 2 and 3c, with a named target
  list. No response invented.
- **TTFRV protocol.** Manual stopwatch, with machine runtime recorded separately and
  explicitly barred from onboarding claims.

---

## IN PROGRESS

Phase 2 vertical slice — F1 container harness, F2 exercise engine, F3 conformance, and the
`rigorrun.record/1` evidence record.

---

## BLOCKED

| Item | Blocked by | Why the gate exists |
|---|---|---|
| **F4** continuous drift — hosted scheduling, alerting, watch fleet, paid tier | **Gate 2** | The buyer hypothesis is unproven. Reusable record-comparison primitives needed by tests are permitted; monitoring infrastructure is not. |
| **F6** machine-readable policy | A named integration partner | Gate 0 check 3c produced none. Inventing a policy format in isolation and hoping for adoption is the failure this gate prevents. |
| Billing · multi-user · hosted console · enterprise RBAC · fundraising · hiring | **Gate 3** | PRD §29, "Never before Gate 3". |
| Website repositioning to v2 claims | A working `npx rigorrun verify` against a real third-party server from a clean packaged build | The site currently describes shipped 0.1.1 and stays that way until the capability is real. |
| Tearing down the deployed Cloudflare Worker + D1 | **Explicit authorization** | Outward-facing action against a live account. The dead code is removed from the product; the deployment is reported, not touched. |
| npm publish of any v2 artifact | **Explicit authorization** | Nothing is published from this branch. `latest` is untouched. |

---

## NEXT

1. Extract the process-spawn chokepoint so a container check can reach it without a
   dependency cycle, keeping the "exactly one file spawns" invariant intact.
2. `rigorrun.record/1` schema in core, canonically serialized with the existing
   `canonicalJson`.
3. Widen `IsolationLevel` with `PARTIAL` and `VERIFICATION_SOURCES` with `DECLARED`, with
   backward-compatibility assertions for records already on disk.
4. Conformance engine — argument planner, judge, exit codes — testable with no container
   runtime present.
5. Adversarial fixtures A and B.
6. Container harness — resolve, fetch, verify digest, stage, build, run hardened.
7. `rigorrun verify` + exit code 3 + `doctor` container checks.
8. Gate 1 clean-room proof from the packaged tarball.
9. 3–5 real third-party servers.

---

## EVIDENCE

| Claim | Where it is proven |
|---|---|
| Gate 0 sources are primary and dated | [docs/GATE0_EVIDENCE.md](docs/GATE0_EVIDENCE.md) |
| F1–F12 / B1–B6 marks | [docs/V2_IMPLEMENTATION_AUDIT.md](docs/V2_IMPLEMENTATION_AUDIT.md) |
| No SDK is published, and no doc claims one is | `npm view @rigorrun/sdk` → 404; `docs/TYPESCRIPT_AGENT_SDK.md:3-8` |
| The control plane is dead in-product | Import graph in the audit, B6 section |
| v1 still works | `pnpm test`, `pnpm e2e:external`, `pnpm e2e:restart`, `pnpm verify:package` |

---

## KNOWN LIMITATIONS

- **No external user has ever run this.** Tier 1 of the source-of-truth hierarchy is empty.
- **The container boundary is not a security guarantee.** Docker here is rootful; a
  container escape reaches the host. We do not claim to solve container escape. The
  boundary is recorded in every evidence record's `harness.caveats`, not only in prose.
- **A server's own read tools are the weakest surface** and may corroborate a
  `CONTRADICTED` verdict but never produce one — the server that might be lying is the one
  answering the read.
- **Not every server is verifiable.** Servers needing credentials, live external APIs, or
  state we cannot seed are reported `UNDETERMINED` and listed in a mandatory `untested`
  array. The honest denominator is published rather than hidden.
- **Records are hashed, not signed.** No HMAC, Ed25519, sigstore or attestation exists yet;
  F5's signature is later work, and the record shape is designed so it is an addition
  rather than a reshape.
- **Evidence tiers `HUMAN` and `MODEL` remain unreachable** (B4), unchanged from v1.
- **Induction still over-produces** ~25% (B3), unchanged; off the v2 critical path.
