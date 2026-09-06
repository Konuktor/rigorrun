# Gate 0 — Falsification Evidence

**Purpose.** PRD v2.0 §29 Phase 0 requires four answers written down before the v2 buyer
thesis may be treated as supported. This file records them, with exact source URLs and
retrieval dates.

**Retrieval date for every source below: 6 September 2026.**

**Rule applied throughout:** primary/official documentation only. Where a claim reached
the PRD secondhand, it was re-read at the source. Where no public answer exists, the
answer is recorded as UNKNOWN and an outreach message is written in
[GATE0_OUTREACH.md](GATE0_OUTREACH.md). **UNKNOWN is not converted to NEGATIVE.**

---

## CHECK 1 — Microsoft MCP certification: does it accept third-party evaluation evidence?

**Verdict: POSITIVE (with one material qualification the PRD does not capture).**

**Source:** <https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-certification>
Page metadata `ms.date: 2026-09-02`, `updated_at: 2026-09-03`. Retrieved 2026-09-06.

### Verbatim

Prerequisites section:

> **Testing readiness**: Test MCP tools before submission and include evaluation evidence when available.

Certification process, step 4 (*Functional and safety review*):

> Microsoft reviews the MCP server for functionality, endpoint behavior, authentication, security, compliance, telemetry readiness, and responsible AI considerations. **Evaluation proof can help accelerate review.**

Package definitions table, row *Evaluation evidence, if available*:

> Include representative functional and safety test evidence. This evidence is useful for validating expected behavior and speeding review, especially for higher-risk actions or AI-driven behavior.

### The four sub-questions, answered

| Question | Answer | Basis |
|---|---|---|
| Is third-party/evaluation evidence **accepted**? | **Yes.** Explicitly invited, twice. | The two quotes above |
| Is it **required**? | **No.** "when available" / "if available" — optional. | Prerequisites + package table |
| Can it **accelerate review**? | **Yes**, stated in those words. | "Evaluation proof can help accelerate review"; "speeding review" |
| What **format** is requested? | **Unspecified.** Only "representative functional and safety test evidence". No schema, no template, no file format. | Package table |
| Is **independent** (third-party) evidence explicitly supported, or only publisher-generated? | **Neither.** The page never says who must generate the evidence. Third-party origin is not named and not prohibited. | Absence, stated as absence |

### The qualification the PRD misses

Submission is publisher-gated:

> **Publisher eligibility**: You must be a verified publisher and own or control the MCP server endpoint you submit.

> If you're an independent publisher who doesn't own the underlying service, you're not eligible to submit directly. You must partner with the service owner or complete verification before pursuing certification.

**RigorRun can therefore never be the submitter.** The evidence channel is real and is
stated to accelerate review, but the party who would attach a RigorRun record is the
**publisher preparing a submission** — not Microsoft, and not an independent verifier
acting alone. PRD §14.3 frames this ICP as "marketplace and certification programs";
the accurate frame is "publishers submitting to them".

That is still a buyer. It is a different buyer from the one the PRD describes, and the
positioning should say so.

---

## CHECK 2 — Underwriters and evidence consumers

**Verdict: UNKNOWN. Not disproven. Requires a human.**

Armilla, Munich Re, AIUC and comparable AI-risk underwriting programs publish marketing
and case-study material about evaluations they run **themselves**. No public documentation
was found stating whether any of them would accept a third party's behavioral test
evidence as an underwriting input.

**PUBLIC SILENCE IS NOT A NO.** This question is answerable only by asking. The exact
outreach message is written in [GATE0_OUTREACH.md](GATE0_OUTREACH.md).

**No response has been received. No response is invented here.**

---

## CHECK 3 — Gateway and private-registry operators: what evidence decides admission?

**Verdict: admission surfaces CONFIRMED to exist. The evidence input to the decision is
CONFIRMED ABSENT from their public documentation. Whether an operator would pay for that
input is UNKNOWN and needs outreach.**

The PRD asks two separate things here. They resolve differently, and conflating them
would overstate the result.

### 3a — Do real organizational MCP admission surfaces exist? **Yes.**

**Azure API Center as an organizational MCP registry.**
Source: <https://learn.microsoft.com/en-us/azure/api-center/register-discover-mcp-server>
(`ms.date: 2026-05-29`). Retrieved 2026-09-06.

> This article describes how to use Azure API Center to maintain an inventory (or *registry*) of remote or local model context protocol (MCP) servers and help stakeholders discover them through the API Center portal.

It exposes a registry endpoint that clients consume:

> Azure API Center exposes an MCP registry endpoint that you can configure in Visual Studio Code, GitHub Copilot, or other tools to discover and connect to the MCP servers in your inventory.

**GitHub organization/enterprise policy.**
Source: <https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/extend-copilot-chat-with-mcp>
Retrieved 2026-09-06. What exists is a **binary** control:

> Enterprises and organizations can choose to enable or disable use of MCP for members of their organization or enterprise with the **MCP servers in Copilot** policy.

