---
title: Troubleshooting
description: The errors people actually hit, and what each one means.
---

Start here:

```bash
npx rigorrun doctor
```

It reports the Node version, whether a container runtime is present and whether it is rootless,
which credential store you got, and the state of every project. Exit `0` when everything it needs is
there, `2` when it is not.

## The runner

**"The interface is not built."** You are running from a checkout without building it. `pnpm build:app`
first, or use `npx rigorrun`, which ships the interface.

**The browser did not open.** The URL is printed. On a headless machine that is the whole interface.

**The pairing code stopped working.** It is single-use and redeemed for a session cookie. Press
Enter in the terminal to issue a new one.

**"Not connected", with a Reconnect button.** A stdio MCP server is a child process and does not
survive a runner restart. Nothing is lost; reconnect.

## Connecting

**A tool errors during discovery.** RigorRun records it as not exercised with the reason, rather than
treating the error as a finding.

**Save is disabled on the tool catalogue.** At least one tool has to be ticked _check with this_.
Without one, RigorRun can watch what your agent does but cannot look at your system afterwards — and
a result nobody checked is not worth having. You can continue anyway, and every verdict will say
`OBSERVATIONAL`.

**Nothing was learned from the recording.** The job left no observable trace. RigorRun derives rules
from what changed; if nothing changed that a nominated read can see, there is nothing to derive.

## Running

**Every verdict says `OBSERVATIONAL`.** No read operations are nominated, or the connection is a
browser with no readable system attached. See [choosing a connection](/systems/choosing/).

**Isolation says `DECLARED`.** A reset was nominated but RigorRun has not run it twice and compared.
Expected for most real systems. See [isolation](/concepts/isolation/).

**The gate passes and you do not believe it.** Check the verification strength on the run. If it is
`OBSERVATIONAL`, the gate is checking that your agent did some things, not that the work happened.

## Stripe and black-box agents

**A case says `TIMED_OUT`.** Your agent did not answer within the case budget: 5 minutes per ticket
in the Stripe pack, 60 seconds in a suite generated from a demonstration. That is not a wrong
answer — no rule was broken, and the verdict still shows what Stripe holds, so you can see whether
the refund was right and only late. If the agent was still working, give it longer: add
`--case-timeout <ms>` to `stripe canary`, `run` or `gate` (`--case-timeout 600000` is ten minutes).
The gate counts a timed-out case as not done, on its own line, apart from the undecided ones.

**A local model is slow.** A model in a tool loop — look the order up, check its refunds, refund,
answer — makes several requests per ticket. On one founder's first run, an 8B model through Ollama
on a 4 GB laptop GPU took a median of 171 seconds per ticket. Run `stripe canary` first, with
`--case-timeout 600000` if the canary times out, and expect a whole gate to take minutes per ticket.

**A refund shows up "outside this case".** Each case reads every refund made in the account since
it began, so a refund on a payment no case created counts against the case: somebody else writing
to the account, or the agent finding the wrong payment by searching. Use a test account or Sandbox
that nothing else writes to during a run. A refund on a payment RigorRun created for a _different_
case is that case's, and is never counted against this one. It is usually a slow agent finishing a
case that had already timed out, and the case it landed in says so: _"1 refund landed on another
case's records while this case ran (a late write from an earlier case: …); it is not counted
here."_ Give the agent a longer budget so it finishes inside its own case.

**"Nothing answered at http://127.0.0.1:12112".** The twin is not running. Start it in its own
terminal and leave it running: `npx rigorrun stripe twin`. If the port is taken, start it with
`--port <n>` and pass the same address to `stripe init --twin http://127.0.0.1:<n>`. It listens on
this machine only, accepts any `sk_test_…` key, and holds nothing once stopped: restarting it
forgets every customer and payment, so start a run again after a restart.

**The agent's refunds never show up on the twin.** The agent is calling Stripe itself, not the
twin. Point its Stripe base URL at the twin (the example agent reads `STRIPE_BASE_URL`; see
[the Stripe guide](/start/stripe/#3-your-agent-as-a-black-box) for the SDKs), with any `sk_test_…`
key.

**"agent said (the agent said nothing)".** RigorRun read the claim from the wrong field of your
agent's answer. `--claim-path` names it as a dotted path (`message` for the example agent; the
default is `output`). Run `agent add` again with the same address and the right path; it replaces
the old entry.

## `rigorrun verify`

**Exit `2`.** The harness failed — usually no container runtime. Never a finding about the server.

**Exit `3`.** It ran and established too little: fewer tools were reachable than `--min-exercised`.

## Reporting a problem

```bash
rigorrun feedback export
```

Writes a sanitised bundle to a file for you to inspect and attach. Nothing is uploaded by the
command. Then open an issue at
[github.com/Konuktor/rigorrun](https://github.com/Konuktor/rigorrun/issues).
