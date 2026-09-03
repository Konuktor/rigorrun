# Roadmap

What exists, what does not, and what comes next. The point of this page is that
the second list is honest.

## What works today

- Recording a real workflow in a real browser, with redaction verified by test
- Trace → contract with observed / inferred / needs-confirmation provenance and
  an open question attached to every inference
- Human review that genuinely changes the benchmark: rejecting a rule removes
  its assertion and regenerates different expectations
- 17 cases across all ten categories, generated deterministically, with
  expectations computed from the approved policy rather than hand-written
- Two demo agents, an HTTP adapter, and an OpenAI-compatible adapter
- Deterministic verification with 14 assertion kinds and evidence on every check
- Scoring with Wilson intervals, pass@k, latency percentiles and thresholds
- A dashboard that executes the real benchmark in the browser
- A self-contained HTML report and a sanitising publish step with a preview
- A CLI whose exit codes are a usable CI gate
- An optional Cloudflare control plane, tested against real SQL

## What is honestly not built

**The environment is synthetic.** Northstar Support is the only environment.
Pointing RigorRun at a customer's own application means either instrumenting it
or driving it through a browser, and neither is implemented.

**Policy templates cover one workflow family.** The compiler ships five
parameterised templates — limit-requires-approval, ownership, linked-record,
single-action-per-subject, forbidden-state — plus a refund vocabulary. They
generalise further than they look, but inferring an entirely new template from a
trace is not implemented.

**No browser-driven execution.** Agents call a typed tool API. The assertion
kinds for DOM and HTTP (`element_exists`, `url_matches`, `http_status`) exist
and are tested, but nothing drives a real browser yet.

**No model-judged evaluator implementation.** The type, the label and the UI
treatment exist; the evaluator itself does not. That is deliberate — shipping it
half-done would blur the line the product depends on.

**Latency and cost are only meaningful for real agents.** The demo agents run
in-process in microseconds and report $0 because they genuinely make no model
calls. Those columns become interesting when you plug in your own agent.

**No multi-user control plane.** Guest workspaces with bearer tokens. No users,
roles or audit trail.

**Reports are not signed.** Hashes prove internal consistency, not authorship.

**LLM-assisted case generation is narrow.** A model may propose which existing
scenarios deserve more coverage. It cannot author an assertion, by design.

## Next

### Near term — make it usable on a real workflow

1. **Bring-your-own environment.** A small adapter contract (`reset`, `seed`,
   `tools`, `observe`) so a team can point RigorRun at a staging system. This is
   the single biggest unlock and the clearest next step.
2. **Playwright execution lane.** Same cases, same checks, driven through a real
   UI, for teams whose agent is a browser agent.
3. **Template inference.** Derive the policy shape from the trace instead of
   selecting from a fixed library.
4. **Multi-workflow projects.** Most teams have five workflows, not one.

### Medium term — make it a gate people trust

5. **Regression tracking.** Store runs over time; show which case started
   failing and on which agent version.
6. **A model judge, properly.** Never as an arbiter: a second opinion that can
   only _flag_ a deterministic PASS for human review, never overturn a FAIL.
7. **Human-review queue.** For the checks that genuinely need a person.
8. **Signed reports.** So a report can be shown to a client's security team.
9. **A recorder that is not Chrome-only.** Firefox, and a desktop capture path
   for non-browser work.

### Longer term — the actual thesis

10. **Become the independent verification layer for AI labour.** The unit of
    trust in agent procurement should be "verified against the buyer's own
    workflow", not "scored well on a public benchmark".
11. **Portable workflow contracts.** A vendor-neutral format a buyer can hand to
    three vendors and get comparable answers back.
12. **Continuous verification.** The benchmark runs on every agent update, not
    once at purchase.

## Explicitly not planned

- A public model leaderboard. The value is that the benchmark is _private_.
- A red-team or jailbreak service. Adversarial cases measure a workflow.
- Production observability. Different product, different buyer.
- An agent framework. RigorRun tests agents; it does not want to be one.
- Blockchain anything.
