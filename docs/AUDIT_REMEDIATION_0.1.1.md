# Audit remediation — 0.1.1

A trust / product-truth remediation of the discrepancies found in
[`AUDIT_FIRST_PASS.md`](AUDIT_FIRST_PASS.md) (which is preserved unchanged as
historical evidence, alongside the claim matrix in
[`AUDIT_2026_09_06.md`](AUDIT_2026_09_06.md)).

No features were added. The core engine was not changed except one additive
security guard, which is covered by a new adversarial test. Objective: make what
RigorRun promises exactly equal to what it can prove.

Public `0.1.0` is immutable and remains on npm. The changes below are prepared
as **`0.1.1`**; the built tarball is `dist/rigorrun-0.1.1.tgz`.

---

## P1 — fixed completely

### P1-1 Verification strength must be obvious before installation

**BEFORE.** The public landing page never used the words AUTHORITATIVE /
PARTIAL / OBSERVATIONAL — a live grep of every rendered text artifact returned
zero hits. A stranger could not learn, before installing, that a verdict against
their own system is `PARTIAL` by design.

**CHANGE.**
- `apps/web/src/pages/Landing.tsx`: the primary verification panel ("Don't ask
  the agent if it succeeded") now carries the three-tier model inline, and the
  "Deterministic verification" card states that a verdict against a real system
  is PARTIAL by design and never a defect.
- `packages/cli/README.md` (the npm README): new "How strongly was it verified?"
  section immediately after the product explanation, with the exact wording, and
  that `AUTHORITATIVE` is claimed only where state access is genuinely
  authoritative.
- `README.md` (repo): new "How strongly was it verified?" subsection in the
  verification section.
- `apps/web/src/pages/Quickstart.tsx`: the verdict step now reads "yes,
  conditional or no — with how strongly each answer could be verified
  (AUTHORITATIVE, PARTIAL or OBSERVATIONAL)".

**AFTER.** Every primary surface states the model and that a normal connected
MCP server is PARTIAL, not defective.

**EVIDENCE.** Built bundle contains the strings (`grep -rl AUTHORITATIVE
apps/web/dist/assets/*.js` → hit; staged package `ui/assets` → hit). Wording is
the classification the audit verified live: a real MCP verdict was reported
`verification: PARTIAL`, the in-process demo `AUTHORITATIVE`, a browser
`OBSERVATIONAL`.

### P1-2 The broken TypeScript-SDK claim

**BEFORE.** Repo + npm README said an agent that does not speak MCP needs "ten
lines of SDK" / "ten lines of the agent SDK", implying an installable package.
`@rigorrun/agent-sdk` is `private:true` and resolves only inside the checkout.

**CHANGE.** The smallest honest solution — remove the install claim rather than
publish a new package in a trust release:
- `README.md`: "a small HTTP handler — about ten lines of plain HTTP, no package
  to install. See docs/HTTP_AGENT.md."
- `packages/cli/README.md`: "about ten lines of plain HTTP — there is no package
  to install; the protocol is documented at docs/HTTP_AGENT.md."
- `docs/GETTING_STARTED.md`: the SDK pointer now says the wrapper "is not yet
  published to npm, so implement the HTTP protocol directly for now."
- `docs/TYPESCRIPT_AGENT_SDK.md`: a prominent "**Not yet published**" banner —
  the `import` resolves only inside the repo; the protocol is plain HTTP.

**AFTER.** No public surface tells a stranger to install a package that is not
public. The genuinely-usable path (plain HTTP, and the standard-library Python
SDK) is what is advertised.

**EVIDENCE.** `grep -rn "npm i @rigorrun\|npm install @rigorrun"` across README,
npm README and GETTING_STARTED → none. The audit already proved an external
agent works over plain HTTP with only the public MCP SDK.

### P1-3 Benchmark richness / reset requirements

**BEFORE.** The landing card said agents run "from the same seeded state",
implying seeding is always available; nothing before onboarding said a system
without reset yields fewer cases / PARTIAL / isolation NONE.

**CHANGE.**
- `README.md`: new "What you get depends on what your system can do" paragraph
  in the start section — "RigorRun generates every case it can safely and
  reproducibly verify, and tells you what it could not test," and names the
  consequences of no reset.
- `packages/cli/README.md`: new "What it can build depends on your system"
  section with the same, plus "Best results: a staging or scratch environment
  with read-back and a reset."
- `apps/web/src/pages/Landing.tsx`: the "Vendor independent" card no longer
  implies seeding — "Where your system can be reset, every agent starts from the
  same state; where it cannot, RigorRun … reports isolation as NONE rather than
  pretending."
- `apps/web/src/pages/Quickstart.tsx`: "Before you start" now spells out fewer
  cases, repeated mutating cases off, isolation NONE, verification PARTIAL.

**AFTER.** The reset/richness reality is stated before onboarding, without
scaremongering — it explains *why*.

**EVIDENCE.** Re-verified live on 0.1.1 against the real (non-resettable)
knowledge-graph server: `benchmark cases: 1  notTestable=partial_state_read,
no_reset,no_seed,induced_schema`, run `verification: PARTIAL isolation: NONE` —
exactly what the copy now describes.

---

## P2 — fixed

### P2-1 Origin / Sec-Fetch-Site protection on state-changing local routes

**BEFORE.** State-changing `/api/*` routes relied on `SameSite=Strict` + the
Host allowlist. `SameSite` treats every `127.0.0.1:<port>` as same-site, so a
hostile page on another local port could, in principle, drive the runner with
the session cookie. No `Origin` / `Sec-Fetch-Site` check existed.

**CHANGE.** `packages/daemon/src/server.ts`: the `/api/*` middleware now refuses
any non-GET/HEAD/OPTIONS request a browser reports as not same-origin. It trusts
`Sec-Fetch-Site` when present (rejecting `same-site` and `cross-site`), and falls
back to an `Origin` that must match the runner's own host (`originMatchesHost`).
Non-browser callers (CI, bearer-key clients) send neither header and are
unaffected. Loopback-only binding, single-use pairing, and the Host allowlist /
DNS-rebinding defence are all preserved.

**AFTER.** The same-site-other-port CSRF vector is closed; the legitimate
same-origin UI and headless CI flows are unaffected.

**EVIDENCE.** New adversarial test `packages/daemon/test/csrf.test.ts` (7 tests,
all pass) and live re-test on the shipped 0.1.1 package:

| Request | Result |
|---|---|
| same-origin POST | 201 |
| `Sec-Fetch-Site: cross-site` POST | 403 |
| `Sec-Fetch-Site: same-site` POST (other local port) | **403** |
| wrong `Origin`, no `Sec-Fetch-Site` | 403 |
| CI client (no browser headers) | 201 |
| `Host: attacker.com` | 403 (unchanged) |
| SSRF agent → `169.254.169.254` | refused (unchanged) |
| GET | never blocked |

### P2-2 README/docs reconciliation

| Item | BEFORE | AFTER |
|---|---|---|
| Agent protocol example | README showed the deprecated `rigorrun/agent/1` drive-the-loop shape (`history`, `stepsRemaining`, `{action}`) | Replaced with the current `rigorrun/agent/2` hand-off-a-URL shape (`environment.mcpUrl`, `{status, output}`), matching what the daemon actually sends |
| `compare` CLI name | — | `compare-runs` is used in the npm README and CLI `--help`; the repo README's file-based `compare` is a real, distinct command and left as-is |
| CLI-driven setup | README implied a full CLI pipeline | Start section now states setup (connect + teach) is done in the interface; running/gating/comparing are on the CLI, which is the half CI needs |
| Cloudflare control plane | Implied a working, used data path | README now states plainly: "the current CLI and interface do not call it … off unless you stand it up yourself" |
| Evidence tiers | `DETERMINISTIC · MODEL-JUDGED · HUMAN-REVIEW` shown as available; "a model judge can be added" | Now: only `DETERMINISTIC` is emitted today; `MODEL-JUDGED` / `HUMAN-REVIEW` are "designed into the format but not emitted yet". Landing's model-judge line replaced with the strength tiers |
| Demo vs external-system capability | Blurred | The reset/richness copy (P1-3) separates the rich bundled example from what a real system yields |

**EVIDENCE.** `grep -n "rigorrun/agent/1"` in README → none. Landing no longer
claims an available model judge. All 785 unit/integration tests pass.

### P2-3 The unmeasured "ten minutes" onboarding claim

**BEFORE.** "In ten minutes" (README), "This takes about ten minutes"
(GETTING_STARTED), "About ten minutes" (Quickstart tag) — a quantitative
onboarding-time claim never measured on independent humans.

**CHANGE.** README heading → "Start with one command"; GETTING_STARTED → "It
starts with one command and runs on your machine"; Quickstart tag → "Start with
one command · Early Access · v0.1". The doc-table link text "The ten minutes, in
order." → "The setup, in order."

**AFTER.** No quantitative onboarding-time claim remains.

**EVIDENCE.** `grep -rn "ten minutes" README.md docs/GETTING_STARTED.md
apps/web/src/pages/Quickstart.tsx` → none.

---

## Preserved (verified still working on 0.1.1, second clean room)

Installed `dist/rigorrun-0.1.1.tgz` into a fresh HOME/cache/prefix and re-ran the
independent tests. All held:

| Capability | Result on 0.1.1 |
|---|---|
| Public MCP stdio interop (server-memory, from npm) | connect + 9 tools + full pipeline |
| Streamable HTTP MCP | (unchanged; verified 0.1.0, code path untouched) |
| OAuth discovery/DCR | (unchanged; verified 0.1.0, code path untouched) |
| State-derived verdict | naive/lying claim recorded, never scored; verdict from STATE |
| Untrusted MCP annotation semantics | (unchanged) |
| Inference confirmation | 0 cases before confirm; rule confirm/reject changes suite |
| Regression detection | badorder FAIL, `compare-runs` "1 case regressed", exit 1 |
| CLI 0/1/2 | `--version` 0; `gate` FAIL exit 1; nonexistent project exit 2 |
| Persistence (SIGKILL) | killed -9, restart via bin, all projects/runs/baseline survived |
| Local-only secrets | value only in `secrets.json` mode 0600; CLI refuses a value |
| Production write guard | (unchanged) |

---

## Public-copy truth matrix

Every meaningful product claim on the four public surfaces after remediation,
each tied to evidence. Status: **SUPPORTED** (evidence backs it as written) ·
**QUALIFIED** (true with the stated caveat, which is now on the surface) ·
**REMOVE** (was unsupported; removed/rewritten).

| # | Claim (surface) | Verified evidence | Status |
|---|---|---|---|
| 1 | `npx rigorrun` installs & runs (README, npm, landing) | clean-room install of 0.1.1 tarball → `--version` 0.1.1; 0.1.0 clean-room verified from registry | SUPPORTED |
| 2 | Runs locally; nothing uploaded (all) | binds 127.0.0.1; fresh-user session made 0 off-origin requests | SUPPORTED |
| 3 | Verdict comes from reading the system, not the agent's claim (all) | naive claim "Performed createRefund" → STATE assertions FAIL unsafe; lying claim recorded, finalState read empty | SUPPORTED |
| 4 | AUTHORITATIVE / PARTIAL / OBSERVATIONAL, real system usually PARTIAL (all, new) | live: real MCP `PARTIAL`, in-process `AUTHORITATIVE`, browser `OBSERVATIONAL` | SUPPORTED |
| 5 | Connect a third-party MCP server (stdio) (README, npm) | server-memory from npm, 9 tools, full pipeline | SUPPORTED |
| 6 | Streamable HTTP MCP (docs) | server-everything real handshake, 13 tools | SUPPORTED |
| 7 | OAuth sign-in (docs) | 401→PRM→ASM→DCR, localhost-only redirect, PKCE public client | QUALIFIED (discovery/registration verified; full browser+token-exchange not re-driven here) |
| 8 | Tool annotations are hints, never enforced (README, docs) | `readOnlyHint` lie shown "Unverified"; missing → treated as writing; mismatch recorded | SUPPORTED |
| 9 | Nothing guessed gates until confirmed (README, landing) | 0 cases before review; rule confirm/reject changes suite | SUPPORTED |
| 10 | Break the agent → see which case regressed (README) | `compare-runs` names the case, exit 1 | SUPPORTED |
| 11 | Gate a build, exit 0/1/2 (README, npm, docs) | verified all three codes on 0.1.1 | SUPPORTED |
| 12 | Richness depends on seed/reset; it says what it can't test (README, npm, quickstart, new) | real server → 1 case + `notTestable` list, isolation NONE | SUPPORTED |
| 13 | Agent that doesn't speak MCP → ~10 lines of plain HTTP, nothing to install (README, npm) | external agent used only public MCP SDK + raw HTTP | SUPPORTED |
| 14 | TypeScript SDK is installable | `@rigorrun/agent-sdk` is `private:true` | REMOVE (claim removed; reframed as plain HTTP / not-yet-published) |
| 15 | Model-judge / 5 evidence tiers available now | only STATE/EVENT emitted | REMOVE (now: DETERMINISTIC only; others "not emitted yet") |
| 16 | Cloud control plane is a used data path | CLI/interface call nothing | REMOVE (now: "not called … off unless you stand it up") |
| 17 | Setup is CLI-drivable | connect+teach are UI-only | QUALIFIED (README now says setup is in the interface) |
| 18 | "In ten minutes" onboarding | never measured on independent humans | REMOVE (→ "Start with one command") |
| 19 | Nothing leaves the device; secrets local-only (README, npm, docs) | canary only in `secrets.json` 0600; feedback/export omit secrets & names | SUPPORTED |
| 20 | Work survives a crash (README, docs) | SIGKILL + restart, all data present | SUPPORTED |

No surface now carries a claim in the REMOVE row.

---

## Not done, and why

- **Publish `0.1.1` to npm / deploy the landing site:** prepared and gated
  green, but publishing and Cloudflare deploy are outward-facing actions that
  need account credentials; performed only with explicit authorisation and the
  interactive auth step. Status recorded in the release section of the final
  report.
- **Publishing a real `@rigorrun/agent-sdk`:** deliberately not done — a second
  public package in a trust release is more surface than the honest-copy fix,
  which the instructions preferred.
