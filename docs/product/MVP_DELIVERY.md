# General-agent MVP local handoff

Functional acceptance and independent whole-branch review completed on 2026-10-09
UTC (2026-10-10 in Bishkek). Ready for local handoff, not production qualification.
Verified runtime/test integration head: `b2b59924e9629e327d000126ebe5703853433a5c`;
subsequent handoff commits update documentation only.
Baseline: `3e2d4e3db3d15b2301599251ad11a4b1b5127781`, published CLI 0.6.0.

Implementation is in `/home/erbol/.codex/worktrees/66f5/RigorRun`, branch
`feat/hackathon-general-agent-mvp`. The original dirty checkout at
`/home/erbol/RigorRun` and unrelated worktrees were preserved. No push, merge to a
shared branch, deployment, npm release, production test writes or outreach.

## What is implemented

- Backend/CLI and browser review require explicit decisions for inferred rules;
  unknown, duplicated and contradictory decisions are rejected. Observed facts
  do not need a fabricated human decision; rejection remains explicit.
  Interactive bundled `n/no` persists as rejected, not an unanswered rule; omitted
  API decisions remain inferred. The CLI's documented `[Y/n]` Enter default is
  unchanged. Rejected rules are not enforced: a PASS does not prove their boundary.
- Full suites bind stored contract, actual configuration/schema and benchmark
  digests. Publishing and completed-run promotion check freshness; stale completed
  run evidence remains stored without becoming the current run/baseline.
- Execution and assessment use the published schema, not stale induced cache;
  changed connector/safety inputs reconnect a cached project session.
- Generated project release gates require current complete conservative quality
  evidence. Missing, stale or inadequate evidence returns 3 before candidate
  execution. Assessment is explicit, involves test writes, and is not invoked by
  gate. Raw-file gate and generic runs remain diagnostic, not universal evidence.
- Bundled pack eligibility is default-deny trusted registry metadata, not a
  project-controlled pack string or self-declared pack definition. Replacing a
  definition revokes eligibility. No domain terms were added to generic code.
- Browser refund/invoice/access selection preserves URL context and resets foreign
  artefacts; unfinished async work cannot publish into another workflow. Examples
  are labelled synthetic/scripted/local/unqualified; invoice/access quality gaps
  are not concealed.
- English landing, onboarding, access and company pages explain pre-deployment
  verification beyond payments, free OSS, proposed paid pilots and a planned team
  subscription. Current contacts use `erbol@rigorrun.xyz`. Existing source-backed
  historical replays, evidence and caveats remain.

## Integrated evidence

| Check                                      | Observed result                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `env -u NO_COLOR pnpm verify`              | Exit 0: lint, typecheck, domain, claims, full tests, examples, all builds        |
| Full Vitest                                | 166 files; 1,937 passed, 1 alternate golden-transcript diagnostic skipped        |
| Example agents                             | 13/13 passed; model requests mocked, not a live model qualification              |
| Helpdesk/Stripe/Helpdesk CLI acceptance    | 3 files, 12/12 passed, no skips or Python omissions                              |
| Fresh Helpdesk repeat                      | 3/3 passed with a new twin/store                                                 |
| Demo + deep-link + domain browser journeys | 58/58 passed, Chromium                                                           |
| Local public-site browser checks           | 99/99 passed, desktop/tablet/mobile, including JS-disabled evidence              |
| Dedicated daemon restart                   | 2/2 passed                                                                       |
| Dedicated operations renderer              | 7/7 passed                                                                       |
| Integrated external-user browser journey   | 1/1 passed; diagnostic failures remain visible, generated release gate returns 3 |
| Contact DNS check                          | MX configured at Zoho; inbox existence and delivery not tested                   |

The final full verify ran on the unchanged runtime tree after all code and test
corrections landed. The external journey was repeated afterwards: 1/1 in 9.7s.
Its gate keeps the original 95% threshold and asserts unchanged run files/assessment
bytes after refusal; it does not manufacture quality or accept a weak release gate.
Site checks ran after the contact-test correction; the demo, restart and operations
checks covered their latest unchanged code, not a newly claimed all-browser sweep.

All build targets passed: CRM, operations app, React app, site (15 routes), docs
(31 routes), extension and CLI with a locally staged package. Starlight retains a
pre-existing missing-404-entry notice. Package-install verification, release
qualification and deployment were not performed.

