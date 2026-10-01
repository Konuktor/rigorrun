# RigorRun — claims ledger

> **What RigorRun may say about itself, and how strongly.** Every product statement on the site,
> in the docs, the README, the CLI and outreach email must map to a row here. Only `QUALIFIED`
> and `RECORDED` rows may be stated as present-tense fact. `BUILDING` and `NOT_BUILT` rows may
> appear only as direction ("being built", "next", "looking for design partners").
>
> A row moves to `QUALIFIED` only after a pre-registered qualification in `reports/` passes with
> 0 false pass and 0 false fail, and only Claude edits this file, with the founder's "yes"
> (see [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)). `node scripts/check-claims.mjs` reads the rules at the
> bottom of this file and fails the build on the common slips.

## Qualified and recorded (may be stated as fact)

| id                      | Claim                                                                                                                                                                                          | Status    | Evidence                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-STRIPE-STATE          | For an agent that issues Stripe refunds, each ticket is decided from what Stripe holds afterwards, not from what the agent said. Every verdict is `PARTIAL` (it reads what each case created). | QUALIFIED | `reports/stripe-pack-2026-10` — Stage T (local twin) 168 cells and Stage L (Stripe test mode) 168 cells, 8 scripted agents × 7 tickets × 3 attempts, independent oracle; no false pass, no false fail. Re-qualified at the 0.5.0 tree `27d40a8`: `reports/stripe-requal-0.5.0` (on branch `engine/0.5.0` until release) — T and L, 168 + 168 cells, same result |
| Q-STRIPE-OTHER-CUSTOMER | It catches a refund made on another customer's payment — a change to another customer's data.                                                                                                  | QUALIFIED | `other_customer` case inside the Stripe qualification above                                                                                                                                                                                                                                                                                                     |
| Q-BLACKBOX              | The agent is reached over HTTP as a black box, with no change to its code; verdicts are state-only.                                                                                            | QUALIFIED | `reports/blackbox-qualification-2026-10` — 36 of 36 cells, GO                                                                                                                                                                                                                                                                                                   |
| Q-MCP-REQUAL            | On third-party MCP servers (requalification v3) RigorRun's verdicts matched an independent oracle: TP 59, TN 13, FP 0, FN 0.                                                                   | QUALIFIED | `reports/public-mcp-audit-2026-09/requalification-v3/README.md`                                                                                                                                                                                                                                                                                                 |
| R-FLAGSHIP              | Recorded 2026-10-01: Groq `openai/gpt-oss-120b`, the `minimal` reference agent, said "Refunded $30.00 … as requested" while Stripe shows $0.30 refunded on another customer's $30.00 charge.   | RECORDED  | `fixtures/replays/stripe-replay.json` (hash-verified), `reports/flagship-demo-2026-10`                                                                                                                                                                                                                                                                          |

## Being built (direction only — "being built", "next")

| id         | Claim                                                                                                          | Status   | Planned in                            |
| ---------- | -------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------- |
| B-READS    | Detects that the agent read another customer's / tenant's data (proxy call log, system access log).            | BUILDING | Phase 1 engine, Phase 2 helpdesk pack |
| B-LEAKS    | Detects another customer's data leaving through an outbound channel (marker strings in email, webhook, reply). | BUILDING | Phase 1–2                             |
| B-ROLE     | Tests actions outside the role the agent acts for.                                                             | BUILDING | Phase 1–2                             |
| B-CALLS    | Tool-call checks: a tool never called, arguments within the principal's scope, refused calls recorded.         | BUILDING | Phase 1                               |
| B-MATRIX   | A permission matrix in the report (tenant × role × tool × sink).                                               | BUILDING | Phase 1                               |
| B-HELPDESK | Larch Helpdesk: a multi-tenant helpdesk pack over MCP, with a recorded run.                                    | BUILDING | Phase 2                               |

## Not built (do not imply it exists)

| id          | Claim                                                                                                  | Status    | Planned in                                             |
| ----------- | ------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------ |
| N-BYO       | Permission tests against your own MCP server or API, with two seeded tenants and a permission matrix.  | NOT_BUILT | Phase 4                                                |
| N-LEDGER    | Packs for ledgers (QuickBooks, NetSuite, Xero).                                                        | NOT_BUILT | Phase 5, on a design partner's request                 |
| N-RLS       | A Postgres / Supabase row-level-security pack.                                                         | NOT_BUILT | Phase 5                                                |
| N-VS-JUDGES | Any measured comparison with LLM judges or red-team graders ("catches what they miss", "better than"). | NOT_BUILT | Phase 3 (pre-registered head-to-head)                  |
| N-PARTNERS  | Design partners exist; anything "built with design partners".                                          | NOT_BUILT | Say "looking for 3–5 design partners" until one agrees |

