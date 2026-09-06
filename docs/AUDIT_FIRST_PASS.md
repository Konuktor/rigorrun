# RigorRun — First-Pass Product Audit (before any remediation)

**Public version tested:** `rigorrun@0.1.0` (registry.npmjs.org, integrity
independently verified). Method and full claim table: `docs/AUDIT_2026_09_06.md`.
This document is written **before** any product code was changed.

---

## EXECUTIVE VERDICT

**USABLE WITH MATERIAL LIMITATIONS.**  Confidence: **HIGH** for what was tested.

The core of RigorRun is real and, in the ways that matter most for trust
infrastructure, it is honest. A stranger can install it from the public
registry, connect a genuine third-party MCP server they did not write, teach a
job in a domain the product has never seen, get a suite whose provenance is
traceable, run an external agent through it, and receive a verdict that is
computed by **reading the system the agent changed, not by trusting what the
agent said** — the single property the whole product rests on. That property
held under every attack I threw at it, including a deliberately lying agent, a
lying tool annotation, hostile tool output, and a regression.

It is not "product core verified" without qualification, for three reasons:

1. **The rich benchmark is a property of the bundled demo, not of your system.**
   The 22-case Northstar suite (boundary cases, injection, mutation grading,
   AUTHORITATIVE verification) exists because that environment can be *seeded*
   and *reset*. Against a real MCP server that can do neither — the common case
   — you get a thin suite (in my run, **one** case), `PARTIAL` verification, and
   `NONE` isolation. RigorRun says all of this loudly and correctly. Marketing
   does not.

2. **The public marketing surface is less honest than the product.** The one
   place a stranger looks before installing — the landing page — drops the
   verification-strength vocabulary entirely, and the README overstates the SDK,
   the model-judge tiers, CLI-driven setup, and the cloud plane.

3. **One advertised on-ramp is broken:** the TypeScript SDK is not installable
   (all workspace packages are `private:true`).

None of these is a P0 that makes the product lie about a verdict. The verdict
engine is trustworthy. The story told *around* it is oversold.

---

## Blockers & issues

### P0 — none found
No defect was found that makes the product unusable or causes it to misreport a
verdict, grant a PASS on an agent's claim, trust a lying annotation, leak a
credential, or defeat a stated safety boundary. This is the important result.

### P1
- **P1-1 Landing page omits verification strength.** `AUTHORITATIVE / PARTIAL /
  OBSERVATIONAL` appear nowhere on `rigorrun.pages.dev`. The product's own docs
  call claiming more than PARTIAL "the single most damaging thing this product
  could do" — yet the surface a stranger reads first makes no strength claim at
  all, implying a stronger verdict than the engine ever gives a real system.
- **P1-2 TypeScript SDK is advertised but not installable.** README (repo +
  npm) says "ten lines of SDK"; `@rigorrun/agent-sdk` and all 16 siblings are
  `private:true`. A stranger following that path 404s. (The Python SDK, being
  copy-one-file, does work.)
- **P1-3 "Rich suite on your system" is implied but only true for seedable +
  resettable systems.** Against a real non-resettable MCP server the suite is
  thin and can be degenerate. Correctly labelled in-product; not on the tin.

### P2
- **P2-1 CSRF defence-in-depth gap.** State-changing routes do no `Origin`
  check; they rely on `SameSite=Strict` + the Host allowlist. A malicious page
  on another *localhost* port (same-site) could drive the runner. Low real-world
  reach, but not the belt-and-braces a local control plane wants.
- **P2-2 Model-judge / 5-tier evidence hierarchy oversold.** Only STATE/EVENT
  are ever emitted; MODEL-JUDGED and HUMAN-REVIEW are unreachable today.
- **P2-3 README implies CLI-driven setup** ("step by step" pipeline); setup is
  UI-only (the gap audit says so; the README does not).
- **P2-4 Cloud control plane** advertised as an optional data path with a live
  URL and a "Deploy for $0" section; the CLI calls nothing (health endpoint is
  up but unused).
- **P2-5 README shows the deprecated `rigorrun/agent/1` protocol;** the product
  speaks `/2`.
- **P2-6 List-valued tool arguments are not inducible** — a real generalisation
  limit for servers whose write tools take arrays (e.g. the reference memory
  server).
- **P2-7 `verify:package` is non-hermetic** and **7 committed evidence
  screenshots do not reproduce** (two materially different).
- **P2-8 Import pre-trust `run` error is misleading** (mentions a missing agent
  rather than the untrusted connector; the connector is correctly not launched).

### P3
- `rigorrun compare` in the README vs `compare-runs` in `--help`/bin.
- Reconnect-after-stop PARTIAL not surfaced on README/landing.
- Pre-existing orphaned test processes from prior repo sessions (repo, not the
  package).
- npm README's "WORKING/PARTIAL/MISSING" sentence omits the DEMO-ONLY & BROKEN
  marks the audit itself uses.