Initial integration browser setup was wrong for unrelated drivers: the broad
config used private operations port 5375 while that test hardcodes 5175, and tried
daemon restart before building its served app. It produced 57 passes, 9 environment
failures and 4 intentional skips. Correct dedicated operations/restart drivers
subsequently passed 7/7 and 2/2; final targeted demo journeys passed 58/58. No failing
test or policy assertion was removed to report a green result.

The first full site run had 93 passes/3 failures from an exact text locator that
ignored the existing shell prompt. Using the accessible command region fixed that
test, and the full 96 checks passed without retries. Three subsequent exact-contact
fallback regressions brought the fresh final site run to 99/99. Desktop/mobile screenshots
were inspected; five changed routes at three widths had no horizontal overflow,
page errors or console errors.

## Review corrections

Independent task reviews approved consent, UI, landing and corrected integrity/
quality tasks. Important findings were fixed and re-reviewed:

1. Generation/pack installation could stamp newer stored inputs onto content
   generated from older captured objects: provenance now binds actual inputs.
2. A long-lived Service could use an older induced schema or connection after a
   sequential reconfiguration and regenerate: execution uses the published schema
   and connection inputs are checked.
3. An explicit pack allowlist leaked domain terms into generic service code:
   trusted bootstrap/registry metadata now expresses eligibility; the architecture
   checker was not relaxed.
4. The external diagnostic journey's former gate-1 expectation conflicted with
   strict generated-quality refusal: gate-3 assertions now verify no new execution
   or assessment while retaining diagnostic unsafe-action evidence.
5. Interactive bundled `No` left a rule inferred and therefore blocked the new
   readiness check. Both initializers now pass explicit rejection IDs through
   installation; invalid decisions fail before publication. A shared structural
   validator preserves existing boundary diagnostics and ordering.
6. Site tests assumed successful MX lookup despite the existing GitHub fallback.
   They now accept only the founder mailto or the exact intended issue destination;
   negative tests reject the old inbox, unrelated repositories and wrong titles.

The final independent whole-branch review first returned **With fixes**. After
the complete correction deltas were reviewed, its verdict became **Ready for local
handoff**, with no open Critical, Important or Minor findings. The pre-existing docs
404 build notice remains a disclosed deferred baseline item, not a new regression.

A minor demo hash guard was added preventatively. Ordinary Projects navigation
already passed before it; no fabricated baseline failure was claimed. Earlier
stale explanatory text in the external test was updated to explicit review,
without weakening downstream evidence checks.

## Show and reproduce

Use [MVP_RUNBOOK.md](MVP_RUNBOOK.md) for exact commands and the model-free demo.
Final integrated three-file acceptance reports are in
`/tmp/rigorrun-helpdesk-e2e-UDZ35V`; the final fresh repeat is
`/tmp/rigorrun-helpdesk-e2e-ioxtPC` (3/3 in 7.16s). The earlier visually inspected
repeat is `/tmp/rigorrun-helpdesk-e2e-7Jp8ih`. These are
machine-local outputs, not portable fixtures or protected qualification reports.

Independent review packages and worker reports are retained outside the worktree
at `/tmp/rigorrun-mvp-review-archive-2026-10-09`. This is a machine-local audit
archive, not product source or qualification evidence. All managed worktrees and
the local feature branch remain available for the founder's next step.

Use [HACKATHON_PITCH.md](HACKATHON_PITCH.md) for the English 60-second pitch,
three-minute demonstration, buyer hypothesis and commercial validation questions.

The Helpdesk path proves a scripted, model-free HTTP/MCP control on a simulated
twin: default scoped gate 0, service-token defect 1, invalid setup 2. Core tests and
the real external journey establish inadequate generated evidence 3. PASS HTML
currently has a summary/matrix; passing details are stored run JSON. Failure HTML
has detailed system/access/outbox evidence beside the control's inaccurate claim.

## Boundaries and next commercial step

One writer/operator per project. Freshness checkpoints are not transactions or
cross-process locks. Assessment must use a disposable resettable test environment.
These changes under `packages/` are **not covered by historical qualification**;
passing regression tests do not constitute a new preregistered qualification or
proof about a general-purpose LLM agent.

No production runtime enforcement, generally supported arbitrary permission pack,
hosted team workspace or subscription billing was built. The monetisation path is
free MIT runner → scoped paid pilot after feasibility/acceptance agreement →
planned recurring team workspace only if repeated release use warrants it.
Pricing, customer demand and investment attractiveness remain hypotheses.

Next: one real design-partner workflow with observable reads, safe reset, agreed
failure cases and a paid-pilot acceptance contract. Fix generic compiler/generator
quality limitations before treating their generated suites as release evidence.
Build managed history/approvals and billing only after recurring use is established.