Correction to the PRD: §14.1 and §20.5 describe "organization-level MCP registries in
GitHub" as an admission surface comparable to API Center. For the Copilot MCP policy
specifically, what the documentation describes is an all-or-nothing toggle with **no
allowlist, no per-server governance, and no stated decision criteria**. The claim should
be narrowed to what the source supports.

### 3b — What evidence does an operator use to decide? **The documentation describes none.**

This is the load-bearing finding, and it is stronger than the PRD claims.

Azure API Center's MCP registration form collects, in full: Title, Identification,
Summary, Description, Icon URL, Use Cases, Runtime URL + Environment (remote), or
Package registry + Package name + Version + Runtime hint + Runtime arguments (local),
plus optional repository URL, version title/identification/lifecycle, License, and
External documentation links.

**Every one of those fields is metadata. Not one is an execution result.** The page
describes no review step, no approval workflow, no admission criteria, no security
requirement, and no evidence artifact. Its access-management section governs *who may
view a server in the inventory* — not whether the server is safe to admit:

> Optionally, use API Center's access management capabilities to manage who can view and access MCP servers in your inventory.

The one execution-adjacent affordance is a manual test console:

> A built-in *test console* allows users to test MCP server tools and view the responses directly in the portal.

That is a human clicking one tool and reading the response. It produces no record, no
baseline, no state verification, and nothing that survives the next version.

**This directly confirms PRD §2.1** ("admission decisions are made on unverified
metadata") from a primary source, for the single largest named example of the ICP.

### 3c — Would an operator buy evidence? **UNKNOWN.**

Existence of the gate is not evidence of willingness to pay for an input to it. Outreach
list and questions are in [GATE0_OUTREACH.md](GATE0_OUTREACH.md). **No operator has
spoken to us. BUYER VALIDATION: UNCONFIRMED.**

---

## Supporting evidence — the two platform statements the strategy rests on

Both were quoted secondhand in the PRD. Both are confirmed verbatim.

### MCP Registry moderation policy

Source: <https://modelcontextprotocol.io/registry/moderation-policy>. Retrieved 2026-09-06.

Under **What We Don't Remove**:

> * Low-quality or buggy servers
> * **Servers with security vulnerabilities**
> * Servers that do the same thing as other servers
> * Servers that provide or contain adult content

And:

> The MCP Registry **does not** make guarantees about moderation, and consumers should assume minimal-to-no moderation.

### Anthropic connector verification

Source: <https://claude.com/docs/connectors/verification>. Retrieved 2026-09-06.

> Verification means Anthropic has reviewed the connector more closely than a Community connector, but **it is not a security audit or a guarantee of how the connector will perform. The developer operates the connector and controls its tools, which can change after review.**

Confirmed on the directory page as well
(<https://claude.com/docs/connectors/directory>):

> Verified connectors have been tested by Anthropic for quality and compatibility and met the Software Directory Policy requirements at the time of review, though verification is not a security audit.

**One finding stronger than the PRD claims.** The same verification page, under *Advice
for all third-party connectors*, instructs the user to:

> * A connector's developer controls which tools it exposes and can change them at any time.
> * **Monitor for unexpected changes in tool behavior.**

Anthropic tells the user to do the job, in those words, and ships no tool that does it.
That sentence is the most direct public statement of the gap this product addresses, and
it comes from the platform itself.

---

## CHECK 4 — The strategic fork

### Recorded verdict

```
GATE_0_NOT_DISPROVEN_BUT_BUYER_UNVALIDATED
```

**Reasoning.** PRD §29 defines Gate 0 failure precisely: *"checks 1 and 3 both negative →
the repositioning is unsupported."*

- Check 1 is **positive**, proven from current official Microsoft documentation.
- Check 3a is **positive** (surfaces exist) and 3b is **positive for the problem
  statement** (they admit on metadata; no evidence input exists in their docs).
- Check 3c and check 2 are **UNKNOWN**, pending outreach to real humans.

One positive is sufficient to prevent failure. **Gate 0 has not failed, and the
repositioning is not unsupported.** Phase 2 is unblocked.

### What is NOT claimed

- Not `GATE_0_SUPPORTED`. That would require a buyer to have said something, and none has.
- No market validation of any kind. Per PRD §32, tests, our own fixtures, our own registry
  scan, stars, traffic and downloads do not count.
- **BUYER VALIDATION: UNCONFIRMED.**

### What would change the verdict

| Event | New verdict |
|---|---|
| A gateway/registry operator states what evidence they would accept | `GATE_0_SUPPORTED` |
| An underwriter states they would accept third-party behavioral evidence | `GATE_0_SUPPORTED` |
| Operators contacted, and all state they would neither use nor pay for such evidence | Re-open; check 1 alone keeps it above `GATE_0_FAILED` |

### Bearing on execution

Phase 1 is unconditional and proceeds regardless. Phase 2 (F1 → F2 → F3) is unblocked.
F4 (drift) stays gated behind Gate 2, and F6 (policy output) stays gated behind a named
integration partner — Gate 0 check 3c is exactly the signal F6 waits for, and it has not
arrived.
