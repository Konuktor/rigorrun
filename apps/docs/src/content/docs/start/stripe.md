---
title: Test a Stripe refund agent
description: From a local twin with no keys to a gate in CI — a support agent that issues refunds, judged on what Stripe holds afterwards.
---

Your agent reads a support ticket and issues refunds in Stripe. RigorRun sends it tickets, lets it
work with its own key, then reads Stripe with a key of its own and decides each case on what Stripe
holds — never on what the agent says it did.

Every case creates its own customer and payments, fresh for each attempt, so nothing one case does
can leave a mark on the next, and no account needs resetting.

## 1. Try it on the twin — no keys, about a minute

The twin is a local copy of the parts of Stripe's API the cases use. It runs on your machine and
accepts any test-mode key.

```bash
npx rigorrun stripe twin                      # leave it running; prints http://127.0.0.1:12112
npx rigorrun stripe init --twin --yes         # in another terminal
```

`init` lists the refund policy's rules and asks you to confirm each one (`--yes` confirms all). Only
a rule you confirm can fail your agent: a rule you say no to is left out of the suite, and `init`
names it. Each ticket's own outcome — the refund it is owed, or none — is always checked. It then
creates the project and its suite — seven tickets and a $1.00 canary — and writes
`rigorrun-stripe/ticket.example.json`: exactly what your agent will be sent, with example ids.

## 2. Or your Stripe test mode

```bash
export STRIPE_TEST_KEY=sk_test_…              # RigorRun's key, not your agent's
npx rigorrun stripe init --safety staging
```

The key is read from the environment, so it never sits in your shell history. Before anything is
stored, RigorRun checks its prefix (`sk_test_` or `rk_test_`), then asks Stripe (`GET /v1/balance`)
and stops unless Stripe answers `livemode: false`. A live key is refused without being sent anywhere,
and so is any object that comes back in live mode. The key goes into this machine's secret store,
never into the project file.

Use an account or [Sandbox](https://docs.stripe.com/sandboxes) that nothing else is using while a
run is going: the reads include every refund made in the account since a case began.

## 3. Your agent, as a black box

Your agent needs one thing: an HTTP endpoint that takes a ticket as `rigorrun/task/1`, does the
work with its own Stripe key, and answers with a sentence. It imports nothing from RigorRun.
[examples/stripe-support-agent](https://github.com/Konuktor/rigorrun/tree/master/examples/stripe-support-agent)
is a complete one, and [a black-box agent](/agents/black-box/) describes the envelope.

```bash
npx rigorrun agent add --project <id> --name my-agent \
  --black-box http://127.0.0.1:8787/ --claim-path message
```

Point the agent at the same place RigorRun uses: the twin's address (`STRIPE_BASE_URL`, any
`sk_test_…` key), or `https://api.stripe.com` with a test key of its own.

## 4. The canary

```bash
npx rigorrun stripe canary --project <id> --agent my-agent
```

One case: a $1.00 payment the customer asks back in full. It shows the agent can be reached, can
find the order, and that its refund lands where RigorRun reads — and the shape of every verdict that
follows:

```
Canary · my-agent · PASS
  agent said             Refunded $1.00 on order RR-ORD-3EA44AD3.
  The Stripe twin shows  Refund re_9qwF… of $1.00 on ch_PAko… (a $1.00 charge), succeeded.
```

## 5. The gate

```bash
npx rigorrun gate --project <id> --report report.html
```

Runs every case and exits `0` when the agent clears the bar, `1` when it does not. The report shows,
for each case, what the agent said beside what Stripe holds: an agent that sent `$25.00` as `25`
fails with _Refund re_… of $0.25 on ch_… (a $25.00 charge)_.

`--case <id>` runs only the cases you name; such a run never becomes the baseline.

## 6. In CI

Use [the GitHub Action](/start/ci-gate/#github-action) or `npx rigorrun gate` with the project
store committed or restored. The key arrives as `RIGORRUN_SECRET__STRIPE_TEST_KEY` (the twin's as
`RIGORRUN_SECRET__STRIPE_TWIN_KEY`); RigorRun reads it when nothing is stored.

## What a verdict can and cannot say

- **`PARTIAL`, by design.** RigorRun reads the case's own customers and payments, the refunds and
  disputes on them, and every refund made in the account since the case began. Changes anywhere
  else are not checked. Every verdict prints what its reads covered.
- **And nothing else.** Besides the refunds, every case checks that its customers are still there,
  that no new payment was taken from them, and that its payments still carry their order reference.
  This is always checked; it is what the policy's "and nothing else" means.
- **State only.** A black-box agent's calls are not seen, so nothing is checked about their order;
  everything about what Stripe holds afterwards is.
- **The twin is a simulation.** A verdict against it is marked so, and is good evidence about your
  agent's logic and none about Stripe. Confirm a release against test mode.
- **Live mode is never used.** Not by RigorRun's key, which must be a test key Stripe confirms, and
  not as a fallback.
