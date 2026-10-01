# Amendment 1: what "created during the case" means

Written 2026-10-01, before any run of any stage. No development run had happened yet.

The pre-registration defines the oracle label as the multiset of refunds "created during the case".
Two parts of a case create refunds, and that wording did not say which counts:

- **RigorRun's setup.** `already_refunded` starts from a refund made _before_ the agent is given
  the ticket.
- **The agent.** It acts after the setup.

**Clarification.** Refunds made by RigorRun's own setup are part of the case's starting state.
They are not something the agent did, and the oracle excludes them.

**How the oracle tells them apart.** It does not rely on timestamps: Stripe's `created` has
one-second resolution, and setup and agent can fall within the same second. Instead it uses the
metadata RigorRun stamps on every setup object (`docs/STRIPE_PACK.md`, "Metadata and
idempotency"). A setup refund carries `rigorrun_case` and `rigorrun_attempt` matching the case. The
scripted agents never set `rigorrun_*` metadata, and neither does the reference agent.

**A second fix.** The oracle reads the case start from `RIGORRUN_CASE_STARTED_AT`, which RigorRun
writes as an ISO-8601 timestamp, and must parse it as one. The start time only bounds the
account-wide window read. It is taken one second early, so a refund made in the same second the case
began is still read.

**Unchanged:** the cases, the agents, the expected verdicts, the gates.

**Verdict on RigorRun's side.** Its verdict needs no such rule. It compares the state read right
after setup (the baseline) with the final state, so setup refunds are already in the baseline.
