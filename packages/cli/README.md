# RigorRun

**Acceptance testing for tool-using AI agents.**

Connect your system. Show RigorRun how one job is done. Connect your agent.
RigorRun proves whether the agent can do that job safely — by reading the
system it changed, never by trusting what it says about itself.

```bash
npx rigorrun
```

Open the URL it prints. That is the whole install.

**Early Access · v0.1.** It does what this page says and it is young. The
limits are written down and marked one by one, rather than left for you to
find: [the v1 gap audit](https://github.com/Konuktor/rigorrun/blob/master/docs/V1_GAP_AUDIT.md).

## What it does

You have an agent that calls tools. You need to know whether it can do a real
job in your real system without doing something unsafe — and you need to know
again next week, after somebody changes a prompt.

RigorRun watches a person do that job once, reads the system before and after,
works out what the rules must be, asks about what it can only guess, and turns
the answers into an executable acceptance suite. Then it runs your agent against
it and reads your system to find out what actually happened.

```
   most tools:   you write the tests   →  the tool runs them
     RigorRun:   you do the job once   →  RigorRun writes the tests
```

## Why it runs locally

Your MCP server, your internal API and your staging box are usually not
reachable from the public internet, and a page served over `https` cannot fetch
`http://127.0.0.1`. So RigorRun's interface is served by this process, on your
machine. Your credentials, recordings and systems never touch anybody's
infrastructure, because there is no path by which they could.

## What you need

- **Node 20.11 or newer.**
- **A way in to the system you want to test**: an MCP server, or an OpenAPI
  document and the address it is served from. Ideally staging or a scratch
  instance, with a way to reset it.
- **An agent.** If it speaks MCP it works unchanged; RigorRun hands it a URL —
  whether your agent listens on an address or is a command RigorRun runs. If it
  does not speak MCP, about ten lines of the agent SDK.

## Commands

```bash
npx rigorrun                              # start the runner and open the interface
npx rigorrun doctor                       # check this machine and every project
npx rigorrun projects                     # what is on this machine
npx rigorrun run --project <id>           # run the suite
npx rigorrun gate --project <id>          # run it, and exit non-zero if it misses the bar
npx rigorrun compare-runs --project <id> <runId>
npx rigorrun feedback export              # a sanitised bundle for a bug report
```

## This is early access

It connects to MCP servers, to HTTP APIs with an OpenAPI document, and to web
applications through a browser — though a browser cannot verify itself, so a
verdict from one is OBSERVATIONAL unless something readable is attached.
Setting a project up needs the interface; running and gating it does not. It has
been used successfully by the people who wrote it and is now looking for people
who did not.

Every capability is marked WORKING, PARTIAL or MISSING in
[the v1 gap audit](https://github.com/Konuktor/rigorrun/blob/master/docs/V1_GAP_AUDIT.md),
with how each one was checked. Read it before you rely on this for anything
that matters.

If it goes wrong, `npx rigorrun feedback export` produces a bundle that contains
no credentials, no tool arguments and no results — only what is needed to work
out where it broke.

## Documentation

<https://github.com/Konuktor/rigorrun/tree/master/docs>

MIT licensed.
