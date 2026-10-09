# General-agent MVP delivery checkpoint

Functional acceptance observed on 2026-10-09; final whole-branch review pending.
Runtime/test integration head: `437a2a2f87e58403b96685085b42edcd3dc1a0c4`.
Baseline: `3e2d4e3db3d15b2301599251ad11a4b1b5127781`, published CLI 0.6.0.

Implementation is in `/home/erbol/.codex/worktrees/66f5/RigorRun`, branch
`feat/hackathon-general-agent-mvp`. The original dirty checkout at
`/home/erbol/RigorRun` and unrelated worktrees were preserved. No push, merge to a
shared branch, deployment, npm release, production test writes or outreach.

## What is implemented

- Backend/CLI and browser review require explicit decisions for inferred rules;
  unknown, duplicated and contradictory decisions are rejected. Observed facts
  do not need a fabricated human decision; rejection remains explicit.
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
| Full Vitest                                | 166 files; 1,929 passed, 1 alternate golden-transcript diagnostic skipped        |
| Example agents                             | 13/13 passed; model requests mocked, not a live model qualification              |
| Helpdesk/Stripe/Helpdesk CLI acceptance    | 3 files, 10/10 passed, no skips or Python omissions                              |
| Fresh Helpdesk repeat                      | 3/3 passed with a new twin/store                                                 |
| Demo + deep-link + domain browser journeys | 58/58 passed, Chromium                                                           |
| Local public-site browser checks           | 96/96 passed, desktop/tablet/mobile, including JS-disabled evidence              |
| Dedicated daemon restart                   | 2/2 passed                                                                       |
| Dedicated operations renderer              | 7/7 passed                                                                       |
| Integrated external-user browser journey   | 1/1 passed; diagnostic failures remain visible, generated release gate returns 3 |
| Contact DNS check                          | MX configured at Zoho; inbox existence and delivery not tested                   |

The final external test adaptation landed after the full verify command's lint
stage started. Its own fresh ESLint check and full integrated external journey
passed afterwards. No runtime/package code changed during that command. Its gate
keeps the original 95% threshold and asserts unchanged run files/assessment bytes
after refusal; it does not manufacture quality or accept a weak release gate.

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
test, and the full 96 checks passed without retries. Desktop/mobile screenshots
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

A minor demo hash guard was added preventatively. Ordinary Projects navigation
already passed before it; no fabricated baseline failure was claimed. Earlier
stale explanatory text in the external test was updated to explicit review,
without weakening downstream evidence checks.

## Show and reproduce

Use [MVP_RUNBOOK.md](MVP_RUNBOOK.md) for exact commands and the model-free demo.
Latest inspected synthetic reports are in
`/tmp/rigorrun-helpdesk-e2e-7Jp8ih` (fresh repeat) and
`/tmp/rigorrun-helpdesk-e2e-wmbXMO` (integrated three-file acceptance). These are
machine-local outputs, not portable fixtures or protected qualification reports.

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
