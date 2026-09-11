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

**Save is disabled on the tool catalogue.** At least one tool has to be ticked *check with this*.
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