---

## Scores (assigned only after evidence)

| Dimension | Score | One-line justification |
|---|---:|---|
| INSTALLATION | 9/10 | Clean-room `npx` works, integrity verified, correct Node guard; SDK install is the only broken on-ramp |
| ONBOARDING | 8/10 | Clear first screen, enforced order, honest next-steps; README overstates CLI setup |
| MCP INTEROP | 9/10 | Real stdio + Streamable HTTP handshakes, standards-compliant OAuth discovery, clean failure modes, honest annotation trust |
| WORKFLOW LEARNING | 8/10 | Genuine generalisation to an unseen domain with provenance & mismatch detection; list-arg limit + naive singularisation |
| BENCHMARK QUALITY | 6/10 | Excellent on seedable/resettable environments; thin & sometimes degenerate on real systems (honestly labelled) |
| AGENT INTEGRATION | 9/10 | External agent, probe integrity, SSRF guard, connected-only-after-handshake |
| VERIFICATION TRUST | 9/10 | Verdict from state not claim (proven under attack); strength labels honest — but missing from the landing page |
| REGRESSION VALUE | 9/10 | `compare-runs` names the regressed case & failing rule; gate exit codes correct |
| PERSISTENCE | 9/10 | Survives SIGKILL; corruption reported not dropped; atomic writes; import inert |
| CLI / CI | 9/10 | Correct 0/1/2 exit codes; fully headless gate/run/compare from the published bin |
| SECURITY | 8/10 | Single-use pairing, DNS-rebinding & SSRF defended, no shell injection, 0600 secrets; CSRF is defence-in-depth-only |
| PRIVACY | 9/10 | No off-origin traffic; canary contained to `secrets.json`; export/feedback omit secrets & names |
| UX | 8/10 | Clean, no overflow, axe-clean, honest in-app copy; landing omits the strength caveat |
| DOCUMENTATION | 6/10 | `docs/` (esp. V1_GAP_AUDIT) is exemplary; README & landing overstate several capabilities — honesty degrades docs → README → landing |

---

## The five required answers

**Can I use it?** Yes. From the public registry, in a clean room, I connected a
real third-party MCP server, taught a novel job, built a suite, ran an external
agent, and got a state-derived verdict, plus a CI gate with correct exit codes.

**Can a stranger use it?** Yes for the MCP/HTTP path, with two caveats: they must
use the local UI to set a project up (not the CLI), and they must not rely on the
TypeScript SDK on-ramp (broken). They should read `docs/V1_GAP_AUDIT.md`, which
the landing page under-signposts.

**Would I trust its verdict?** Yes — *with its own strength label attached.* A
`PARTIAL`/`AUTHORITATIVE`/`OBSERVATIONAL` verdict means exactly what it says, and
the engine never upgrades confidence to please a test. I would **not** trust the
impression the landing page gives, because it omits the label.

**What is still a demo?** The 22-case richness, mutation grading, and
AUTHORITATIVE verification are demonstrated at full strength only on the bundled
in-process Northstar environment (seed+reset). The cloud control plane. The
model-judge / human-review tiers. The TypeScript SDK.

**What is genuinely productised?** The daemon, the MCP stdio/HTTP/OAuth
connectors, workflow induction with observed-vs-inferred separation, contract
review, benchmark generation with `notTestable` honesty, the proxy + external
agent protocol, deterministic state-based verification, regression compare, the
CLI gate, persistence/recovery, the secret store, and the security boundaries.

---

## Verdict language (choose one)

> **B. USABLE WITH MATERIAL LIMITATIONS.**

The engine is real and trustworthy; the limitations are (1) benchmark richness
depends on seed+reset, (2) the marketing surface oversells and omits the key
caveat, (3) the TS SDK on-ramp is broken.

---

## Recommended next 5 actions (ranked by impact)

1. **Put verification strength on the landing page.** One line — "verdicts
   against a real system are PARTIAL by design" — closes the biggest
   honesty gap and costs nothing. (P1-1)
2. **Fix or retract the TypeScript SDK claim.** Either publish a minimal
   `@rigorrun/agent-sdk` or change README (repo + npm) to say "copy this file",
   as the Python SDK already is. (P1-2)
3. **Say, where the suite is shown, that richness needs seed+reset.** Set the
   expectation that a real MCP server yields a thinner suite + PARTIAL, so the
   first real run is not a disappointment mistaken for a bug. (P1-3)
4. **Add an `Origin`/`Sec-Fetch-Site` check to state-changing routes.** Cheap
   defence-in-depth over the same-site-localhost CSRF vector. (P2-1)
5. **Reconcile README with reality:** protocol `/2`, `compare-runs`, CLI-setup
   caveat, and either wire or delete the cloud plane. Make `verify:package`
   hermetic and regenerate the evidence screenshots so they reproduce. (P2-3/4/5/7)
