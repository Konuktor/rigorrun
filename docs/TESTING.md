# Testing

Four layers, four purposes. The distinction matters: a passing smoke test is
not evidence that the product works, and treating it as such is how broken
deployments ship.

| Layer                      | Command                                      | What it answers                             | Runs against               |
| -------------------------- | -------------------------------------------- | ------------------------------------------- | -------------------------- |
| **A — unit & integration** | `pnpm test`                                  | Is the business logic correct?              | Source                     |
| **B — smoke**              | `pnpm smoke:prod`                            | Is the deployment catastrophically broken?  | Production                 |
| **C — acceptance**         | `pnpm e2e`, `pnpm e2e:prod`                  | Does the product actually work, for a user? | Local build and production |
| **D — release gate**       | `pnpm release:verify [--prod]`               | May this ship?                              | Everything above           |

Supporting suites: `pnpm a11y` (WCAG A/AA), `pnpm visual` (golden screenshots),
`pnpm cross` (Chromium and Firefox; WebKit where the host has the libraries),
`pnpm contrast` (design tokens), `pnpm domain` (no business noun in generic
code), `pnpm perf:prod` (Core Web Vitals and layout shift).

## The layer that is easy to miss

There is a fifth thing being tested, and it is the one the product exists for:
**the benchmark itself**. `packages/quality` runs deliberately broken
implementations against every generated suite and asks whether it notices —
along with one control that must *survive*, because a benchmark that fails a
careful agent is unusable as a gate. It also checks that no correct
implementation is failed, that the boundary cases change what a compliant
operator has to do, that the same seed produces the same world, and that the
answer never reaches the agent.

Before RigorRun says whether an agent can be trusted, it says why the test
can be.

## Layer A — unit and integration

762 tests across 64 files: the environment SDK and its conformance kit, the
state-delta engine, the generic projection, canonical trace normalisation, the
rule lifecycle, induction over a deliberately meaningless domain, counterfactual
generation, expected outcomes, benchmark quality, the five demo workflows, a
sixth domain the product has never seen, the bring-your-own HTTP agent, the
verifier, scoring, redaction, the CLI, and security properties.

## Layer B — smoke

Three tests, about three seconds. Landing serves and renders, the demo starts,
the CRM serves. It is deliberately shallow.

## Layer C — acceptance

**Local** (`pnpm e2e`) — the golden journey, the injection case both ways,
contract confirm and reject changing the benchmark, case filters, report export,
the Northstar workflow, responsive journeys at 390 and 820, and the real
recorder extension driven in a real browser.

**Production journeys** (`pnpm e2e:prod`) — 87 tests at 1440 / 820 / 390 against
the deployed site with no local server: the whole pipeline, observed-vs-inferred
rendering, confirming and rejecting rules, every case category, the private
verifier never reaching the agent, the injection case in both directions, dialog
semantics and keyboard operation, report export and publish preview, deep links,
back/forward, refresh, unknown routes, double-click protection, navigation
during a run, no dead controls, and no console errors, failed requests or
horizontal overflow anywhere.


**Performance budgets** (`pnpm perf:prod`) — Core Web Vitals against the
deployed site, measured three times from a cold browser context with the median
asserted, so one noisy sample can neither fail nor pass the gate. Budgets are
Google's "good" thresholds (LCP 2.5s, FCP 1.8s, TTFB 800ms, CLS 0.1), plus a
600 KB transfer budget for the landing page and an 8s budget for executing the
whole benchmark in the browser. Cumulative layout shift is measured on **every**
route at 1440 and 390 — a landing-only budget would have missed the one real
regression this layer found.

## Layer D — release gate

```bash
pnpm release:verify          # contrast, lint, types, unit, build, e2e, a11y, visual, cross
pnpm deploy:all
pnpm release:verify --prod   # the above, plus smoke, API/system state, journeys, performance
```

Exits non-zero if any gate fails, and prints a per-stage summary so a failure is
identifiable at a glance.

## Rules this suite follows

- **No fixed waits.** Web-first assertions and auto-waiting only. There is no
  `waitForTimeout` standing in for a condition.
- **Role and test-id selectors**, never Tailwind classes.
- **Every test owns its state.** Tests do not depend on each other's side
  effects; production API resources are uniquely named and cleaned up.
- **Retries are for diagnosis, not for passing.** A test that only passes on
  retry is debt, and traces are captured on failure to make it findable.
- **No first-party mocking in the golden demo.** The benchmark that runs in the
  production test is the real benchmark.

## Known limitations

**WebKit is not verified on this machine.** Playwright's WebKit needs host
libraries that cannot be installed without root. The cross-browser config
attempts a real launch, and if it fails it skips WebKit with a visible warning
rather than silently dropping an engine. CI installs the dependencies and runs
all three. **Safari compatibility is therefore unverified and is not claimed.**

**Production workspace creation is rate limited** to 10/hour per address, by
design. If the quota is exhausted, the credentialed API tests skip with that
reason rather than reporting a product failure. Set `QA_WORKSPACE_ID` /
`QA_WORKSPACE_TOKEN` (and the `_2` pair) to reuse credentials instead. The smoke
test accepts either answer and checks both properly: a 201 must carry a
well-formed workspace and token, and a 429 must carry the limiter's error and a
positive `retryAfter`. A 500, a timeout or a malformed body still fails.