Describing the _difference in evidence_ is allowed today ("graders read the reply; RigorRun reads the
system"). Claiming a _measured advantage_ is N-VS-JUDGES.

## Never (no status makes these acceptable)

"the first …", "the only …", "novel", "state of the art", "guarantee", "certified/certification",
and "canary" used for leak markers ("canary" is the $1.00 Stripe refund).

## Rules for `scripts/check-claims.mjs`

A line that matches a rule fails the check when its claim is not `QUALIFIED`/`RECORDED`, unless a
hedge appears on the same line or the line next to it, or the line carries `claims-ok` (use that
only with a reason in the same comment). Rules tied to `NEVER`, and rules marked `noHedge`, ignore
hedges: "being built with design partners" is still a claim that partners exist.

```json claims-config
{
  "allowed": ["QUALIFIED", "RECORDED"],
  "status": {
    "B-READS": "BUILDING",
    "B-LEAKS": "BUILDING",
    "B-ROLE": "BUILDING",
    "B-CALLS": "BUILDING",
    "B-MATRIX": "BUILDING",
    "B-HELPDESK": "BUILDING",
    "N-BYO": "NOT_BUILT",
    "N-LEDGER": "NOT_BUILT",
    "N-RLS": "NOT_BUILT",
    "N-VS-JUDGES": "NOT_BUILT",
    "N-PARTNERS": "NOT_BUILT",
    "NEVER": "NEVER"
  },
  "hedges": [
    "being built",
    "not built",
    "not yet",
    "in development",
    "planned",
    "roadmap",
    "looking for",
    "next:",
    "(next)",
    "coming next",
    "not qualified",
    "is next",
    "are next"
  ],
  "rules": [
    {
      "claim": "B-READS",
      "pattern": "\\b(never|doesn'?t|does not|didn'?t)\\s+(read|reads|see|sees|access|accesses)\\b[^.]{0,50}\\b((another|other|wrong)\\s+(customer|tenant|org|organi[sz]ation|user|patient|account)|(customer|tenant|org)'s data)"
    },
    {
      "claim": "B-READS",
      "pattern": "\\b(detects?|catch(es)?|flags?)\\b[^.]{0,30}\\b(reads|read access|data access)\\b"
    },
    { "claim": "B-READS", "pattern": "\\bcross[- ](tenant|customer|org)\\s+reads?\\b" },
    {
      "claim": "B-LEAKS",
      "pattern": "\\b(never|doesn'?t|does not|didn'?t)\\s+(send|sends|leak|leaks|exfiltrates?)\\b[^.]{0,50}\\b((another|other|wrong)\\s+(customer|tenant|org|organi[sz]ation|user|patient)|data|records)"
    },
    {
      "claim": "B-LEAKS",
      "pattern": "\\b(detects?|catch(es)?|flags?)\\b[^.]{0,30}\\b(leaks?|exfiltration)\\b"
    },
    { "claim": "B-LEAKS", "pattern": "\\b(leak detection|leak tests?|marker strings?)\\b" },
    {
      "claim": "B-ROLE",
      "pattern": "\\b(out[- ]of[- ]role|within its role|beyond its role|outside its role|role[- ]based)\\b"
    },
    {
      "claim": "B-CALLS",
      "pattern": "\\b(tool[- ]call (checks?|tests?)|never called|arguments? (with)?in (its )?scope)\\b"
    },
    { "claim": "B-MATRIX", "pattern": "\\bpermission matrix\\b" },
    { "claim": "B-HELPDESK", "pattern": "\\b(larch|helpdesk pack)\\b" },
    {
      "claim": "N-BYO",
      "pattern": "\\b(your own|any) (MCP server|API)\\b[^.]{0,60}\\b(tenants?|permissions?|isolation|scope)\\b"
    },
    { "claim": "N-BYO", "pattern": "\\bpermissions? (pack|tests?) (for|on) (any|your own)\\b" },
    { "claim": "N-LEDGER", "pattern": "\\b(QuickBooks|NetSuite|Xero)\\b" },
    { "claim": "N-RLS", "pattern": "\\b(Supabase|row[- ]level security|RLS)\\b" },
    {
      "claim": "N-VS-JUDGES",
      "pattern": "\\b(better than|outperforms?|beats?|more (accurate|reliable) than|catch(es)? what)\\b[^.]{0,60}\\b(LLM[- ]?judges?|Promptfoo|Braintrust|LangSmith|Galileo|red[- ]team\\w*|graders?)\\b"
    },
    {
      "claim": "N-PARTNERS",
      "noHedge": true,
      "pattern": "\\b(built|developed|designed|being built) with (our )?design partners\\b|\\bour design partners\\b"
    },
    {
      "claim": "NEVER",
      "pattern": "\\b(the|our|world'?s) first\\b[^.]{0,20}\\b(tool|product|platform|framework|open[- ]source|solution)\\b"
    },
    { "claim": "NEVER", "pattern": "\\bthe only (tool|product|platform|solution|one that)\\b" },
    {
      "claim": "NEVER",
      "pattern": "\\b(novel|state[- ]of[- ]the[- ]art|certified|certification)\\b"
    },
    {
      "claim": "NEVER",
      "pattern": "\\b(we|it|rigorrun|this)\\s+guarantees?\\b|\\bguaranteed to\\b|\\bguarantees (that|your|the)\\b"
    },
    {
      "claim": "NEVER",
      "pattern": "canar(y|ies)[^.]{0,40}\\b(leak|leaks|marker|markers|exfiltration|tenant)\\b|\\b(leak|leaks|marker|markers|exfiltration)\\b[^.]{0,40}canar(y|ies)"
    }
  ]
}
```
