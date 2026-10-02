# RigorRun — decisions

> One entry per decision, newest first. A decision that changes positioning also changes
> [POSITIONING.md](POSITIONING.md) in the same commit. Entries are never edited after the fact;
> a reversal is a new entry.

## D-007 · 2026-10-02 · 0.5.0 released on the re-qualified tree, with the version bump disclosed

The founder said "deploy the site and release 0.5.0". The Stripe pack was re-qualified at tree
`27d40a8`; the version bump to 0.5.0 came after, so the released tree `c247c72` differs from the
qualified one by three version lines. Rather than run both stages again for a version string, the
difference is published in full (`reports/stripe-requal-0.5.0/RELEASE-TREE.md`) and named in the
changelog. **Why:** the rule is "re-qualify, or say that the release tree differs"; a
version-only diff is checkable by anyone in one command. Next time, bump the version before the
freeze.

## D-006 · 2026-10-02 · Codex and Cursor work on the project under Claude's supervision

Claude writes briefs, delegates, reviews diffs and runs the tests itself; it never accepts an
agent's own "done". Never delegated: pre-registrations, qualification runs, analysis and numbers,
`CLAIMS.md`, releases and deploys, outreach copy. How: [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md).
**Why:** speed, without letting any agent tune a result or drift from the positioning.

## D-005 · 2026-10-02 · A claims ledger enforced by a script

`CLAIMS.md` lists every product claim with a status; `scripts/check-claims.mjs` (in `pnpm verify`
and `release:verify`) fails on unqualified claims stated as fact. Old positioning moved to
`docs/archive/v0.2/` or got an ARCHIVED banner. **Why:** several AI sessions had worked from
contradicting documents (agencies vs YC founders, "do the job once" vs Stripe), and copy had
started to promise more than was qualified.

## D-004 · 2026-10-02 · Outreach paused until the repositioned site is deployed

The sending bot stops; it resumes with the permissions email (v2) once Phase 0 is live. The five
companies already emailed (Calltree, Minimal AI, Open, Parahelp, Quivr) are marked sent and get a
permissions follow-up. **Why:** not to spend first contacts on the old pitch.

## D-003 · 2026-10-02 · Flagship permissions demo: "Larch Helpdesk"

A new in-memory multi-tenant helpdesk served over MCP (org-scoped token vs service-role token),
not an extension of Northstar ("northstar" is a reserved domain term in
`scripts/check-domain-leak.mjs`) and not a third-party server. **Why:** offline, deterministic,
looks like a founder's own stack, and shows reads, writes and leaks in one system.

## D-002 · 2026-10-02 · Policy input becomes a permission matrix, drafted by an LLM and confirmed by a person

The earlier "paste your refund policy → tests" (founder's choice: LLM draft + human confirmation)
generalises to a permission matrix. The LLM only drafts; a person confirms before a rule can
block; verdicts stay deterministic.

## D-001 · 2026-10-02 · Positioning: permissions & scope tests for AI agents; Stripe is the first pack

**Decision:** RigorRun is pre-deployment tests of an agent's permissions and scope (right customer,
within its role, never reads/changes/sends another customer's data), decided from the real system.
The Stripe refunds pack stays as the first qualified pack and first proof.
**Why:** in the 100-company outreach list permissions is the #1 concern for 25 and a strong fit for
51, Stripe the #1 concern for 4; incidents (Asana MCP cross-org exposure, Supabase MCP
service_role leak, agents deleting production data) and surveys (SailPoint: 80 % saw unintended
agent actions) show demand; runtime authorisation is crowded, pre-deployment proof on reads,
writes and leaks is not. Research notes: session of 2026-10-02 (market, codebase and per-company
mapping agents); per-company table `~/Documents/rigorrun-outreach/yc_founders_100_needs.csv`.
**Replaces:** "acceptance testing from one human demonstration" (v0.2) and the Stripe-only framing
of 0.4.0.
