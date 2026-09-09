# Product reality audit

**Written 10 September 2026**, against `rigorrun@0.1.1` as published, the
deployed site, and the repository at `93e0b8c`. Every finding below was checked
by running something. Where a claim is marked false, the command that showed it
is in the row.

This replaces an earlier audit of the same name written on 6 September. That one
answered "what could an external person do?"; this one asks "what does this
product claim, and which of those claims survive contact with a measurement?"

---

## Executive verdict

**The product is more honest than its website, and its best capability had never
shipped.**

The expected finding — a thin product behind a polished site — is not what is
here. The engine is real, genuinely domain-generic (there is a build check that
fails if a business noun reaches the compiler, generator, verifier or runner),
and the npm README and `V1_GAP_AUDIT.md` are more candid than most shipping
products. Three separate things were wrong instead:

1. **`rigorrun verify` existed, worked, and was invisible.** One command
   verifies an arbitrary published MCP server against its own annotations — no
   project, no browser, no agent, no recording. It was on an unmerged branch, in
   no release, and on no page of the site.
2. **Three shipped behaviours were untrue**, in the specific sense that they
   asserted a check nobody ran or a fact that was not so.
3. **The site led with an invented CRM**, and its evidence page put five
   invented companies under the heading EVIDENCE.

A fourth thing is true and remains true: a control plane deleted from the code
is still deployed and publicly reachable.

---

## What the product actually is

Two capabilities, both real, in the order a stranger meets them.

**Connect a system, do the job once, test an agent against it.** A local runner
serves an interface. It connects an MCP server (stdio or streamable HTTP,
including OAuth), an HTTP API from an OpenAPI document, or a web application
through a browser. A person does one job through the system's own tools while
RigorRun reads the system before and after. It compiles rules from what changed,
asks about what structure could not settle, and — only for rules a human
confirms — generates an executable suite. An agent that speaks MCP connects
unchanged. The verdict is read back from the system, never from the agent's
prose, and is labelled with how strongly it was verified.

**Verify a server nobody wrote.** `rigorrun verify npm:<pkg>@<version>` resolves
the reference against the registry, takes the published sha512, refuses to
continue unless the downloaded bytes hash to it, installs with lifecycle scripts
disabled, builds an image with no `RUN` instruction, and runs the server with no
network, no mounts, no capabilities and no environment. It calls each tool with
arguments derived from its own schema and hashes the writable mounts before and
after. Isolation is measured by starting two containers and comparing, not read
off a config flag.

Everything else in the repository — five demo workflows, two demo apps, a Chrome
recorder extension, a Python SDK, nine Playwright suites — is input to those two
things or evidence about them.

---

## Claim → implementation → evidence

Verdicts: **PROVEN** (checked externally), **PARTIAL** (real, narrower than the
sentence), **DEMO-ONLY**, **BROKEN**, **MISLEADING**, **FIXED** (was one of the
last three, now is not).

| Claim | Where it was said | Code | Evidence | Verdict |
| --- | --- | --- | --- | --- |
| Connect your MCP server | site, README | `packages/mcp/src/client.ts` | Four published `@modelcontextprotocol` servers launched and verified; `pnpm test` third-party suites | **PROVEN** |
| Connect an OpenAPI API | README, GETTING_STARTED | `packages/env-openapi` | Integration tests; no write endpoint called during discovery | **PARTIAL** — `client_credentials` only |
| Connect a browser application | README | `packages/env-browser` | e2e | **PARTIAL** — a browser cannot verify itself; verdicts are `OBSERVATIONAL` and the type refuses to let it be its own verifier |
| OAuth works | V1_GAP_AUDIT | `packages/mcp/src/oauth.ts` | Against an AS that issues metadata, registers dynamically and checks PKCE | **PARTIAL** — the authorization URL is written to stderr, so a remote user must watch the terminal |
| Teach one workflow | site, README | `packages/daemon/src/workspace.ts` | `pnpm e2e:external`, reload mid-recording | **PROVEN** |
| Generate acceptance tests | site | `packages/generator` | Expected answers computed by hypothetical completion, not authored | **PROVEN** |
| Verify actual state | site, README | `packages/verifier` | Assertions read state and events; `INAPPLICABLE` never counts as a pass | **PROVEN** |
| Compare agent versions | README | `packages/daemon/src/compare.ts` | Refuses to interpret a diff across a changed suite, exit 2 | **PROVEN** |
| Gate CI | README, `--help` | `packages/cli/src/commands.ts` | Exit 0/1/2 | **FIXED** — see below |
| Credentials stay local | site, README, npm | OS keychain, no egress | Published bundle grepped: no control-plane URL | **PROVEN** |
| No hosted component | README, STATUS | — | True of the product; a deleted control plane is still deployed | **PARTIAL** — see Cloudflare |
| Confidence intervals alongside every rate | site | `packages/scoring/src/stats.ts` | Wilson intervals in CLI, report and demo verdict | **PROVEN** |
| Works with arbitrary MCP systems | site | — | 19 of 37 tools across four servers | **PARTIAL**, and the denominator is now published |
| A TypeScript SDK | README table | `packages/agent-sdk` | `npm view @rigorrun/agent-sdk` → 404 | **PARTIAL** — real, not installable, and no SDK will be published |

