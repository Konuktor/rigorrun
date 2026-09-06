# STATUS — v2 Behavioral Verification

**Branch:** `feature/v2-behavioral-verification` · **Updated:** 6 September 2026
**Public release, untouched by this branch:** `rigorrun@0.1.1`, `latest`

> This file is written pessimistically on purpose. A status file that flatters the work is
> worth less than no status file, and in a product whose thesis is "do not trust what a
> system says about itself", it is a defect.

---

## CURRENT PHASE

**Phase 1 complete. Phase 2 vertical slice complete and proven on real
third-party servers. Stopped there deliberately.**

Phase 0 (falsification) is done and written up. Phase 2 is limited to the smallest real
F1 → F2 → F3 slice plus 3–5 real third-party servers. F4 and F6 are not being built.

---

## GATE STATUS

| Gate | Status | Basis |
|---|---|---|
| **Gate 0** — falsification | `GATE_0_NOT_DISPROVEN_BUT_BUYER_UNVALIDATED` | Check 1 positive from primary Microsoft documentation. Check 3a/3b positive. Checks 2 and 3c UNKNOWN, outreach written and unsent. Gate 0 fails only if 1 **and** 3 are both negative; 1 is positive, so it has not failed. See [GATE0_EVIDENCE.md](docs/GATE0_EVIDENCE.md). |
| **Gate 1** — clean machine → record, one command, no browser | **PASSED** | `pnpm gate1`. Builds the tarball, installs it into a directory that has never seen RigorRun with a `HOME` that did not exist, and runs `rigorrun verify npm:@modelcontextprotocol/server-memory@2026.8.31` with no browser reachable. Eight checks, all green. Machine runtime 12.5s; **human TTFRV remains UNMEASURED and no onboarding claim follows from this.** |
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
- **B6 removed.** The deployed-but-uncalled control plane is gone from the product,
  with the import-graph proof in the commit. The deployment itself is still up and needs
  authorization to tear down.
- **F9 confirmed.** `npx rigorrun` installs 0.1.1 from the public registry into a clean
  directory with a fresh `HOME`, runs, and `doctor` exits 0. `@rigorrun/agent-sdk` 404s,
  exactly as the documentation says. Decision: no SDK will be published — the v2 path
  needs none.
- **F1 container harness.** npm and directory references, digest pinned and verified
  before anything unpacks, host-side staging with lifecycle scripts disabled, an image
  with no `RUN` instruction, and a hardened container with no network, no mounts and no
  environment. Reset is measured rather than declared.
- **F2 exercise engine.** Schema-derived arguments with five safety classes and a fixed
  value table rather than a fuzzer.
- **F3 conformance.** Three-valued verdicts across `readOnlyHint`, `destructiveHint` and
  `idempotentHint`, with `permissionRelevant` on the two that drive automatic
  permissioning.
- **`rigorrun.record/1`.** Canonically serialized, re-hashable from the file on disk.
- **`rigorrun verify` and exit code 3.** No browser, no agent, no project.
- **Gate 1 proven from a packaged artifact**, not from unit tests.
- **Four real third-party servers verified.** 37 tools discovered, 19 exercised, 18 named
  as untested with reasons. All four launched, all four reset cleanly, all four held the
  read-only posture. See [THIRD_PARTY_VERIFICATION.md](docs/THIRD_PARTY_VERIFICATION.md).
- **A threat model**, written before F1 was called done, that leads with what the
  container does *not* do.

---

## IN PROGRESS

Nothing. The session stops at the end of the vertical slice, as planned. The next
increment is more third-party servers, gradually, per F12 — 5 → 20 → 100 → 300+ — fixing
systemic harness defects before each increase.

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

1. Widen to 20 third-party servers and measure launch rate, discovery rate, exercise
   coverage and the share that is fully verifiable. Publish the honest denominator.
2. Send the Gate 0 outreach. Checks 2 and 3c cannot be answered any other way, and
   until one is answered the buyer remains unvalidated.
3. Measure human TTFRV with a real subject who has not seen this repository.
4. `rigorrun diff <a> <b>` as a first-class command. The record comparison already
   works — the adversarial fixture pair is diffed in a test — but there is no command.
5. Server-provided read tools as a corroborating surface, which is written and specified
   but not yet wired into an exercise run.

---

## EVIDENCE

| Claim | Where it is proven |
|---|---|
| Gate 0 sources are primary and dated | [docs/GATE0_EVIDENCE.md](docs/GATE0_EVIDENCE.md) |
| F1–F12 / B1–B6 marks | [docs/V2_IMPLEMENTATION_AUDIT.md](docs/V2_IMPLEMENTATION_AUDIT.md) |
| No SDK is published, and no doc claims one is | `npm view @rigorrun/sdk` → 404; `docs/TYPESCRIPT_AGENT_SDK.md:3-8` |
| The control plane is dead in-product | Import graph in the audit, B6 section |
| v1 still works | `pnpm test` — 831 tests across 72 files, all passing |
| Gate 1 | `pnpm gate1` — eight checks from a packaged artifact in a fresh HOME |
| The harness catches a lying server | `packages/sandbox/test/adversarial.test.ts`, and `rigorrun verify dir:fixtures/external/mcp-attested-lookup` exits 1 |
| The container posture is what is claimed | `packages/sandbox/test/posture.test.ts`, asserted from the argv with no runtime needed |

---

## KNOWN LIMITATIONS

- **No external user has ever run this.** Tier 1 of the source-of-truth hierarchy is empty.
- **The container boundary is not a security guarantee.** Docker here is rootful; a
  container escape reaches the host. We do not claim to solve container escape. The
  boundary is recorded in every evidence record's `harness.caveats`, not only in prose.
- **A server's own read tools are the weakest surface** and may corroborate a
  `CONTRADICTED` verdict but never produce one — the server that might be lying is the one
  answering the read.
- **About half of a typical server's surface is reachable.** Measured: 19 of 37 tools
  across four real servers. `server-filesystem` is 2 of 14, because nine of its tools want
  a real path and the planner will not generate one. The remainder is itemised with
  reasons in every record's mandatory `untested` array rather than rounded away.
- **The four servers tested are one publisher's.** No `readOnlyHint: true` or
  `destructiveHint: false` was contradicted by any of them, and that is a fact about four
  well-maintained servers, not about the 18,000 in the registry.
- **Only npm and directory references work.** An OCI image, a git ref and a remote
  endpoint are refused rather than half-supported.
- **A server's own read tools are specified as a corroborating surface but are not yet
  wired into a run.** Today every observation comes from the container's filesystem.
- **Records are hashed, not signed.** No HMAC, Ed25519, sigstore or attestation exists yet;
  F5's signature is later work, and the record shape is designed so it is an addition
  rather than a reshape.
- **Evidence tiers `HUMAN` and `MODEL` remain unreachable** (B4), unchanged from v1.
- **Induction still over-produces** ~25% (B3), unchanged; off the v2 critical path.