---

## What was untrue, and is no longer

Each of these was found by running the thing, not by reading it.

**The documented gate could not fail.** `--help` recommended
`rigorrun gate <benchmark> --agent reference`, and `rigorrun run` with no
`--agent` ran only the reference implementation and exited 0. The reference
replays the plan the expectation engine derived — it is handed the answer. So
the documented way to gate a build was a guaranteed pass.
*Now:* `run` requires an agent; `gate` refuses `reference` without
`--allow-reference`. Our own CI asks for it by name, because "is this suite
satisfiable at all" is the one honest use.

**Every report told its reader the records were fabricated.**
`packages/report/src/render.ts` emitted "*<environment>* is a synthetic demo
environment. Every record in it is fabricated." unconditionally — including a
report of a run against a customer's own system. A test asserted it.
*Now:* derived from the bundled registry, with a test on both branches.

**Isolation was printed but never measured.** `isolationLevel(caps)` returned
`RESET` — which means cases were *observed* to start from the same state —
whenever any reset was configured. Nothing had ever run the reset twice and
compared.
*Now:* `RESET` only where the reset is RigorRun's own machinery (an in-process
snapshot, a container we throw away). Where the operator nominated a tool, the
answer is `DECLARED`: believed, not observed. Six tests asserted the overclaim.

**`rigorrun record` printed a next step that errors.** It said
`Next: rigorrun compile <file>`; `compile` reads a canonical trace and the
recorder writes a workflow trace. Checked:
`error: … environmentId Invalid input: expected string, received undefined`.
*Now:* it says what the file is and what cannot be done with it.

**The demo miscounted itself in public.** Three agents ran; the progress UI was
sized for two. It rendered "66 of 44 case executions" with the bar at 150% and
`aria-valuenow` above `aria-valuemax`.
*Now:* 66 of 66, from the agents that actually ran.

**Every default-size button was unreadable.** `styles.css` defines both
`--text-secondary` (13px) and `--color-secondary` (#b4bdcb); Tailwind generates a
`text-secondary` utility for each and the colour won. `Button`'s default size set
a colour where the other sizes set a font size, so 29 buttons rendered at
**1.6:1** against a 4.5:1 gate. Invisible because none was on a page the a11y
gate covered.

**The evidence freshness gate could never pass and never ran.** It diffed the
whole of `proof.json`, three of whose fields are a clock, and was wired to
`branches: [main]` in a repository whose default branch is `master`. The page
drifted 13 commits behind HEAD under the sentence "every number below was
produced by running the real pipeline". (Regenerating at HEAD changed nothing but
the clocks — the numbers were right; only the stamp was stale.)

**Four documented facts were false.** `rigorrun.pages.dev` does not 301 to the
apex (it answers 200 with byte-identical content); `www.rigorrun.xyz` does not
resolve at all; `ALTALAB_SUBMISSION.md` advertised a "Control-plane API" that no
part of the product ever called; and `SECURITY.md` described a "baseline" agent
obeying a prompt injection and a "hardened" one resisting it — neither agent
exists, and on the generated injection case **all three shipped agents pass**.

---

## Synthetic, real, and the line between them

Classified as the brief asked. A synthetic example is fine when it is labelled.

| Thing | Class | Now |
| --- | --- | --- |
| `apps/demo-crm` (Northstar Support) | SYNTHETIC EXAMPLE | Kept. Labelled synthetic in its own banner and, now, on the site |
| `apps/demo-ops` (four schema-driven systems) | SYNTHETIC EXAMPLE | Kept, no longer linked from a page claiming to be evidence |
| The five bundled workflows | SYNTHETIC EXAMPLE | Kept. They are how the pipeline is exercised in CI |
| `/#/proof` — five invented companies under "EVIDENCE" | **MISLEADING PUBLIC SURFACE** | **Deleted.** Replaced by `/#/evidence` |
| `proof.json` | REAL EXAMPLE — real pipeline, invented inputs | Kept for the example's counts; freshness gate now works |
| `evidence.json` | REAL PRODUCT, external | New. Four published servers, regenerable |
| `fixtures/external/*` | TEST FIXTURE | Kept. Import nothing from RigorRun; one annotation is deliberately wrong, and says so |
| `.rigorrun/records/*` | REAL PRODUCT | Real verification records, gitignored |
| `packages/agents/src/http.ts` | DEAD CODE | Superseded by `daemon/src/httpAgent.ts` |
| `packages/env-mcp` | DEAD CODE | Re-export shim, imported only by a test |
| Cloudflare Worker + D1 | **DEPLOYED, SOURCE DELETED** | Still live. See `CLOUDFLARE_READINESS.md` |

The distinction the brief asked for, kept: **generated by the real pipeline** is
not **independently validated**. `proof.json` is the first. `evidence.json` is
the second, and it is the only public number on the site that involves software
nobody here wrote.

---

## Fresh-user findings

Measured by `scripts/gate1.mjs`, which packs the tarball, installs it into a
directory that has never seen RigorRun with a `HOME` that did not exist, and
runs it with no browser reachable.

- **Time to a real verdict, machine runtime: 14.9s.** One command.
- **Manual steps to a verification record: one.** `rigorrun verify npm:…`
- **Manual steps to an agent verdict: nine**, and all of them need a browser.
  Setting a project up is interface-only; running, gating and comparing are not.
- **Repository knowledge needed: none for `verify`.** For the agent path, none
  either — `pnpm e2e:external` drives it as a stranger, from the packaged
  artifact, with its own MCP server and its own agent process.
- **Human time-to-first-real-verdict: UNMEASURED.** Machine runtime is not it and
  is not reported as it. `docs/TTFRV_PROTOCOL.md` is the protocol; no subject has
  run it.

---

## Priorities

**P0 — prevented a stranger getting a real, trustworthy result. All fixed.**
The guaranteed-pass gate; the report calling real data fabricated; unmeasured
isolation reported as measured; `record` → `compile`; shipping `verify` at all;
the demo's public miscount.

**P1 — damaged trust. All fixed.** `/proof` framing; the freshness gate; version
drift across five constants; the four false documented facts; the 1.6:1 buttons;
missing OG/canonical metadata; a site with two links on it.

**P2 — not done, deliberately.** Induction over-produces (~25% of proposed rules
are discarded). Confidence numbers in the review UI are hardcoded priors, not
calibrated. Four of six `VerificationSource` tiers, two of three evaluators,
three of four state surfaces and about nine of fourteen assertion kinds are
declared but never produced. `clearEnvironments()` is global mutable state that
two projects in one process would contend for. LLM agent `costUsd` is always
null. None blocks a first real result; all are now in `V1_GAP_AUDIT.md`.

**Not now.** SDK publishing (decided against — the verify path needs none).
Multi-user, cloud sync, hosted console, billing: blocked behind the project's own
Gate 3, which is what that gate is for.

---

## Remaining limitations

- **No external user has ever run this.** Tier 1 of the evidence hierarchy is
  empty. Four servers from one publisher is our own scan, and our own scan is not
  a user.
- **About half a typical server's surface is reachable.** 19 of 37 measured. The
  rest is itemised with reasons in every record.
- **A verdict against a real system is `PARTIAL`, by design**, and isolation
  against one is `DECLARED` unless something measures it.
- **The container boundary is not a security guarantee.** Docker here is rootful;
  an escape reaches the host. Recorded in every record's `harness.caveats`.
- **`verify` needs Docker**, and supports only `npm:` and `dir:` references and
  stdio servers. An OCI image, a git ref and a remote endpoint are refused rather
  than half-supported.
- **Setting a project up is interface-only.** Running, gating and comparing are
  not, which is the half CI needs.
- **A control plane is deployed and unreferenced.** Teardown is written down and
  was not authorised in this pass.
